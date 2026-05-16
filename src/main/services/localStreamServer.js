const http = require('http');
const fs = require('fs');

const STREAM_ROUTE_PREFIX = '/stream/';
const GROWING_FALLBACK_CHUNK_BYTES = 2 * 1024 * 1024;
const STREAM_CHUNK_SIZE_BYTES = Math.max(
  64 * 1024,
  Number(process.env.CINESOFT_STREAM_CHUNK_SIZE_BYTES) || (2 * 1024 * 1024),
);
const STREAM_READ_AHEAD_CHUNKS = Math.max(
  0,
  Number(process.env.CINESOFT_STREAM_READ_AHEAD_CHUNKS) || 4,
);
const ENSURE_RANGE_THROTTLE_MS = 2000;

const parseRangeHeader = (rangeHeader = '', fileSize = 0) => {
  const raw = String(rangeHeader || '').trim();
  const match = raw.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return { invalid: true };

  const startRaw = match[1];
  const endRaw = match[2];
  let start = null;
  let end = null;

  if (startRaw === '' && endRaw === '') return { invalid: true };

  let isOpenEnded = false;
  if (startRaw === '') {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isFinite(start) || start < 0) return { invalid: true };
    if (endRaw === '') {
      isOpenEnded = true;
      end = fileSize - 1;
    } else {
      end = Number(endRaw);
      if (!Number.isFinite(end) || end < 0) return { invalid: true };
    }
  }

  if (start >= fileSize || end >= fileSize || start > end) return { invalid: true };
  return { start, end, isOpenEnded };
};

class LocalStreamServer {
  constructor(streamSessionManager) {
    this.streamSessionManager = streamSessionManager;
    this.server = null;
    this.port = null;
    this.torrentRangeChecker = null;
    this.torrentEnsureRange = null;
  }

  setTorrentRangeChecker(checker) {
    this.torrentRangeChecker = typeof checker === 'function' ? checker : null;
  }

  setTorrentEnsureRange(ensurer) {
    this.torrentEnsureRange = typeof ensurer === 'function' ? ensurer : null;
  }

  shouldSkipDuplicateEnsure(sessionRef, rangeKey) {
    if (!sessionRef || !rangeKey) return false;
    const now = Date.now();
    const pending = (sessionRef.pendingEnsureRanges && typeof sessionRef.pendingEnsureRanges === 'object')
      ? sessionRef.pendingEnsureRanges
      : {};
    const previous = Number(pending[rangeKey] || 0);
    if (previous > 0 && (now - previous) < ENSURE_RANGE_THROTTLE_MS) {
      return true;
    }
    pending[rangeKey] = now;
    sessionRef.pendingEnsureRanges = pending;
    return false;
  }

  triggerReadAheadPrefetch({ streamId, sessionRef, torrentId, fileIndex, expectedSize, baseStart, baseEnd }) {
    if (!this.torrentEnsureRange || !sessionRef || !torrentId || !Number.isInteger(fileIndex)) return;
    if (STREAM_READ_AHEAD_CHUNKS <= 0) return;

    let nextStart = Number(baseEnd) + 1;
    for (let chunkIndex = 1; chunkIndex <= STREAM_READ_AHEAD_CHUNKS; chunkIndex += 1) {
      if (nextStart >= expectedSize) break;
      const prefetchStart = nextStart;
      const prefetchEnd = Math.min(prefetchStart + STREAM_CHUNK_SIZE_BYTES - 1, expectedSize - 1);
      nextStart = prefetchEnd + 1;
      const rangeKey = `${torrentId}:${fileIndex}:${prefetchStart}:${prefetchEnd}`;
      const skippedDuplicate = this.shouldSkipDuplicateEnsure(sessionRef, rangeKey);
      if (skippedDuplicate) {
        console.info('[LocalStreamServer:Prefetch]', {
          streamId,
          torrentId,
          fileIndex,
          baseStart,
          baseEnd,
          prefetchStart,
          prefetchEnd,
          chunkIndex,
          skippedDuplicate: true,
        });
        continue;
      }
      sessionRef.lastPrefetchAt = Date.now();
      this.torrentEnsureRange({
        torrentId,
        fileIndex,
        start: prefetchStart,
        end: prefetchEnd,
        deadlineMs: 1000,
      }).then((result) => {
        console.info('[LocalStreamServer:Prefetch]', {
          streamId,
          torrentId,
          fileIndex,
          baseStart,
          baseEnd,
          prefetchStart,
          prefetchEnd,
          chunkIndex,
          skippedDuplicate: false,
          ok: Boolean(result?.ok),
          error: result?.error || null,
        });
      }).catch((error) => {
        console.warn('[LocalStreamServer:Prefetch]', {
          streamId,
          torrentId,
          fileIndex,
          baseStart,
          baseEnd,
          prefetchStart,
          prefetchEnd,
          chunkIndex,
          skippedDuplicate: false,
          ok: false,
          error: String(error?.message || error),
        });
      });
    }
  }

