const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v']);
const STREAM_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const MINIMUM_PREBUFFER_BYTES = STREAM_CHUNK_SIZE_BYTES;
const TARGET_PREBUFFER_BYTES = 8 * 1024 * 1024;
const PREBUFFER_TIMEOUT_MS = 30000;
const PREBUFFER_POLL_MS = 1000;
const NO_PROGRESS_TIMEOUT_MS = 30000;
const MAX_PREBUFFER_WAIT_MS = 180000;
const MINIMUM_DEADLINE_MS = 250;
const TARGET_DEADLINE_MS = 1000;
const MINIMUM_ENSURE_INTERVAL_MS = 1000;
const TARGET_ENSURE_INTERVAL_MS = 3000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAUSE_VERIFY_TIMEOUT_MS = 5000;
const PAUSE_VERIFY_POLL_MS = 500;
const PAUSE_VERIFY_MAX_DOWNLOAD_RATE = 1024;
const PAUSE_VERIFY_MAX_ATTEMPTS = 3;

const normalizeTorrentStatus = (status = {}) => {
  const paused = Boolean(status?.isPaused ?? status?.paused);
  const state = Number.isInteger(status?.state) ? status.state : Number(status?.state ?? NaN);
  const downloadRate = Number(
    status?.downloadRate
    ?? status?.downloadSpeed
    ?? status?.dlRate
    ?? 0,
  );
  const uploadRate = Number(
    status?.uploadRate
    ?? status?.uploadSpeed
    ?? status?.ulRate
    ?? 0,
  );
  return {
    paused,
    state: Number.isNaN(state) ? null : state,
    downloadRate: Number.isFinite(downloadRate) ? downloadRate : 0,
    uploadRate: Number.isFinite(uploadRate) ? uploadRate : 0,
  };
};

class EmbeddedTorrentStreamService {
  constructor({
    getTorrentManager,
    streamSessionManager,
    localStreamServer,
    mpvPlayerService,
  }) {
    this.getTorrentManager = getTorrentManager;
    this.streamSessionManager = streamSessionManager;
    this.localStreamServer = localStreamServer;
    this.mpvPlayerService = mpvPlayerService;
    this.activeStreams = new Map();
    this.runCounter = 0;
    this.currentRunId = null;
    this.cancelledRuns = new Map();
    this.pausedByStream = new Set();
    this.pauseWatchdogs = new Map();
    this.lastError = null;
    this.currentStatus = {
      runId: null,
      cancelled: false,
      stopRequested: false,
      status: 'idle',
      torrentId: null,
      fileIndex: null,
      selectedFileName: null,
      expectedSize: null,
      prebufferStart: null,
      prebufferEnd: null,
      prebufferReady: false,
      missingPiecesCount: null,
      minimumPrebufferStart: null,
      minimumPrebufferEnd: null,
      minimumPrebufferReady: false,
      minimumMissingPiecesCount: null,
      targetPrebufferStart: null,
      targetPrebufferEnd: null,
      targetPrebufferReady: false,
      targetMissingPiecesCount: null,
      prebufferDownloadRate: null,
      prebufferPeerCount: null,
      lastEnsureResult: null,
      lastMinimumRangeStatus: null,
      lastMinimumEnsureResult: null,
      lastTargetEnsureResult: null,
      lastTargetRangeStatus: null,
      selectedFileIndex: null,
      selectedFileSize: null,
      fileOffset: null,
      elapsedMs: 0,
      lastError: null,
      stopReason: null,
      torrentPaused: null,
      torrentState: null,
      torrentDownloadRate: null,
      torrentUploadRate: null,
      pauseVerified: null,
      waitingForFirstPiece: false,
      firstPiece: null,
      pieceLength: null,
      firstPieceAvailability: null,
      totalWantedDone: null,
      lastProgressAt: null,
      noProgressElapsedMs: null,
      lastPauseAttemptAt: null,
      pauseRetryCount: 0,
      pausedByStream: false,
      pauseWatchdogActive: false,
      pauseWatchdogRepauses: 0,
      lastPauseWatchdogAt: null,
    };
  }

  setStatus(next = {}) {
    this.currentStatus = {
      ...this.currentStatus,
      ...next,
    };
  }

  createRunId() {
    this.runCounter += 1;
    return `run-${Date.now()}-${this.runCounter}`;
  }

  startRun(runId) {
    this.currentRunId = runId;
    this.cancelledRuns.delete(runId);
  }

  cancelRun(runId, reason = 'stop-requested') {
    if (!runId) return;
    this.cancelledRuns.set(runId, { cancelled: true, reason, at: Date.now() });
  }

  isRunActive(runId) {
    if (!runId) return false;
    if (this.currentRunId !== runId) return false;
    if (this.cancelledRuns.has(runId)) return false;
    return true;
  }

  throwIfRunCancelled(runId) {
    if (!this.isRunActive(runId)) {
      const info = this.cancelledRuns.get(runId) || {};
      const err = new Error(`stream cancelled (${String(info.reason || 'unknown')})`);
      err.code = 'RUN_CANCELLED';
      throw err;
    }
  }

  isTorrentLocked(torrentId) {
    const id = String(torrentId || '').trim();
    return id ? this.pausedByStream.has(id) : false;
  }

  clearPausedLock(torrentId) {
    const id = String(torrentId || '').trim();
    if (!id) return;
    this.pausedByStream.delete(id);
    const watchdog = this.pauseWatchdogs.get(id);
    if (watchdog?.timer) clearInterval(watchdog.timer);
    this.pauseWatchdogs.delete(id);
  }

  startPauseWatchdog(torrentId) {
    const id = String(torrentId || '').trim();
    if (!id) return;
    const existing = this.pauseWatchdogs.get(id);
    if (existing?.timer) {
      clearInterval(existing.timer);
    }
    const startedAt = Date.now();
    const state = { timer: null, repauses: 0, startedAt, lastAt: startedAt };
    state.timer = setInterval(async () => {
      if (!this.pausedByStream.has(id)) {
        if (state.timer) clearInterval(state.timer);
        this.pauseWatchdogs.delete(id);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed > 20000) {
        if (state.timer) clearInterval(state.timer);
        this.pauseWatchdogs.delete(id);
        this.setStatus({ pauseWatchdogActive: false });
        return;
      }
      try {
        const tm = await this.getTorrentManager();
        const st = await tm.getStatus(id);
        const normalized = normalizeTorrentStatus(st);
        if (!normalized.paused || normalized.downloadRate > 1024) {
          state.repauses += 1;
          state.lastAt = Date.now();
          await tm.pause(id, { force: true, reason: 'pause-watchdog' });
          console.info('[EmbeddedTorrentStream:PauseWatchdog]', {
            torrentId: id,
            phase: 're-paused',
            repauses: state.repauses,
            paused: normalized.paused,
            downloadRate: normalized.downloadRate,
          });
          this.setStatus({
            pauseWatchdogRepauses: state.repauses,
            lastPauseWatchdogAt: state.lastAt,
          });
        }
      } catch (error) {
        console.warn('[EmbeddedTorrentStream:PauseWatchdog]', {
          torrentId: id,
          phase: 'error',
          error: String(error?.message || error),
        });
      }
    }, 2000);
    this.pauseWatchdogs.set(id, state);
    this.setStatus({
      pauseWatchdogActive: true,
      pauseWatchdogRepauses: 0,
      lastPauseWatchdogAt: startedAt,
    });
  }

