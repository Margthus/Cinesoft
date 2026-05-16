const path = require('path');

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m4v']);
const PREBUFFER_BYTES = 8 * 1024 * 1024;
const PREBUFFER_TIMEOUT_MS = 30000;
const PREBUFFER_POLL_MS = 1000;
const PREBUFFER_DEADLINE_MS = 1000;

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
        selectedFileName: path.basename(picked.path || ''),
        expectedSize: Number(picked.size || 0),
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
      const prebufferEnd = Math.min(expectedSize - 1, PREBUFFER_BYTES - 1);
      this.setStatus({
        status: 'prebuffering',
        torrentId,
        fileIndex: picked.index,
        selectedFileName: path.basename(picked.path || ''),
        expectedSize,
        prebufferStart,
        prebufferEnd,
        prebufferReady: false,
        elapsedMs: Date.now() - startedAt,
      });
      try {
        await tm.ensureRange({
          torrentId,
          fileIndex: picked.index,
          start: prebufferStart,
          end: prebufferEnd,
          deadlineMs: PREBUFFER_DEADLINE_MS,
        });
      } catch (error) {
        console.warn('[TorrentEnsureRange] prebuffer ensure failed:', {
          torrentId,
          fileIndex: picked.index,
          error: String(error?.message || error),
        });
      }

      const prebufferStartAt = Date.now();
      let prebufferReady = false;
      let missingPiecesCount = null;
      while ((Date.now() - prebufferStartAt) < PREBUFFER_TIMEOUT_MS) {
        const rangeStatus = await tm.checkRangeStatus({
          torrentId,
          fileIndex: picked.index,
          start: prebufferStart,
          end: prebufferEnd,
        });
        prebufferReady = Boolean(rangeStatus?.ok && rangeStatus?.ready === true);
        missingPiecesCount = Array.isArray(rangeStatus?.missingPieces) ? rangeStatus.missingPieces.length : null;
        const elapsedMs = Date.now() - prebufferStartAt;
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          torrentId,
          fileIndex: picked.index,
          start: prebufferStart,
          end: prebufferEnd,
          ready: prebufferReady,
          missingPiecesCount,
          elapsedMs,
          timeout: false,
        });
        this.setStatus({
          status: prebufferReady ? 'ready' : 'prebuffering',
          torrentId,
          fileIndex: picked.index,
          selectedFileName: path.basename(picked.path || ''),
          expectedSize,
          prebufferStart,
          prebufferEnd,
          prebufferReady,
          missingPiecesCount,
          elapsedMs: Date.now() - startedAt,
        });
        if (prebufferReady) break;
        await delay(PREBUFFER_POLL_MS);
      }

      if (!prebufferReady) {
        const elapsedMs = Date.now() - prebufferStartAt;
        console.info('[EmbeddedTorrentStream:Prebuffer]', {
          torrentId,
          fileIndex: picked.index,
          start: prebufferStart,
          end: prebufferEnd,
          ready: false,
          missingPiecesCount,
          elapsedMs,
          timeout: true,
        });
        this.streamSessionManager.closeSession(session.streamId);
        throw new Error('prebuffer timeout');
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
        prebufferEnd,
        prebufferReady: true,
        missingPiecesCount: 0,
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
