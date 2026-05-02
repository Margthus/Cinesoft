/**
 * TorrentManager — Bridges Electron main process with the Python libtorrent service.
 * Spawns the Python torrent_service.py and communicates via HTTP JSON API.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

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
    const scriptPath = path.join(__dirname, 'torrent_service.py');

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
  async _request(method, path, body = null) {
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
        timeout: 10000,
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
    return this._request('POST', '/add', opts);
  }

  /** Add torrent paused and return file list for selection. */
  async prepare(opts) {
    return this._request('POST', '/prepare', opts);
  }

  /** Get torrent file list. */
  async getFiles(id) {
    return this._request('GET', `/files?id=${encodeURIComponent(id)}`);
  }

  /** Select torrent files and optionally resume. */
  async selectFiles(id, fileIndexes = [], resume = true) {
    return this._request('POST', '/select-files', { id, fileIndexes, resume });
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

  /** Pause a torrent. */
  async pause(id) {
    return this._request('POST', '/pause', { id });
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