  onTorrentResumed(torrentId) {
    this.clearPausedLock(torrentId);
  }

  normalizeSourceInput(options = {}) {
    const source = String(options?.source || '').trim();
    const sourceKind = String(options?.sourceKind || '').trim().toLowerCase();
    if (!source) {
      throw new Error('Source is required.');
    }
    if (!['magnet', 'torrent-url', 'infohash'].includes(sourceKind)) {
      throw new Error('Unsupported sourceKind. Use magnet, torrent-url, or infohash.');
    }
    return { source, sourceKind };
  }

  buildPreparePayload({ source, sourceKind, title }) {
    const payload = {
      mode: 'download',
      title: String(title || 'Embedded Torrent Stream').trim(),
      mediaInfo: {},
    };
    if (sourceKind === 'torrent-url') {
      payload.torrentUrl = source;
      payload.magnetOrHash = '';
    } else {
      payload.magnetOrHash = source;
      payload.torrentUrl = '';
    }
    return payload;
  }

  async resolveTorrentFiles(tm, torrentId, prepareResult, shouldContinue = null) {
    let files = Array.isArray(prepareResult?.files) ? prepareResult.files : [];
    if (files.length) return files;

    for (let i = 0; i < 60; i += 1) {
      if (typeof shouldContinue === 'function' && !shouldContinue()) {
        const err = new Error('stream cancelled (resolve-files)');
        err.code = 'RUN_CANCELLED';
        throw err;
      }
      const latest = await tm.getFiles(torrentId);
      if (latest?.ok && Array.isArray(latest.files) && latest.files.length) {
        return latest.files;
      }
      await delay(1000);
    }
    return [];
  }

  pickVideoFile(files = [], selectedFileIndex) {
    const videoFiles = (Array.isArray(files) ? files : [])
      .filter((file) => {
        const filePath = String(file?.path || file?.name || '').toLowerCase();
        const ext = path.extname(filePath);
        return VIDEO_EXTENSIONS.has(ext);
      })
      .map((file) => ({
        index: Number(file.index),
        path: String(file.path || ''),
        size: Math.max(0, Number(file.size || 0)),
      }))
      .filter((file) => Number.isInteger(file.index) && file.index >= 0 && file.path);

    if (!videoFiles.length) return null;

    const requested = Number(selectedFileIndex);
    if (Number.isInteger(requested)) {
      const direct = videoFiles.find((file) => file.index === requested);
      if (direct) return direct;
    }

    return [...videoFiles].sort((a, b) => b.size - a.size)[0];
  }

