const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v']);
const STREAM_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const MINIMUM_PREBUFFER_BYTES = STREAM_CHUNK_SIZE_BYTES;
const TARGET_PREBUFFER_BYTES = 8 * 1024 * 1024;
const PREBUFFER_TIMEOUT_MS = 30000;
const PREBUFFER_POLL_MS = 1000;
const MINIMUM_DEADLINE_MS = 250;
const TARGET_DEADLINE_MS = 1000;
const MINIMUM_ENSURE_INTERVAL_MS = 1000;
const TARGET_ENSURE_INTERVAL_MS = 3000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAUSE_VERIFY_TIMEOUT_MS = 5000;
const PAUSE_VERIFY_POLL_MS = 500;
const PAUSE_VERIFY_MAX_DOWNLOAD_RATE = 1024;

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
    this.lastError = null;
    this.currentStatus = {
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
    };
  }

  setStatus(next = {}) {
    this.currentStatus = {
      ...this.currentStatus,
      ...next,
    };
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

  async resolveTorrentFiles(tm, torrentId, prepareResult) {
    let files = Array.isArray(prepareResult?.files) ? prepareResult.files : [];
    if (files.length) return files;

    for (let i = 0; i < 60; i += 1) {
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
      const { source, sourceKind } = this.normalizeSourceInput(options);
      const title = String(options?.title || 'Embedded Torrent Stream').trim();
      const bounds = options?.bounds && typeof options.bounds === 'object' ? options.bounds : undefined;
      const startedAt = Date.now();
      console.info('[EmbeddedTorrentStream] start requested', { sourceKind });
      this.setStatus({
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
      });

      const tm = await this.getTorrentManager();
      const preparePayload = this.buildPreparePayload({ source, sourceKind, title });
      const prepareResult = await tm.prepare(preparePayload);
      if (!prepareResult?.ok || !prepareResult?.id) {
        throw new Error(prepareResult?.error || 'torrent-prepare failed.');
      }
      const torrentId = String(prepareResult.id);
      const files = await this.resolveTorrentFiles(tm, torrentId, prepareResult);
      if (!files.length) {
        throw new Error('TODO: Metadata/files not ready for stream yet.');
      }

      const picked = this.pickVideoFile(files, options?.selectedFileIndex);
      if (!picked) {
        throw new Error('No playable video file found in torrent.');
      }
      this.setStatus({
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
      if (!selectResult?.ok) {
        throw new Error(selectResult?.error || 'torrent-select-files failed.');
      }

      const status = await tm.getStatus(torrentId);
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
        });
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
      let lastMinimumEnsureAt = 0;
      let lastTargetEnsureAt = 0;
      let minimumPrebufferReady = false;
      let minimumMissingPiecesCount = null;
      let targetPrebufferReady = false;
      let targetMissingPiecesCount = null;
      while ((Date.now() - prebufferStartAt) < PREBUFFER_TIMEOUT_MS) {
        const elapsedMs = Date.now() - prebufferStartAt;
        if (!minimumPrebufferReady && (elapsedMs - lastMinimumEnsureAt) >= MINIMUM_ENSURE_INTERVAL_MS) {
          const minimumEnsure = await tm.ensureRange({
            torrentId,
            fileIndex: picked.index,
            start: minimumPrebufferStart,
            end: minimumPrebufferEnd,
            deadlineMs: MINIMUM_DEADLINE_MS,
          });
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
          const targetEnsure = await tm.ensureRange({
            torrentId,
            fileIndex: picked.index,
            start: targetPrebufferStart,
            end: targetPrebufferEnd,
            deadlineMs: TARGET_DEADLINE_MS,
          });
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
        const prebufferDownloadRate = Number(torrentStatus?.downloadRate ?? torrentStatus?.downloadSpeed ?? 0) || 0;
        const prebufferPeerCount = Number(torrentStatus?.numPeers ?? 0) || 0;
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          phase: 'minimum',
          torrentId,
          fileIndex: picked.index,
          start: minimumPrebufferStart,
          end: minimumPrebufferEnd,
          ready: minimumPrebufferReady,
          missingPiecesCount: minimumMissingPiecesCount,
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
          elapsedMs: Date.now() - startedAt,
        });
        if (minimumPrebufferReady) break;
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
        throw new Error('minimum prebuffer timeout');
      }

      const mpvResult = await this.mpvPlayerService.startMpvPlayback({
        sourceType: 'embedded-stream-url',
        source: streamUrl,
        url: streamUrl,
        title,
        mode: 'native-host',
        bounds,
      });
      if (!mpvResult?.ok) {
        this.streamSessionManager.closeSession(session.streamId);
        throw new Error(mpvResult?.error || 'MPV start failed.');
      }

      this.lastError = null;
      this.setStatus({
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
      });
      this.activeStreams.set(session.streamId, {
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
    const errors = [];

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
    } catch (error) {
      errors.push(String(error?.message || 'Failed to close stream session.'));
    }

    if (mode !== 'playback-only' && active.torrentId) {
      try {
        const tm = await this.getTorrentManager();
        if (mode === 'pause-torrent') {
          const verifyStartedAt = Date.now();
          const pauseResult = await tm.pause(active.torrentId);
          console.info('[EmbeddedTorrentStream:PauseVerify]', {
            torrentId: active.torrentId,
            phase: 'pause-request',
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
                paused: torrentPaused,
                state: torrentState,
                downloadRate: torrentDownloadRate,
                uploadRate: torrentUploadRate,
                elapsedMs,
                pauseVerified,
              });
              if (pauseVerified) break;
              await delay(PAUSE_VERIFY_POLL_MS);
            }
            if (!pauseVerified) {
              warning = 'pause requested but torrent still active';
              errors.push(warning);
              console.info('[EmbeddedTorrentStream:PauseVerify]', {
                torrentId: active.torrentId,
                phase: 'pause-timeout',
                paused: torrentPaused,
                state: torrentState,
                downloadRate: torrentDownloadRate,
                uploadRate: torrentUploadRate,
                elapsedMs: Date.now() - verifyStartedAt,
                pauseVerified: false,
              });
            }
          }
          torrentAction = pauseResult?.ok ? 'paused' : 'pause-failed';
          if (!pauseResult?.ok) {
            pauseVerified = false;
            warning = warning || 'Failed to pause torrent.';
            errors.push(String(pauseResult?.error || 'Failed to pause torrent.'));
          }
        } else if (mode === 'remove-torrent') {
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
    this.setStatus({
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
      lastError: this.currentStatus.lastError || this.lastError,
    };
  }
}

module.exports = {
  EmbeddedTorrentStreamService,
};