  async start() {
    if (this.server && this.port) return this.getBaseUrl();

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('[LocalStreamServer] request failed:', error?.message || error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ ok: false, error: 'Stream request failed.' }));
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        this.port = address && typeof address === 'object' ? Number(address.port) : null;
        resolve();
      });
    });

    return this.getBaseUrl();
  }

  async stop() {
    if (!this.server) return;
    const currentServer = this.server;
    this.server = null;
    this.port = null;
    await new Promise((resolve) => {
      currentServer.close(() => resolve());
    });
  }

  isRunning() {
    return Boolean(this.server && this.port);
  }

  getBaseUrl() {
    return this.port ? `http://127.0.0.1:${this.port}` : '';
  }

  getPort() {
    return this.port || null;
  }

  getStreamUrl(streamId) {
    if (!this.port) return '';
    return `${this.getBaseUrl()}${STREAM_ROUTE_PREFIX}${encodeURIComponent(String(streamId || '').trim())}`;
  }

  async handleRequest(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const streamId = requestUrl.pathname.startsWith(STREAM_ROUTE_PREFIX)
      ? decodeURIComponent(requestUrl.pathname.slice(STREAM_ROUTE_PREFIX.length))
      : '';
    const rangeHeader = String(req.headers.range || '');
    console.info('[LocalStreamServer:Request]', {
      method,
      url: requestUrl.pathname,
      streamId,
      range: rangeHeader || null,
    });

    const sendWithLog = (statusCode, headers = {}, details = {}) => {
      res.writeHead(statusCode, headers);
      console.info('[LocalStreamServer:Response]', {
        method,
        url: requestUrl.pathname,
        streamId,
        range: rangeHeader || null,
        statusCode,
        ...details,
      });
    };
    const logReadiness = ({
      requestedStart = null,
      requestedEnd = null,
      clampedStart = null,
      clampedEnd = null,
      expectedSize = null,
      currentSize = null,
      ready = false,
      reason = '',
      originalRange = null,
      isOpenEndedRange = false,
      chunkSize = STREAM_CHUNK_SIZE_BYTES,
    } = {}) => {
      console.info('[LocalStreamServer:Readiness]', {
        streamId,
        originalRange,
        requestedStart,
        requestedEnd,
        clampedStart,
        clampedEnd,
        isOpenEndedRange,
        chunkSize,
        expectedSize,
        currentSize,
        ready,
        reason,
      });
    };

    if (method !== 'GET' && method !== 'HEAD') {
      sendWithLog(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    if (!requestUrl.pathname.startsWith(STREAM_ROUTE_PREFIX)) {
      sendWithLog(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found.' }));
      return;
    }

    const sessionRef = this.streamSessionManager.getSession(streamId, { raw: true });
    const session = sessionRef ? { ...sessionRef } : null;
    if (!session) {
      sendWithLog(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Stream session not found.' }));
      return;
    }

    const sourceType = String(session.sourceType || 'local-file');
    const expectedSize = Number(session.expectedSize || 0);
    const readinessMode = String(session.readinessMode || 'file-size');
    const torrentId = String(session.torrentId || '').trim();
    const fileIndex = Number.isInteger(Number(session.fileIndex)) ? Number(session.fileIndex) : null;
    let fileSize = 0;
    let fileExists = fs.existsSync(session.filePath);
    if (fileExists) {
      try {
        const stat = fs.statSync(session.filePath);
        fileSize = Number(stat.size || 0);
      } catch {
        fileExists = false;
        fileSize = 0;
      }
    }
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': session.mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };

    if (sourceType === 'local-file' && !fileExists) {
      sendWithLog(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Source file not found.' }));
      return;
    }

    if (sourceType === 'growing-file' && (!Number.isFinite(expectedSize) || expectedSize <= 0)) {
      sendWithLog(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid expectedSize for growing-file session.' }));
      return;
    }

    if (method === 'HEAD') {
      if (sourceType === 'growing-file' && !fileExists) {
        sendWithLog(503, {
          ...commonHeaders,
          'Content-Length': String(expectedSize),
          'Retry-After': '2',
          'X-Stream-Error': 'range_not_ready',
        }, {
          total: expectedSize,
          contentLength: expectedSize,
        });
        logReadiness({
          requestedStart: null,
          requestedEnd: null,
          clampedStart: null,
          clampedEnd: null,
          expectedSize,
          currentSize: 0,
          ready: false,
          reason: 'file_missing',
        });
        res.end();
        return;
      }
      const headTotal = sourceType === 'growing-file' ? expectedSize : fileSize;
      sendWithLog(200, {
        ...commonHeaders,
        'Content-Length': String(headTotal),
      }, {
        total: headTotal,
        contentLength: headTotal,
      });
      res.end();
      return;
    }

    const totalSize = sourceType === 'growing-file' ? expectedSize : fileSize;
    if (sourceType === 'local-file' && totalSize <= 0) {
      sendWithLog(200, {
        ...commonHeaders,
        'Content-Length': '0',
      }, {
        total: 0,
        contentLength: 0,
      });
      res.end();
      return;
    }
    const parsedRange = rangeHeader ? parseRangeHeader(rangeHeader, totalSize) : null;
    const hasParsedRange = Boolean(parsedRange && Number.isFinite(parsedRange.start) && Number.isFinite(parsedRange.end));
    const isOpenEndedRange = Boolean(parsedRange?.isOpenEnded);
    const originalRange = rangeHeader || null;
    const requestedStart = hasParsedRange ? parsedRange.start : null;
    const requestedEnd = hasParsedRange ? parsedRange.end : null;
    if (rangeHeader && parsedRange?.invalid) {
      sendWithLog(416, {
        ...commonHeaders,
        'Content-Range': `bytes */${totalSize}`,
      }, {
        total: totalSize,
      });
      logReadiness({
        requestedStart: null,
        requestedEnd: null,
        clampedStart: null,
        clampedEnd: null,
        expectedSize: totalSize,
        currentSize: fileSize,
        ready: false,
        reason: 'invalid_range',
        originalRange,
        isOpenEndedRange,
        chunkSize: STREAM_CHUNK_SIZE_BYTES,
      });
      res.end();
      return;
    }

    let start = 0;
    let end = totalSize > 0 ? totalSize - 1 : 0;
    let statusCode = sourceType === 'growing-file' ? 206 : 200;
    const responseHeaders = { ...commonHeaders };

    if (hasParsedRange) {
      start = parsedRange.start;
      end = Math.min(parsedRange.end, totalSize - 1);
      if (sourceType === 'growing-file' && isOpenEndedRange) {
        end = Math.min(start + STREAM_CHUNK_SIZE_BYTES - 1, totalSize - 1);
      }
      statusCode = 206;
    } else if (sourceType === 'growing-file') {
      if (!fileExists || fileSize <= 0) {
        sendWithLog(503, {
          ...commonHeaders,
          'Retry-After': '2',
          'X-Stream-Error': 'range_not_ready',
        });
        logReadiness({
          requestedStart: 0,
          requestedEnd: null,
          clampedStart: null,
          clampedEnd: null,
          expectedSize: totalSize,
          currentSize: fileSize,
          ready: false,
          reason: !fileExists ? 'file_missing' : 'no_ready_bytes',
        });
        res.end();
        return;
      }
      start = 0;
      end = Math.min(fileSize - 1, GROWING_FALLBACK_CHUNK_BYTES - 1, totalSize - 1);
      statusCode = 206;
    }

    if (start >= totalSize || start > end) {
      sendWithLog(416, {
        ...commonHeaders,
        'Content-Range': `bytes */${totalSize}`,
      }, {
        total: totalSize,
      });
      logReadiness({
        requestedStart: start,
        requestedEnd: end,
        clampedStart: start,
        clampedEnd: end,
        expectedSize: totalSize,
        currentSize: fileSize,
        ready: false,
        reason: 'range_out_of_bounds',
        originalRange,
        isOpenEndedRange,
        chunkSize: STREAM_CHUNK_SIZE_BYTES,
      });
      res.end();
      return;
    }

    if (sourceType === 'growing-file') {
      if (readinessMode === 'torrent-piece' && this.torrentRangeChecker && torrentId && Number.isInteger(fileIndex)) {
        try {
          const rangeStatus = await this.torrentRangeChecker({
            torrentId,
            fileIndex,
            start,
            end,
          });
          if (!rangeStatus?.ok) {
            console.warn('[TorrentRangeStatus] fallback to file-size readiness:', {
              torrentId,
              fileIndex,
              start,
              end,
              error: String(rangeStatus?.error || 'range_status_not_ok'),
            });
          } else {
            const pieceReady = Boolean(rangeStatus?.ok && rangeStatus?.ready === true);
            const missingCount = Array.isArray(rangeStatus?.missingPieces) ? rangeStatus.missingPieces.length : null;
            console.info('[TorrentRangeStatus]', {
              torrentId,
              fileIndex,
              start,
              end,
              firstPiece: rangeStatus?.firstPiece ?? null,
              lastPiece: rangeStatus?.lastPiece ?? null,
              ready: pieceReady,
              missingPiecesCount: missingCount,
            });
            if (!pieceReady) {
              if (this.torrentEnsureRange) {
                const ensureKey = `${torrentId}:${fileIndex}:${start}:${end}`;
                const skippedDuplicate = this.shouldSkipDuplicateEnsure(sessionRef, ensureKey);
                try {
                  if (!skippedDuplicate) {
                    const ensureResult = await this.torrentEnsureRange({
                      torrentId,
                      fileIndex,
                      start,
                      end,
                      deadlineMs: 1000,
                    });
                    console.info('[TorrentEnsureRange]', {
                      torrentId,
                      fileIndex,
                      start,
                      end,
                      firstPiece: ensureResult?.firstPiece ?? null,
                      lastPiece: ensureResult?.lastPiece ?? null,
                      ready: Boolean(ensureResult?.ready),
                      missingPiecesCount: Array.isArray(ensureResult?.missingPieces) ? ensureResult.missingPieces.length : null,
                      prioritizedPieces: Number(ensureResult?.prioritizedPieces || 0),
                      deadlineMs: Number(ensureResult?.deadlineMs || 1000),
                      skippedDuplicate: false,
                    });
                  } else {
                    console.info('[TorrentEnsureRange]', {
                      torrentId,
                      fileIndex,
                      start,
                      end,
                      skippedDuplicate: true,
                    });
                  }
                } catch (ensureError) {
                  console.warn('[TorrentEnsureRange] failed:', {
                    torrentId,
                    fileIndex,
                    start,
                    end,
                    error: String(ensureError?.message || ensureError),
                  });
                }
              }
              sendWithLog(503, {
                ...commonHeaders,
                'Retry-After': '2',
                'X-Stream-Error': 'range_not_ready',
                'Content-Type': 'application/json',
              });
            logReadiness({
              requestedStart: start,
              requestedEnd: end,
              clampedStart: start,
              clampedEnd: end,
              expectedSize: totalSize,
              currentSize: fileSize,
              ready: false,
              reason: 'piece_not_ready',
              originalRange,
              isOpenEndedRange,
              chunkSize: STREAM_CHUNK_SIZE_BYTES,
            });
              res.end(JSON.stringify({ ok: false, error: 'range_not_ready' }));
              return;
            }
          }
        } catch (error) {
          console.warn('[TorrentRangeStatus] fallback to file-size readiness:', {
            torrentId,
            fileIndex,
            start,
            end,
            error: String(error?.message || error),
          });
        }
      }
      if (!fileExists || fileSize <= 0 || end >= fileSize) {
        sendWithLog(503, {
          ...commonHeaders,
          'Retry-After': '2',
          'X-Stream-Error': 'range_not_ready',
        });
        logReadiness({
          requestedStart: start,
          requestedEnd: end,
          clampedStart: start,
          clampedEnd: end,
          expectedSize: totalSize,
          currentSize: fileSize,
          ready: false,
          reason: !fileExists ? 'file_missing' : 'range_not_ready',
          originalRange,
          isOpenEndedRange,
          chunkSize: STREAM_CHUNK_SIZE_BYTES,
        });
        res.end();
        return;
      }
    }

    if (statusCode === 206) {
      responseHeaders['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
    }
    responseHeaders['Content-Length'] = String(Math.max(0, end - start + 1));

    sendWithLog(statusCode, responseHeaders, {
      start,
      end,
      total: totalSize,
      contentLength: Number(responseHeaders['Content-Length'] || 0),
      originalRange,
      requestedStart,
      requestedEnd,
      clampedStart: start,
      clampedEnd: end,
      isOpenEndedRange,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
    });
    logReadiness({
      requestedStart: start,
      requestedEnd: end,
      clampedStart: start,
      clampedEnd: end,
      expectedSize: totalSize,
      currentSize: fileSize,
      ready: true,
      reason: 'ok',
      originalRange,
      isOpenEndedRange,
      chunkSize: STREAM_CHUNK_SIZE_BYTES,
    });
    if (sessionRef) {
      sessionRef.lastServedStart = start;
      sessionRef.lastServedEnd = end;
    }

    if (
      sourceType === 'growing-file'
      && readinessMode === 'torrent-piece'
      && statusCode === 206
    ) {
      this.triggerReadAheadPrefetch({
        streamId,
        sessionRef,
        torrentId,
        fileIndex,
        expectedSize: totalSize,
        baseStart: start,
        baseEnd: end,
      });
    }

    const stream = fs.createReadStream(session.filePath, { start, end });
    req.on('close', () => {
      stream.destroy();
    });
    stream.on('error', () => {
      if (!res.writableEnded) {
        res.destroy();
      }
    });
    stream.pipe(res);
  }
}

module.exports = {
  LocalStreamServer,
};