  async startEmbeddedTorrentStream(options = {}) {
    try {
      const runId = this.createRunId();
      this.startRun(runId);
      const { source, sourceKind } = this.normalizeSourceInput(options);
      const title = String(options?.title || 'Embedded Torrent Stream').trim();
      const bounds = options?.bounds && typeof options.bounds === 'object' ? options.bounds : undefined;
      const isPlayerMode = options?.isPlayerMode === true;
      console.info('[EmbeddedTorrentStream:StartBounds]', {
        sourceKind,
        title,
        isPlayerMode,
        bounds: bounds || null,
        fallbackUsed: !bounds,
      });
      if (isPlayerMode && !bounds) {
        console.warn('[EmbeddedTorrentStream:StartBounds] Missing fullscreen bounds for player mode');
      }
      const startedAt = Date.now();
      console.info('[EmbeddedTorrentStream] start requested', { sourceKind });
      this.setStatus({
        runId,
        cancelled: false,
        stopRequested: false,
        status: 'preparing',
        torrentId: null,
        fileIndex: null,
        selectedFileName: null,
        expectedSize: null,
        prebufferStart: null,
        prebufferEnd: null,
        prebufferReady: false,
        missingPiecesCount: null,
        minimumPrebufferStart: null,
        minimumPrebufferEnd: null,
        minimumPrebufferReady: false,
        minimumMissingPiecesCount: null,
        targetPrebufferStart: null,
        targetPrebufferEnd: null,
        targetPrebufferReady: false,
        targetMissingPiecesCount: null,
        prebufferDownloadRate: null,
        prebufferPeerCount: null,
        lastEnsureResult: null,
        lastMinimumRangeStatus: null,
        lastMinimumEnsureResult: null,
        lastTargetEnsureResult: null,
        lastTargetRangeStatus: null,
        selectedFileIndex: null,
        selectedFileSize: null,
        fileOffset: null,
        elapsedMs: 0,
        lastError: null,
        stopReason: null,
        torrentPaused: null,
        torrentState: null,
        torrentDownloadRate: null,
        torrentUploadRate: null,
        pauseVerified: null,
        waitingForFirstPiece: false,
        firstPiece: null,
        pieceLength: null,
        firstPieceAvailability: null,
        totalWantedDone: null,
        lastProgressAt: null,
        noProgressElapsedMs: null,
        lastPauseAttemptAt: null,
        pauseRetryCount: 0,
      });

      const tm = await this.getTorrentManager();
      this.throwIfRunCancelled(runId);
      const preparePayload = this.buildPreparePayload({ source, sourceKind, title });
      const prepareResult = await tm.prepare(preparePayload);
      this.throwIfRunCancelled(runId);
      if (!prepareResult?.ok || !prepareResult?.id) {
        throw new Error(prepareResult?.error || 'torrent-prepare failed.');
      }
      const torrentId = String(prepareResult.id);
      if (this.isTorrentLocked(torrentId)) {
        this.clearPausedLock(torrentId);
      }
      const files = await this.resolveTorrentFiles(
        tm,
        torrentId,
        prepareResult,
        () => this.isRunActive(runId),
      );
      this.throwIfRunCancelled(runId);
      if (!files.length) {
        throw new Error('TODO: Metadata/files not ready for stream yet.');
      }

      const picked = this.pickVideoFile(files, options?.selectedFileIndex);
      if (!picked) {
        throw new Error('No playable video file found in torrent.');
      }
      this.setStatus({
        runId,
        status: 'selecting-file',
        torrentId,
        fileIndex: picked.index,
        selectedFileIndex: picked.index,
        selectedFileName: path.basename(picked.path || ''),
        expectedSize: Number(picked.size || 0),
        selectedFileSize: Number(picked.size || 0),
        elapsedMs: Date.now() - startedAt,
      });

      const selectResult = await tm.selectFiles(torrentId, [picked.index], true, true);
      this.throwIfRunCancelled(runId);
      if (!selectResult?.ok) {
        throw new Error(selectResult?.error || 'torrent-select-files failed.');
      }

      const status = await tm.getStatus(torrentId);
      this.throwIfRunCancelled(runId);
      const savePath = String(status?.savePath || '').trim();
      if (!savePath || !picked.path) {
        throw new Error('TODO: Could not resolve local file path from torrent status.');
      }
      const localFilePath = path.resolve(savePath, picked.path);
      const expectedSize = Math.max(0, Number(picked.size || 0));
      if (expectedSize <= 0) {
        throw new Error('TODO: Selected file size is unavailable for growing stream session.');
      }

      await this.localStreamServer.start();
      this.throwIfRunCancelled(runId);
      // TODO: currentSize-based readiness in LocalStreamServer is not true piece readiness.
      // Sparse/preallocated torrent files can report misleading readable size.
      // Next phase should query torrent_service.py for piece/range readiness.
      const session = this.streamSessionManager.createGrowingFileSession({
        filePath: localFilePath,
        title,
        expectedSize,
        torrentId,
        fileIndex: picked.index,
        readinessMode: 'torrent-piece',
      });
      const streamUrl = this.localStreamServer.getStreamUrl(session.streamId);

      const prebufferStart = 0;
      const minimumPrebufferStart = 0;
      const minimumPrebufferEnd = Math.min(expectedSize - 1, MINIMUM_PREBUFFER_BYTES - 1);
      const targetPrebufferStart = 0;
      const targetPrebufferEnd = Math.min(expectedSize - 1, TARGET_PREBUFFER_BYTES - 1);
      this.setStatus({
        runId,
        cancelled: false,
        stopRequested: false,
        status: 'prebuffering',
        torrentId,
        fileIndex: picked.index,
        selectedFileIndex: picked.index,
        selectedFileName: path.basename(picked.path || ''),
        expectedSize,
        selectedFileSize: Number(picked.size || 0),
        prebufferStart,
        prebufferEnd: targetPrebufferEnd,
        prebufferReady: false,
        minimumPrebufferStart,
        minimumPrebufferEnd,
        minimumPrebufferReady: false,
        minimumMissingPiecesCount: null,
        targetPrebufferStart,
        targetPrebufferEnd,
        targetPrebufferReady: false,
        targetMissingPiecesCount: null,
        elapsedMs: Date.now() - startedAt,
      });
      try {
        const initialTargetEnsure = await tm.ensureRange({
          torrentId,
          fileIndex: picked.index,
          start: targetPrebufferStart,
          end: targetPrebufferEnd,
          deadlineMs: TARGET_DEADLINE_MS,
          allowResume: true,
        });
        this.throwIfRunCancelled(runId);
        console.info('[EmbeddedTorrentStream:PrebufferEnsure]', {
          phase: 'target',
          torrentId,
          fileIndex: picked.index,
          selectedFileName: path.basename(picked.path || ''),
          selectedFileIndex: picked.index,
          selectedFileSize: Number(picked.size || 0),
          start: targetPrebufferStart,
          end: targetPrebufferEnd,
          elapsedMs: 0,
          ok: Boolean(initialTargetEnsure?.ok),
          ready: Boolean(initialTargetEnsure?.ready),
          missingPiecesCount: Array.isArray(initialTargetEnsure?.missingPieces) ? initialTargetEnsure.missingPieces.length : null,
          missingPieces: initialTargetEnsure?.missingPieces || [],
          fileOffset: initialTargetEnsure?.fileOffset ?? null,
          fileSize: initialTargetEnsure?.fileSize ?? null,
          pieceLength: initialTargetEnsure?.pieceLength ?? null,
          firstPiece: initialTargetEnsure?.firstPiece ?? null,
          lastPiece: initialTargetEnsure?.lastPiece ?? null,
          checkedPieces: initialTargetEnsure?.checkedPieces ?? null,
          piecePriorities: initialTargetEnsure?.piecePriorities || [],
          pieceAvailability: initialTargetEnsure?.pieceAvailability || [],
          state: initialTargetEnsure?.state ?? null,
          paused: initialTargetEnsure?.paused ?? null,
          uploadMode: initialTargetEnsure?.uploadMode ?? null,
          downloadRate: initialTargetEnsure?.downloadRate ?? null,
          uploadRate: initialTargetEnsure?.uploadRate ?? null,
          numPeers: initialTargetEnsure?.numPeers ?? null,
          totalWantedDone: initialTargetEnsure?.totalWantedDone ?? null,
          totalWanted: initialTargetEnsure?.totalWanted ?? null,
          progress: initialTargetEnsure?.progress ?? null,
          beforeStatus: initialTargetEnsure?.beforeStatus ?? null,
          afterStatus: initialTargetEnsure?.afterStatus ?? null,
          prioritizedPieces: initialTargetEnsure?.prioritizedPieces ?? null,
          deadlineAppliedPieces: initialTargetEnsure?.deadlineAppliedPieces ?? null,
          priorityErrors: initialTargetEnsure?.priorityErrors || [],
          deadlineErrors: initialTargetEnsure?.deadlineErrors || [],
          resumed: initialTargetEnsure?.resumed ?? null,
          sequentialEnabled: initialTargetEnsure?.sequentialEnabled ?? null,
          deadlineMs: TARGET_DEADLINE_MS,
        });
        this.setStatus({
          lastEnsureResult: {
            phase: 'target',
            ok: Boolean(initialTargetEnsure?.ok),
            ready: Boolean(initialTargetEnsure?.ready),
            missingPiecesCount: Array.isArray(initialTargetEnsure?.missingPieces) ? initialTargetEnsure.missingPieces.length : null,
            prioritizedPieces: initialTargetEnsure?.prioritizedPieces ?? null,
            deadlineMs: TARGET_DEADLINE_MS,
            elapsedMs: 0,
          },
          lastTargetEnsureResult: initialTargetEnsure || null,
        });
      } catch (error) {
        console.warn('[TorrentEnsureRange] prebuffer ensure failed:', {
          torrentId,
          fileIndex: picked.index,
          error: String(error?.message || error),
        });
      }

      const prebufferStartAt = Date.now();
      let prebufferDeadlineAt = prebufferStartAt + PREBUFFER_TIMEOUT_MS;
      const maxPrebufferDeadlineAt = prebufferStartAt + MAX_PREBUFFER_WAIT_MS;
      let lastMinimumEnsureAt = 0;
      let lastTargetEnsureAt = 0;
      let minimumPrebufferReady = false;
      let minimumMissingPiecesCount = null;
      let targetPrebufferReady = false;
      let targetMissingPiecesCount = null;
      let lastProgressBytes = 0;
      let lastProgressAt = prebufferStartAt;
      let lastObservedFirstPieceAvailability = null;
      while (Date.now() < prebufferDeadlineAt && Date.now() < maxPrebufferDeadlineAt) {
        const elapsedMs = Date.now() - prebufferStartAt;
        if (!minimumPrebufferReady && (elapsedMs - lastMinimumEnsureAt) >= MINIMUM_ENSURE_INTERVAL_MS) {
          if (this.isTorrentLocked(torrentId)) {
            console.info('[EmbeddedTorrentStream:PausedLock]', {
              torrentId,
              phase: 'minimum-ensure',
              action: 'skip ensure',
            });
            await delay(PREBUFFER_POLL_MS);
            continue;
          }
          const minimumEnsure = await tm.ensureRange({
            torrentId,
            fileIndex: picked.index,
            start: minimumPrebufferStart,
            end: minimumPrebufferEnd,
            deadlineMs: MINIMUM_DEADLINE_MS,
            allowResume: true,
          });
          this.throwIfRunCancelled(runId);
          lastMinimumEnsureAt = elapsedMs;
          console.info('[EmbeddedTorrentStream:PrebufferEnsure]', {
            phase: 'minimum',
            torrentId,
            fileIndex: picked.index,
            selectedFileName: path.basename(picked.path || ''),
            selectedFileIndex: picked.index,
            selectedFileSize: Number(picked.size || 0),
            start: minimumPrebufferStart,
            end: minimumPrebufferEnd,
            elapsedMs,
            ok: Boolean(minimumEnsure?.ok),
            ready: Boolean(minimumEnsure?.ready),
            missingPiecesCount: Array.isArray(minimumEnsure?.missingPieces) ? minimumEnsure.missingPieces.length : null,
            missingPieces: minimumEnsure?.missingPieces || [],
            fileOffset: minimumEnsure?.fileOffset ?? null,
            fileSize: minimumEnsure?.fileSize ?? null,
            pieceLength: minimumEnsure?.pieceLength ?? null,
            firstPiece: minimumEnsure?.firstPiece ?? null,
            lastPiece: minimumEnsure?.lastPiece ?? null,
            checkedPieces: minimumEnsure?.checkedPieces ?? null,
            piecePriorities: minimumEnsure?.piecePriorities || [],
            pieceAvailability: minimumEnsure?.pieceAvailability || [],
            downloadRate: minimumEnsure?.downloadRate ?? null,
            uploadRate: minimumEnsure?.uploadRate ?? null,
            numPeers: minimumEnsure?.numPeers ?? null,
            state: minimumEnsure?.state ?? null,
            paused: minimumEnsure?.paused ?? null,
            uploadMode: minimumEnsure?.uploadMode ?? null,
            totalWantedDone: minimumEnsure?.totalWantedDone ?? null,
            totalWanted: minimumEnsure?.totalWanted ?? null,
            progress: minimumEnsure?.progress ?? null,
            beforeStatus: minimumEnsure?.beforeStatus ?? null,
            afterStatus: minimumEnsure?.afterStatus ?? null,
            prioritizedPieces: minimumEnsure?.prioritizedPieces ?? null,
            deadlineAppliedPieces: minimumEnsure?.deadlineAppliedPieces ?? null,
            priorityErrors: minimumEnsure?.priorityErrors || [],
            deadlineErrors: minimumEnsure?.deadlineErrors || [],
            resumed: minimumEnsure?.resumed ?? null,
            sequentialEnabled: minimumEnsure?.sequentialEnabled ?? null,
            deadlineMs: MINIMUM_DEADLINE_MS,
          });
          this.setStatus({
            lastEnsureResult: {
              phase: 'minimum',
              ok: Boolean(minimumEnsure?.ok),
              ready: Boolean(minimumEnsure?.ready),
              missingPiecesCount: Array.isArray(minimumEnsure?.missingPieces) ? minimumEnsure.missingPieces.length : null,
              prioritizedPieces: minimumEnsure?.prioritizedPieces ?? null,
              deadlineMs: MINIMUM_DEADLINE_MS,
              elapsedMs,
            },
            lastMinimumEnsureResult: minimumEnsure || null,
            fileOffset: minimumEnsure?.fileOffset ?? null,
          });
        }
        if (!targetPrebufferReady && (elapsedMs - lastTargetEnsureAt) >= TARGET_ENSURE_INTERVAL_MS) {
          if (this.isTorrentLocked(torrentId)) {
            console.info('[EmbeddedTorrentStream:PausedLock]', {
              torrentId,
              phase: 'target-ensure',
              action: 'skip ensure',
            });
          } else {
          const targetEnsure = await tm.ensureRange({
            torrentId,
            fileIndex: picked.index,
            start: targetPrebufferStart,
            end: targetPrebufferEnd,
            deadlineMs: TARGET_DEADLINE_MS,
            allowResume: true,
          });
          this.throwIfRunCancelled(runId);
          lastTargetEnsureAt = elapsedMs;
          console.info('[EmbeddedTorrentStream:PrebufferEnsure]', {
            phase: 'target',
            torrentId,
            fileIndex: picked.index,
            selectedFileName: path.basename(picked.path || ''),
            selectedFileIndex: picked.index,
            selectedFileSize: Number(picked.size || 0),
            start: targetPrebufferStart,
            end: targetPrebufferEnd,
            elapsedMs,
            ok: Boolean(targetEnsure?.ok),
            ready: Boolean(targetEnsure?.ready),
            missingPiecesCount: Array.isArray(targetEnsure?.missingPieces) ? targetEnsure.missingPieces.length : null,
            missingPieces: targetEnsure?.missingPieces || [],
            fileOffset: targetEnsure?.fileOffset ?? null,
            fileSize: targetEnsure?.fileSize ?? null,
            pieceLength: targetEnsure?.pieceLength ?? null,
            firstPiece: targetEnsure?.firstPiece ?? null,
            lastPiece: targetEnsure?.lastPiece ?? null,
            checkedPieces: targetEnsure?.checkedPieces ?? null,
            piecePriorities: targetEnsure?.piecePriorities || [],
            pieceAvailability: targetEnsure?.pieceAvailability || [],
            state: targetEnsure?.state ?? null,
            paused: targetEnsure?.paused ?? null,
            uploadMode: targetEnsure?.uploadMode ?? null,
            downloadRate: targetEnsure?.downloadRate ?? null,
            uploadRate: targetEnsure?.uploadRate ?? null,
            numPeers: targetEnsure?.numPeers ?? null,
            totalWantedDone: targetEnsure?.totalWantedDone ?? null,
            totalWanted: targetEnsure?.totalWanted ?? null,
            progress: targetEnsure?.progress ?? null,
            beforeStatus: targetEnsure?.beforeStatus ?? null,
            afterStatus: targetEnsure?.afterStatus ?? null,
            prioritizedPieces: targetEnsure?.prioritizedPieces ?? null,
            deadlineAppliedPieces: targetEnsure?.deadlineAppliedPieces ?? null,
            priorityErrors: targetEnsure?.priorityErrors || [],
            deadlineErrors: targetEnsure?.deadlineErrors || [],
            resumed: targetEnsure?.resumed ?? null,
            sequentialEnabled: targetEnsure?.sequentialEnabled ?? null,
            deadlineMs: TARGET_DEADLINE_MS,
          });
          this.setStatus({
            lastEnsureResult: {
              phase: 'target',
              ok: Boolean(targetEnsure?.ok),
              ready: Boolean(targetEnsure?.ready),
              missingPiecesCount: Array.isArray(targetEnsure?.missingPieces) ? targetEnsure.missingPieces.length : null,
              prioritizedPieces: targetEnsure?.prioritizedPieces ?? null,
              deadlineMs: TARGET_DEADLINE_MS,
              elapsedMs,
            },
            lastTargetEnsureResult: targetEnsure || null,
          });
          }
        }
        const minimumRangeStatus = await tm.checkRangeStatus({
          torrentId,
          fileIndex: picked.index,
          start: minimumPrebufferStart,
          end: minimumPrebufferEnd,
        });
        const targetRangeStatus = await tm.checkRangeStatus({
          torrentId,
          fileIndex: picked.index,
          start: targetPrebufferStart,
          end: targetPrebufferEnd,
        });
        minimumPrebufferReady = Boolean(minimumRangeStatus?.ok && minimumRangeStatus?.ready === true);
        minimumMissingPiecesCount = Array.isArray(minimumRangeStatus?.missingPieces)
          ? minimumRangeStatus.missingPieces.length
          : null;
        targetPrebufferReady = Boolean(targetRangeStatus?.ok && targetRangeStatus?.ready === true);
        targetMissingPiecesCount = Array.isArray(targetRangeStatus?.missingPieces)
          ? targetRangeStatus.missingPieces.length
          : null;
        const torrentStatus = await tm.getStatus(torrentId);
        this.throwIfRunCancelled(runId);
        const prebufferDownloadRate = Number(torrentStatus?.downloadRate ?? torrentStatus?.downloadSpeed ?? 0) || 0;
        const prebufferPeerCount = Number(torrentStatus?.numPeers ?? 0) || 0;
        const totalWantedDone = Number(torrentStatus?.totalWantedDone ?? 0) || 0;
        if (totalWantedDone > lastProgressBytes) {
          lastProgressBytes = totalWantedDone;
          lastProgressAt = Date.now();
        }
        const firstPiece = Number.isFinite(Number(minimumRangeStatus?.firstPiece))
          ? Number(minimumRangeStatus.firstPiece)
          : null;
        const pieceLength = Number.isFinite(Number(minimumRangeStatus?.pieceLength))
          ? Number(minimumRangeStatus.pieceLength)
          : null;
        const pieceAvailability = Array.isArray(minimumRangeStatus?.pieceAvailability)
          ? minimumRangeStatus.pieceAvailability
          : [];
        const firstPieceAvailability = pieceAvailability.length > 0
          ? Number(pieceAvailability[0]?.availability ?? pieceAvailability[0] ?? 0) || 0
          : 0;
        lastObservedFirstPieceAvailability = firstPieceAvailability;
        const waitingForFirstPiece = !minimumPrebufferReady && Number(minimumMissingPiecesCount || 0) > 0;
        const noProgressElapsedMs = Date.now() - lastProgressAt;
        const hasActiveSignals = prebufferPeerCount > 0 || prebufferDownloadRate > 0 || firstPieceAvailability > 0;
        if (!minimumPrebufferReady && hasActiveSignals) {
          prebufferDeadlineAt = Math.min(maxPrebufferDeadlineAt, Date.now() + NO_PROGRESS_TIMEOUT_MS);
        }
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          phase: 'minimum',
          torrentId,
          fileIndex: picked.index,
          start: minimumPrebufferStart,
          end: minimumPrebufferEnd,
          ready: minimumPrebufferReady,
          missingPiecesCount: minimumMissingPiecesCount,
          firstPiece,
          firstPieceAvailability,
          pieceLength,
          downloadRate: prebufferDownloadRate,
          peerCount: prebufferPeerCount,
          totalWantedDone,
          waitingForFirstPiece,
          noProgressElapsedMs,
          elapsedMs,
          timeout: false,
        });
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          phase: 'target',
          torrentId,
          fileIndex: picked.index,
          start: targetPrebufferStart,
          end: targetPrebufferEnd,
          ready: targetPrebufferReady,
          missingPiecesCount: targetMissingPiecesCount,
          elapsedMs,
          timeout: false,
        });
        this.setStatus({
          runId,
          cancelled: false,
          stopRequested: false,
          status: minimumPrebufferReady ? 'ready' : 'prebuffering',
          torrentId,
          fileIndex: picked.index,
          selectedFileName: path.basename(picked.path || ''),
          expectedSize,
          prebufferStart,
          prebufferEnd: targetPrebufferEnd,
          prebufferReady: minimumPrebufferReady,
          missingPiecesCount: minimumMissingPiecesCount,
          minimumPrebufferStart,
          minimumPrebufferEnd,
          minimumPrebufferReady,
          minimumMissingPiecesCount,
          targetPrebufferStart,
          targetPrebufferEnd,
          targetPrebufferReady,
          targetMissingPiecesCount,
          lastMinimumRangeStatus: minimumRangeStatus || null,
          lastTargetRangeStatus: targetRangeStatus || null,
          fileOffset: minimumRangeStatus?.fileOffset ?? targetRangeStatus?.fileOffset ?? null,
          prebufferDownloadRate,
          prebufferPeerCount,
          waitingForFirstPiece,
          firstPiece,
          pieceLength,
          firstPieceAvailability,
          totalWantedDone,
          lastProgressAt,
          noProgressElapsedMs,
          elapsedMs: Date.now() - startedAt,
        });
        if (minimumPrebufferReady) break;
        if (waitingForFirstPiece && noProgressElapsedMs >= NO_PROGRESS_TIMEOUT_MS) {
          this.streamSessionManager.closeSession(session.streamId);
          if (prebufferPeerCount <= 0 && firstPieceAvailability <= 0) {
            throw new Error('first piece unavailable');
          }
          throw new Error('prebuffer stalled');
        }
        await delay(PREBUFFER_POLL_MS);
      }

      if (!minimumPrebufferReady) {
        const elapsedMs = Date.now() - prebufferStartAt;
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          phase: 'minimum',
          torrentId,
          fileIndex: picked.index,
          start: minimumPrebufferStart,
          end: minimumPrebufferEnd,
          ready: false,
          missingPiecesCount: minimumMissingPiecesCount,
          firstPieceAvailability: lastObservedFirstPieceAvailability,
          elapsedMs,
          timeout: true,
        });
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          phase: 'target',
          torrentId,
          fileIndex: picked.index,
          start: targetPrebufferStart,
          end: targetPrebufferEnd,
          ready: targetPrebufferReady,
          missingPiecesCount: targetMissingPiecesCount,
          elapsedMs,
          timeout: true,
        });
        this.streamSessionManager.closeSession(session.streamId);
        throw new Error('prebuffer stalled');
      }

      this.throwIfRunCancelled(runId);
      const mpvResult = await this.mpvPlayerService.startMpvPlayback({
        sourceType: 'embedded-stream-url',
        source: streamUrl,
        url: streamUrl,
        title,
        mode: 'native-host',
        bounds,
        isPlayerMode,
      });
      if (!mpvResult?.ok) {
        this.streamSessionManager.closeSession(session.streamId);
        throw new Error(mpvResult?.error || 'MPV start failed.');
      }

      this.lastError = null;
      this.setStatus({
        runId,
        cancelled: false,
        stopRequested: false,
        status: 'playing',
        torrentId,
        fileIndex: picked.index,
        selectedFileName: path.basename(picked.path || ''),
        expectedSize,
        prebufferStart,
        prebufferEnd: targetPrebufferEnd,
        prebufferReady: true,
        missingPiecesCount: minimumMissingPiecesCount ?? 0,
        minimumPrebufferStart,
        minimumPrebufferEnd,
        minimumPrebufferReady: true,
        minimumMissingPiecesCount: minimumMissingPiecesCount ?? 0,
        targetPrebufferStart,
        targetPrebufferEnd,
        targetPrebufferReady,
        targetMissingPiecesCount,
        prebufferDownloadRate: null,
        prebufferPeerCount: null,
        selectedFileIndex: picked.index,
        selectedFileSize: Number(picked.size || 0),
        elapsedMs: Date.now() - startedAt,
        lastError: null,
        torrentPaused: null,
        torrentState: null,
        torrentDownloadRate: null,
        torrentUploadRate: null,
        pauseVerified: null,
        waitingForFirstPiece: false,
        firstPiece: null,
        pieceLength: null,
        firstPieceAvailability: null,
        totalWantedDone: null,
        lastProgressAt: null,
        noProgressElapsedMs: null,
      });
      this.activeStreams.set(session.streamId, {
        runId,
        cancelled: false,
        stopRequested: false,
        streamId: session.streamId,
        torrentId,
        fileIndex: picked.index,
        localFilePath,
        streamUrl,
        mpvStarted: true,
        startedAt: Date.now(),
        status: 'playing',
        stopReason: null,
        selectedFileName: path.basename(picked.path || ''),
      });

      console.info('[EmbeddedTorrentStream] started', {
        sourceKind,
        selectedFile: picked.path,
        selectedIndex: picked.index,
        localFilePath,
        streamUrl,
      });

      return {
        ok: true,
        streamId: session.streamId,
        torrentId,
        selectedFileIndex: picked.index,
        selectedFilePath: picked.path,
        localFilePath,
        streamUrl,
        details: mpvResult?.details,
      };
    } catch (error) {
      const message = String(error?.message || 'Embedded torrent stream start failed.');
      if (error?.code === 'RUN_CANCELLED') {
        return {
          ok: false,
          cancelled: true,
          error: message,
        };
      }
      this.lastError = message;
      this.setStatus({
        status: 'error',
        lastError: message,
      });
      console.error('[EmbeddedTorrentStream] start failed', { error: message });
      return {
        ok: false,
        error: message,
      };
    }
  }

  getActiveStreamEntry(streamId) {
    const requestedId = String(streamId || '').trim();
    if (requestedId && this.activeStreams.has(requestedId)) {
      return { streamId: requestedId, stream: this.activeStreams.get(requestedId) };
    }
    const first = this.activeStreams.entries().next();
    if (!first.done) {
      const [id, stream] = first.value;
      return { streamId: id, stream };
    }
    return { streamId: '', stream: null };
  }

  async stopEmbeddedTorrentStream(options = {}) {
    const streamId = typeof options === 'string' ? options : options?.streamId;
    const modeRaw = typeof options === 'string' ? 'playback-only' : String(options?.mode || 'playback-only').trim();
    const mode = ['playback-only', 'pause-torrent', 'remove-torrent'].includes(modeRaw) ? modeRaw : 'playback-only';
    const removeFiles = options?.removeFiles === true;

    const { streamId: targetId, stream: active } = this.getActiveStreamEntry(streamId);
    if (!active) {
      return {
        ok: true,
        stopped: false,
        stoppedMpv: false,
        closedSession: false,
        torrentAction: 'none',
      };
    }

    let stoppedMpv = false;
    let closedSession = false;
    let torrentAction = 'none';
    let pauseVerified = null;
    let torrentPaused = null;
    let torrentState = null;
    let torrentDownloadRate = null;
    let torrentUploadRate = null;
    let warning = null;
    let filesRemoved = null;
    let pauseRetryCount = 0;
    let lastPauseAttemptAt = null;
    const errors = [];

    if (active?.runId) {
      this.cancelRun(active.runId, mode);
    } else if (this.currentRunId) {
      this.cancelRun(this.currentRunId, mode);
    }
    this.setStatus({
      runId: active?.runId || this.currentRunId || null,
      cancelled: true,
      stopRequested: true,
      stopReason: mode,
    });
    if (mode === 'pause-torrent' && active?.torrentId) {
      this.pausedByStream.add(String(active.torrentId));
      this.setStatus({ pausedByStream: true });
    }

    try {
      const stopResult = await this.mpvPlayerService.stopMpvPlayback();
      stoppedMpv = Boolean(stopResult?.ok);
      if (!stopResult?.ok) {
        errors.push(String(stopResult?.error || 'Failed to stop MPV playback.'));
      }
    } catch (error) {
      errors.push(String(error?.message || 'Failed to stop MPV playback.'));
    }

    try {
      closedSession = Boolean(this.streamSessionManager.closeSession(targetId));
      if (active && typeof active === 'object') {
        active.pendingEnsureRanges = {};
      }
    } catch (error) {
      errors.push(String(error?.message || 'Failed to close stream session.'));
    }

    if (mode !== 'playback-only' && active.torrentId) {
      try {
        const tm = await this.getTorrentManager();
        if (mode === 'pause-torrent') {
          const verifyStartedAt = Date.now();
          const pauseResult = await tm.pause(active.torrentId, { force: true, reason: 'stream-close' });
          pauseRetryCount = 1;
          lastPauseAttemptAt = Date.now();
          console.info('[EmbeddedTorrentStream:PauseVerify]', {
            torrentId: active.torrentId,
            phase: 'pause-request',
            attempt: pauseRetryCount,
            pauseResult,
          });
          let pauseStatus = null;
          let elapsedMs = 0;
          if (pauseResult?.ok) {
            while ((Date.now() - verifyStartedAt) <= PAUSE_VERIFY_TIMEOUT_MS) {
              pauseStatus = await tm.getStatus(active.torrentId);
              const normalized = normalizeTorrentStatus(pauseStatus);
              torrentPaused = normalized.paused;
              torrentState = normalized.state;
              torrentDownloadRate = normalized.downloadRate;
              torrentUploadRate = normalized.uploadRate;
              elapsedMs = Date.now() - verifyStartedAt;
              pauseVerified = torrentPaused && torrentDownloadRate <= PAUSE_VERIFY_MAX_DOWNLOAD_RATE;
              console.info('[EmbeddedTorrentStream:PauseVerify]', {
                torrentId: active.torrentId,
                phase: 'pause-status-poll',
                attempt: pauseRetryCount,
                paused: torrentPaused,
                state: torrentState,
                downloadRate: torrentDownloadRate,
                uploadRate: torrentUploadRate,
                elapsedMs,
                pauseVerified,
              });
              if (pauseVerified) break;
              if (pauseRetryCount < PAUSE_VERIFY_MAX_ATTEMPTS && elapsedMs >= pauseRetryCount * 1500) {
                pauseRetryCount += 1;
                lastPauseAttemptAt = Date.now();
                const retryResult = await tm.pause(active.torrentId, { force: true, reason: 'stream-close-retry' });
                console.info('[EmbeddedTorrentStream:PauseVerify]', {
                  torrentId: active.torrentId,
                  phase: 'pause-retry',
                  attempt: pauseRetryCount,
                  pauseResult: retryResult,
                });
              }
              await delay(PAUSE_VERIFY_POLL_MS);
            }
            if (pauseVerified) {
              console.info('[EmbeddedTorrentStream:PauseVerify]', {
                torrentId: active.torrentId,
                phase: 'pause-verified',
                pauseVerified: true,
                pauseRetryCount,
                lastPauseAttemptAt,
              });
            }
            if (!pauseVerified) {
              warning = 'pause requested but torrent still active';
              errors.push(warning);
              console.info('[EmbeddedTorrentStream:PauseVerify]', {
                torrentId: active.torrentId,
                phase: 'pause-timeout',
                pauseRetryCount,
                paused: torrentPaused,
                state: torrentState,
                downloadRate: torrentDownloadRate,
                uploadRate: torrentUploadRate,
                elapsedMs: Date.now() - verifyStartedAt,
                pauseVerified: false,
              });
            }
            this.startPauseWatchdog(active.torrentId);
          }
          torrentAction = pauseResult?.ok ? 'paused' : 'pause-failed';
          if (!pauseResult?.ok) {
            pauseVerified = false;
            warning = warning || 'Failed to pause torrent.';
            errors.push(String(pauseResult?.error || 'Failed to pause torrent.'));
          }
        } else if (mode === 'remove-torrent') {
          this.clearPausedLock(active.torrentId);
          const removeResult = await tm.remove(active.torrentId, removeFiles === true);
          torrentAction = removeResult?.ok ? 'removed' : 'remove-failed';
          filesRemoved = removeFiles === true;
          if (!removeResult?.ok) errors.push(String(removeResult?.error || 'Failed to remove torrent.'));
        }
      } catch (error) {
        torrentAction = mode === 'pause-torrent' ? 'pause-failed' : 'remove-failed';
        errors.push(String(error?.message || 'Torrent action failed.'));
      }
    }

    this.activeStreams.delete(targetId);
    if (active?.runId && this.currentRunId === active.runId) {
      this.currentRunId = null;
    }
    this.setStatus({
      runId: active?.runId || null,
      cancelled: true,
      stopRequested: true,
      status: 'idle',
      torrentId: null,
      fileIndex: null,
      selectedFileName: null,
      expectedSize: null,
      prebufferStart: null,
      prebufferEnd: null,
      prebufferReady: false,
      missingPiecesCount: null,
      minimumPrebufferStart: null,
      minimumPrebufferEnd: null,
      minimumPrebufferReady: false,
      minimumMissingPiecesCount: null,
      targetPrebufferStart: null,
      targetPrebufferEnd: null,
      targetPrebufferReady: false,
      targetMissingPiecesCount: null,
      prebufferDownloadRate: null,
      prebufferPeerCount: null,
      lastEnsureResult: null,
      lastMinimumRangeStatus: null,
      lastMinimumEnsureResult: null,
      lastTargetEnsureResult: null,
      lastTargetRangeStatus: null,
      selectedFileIndex: null,
      selectedFileSize: null,
      fileOffset: null,
      elapsedMs: 0,
      stopReason: mode,
      lastError: errors.length ? errors.join(' | ') : null,
      torrentPaused,
      torrentState,
      torrentDownloadRate,
      torrentUploadRate,
      pauseVerified,
      lastPauseAttemptAt,
      pauseRetryCount,
      waitingForFirstPiece: false,
      firstPiece: null,
      pieceLength: null,
      firstPieceAvailability: null,
      totalWantedDone: null,
      lastProgressAt: null,
      noProgressElapsedMs: null,
      pausedByStream: Boolean(active?.torrentId && this.isTorrentLocked(active.torrentId)),
      pauseWatchdogActive: Boolean(active?.torrentId && this.pauseWatchdogs.has(String(active.torrentId))),
      pauseWatchdogRepauses: this.currentStatus.pauseWatchdogRepauses || 0,
      lastPauseWatchdogAt: this.currentStatus.lastPauseWatchdogAt || null,
    });
    if (errors.length) this.lastError = errors.join(' | ');
    console.info('[EmbeddedTorrentStream] stopped', {
      streamId: targetId,
      torrentId: active.torrentId,
      mode,
      stoppedMpv,
      closedSession,
      torrentAction,
      removeFiles,
      partialErrors: errors,
      pauseVerified,
      torrentPaused,
      torrentState,
      downloadRate: torrentDownloadRate,
      uploadRate: torrentUploadRate,
      lastPauseAttemptAt,
      pauseRetryCount,
      warning,
      filesRemoved,
    });
    return {
      ok: errors.length === 0,
      stopped: true,
      streamId: targetId,
      stoppedMpv,
      closedSession,
      torrentAction,
      pauseVerified,
      torrentPaused,
      torrentState,
      downloadRate: torrentDownloadRate,
      uploadRate: torrentUploadRate,
      lastPauseAttemptAt,
      pauseRetryCount,
      warning,
      removeFiles,
      filesRemoved,
      error: errors.length ? errors.join(' | ') : undefined,
    };
  }

  async shutdown() {
    const activeIds = Array.from(this.activeStreams.keys());
    for (const id of activeIds) {
      await this.stopEmbeddedTorrentStream({ streamId: id, mode: 'playback-only' });
    }
  }

  getEmbeddedTorrentStreamStatus() {
    const mpvStatus = this.mpvPlayerService.getMpvStatus?.();
    if (this.activeStreams.size > 0 && mpvStatus?.status && ['stopped', 'error', 'unavailable'].includes(mpvStatus.status)) {
      const reason = mpvStatus.status === 'error' ? 'mpv_error' : 'mpv_stopped';
      this.activeStreams.clear();
      this.setStatus({
        status: mpvStatus.status === 'error' ? 'error' : 'idle',
        stopReason: reason,
        lastError: mpvStatus?.lastError || this.currentStatus.lastError,
      });
    }
    return {
      ok: true,
      runId: this.currentStatus.runId,
      cancelled: this.currentStatus.cancelled,
      stopRequested: this.currentStatus.stopRequested,
      status: this.currentStatus.status,
      torrentId: this.currentStatus.torrentId,
      fileIndex: this.currentStatus.fileIndex,
      selectedFileName: this.currentStatus.selectedFileName,
      expectedSize: this.currentStatus.expectedSize,
      prebufferStart: this.currentStatus.prebufferStart,
      prebufferEnd: this.currentStatus.prebufferEnd,
      prebufferReady: this.currentStatus.prebufferReady,
      missingPiecesCount: this.currentStatus.missingPiecesCount,
      minimumPrebufferStart: this.currentStatus.minimumPrebufferStart,
      minimumPrebufferEnd: this.currentStatus.minimumPrebufferEnd,
      minimumPrebufferReady: this.currentStatus.minimumPrebufferReady,
      minimumMissingPiecesCount: this.currentStatus.minimumMissingPiecesCount,
      targetPrebufferStart: this.currentStatus.targetPrebufferStart,
      targetPrebufferEnd: this.currentStatus.targetPrebufferEnd,
      targetPrebufferReady: this.currentStatus.targetPrebufferReady,
      targetMissingPiecesCount: this.currentStatus.targetMissingPiecesCount,
      prebufferDownloadRate: this.currentStatus.prebufferDownloadRate,
      prebufferPeerCount: this.currentStatus.prebufferPeerCount,
      lastEnsureResult: this.currentStatus.lastEnsureResult,
      lastMinimumRangeStatus: this.currentStatus.lastMinimumRangeStatus,
      lastMinimumEnsureResult: this.currentStatus.lastMinimumEnsureResult,
      lastTargetEnsureResult: this.currentStatus.lastTargetEnsureResult,
      lastTargetRangeStatus: this.currentStatus.lastTargetRangeStatus,
      selectedFileIndex: this.currentStatus.selectedFileIndex,
      selectedFileSize: this.currentStatus.selectedFileSize,
      fileOffset: this.currentStatus.fileOffset,
      elapsedMs: this.currentStatus.elapsedMs,
      stopReason: this.currentStatus.stopReason,
      activeStreamCount: this.activeStreams.size,
      activeStreams: Array.from(this.activeStreams.values()),
      torrentPaused: this.currentStatus.torrentPaused,
      torrentState: this.currentStatus.torrentState,
      torrentDownloadRate: this.currentStatus.torrentDownloadRate,
      torrentUploadRate: this.currentStatus.torrentUploadRate,
      pauseVerified: this.currentStatus.pauseVerified,
      waitingForFirstPiece: this.currentStatus.waitingForFirstPiece,
      firstPiece: this.currentStatus.firstPiece,
      pieceLength: this.currentStatus.pieceLength,
      firstPieceAvailability: this.currentStatus.firstPieceAvailability,
      totalWantedDone: this.currentStatus.totalWantedDone,
      lastProgressAt: this.currentStatus.lastProgressAt,
      noProgressElapsedMs: this.currentStatus.noProgressElapsedMs,
      lastPauseAttemptAt: this.currentStatus.lastPauseAttemptAt,
      pauseRetryCount: this.currentStatus.pauseRetryCount,
      pausedByStream: this.currentStatus.pausedByStream,
      pauseWatchdogActive: this.currentStatus.pauseWatchdogActive,
      pauseWatchdogRepauses: this.currentStatus.pauseWatchdogRepauses,
      lastPauseWatchdogAt: this.currentStatus.lastPauseWatchdogAt,
      lastError: this.currentStatus.lastError || this.lastError,
    };
  }
}

module.exports = {
  EmbeddedTorrentStreamService,
};
