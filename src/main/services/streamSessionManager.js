const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const getMimeByExtension = (filePath = '') => {
  const ext = String(path.extname(filePath || '') || '').toLowerCase();
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.mkv':
      return 'video/x-matroska';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.avi':
      return 'video/x-msvideo';
    case '.ts':
      return 'video/mp2t';
    default:
      return 'application/octet-stream';
  }
};

class StreamSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  buildRuntimeState() {
    return {
      lastServedStart: null,
      lastServedEnd: null,
      lastPrefetchAt: null,
      pendingEnsureRanges: {},
    };
  }

  createLocalFileSession({ filePath, title } = {}) {
    const safePath = String(filePath || '').trim();
    if (!safePath) {
      throw new Error('filePath is required.');
    }
    if (!fs.existsSync(safePath)) {
      throw new Error('File not found.');
    }

    const streamId = crypto.randomUUID();
    const now = Date.now();
    const session = {
      streamId,
      sourceType: 'local-file',
      filePath: safePath,
      title: String(title || '').trim(),
      mime: getMimeByExtension(safePath),
      expectedSize: null,
      ...this.buildRuntimeState(),
      createdAt: now,
      lastAccessAt: now,
    };
    this.sessions.set(streamId, session);
    return { ...session };
  }

  createGrowingFileSession({ filePath, title, mime, expectedSize, torrentId, fileIndex, readinessMode } = {}) {
    const safePath = String(filePath || '').trim();
    if (!safePath) {
      throw new Error('filePath is required.');
    }
    const safeExpectedSize = Number(expectedSize);
    if (!Number.isFinite(safeExpectedSize) || safeExpectedSize <= 0) {
      throw new Error('expectedSize must be greater than 0.');
    }

    const streamId = crypto.randomUUID();
    const now = Date.now();
    const session = {
      streamId,
      sourceType: 'growing-file',
      filePath: safePath,
      title: String(title || '').trim(),
      mime: String(mime || '').trim() || getMimeByExtension(safePath),
      expectedSize: Math.floor(safeExpectedSize),
      torrentId: String(torrentId || '').trim() || null,
      fileIndex: Number.isInteger(Number(fileIndex)) ? Number(fileIndex) : null,
      readinessMode: String(readinessMode || '').trim() || 'file-size',
      ...this.buildRuntimeState(),
      createdAt: now,
      lastAccessAt: now,
    };
    this.sessions.set(streamId, session);
    return { ...session };
  }

  getSession(streamId, { touch = true, raw = false } = {}) {
    const id = String(streamId || '').trim();
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    if (touch) {
      session.lastAccessAt = Date.now();
    }
    return raw ? session : { ...session };
  }

  updateSessionRuntime(streamId, runtimePatch = {}) {
    const session = this.getSession(streamId, { touch: false, raw: true });
    if (!session) return false;
    const next = { ...(runtimePatch || {}) };
    if (Object.prototype.hasOwnProperty.call(next, 'pendingEnsureRanges') && typeof next.pendingEnsureRanges !== 'object') {
      delete next.pendingEnsureRanges;
    }
    Object.assign(session, next);
    return true;
  }

  closeSession(streamId) {
    const id = String(streamId || '').trim();
    if (!id) return false;
    return this.sessions.delete(id);
  }

  closeAll() {
    const count = this.sessions.size;
    this.sessions.clear();
    return count;
  }

  getSessionCount() {
    return this.sessions.size;
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({ ...session }));
  }
}

const streamSessionManager = new StreamSessionManager();

module.exports = {
  StreamSessionManager,
  streamSessionManager,
};
