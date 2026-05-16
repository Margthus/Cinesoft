/**
 * TorrentManager — Bridges Electron main process with the Python libtorrent service.
 * Spawns the Python torrent_service.py and communicates via HTTP JSON API.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { app } = require('electron');
const DEBUG_STREAM_SERVER = String(process.env.DEBUG_STREAM_SERVER || '').toLowerCase() === 'true';

const limitArray = (value, max = 20) => (Array.isArray(value) ? value.slice(0, max) : []);
const compactEnsureDebug = (result = {}) => ({
  ok: result?.ok ?? null,
  ready: result?.ready ?? null,
  fileOffset: result?.fileOffset ?? null,
  fileSize: result?.fileSize ?? null,
  pieceLength: result?.pieceLength ?? null,
  firstPiece: result?.firstPiece ?? null,
  lastPiece: result?.lastPiece ?? null,
  checkedPieces: result?.checkedPieces ?? null,
  missingPiecesCount: result?.missingPiecesCount ?? null,
  missingPieces: limitArray(result?.missingPieces),
  piecePriorities: limitArray(result?.piecePriorities),
  pieceAvailability: limitArray(result?.pieceAvailability),
  state: result?.state ?? null,
  paused: result?.paused ?? null,
  uploadMode: result?.uploadMode ?? null,
  downloadRate: result?.downloadRate ?? null,
  uploadRate: result?.uploadRate ?? null,
  numPeers: result?.numPeers ?? null,
  totalWantedDone: result?.totalWantedDone ?? null,
  totalWanted: result?.totalWanted ?? null,
  progress: result?.progress ?? null,
  prioritizedPieces: result?.prioritizedPieces ?? null,
  deadlineAppliedPieces: result?.deadlineAppliedPieces ?? null,
  priorityErrors: limitArray(result?.priorityErrors),
  deadlineErrors: limitArray(result?.deadlineErrors),
  resumed: result?.resumed ?? null,
  sequentialEnabled: result?.sequentialEnabled ?? null,
  beforeStatus: result?.beforeStatus ? {
    firstPiece: result.beforeStatus.firstPiece ?? null,
    lastPiece: result.beforeStatus.lastPiece ?? null,
    missingPiecesCount: result.beforeStatus.missingPiecesCount ?? null,
    state: result.beforeStatus.state ?? null,
    uploadMode: result.beforeStatus.uploadMode ?? null,
  } : null,
  afterStatus: result?.afterStatus ? {
    firstPiece: result.afterStatus.firstPiece ?? null,
    lastPiece: result.afterStatus.lastPiece ?? null,
    missingPiecesCount: result.afterStatus.missingPiecesCount ?? null,
    state: result.afterStatus.state ?? null,
    uploadMode: result.afterStatus.uploadMode ?? null,
  } : null,
});

class TorrentManager {
  constructor(downloadDir) {
    this.downloadDir = downloadDir;
    this.process = null;
    this.apiPort = null;
    this._ready = false;
    this._startPromise = null;
    fs.mkdirSync(this.downloadDir, { recursive: true });
  }

  /** Start the Python libtorrent service. */
  async start() {
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._spawn();
    return this._startPromise;
  }

  async _spawn() {
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'torrent', 'torrent_service.py')
      : path.join(__dirname, 'torrent_service.py');

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Torrent service script not found: ${scriptPath}`);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('python', [scriptPath, this.downloadDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.process = proc;
      let startupReceived = false;
      let stderrBuffer = '';

      proc.stdout.once('data', (data) => {
        try {
          const info = JSON.parse(data.toString().trim());
          if (info.ok) {
            this.apiPort = info.apiPort;
            this._ready = true;
            startupReceived = true;
            console.log(`[TorrentManager] libtorrent ${info.libtorrentVersion} started — API:${info.apiPort}`);
            resolve(info);
          } else {
            reject(new Error(info.error || 'Unknown startup error'));
          }
        } catch (e) {
          reject(new Error(`Failed to parse startup output: ${data.toString()}`));
        }
      });

      // Log remaining stdout (after startup)
      proc.stdout.on('data', (data) => {
        if (startupReceived) {
          const msg = data.toString().trim();
          if (msg) console.log(`[TorrentService] ${msg}`);
        }
      });

      proc.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        console.error(`[TorrentService:stderr] ${data.toString().trim()}`);
      });

      proc.on('error', (err) => {
        console.error('[TorrentManager] Process error:', err.message);
        if (!startupReceived) reject(err);
      });

      proc.on('exit', (code) => {
        this._ready = false;
        this.process = null;
        console.log(`[TorrentManager] Process exited with code ${code}`);
        if (!startupReceived) {
          reject(new Error(`Process exited before startup (code ${code}): ${stderrBuffer}`));
        }
      });

      // Timeout
      setTimeout(() => {
        if (!startupReceived) {
          reject(new Error('Torrent service startup timed out'));
        }
      }, 15000);
    });
  }

  /** Make an HTTP request to the Python API. */
  async _request(method, path, body = null, timeoutMs = 10000) {
    if (!this._ready) {
      await this.start();
    }

    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const options = {
        hostname: '127.0.0.1',
        port: this.apiPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
        timeout: timeoutMs,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false, error: 'Invalid JSON response', raw: data });
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  /** Add a torrent. */
  async add(opts) {
    return this._request('POST', '/add', opts, 45000);
  }

  /** Add torrent paused and return file list for selection. */
  async prepare(opts) {
    return this._request('POST', '/prepare', opts, 45000);
  }

  /** Get torrent file list. */
  async getFiles(id) {
    return this._request('GET', `/files?id=${encodeURIComponent(id)}`);
  }

  /** Select torrent files and optionally resume. */
  async selectFiles(id, fileIndexes = [], resume = true, sequentialDownload = false) {
    return this._request('POST', '/select-files', { id, fileIndexes, resume, sequentialDownload });
  }

  /** Get status of a specific torrent. */
  async getStatus(id) {
    return this._request('GET', `/status?id=${encodeURIComponent(id)}`);
  }

  /** Get all torrents. */
  async getAll() {
    return this._request('GET', '/all');
  }

  /** Get current download speed limit. */
  async getSpeedLimit() {
    return this._request('GET', '/speed-limit');
  }

  /** Set download speed limit in bytes/sec. 0 disables limit. */
  async setSpeedLimit(downloadRateLimit) {
    return this._request('POST', '/speed-limit', { downloadRateLimit });
  }

  /** Apply session-level network options. */
  async setSessionOptions(options) {
    return this._request('POST', '/session-options', options || {});
  }

  /** Check torrent piece readiness for a byte range. */
  async checkRangeStatus({ torrentId, fileIndex, start, end } = {}) {
    try {
      return await this._request('POST', '/stream/range-status', {
        torrentId,
        fileIndex,
        start,
        end,
      }, 10000);
    } catch (error) {
      return {
        ok: false,
        ready: false,
        error: String(error?.message || 'range-status request failed'),
      };
    }
  }

  /** Ensure torrent pieces for a byte range are prioritized/deadlined. */
  async ensureRange({ torrentId, fileIndex, start, end, deadlineMs = 1000 } = {}) {
    try {
      const result = await this._request('POST', '/stream/ensure-range', {
        torrentId,
        fileIndex,
        start,
        end,
        deadlineMs,
      }, 10000);
      const isMinimum = Number(start) === 0 && Number(end) <= (2 * 1024 * 1024 - 1);
      if (DEBUG_STREAM_SERVER || isMinimum) {
        console.info('[TorrentManager:EnsureRangeRaw]', {
          torrentId,
          fileIndex,
          start,
          end,
          deadlineMs,
          raw: compactEnsureDebug(result),
        });
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        ready: false,
        error: String(error?.message || 'ensure-range request failed'),
      };
    }
  }


  /** Pause a torrent. */
  async pause(id) {
    const requestId = String(id || '').trim();
    const result = await this._request('POST', '/pause', { id: requestId });
    console.info('[TorrentManager:Pause]', {
      id: requestId,
      ok: Boolean(result?.ok),
      paused: result?.paused ?? result?.isPaused ?? null,
      state: result?.state ?? null,
      downloadRate: result?.downloadRate ?? null,
      uploadRate: result?.uploadRate ?? null,
      error: result?.error || null,
      raw: result,
    });
    return result;
  }

  /** Resume a torrent. */
  async resume(id) {
    return this._request('POST', '/resume', { id });
  }

  /** Remove a torrent. */
  async remove(id, deleteFiles = false) {
    return this._request('POST', '/remove', { id, deleteFiles });
  }

  /** Health check. */
  async health() {
    return this._request('GET', '/health');
  }

  /** Destroy the service. */
  destroy() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (e) {
        console.error('[TorrentManager] Error killing process:', e.message);
      }
      this.process = null;
    }
    this._ready = false;
    this._startPromise = null;
  }
}

module.exports = { TorrentManager };
