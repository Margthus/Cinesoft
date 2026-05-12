const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const http = require('http');
const https = require('https');
const axios = require('axios');
const { pathToFileURL } = require('url');
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const Store = require('electron-store');
const store = new Store();
const { TorrentManager } = require('./src/torrent/torrentManager.cjs');
const FORCE_SOFTWARE_RENDERING_KEY = 'forceSoftwareRendering';
const WINDOWS_APP_ID = 'com.margthus.cinesoft';

// Torrent manager - lazy init
let torrentManager = null;
let torrentRestorePromise = null;
let metadataDb = null;
let completionNotificationBootstrapped = false;
const completedTorrentNotified = new Set();
const appLogs = [];
const MAX_APP_LOGS = 500;

const PERSISTED_DOWNLOADS_KEY = 'torrentDownloads';
const TORRENT_SPEED_LIMIT_KEY = 'torrentDownloadSpeedLimitKbps';
const TORRENT_SETTINGS_KEY = 'torrentSettings';
const DEFAULT_TORRENT_SETTINGS = {
  seedAfterDownload: true,
  shutdownOnComplete: false,
  maxActiveDownloads: 3,
  dhtEnabled: true,
  lsdEnabled: true,
  upnpEnabled: true,
  natPmpEnabled: true,
  announceToAllTrackers: true,
};
const DEFAULT_TORRENTIO_SETTINGS = {
  baseUrl: 'https://torrentio.strem.fun',
  maxResults: 80,
  excludeKeywords: 'cam,ts,tc',
  sortBy: 'seeders',
  enabledSites: {
    yts: true,
    thepiratebay: true,
    '1337x': true,
    nyaa: true,
    eztv: true,
    torrentgalaxy: true,
    kickass: true,
    rarbg: true,
    horriblesubs: true,
    tokyotosho: true,
    anidex: true,
    nekobt: true,
    rutor: true,
    comando: true,
    bludv: true,
    micoleaodublado: true,
    torrent9: true,
    ilcorsaronero: true,
    mejortorrent: true,
    wolfmax4k: true,
    cinecalidad: true,
    besttorrents: true,
    zooqle: true,
    rutracker: true,
    magnetdl: true,
    torrentdownloads: true,
    glodls: true,
    limetorrents: true,
    solidtorrents: true,
    torlock: true,
    bitsearch: true,
    btdigg: true,
    ibit: true,
    all: true,
  },
};
const DEFAULT_SUBTITLE_ADDON_BASE_URL = 'https://turkcealtyaziorg-stremio-addon.mycodelab.live';
const FALLBACK_SUBTITLE_ADDON_BASE_URLS = [
  'https://turkcealtyaziorg-stremio-addon.mycodelab.live',
  'https://turkcealtyaziorg-stremio-addon.mycodelab.com.tr',
];
const OPENSUBTITLES_V3_BASE_URL = 'https://opensubtitles-v3.strem.io';
const SUBTITLE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const subtitleSearchCache = new Map();
const subtitleMetadataCache = new Map();

const subtitleHttpAgent = new http.Agent({ keepAlive: false });
const subtitleHttpsAgent = new https.Agent({ keepAlive: false });
const SUBTITLE_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,text/html,*/*',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  Connection: 'close',
};

const getPersistedDownloads = () => {
  const entries = store.get(PERSISTED_DOWNLOADS_KEY);
  return Array.isArray(entries) ? entries : [];
};

const savePersistedDownloads = (entries) => {
  store.set(PERSISTED_DOWNLOADS_KEY, entries);
};

const upsertPersistedDownload = (entry) => {
  const current = getPersistedDownloads();
  const existing = current.find((item) => item.key === entry.key) || {};
  const next = current.filter((item) => item.key !== entry.key);
  next.push({
    ...existing,
    ...entry,
    magnetOrHash: entry.magnetOrHash || existing.magnetOrHash || '',
    torrentUrl: entry.torrentUrl || existing.torrentUrl || '',
    mediaInfo: entry.mediaInfo || existing.mediaInfo || {},
  });
  savePersistedDownloads(next);
};

const removePersistedDownload = (key) => {
  const current = getPersistedDownloads();
  savePersistedDownloads(current.filter((item) => item.key !== key));
};

const patchPersistedDownload = (key, changes = {}) => {
  const current = getPersistedDownloads();
  let found = false;
  const next = current.map((item) => {
    if (String(item.key) !== String(key)) return item;
    found = true;
    return {
      ...item,
      ...changes,
      mediaInfo: {
        ...(item.mediaInfo || {}),
        ...(changes.mediaInfo || {}),
      },
    };
  });
  if (found) savePersistedDownloads(next);
};

const getLibraryFileHash = (filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return crypto.createHash('sha1')
      .update(`${filePath}|${Number(stat.size || 0)}|${Number(stat.mtimeMs || 0)}`)
      .digest('hex');
  } catch {
    return '';
  }
};

const upsertLibraryMetadata = (payload = {}) => {
  if (!metadataDb) return { ok: false, error: 'metadata db not ready' };
  const filePath = String(payload.filePath || '');
  if (!filePath) return { ok: false, error: 'filePath is required' };
  const fileHash = String(payload.fileHash || '');
  const title = String(payload.title || '');
  const year = Number(payload.year) || null;
  const posterUrl = String(payload.posterUrl || '');
  const tmdbId = Number(payload.tmdbId) || null;
  const mediaType = String(payload.mediaType || '');
  const now = Date.now();
  const stmt = metadataDb.prepare(`
    INSERT INTO media_metadata_cache (file_path, file_hash, title, year, poster_url, tmdb_id, media_type, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      file_hash = excluded.file_hash,
      title = excluded.title,
      year = excluded.year,
      poster_url = excluded.poster_url,
      tmdb_id = excluded.tmdb_id,
      media_type = excluded.media_type,
      updated_at = excluded.updated_at
  `);
  stmt.run(filePath, fileHash, title, year, posterUrl, tmdbId, mediaType, now);
  return { ok: true };
};

const cacheTorrentLibraryMetadata = (torrent) => {
  try {
    const posterUrl = String(torrent?.mediaInfo?.poster || '');
    if (!posterUrl) return;
    const savePath = String(torrent?.savePath || getDownloadDir());
    const videoFiles = Array.isArray(torrent?.selectedVideoFiles) && torrent.selectedVideoFiles.length
      ? torrent.selectedVideoFiles
      : [torrent?.videoFile].filter(Boolean);
    for (const videoFile of videoFiles) {
      const relPath = String(videoFile?.path || '');
      if (!relPath) continue;
      const filePath = path.resolve(savePath, relPath);
      if (!fs.existsSync(filePath)) continue;
      upsertLibraryMetadata({
        filePath,
        fileHash: getLibraryFileHash(filePath),
        title: torrent?.title || torrent?.name || path.parse(filePath).name,
        year: Number(torrent?.mediaInfo?.year) || null,
        posterUrl,
        tmdbId: Number(torrent?.mediaInfo?.tmdbId) || null,
        mediaType: String(torrent?.mediaInfo?.type || ''),
      });
    }
  } catch (err) {
    logEvent('library', classifyError(err.message), 'Torrent metadata cache failed', { error: err.message });
  }
};

const notifyTorrentCompleted = (torrent) => {
  try {
    if (!Notification.isSupported()) return;
    const language = store.get('language') || 'tr';
    const title = language === 'en' ? 'Download Completed' : 'Indirme Tamamlandi';
    const body = language === 'en'
      ? `${torrent?.title || torrent?.name || 'Torrent'} is ready.`
      : `${torrent?.title || torrent?.name || 'Torrent'} hazir.`;

    new Notification({
      title,
      body,
      silent: false,
    }).show();
  } catch (err) {
    console.error('[Main] Failed to show completion notification:', err.message);
  }
};

const isTorrentDownloadCompleted = (torrent) => {
  if (!torrent || torrent.pendingSelection) return false;
  const selectedVideos = Array.isArray(torrent.selectedVideoFiles) ? torrent.selectedVideoFiles : [];
  if (selectedVideos.length > 0) {
    const allSelectedDone = selectedVideos.every((file) => {
      const size = Number(file?.size || 0);
      const downloaded = Number(file?.downloaded || 0);
      if (size <= 0) return false;
      if (file?.done === true) return true;
      return downloaded >= size * 0.995;
    });
    if (allSelectedDone) return true;
  }
  const progress = Number(torrent.progress || 0);
  const totalSize = Number(torrent.totalSize || 0);
  const downloaded = Number(torrent.downloaded || 0);
  if (totalSize <= 0) return false;
  // Require actual payload completion, not just session state.
  if (progress < 99.9) return false;
  if (downloaded < totalSize * 0.98) return false;
  return Boolean(torrent.done);
};

const persistTorrentSnapshot = (torrent) => {
  if (!torrent?.id) return;
  patchPersistedDownload(torrent.id, {
    title: torrent.title || torrent.name || '',
    mediaInfo: torrent.mediaInfo || {},
    paused: Boolean(torrent.paused),
    progress: Number(torrent.progress || 0),
    downloaded: Number(torrent.downloaded || 0),
    totalSize: Number(torrent.totalSize || 0),
    selectedFileIndexes: Array.isArray(torrent.selectedFileIndexes) ? torrent.selectedFileIndexes : [],
    sequentialDownload: torrent.sequentialDownload === true,
    completed: isTorrentDownloadCompleted(torrent),
    completedNotified: completedTorrentNotified.has(String(torrent.id)),
    lastSeenAt: new Date().toISOString(),
  });
};

const updateCompletionNotifications = (torrents = []) => {
  const seenIds = new Set((torrents || []).map((torrent) => String(torrent.id)));
  torrents.forEach(persistTorrentSnapshot);

  if (!completionNotificationBootstrapped) {
    for (const torrent of torrents) {
      if (isTorrentDownloadCompleted(torrent)) {
        completedTorrentNotified.add(String(torrent.id));
        patchPersistedDownload(torrent.id, {
          completedNotified: true,
          completedAt: new Date().toISOString(),
          paused: Boolean(torrent.paused),
          mediaInfo: torrent.mediaInfo || {},
        });
        cacheTorrentLibraryMetadata(torrent);
      }
    }
    completionNotificationBootstrapped = true;
    return;
  }

  for (const torrent of torrents) {
    const id = String(torrent.id);
    if (isTorrentDownloadCompleted(torrent) && !completedTorrentNotified.has(id)) {
      completedTorrentNotified.add(id);
      patchPersistedDownload(id, {
        completedNotified: true,
        completedAt: new Date().toISOString(),
        paused: Boolean(torrent.paused),
        mediaInfo: torrent.mediaInfo || {},
      });
      cacheTorrentLibraryMetadata(torrent);
      notifyTorrentCompleted(torrent);
    }
  }

  for (const id of Array.from(completedTorrentNotified)) {
    if (!seenIds.has(id)) completedTorrentNotified.delete(id);
  }
};

const getQueueOrderForKey = (key) => {
  const current = getPersistedDownloads();
  const entry = current.find((item) => String(item.key) === String(key));
  const value = Number(entry?.queueOrder);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
};

const getNextQueueOrder = () => {
  const current = getPersistedDownloads();
  const max = current.reduce((acc, item) => {
    const value = Number(item?.queueOrder);
    return Number.isFinite(value) && value > acc ? value : acc;
  }, 0);
  return max + 1;
};

const setQueueOrderForKeys = (orderedKeys = []) => {
  if (!Array.isArray(orderedKeys) || !orderedKeys.length) return;
  const current = getPersistedDownloads();
  const next = current.map((entry) => ({ ...entry }));
  const byKey = new Map(next.map((entry) => [String(entry.key), entry]));
  orderedKeys.forEach((key, index) => {
    const entry = byKey.get(String(key));
    if (entry) entry.queueOrder = index + 1;
  });
  savePersistedDownloads(next);
};

const getManuallyPausedIds = () => {
  const entries = getPersistedDownloads();
  return new Set(
    entries
      .filter((item) => item?.manuallyPaused === true && item?.key)
      .map((item) => String(item.key))
  );
};

const getStoredTorrentSpeedLimit = () => {
  const value = Number(store.get(TORRENT_SPEED_LIMIT_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const getTorrentSettings = () => {
  const current = store.get(TORRENT_SETTINGS_KEY) || {};
  return {
    ...DEFAULT_TORRENT_SETTINGS,
    ...current,
    maxActiveDownloads: Math.max(1, Number(current.maxActiveDownloads) || DEFAULT_TORRENT_SETTINGS.maxActiveDownloads),
  };
};

const saveTorrentSettings = (nextSettings = {}) => {
  const merged = {
    ...DEFAULT_TORRENT_SETTINGS,
    ...nextSettings,
    maxActiveDownloads: Math.max(1, Number(nextSettings.maxActiveDownloads) || DEFAULT_TORRENT_SETTINGS.maxActiveDownloads),
  };
  store.set(TORRENT_SETTINGS_KEY, merged);
  return merged;
};

let torrentRulesInterval = null;
let shutdownTriggeredForCompletion = false;

const scheduleSystemShutdown = () => {
  try {
    if (process.platform === 'win32') {
      execSync('shutdown /s /t 30', { stdio: 'ignore' });
      return true;
    }
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'tell app "System Events" to shut down'`, { stdio: 'ignore' });
      return true;
    }
    execSync('shutdown -h +1', { stdio: 'ignore' });
    return true;
  } catch (err) {
    console.error('[Main] Failed to schedule system shutdown:', err.message);
    return false;
  }
};

const enforceTorrentRules = async () => {
  if (!torrentManager) return;
  try {
    const settings = getTorrentSettings();
    const all = await torrentManager.getAll();
    const torrents = Array.isArray(all?.torrents) ? all.torrents : [];
    updateCompletionNotifications(torrents);
    const manuallyPausedIds = getManuallyPausedIds();
    const sorted = [...torrents].sort((a, b) => {
      const orderA = getQueueOrderForKey(a.id);
      const orderB = getQueueOrderForKey(b.id);
      if (orderA !== orderB) return orderA - orderB;
      const aTime = Number(a.addedAt || 0);
      const bTime = Number(b.addedAt || 0);
      return aTime - bTime;
    });

    if (!settings.seedAfterDownload) {
      const completedActive = sorted.filter((t) => t.done && !t.paused);
      for (const t of completedActive) {
        await torrentManager.pause(t.id);
      }
    }

    const queueCandidates = sorted.filter((t) => !t.done && !t.pendingSelection);
    const activeNow = queueCandidates.filter((t) => !t.paused);
    const desiredActiveIds = new Set(
      queueCandidates
        .filter((t) => !manuallyPausedIds.has(String(t.id)))
        .slice(0, settings.maxActiveDownloads)
        .map((t) => String(t.id))
    );

    // Always align active set with queue priority, even when active count already matches.
    for (const t of activeNow) {
      if (!desiredActiveIds.has(String(t.id))) {
        await torrentManager.pause(t.id);
      }
    }

    for (const t of queueCandidates) {
      if (desiredActiveIds.has(String(t.id)) && t.paused) {
        await torrentManager.resume(t.id);
      }
    }

    const hasAnyTorrent = torrents.length > 0;
    const allComplete = hasAnyTorrent && torrents.every((t) => t.done);
    if (!settings.shutdownOnComplete || !allComplete) {
      shutdownTriggeredForCompletion = false;
    } else if (!shutdownTriggeredForCompletion) {
      shutdownTriggeredForCompletion = true;
      scheduleSystemShutdown();
    }
  } catch (err) {
    console.error('[Main] Failed to enforce torrent rules:', err.message);
  }
};

const restorePersistedDownloads = async (tm) => {
  const entries = getPersistedDownloads();
  if (!entries.length) return;

  for (const entry of entries) {
    try {
      const wasCompleted = entry.completedNotified === true || entry.completed === true;
      const selectedFileIndexes = Array.isArray(entry.selectedFileIndexes)
        ? entry.selectedFileIndexes.map((value) => Number(value)).filter(Number.isInteger)
        : [];
      if (wasCompleted) {
        completedTorrentNotified.add(String(entry.key));
        if (!selectedFileIndexes.length) {
          logSafeEvent('torrent', 'restore_skipped', 'Completed torrent restore skipped because selected files are unknown', {
            title: entry.title || entry.key,
          });
          continue;
        }
      }
      const result = await tm.add({
        magnetOrHash: entry.magnetOrHash || '',
        torrentUrl: entry.torrentUrl || '',
        mode: 'download',
        title: entry.title || 'Unknown',
        mediaInfo: entry.mediaInfo || {},
        seedMode: wasCompleted,
      });

      if (result?.ok) {
        if (selectedFileIndexes.length) {
          for (let attempt = 0; attempt < 30; attempt += 1) {
            const files = await tm.getFiles(result.id);
            if (files?.ok) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          await tm.selectFiles(result.id, selectedFileIndexes, !wasCompleted && !entry.paused, entry.sequentialDownload === true);
        }
        if (entry.paused || wasCompleted) {
          await tm.pause(result.id);
        }
      }
    } catch (err) {
      console.error('[Main] Failed to restore torrent:', entry.title || entry.key, err.message);
    }
  }
};

const getDownloadDir = () => {
  const customDir = store.get('downloadDir');
  if (customDir && fs.existsSync(customDir)) return customDir;
  return path.join(app.getPath('downloads'), 'CineSoft');
};

const logEvent = (source, code, message, details = {}) => {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toISOString(),
    source,
    code,
    message,
    details,
  };
  appLogs.unshift(entry);
  if (appLogs.length > MAX_APP_LOGS) appLogs.length = MAX_APP_LOGS;
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'cinesoft.log'), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error('[Main] Failed to write log file:', err.message);
  }
};

const pruneCompletedPersistedDownloads = (torrents = []) => {
  const completedLiveIds = new Set(
    (Array.isArray(torrents) ? torrents : [])
      .filter((torrent) => isTorrentDownloadCompleted(torrent))
      .map((torrent) => String(torrent.id))
  );
  const current = getPersistedDownloads();
  const next = current.filter((entry) => {
    const key = String(entry?.key || '');
    if (!key) return false;
    const markedCompleted = entry?.completed === true || entry?.completedNotified === true;
    return !markedCompleted && !completedLiveIds.has(key);
  });
  if (next.length !== current.length) {
    savePersistedDownloads(next);
  }
};

const sanitizeLogDetails = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeLogDetails);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return value.replace(/([?&](?:api_key|apikey|apiKey)=)[^&\s]+/gi, '$1***');
    }
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/^(api[-_ ]?key|apikey|authorization|password|token|secret)$/i.test(key)) {
      return [key, item ? '***' : item];
    }
    return [key, sanitizeLogDetails(item)];
  }));
};

const logSafeEvent = (source, code, message, details = {}) => {
  logEvent(source, code, message, sanitizeLogDetails(details));
};

const classifyError = (raw = '') => {
  const msg = String(raw || '').toLowerCase();
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) return 'auth';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) return 'timeout';
  if (msg.includes('parse') || msg.includes('invalid json') || msg.includes('malformed')) return 'parse';
  if (msg.includes('no peers') || msg.includes('0 seed') || msg.includes('no sources')) return 'no_peers';
  return 'unknown';
};

const initMetadataDb = () => {
  if (!DatabaseSync) {
    logEvent('library', 'parse', 'node:sqlite is unavailable; metadata cache disabled');
    metadataDb = null;
    return;
  }
  const dbPath = path.join(app.getPath('userData'), 'library_metadata.sqlite');
  metadataDb = new DatabaseSync(dbPath);
  metadataDb.exec(`
    CREATE TABLE IF NOT EXISTS media_metadata_cache (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      file_hash TEXT NOT NULL,
      title TEXT,
      year INTEGER,
      poster_url TEXT,
      tmdb_id INTEGER,
      media_type TEXT,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_media_cache_hash ON media_metadata_cache(file_hash);
    CREATE INDEX IF NOT EXISTS idx_media_cache_updated ON media_metadata_cache(updated_at);
  `);
};

const ensureTorrentManager = async () => {
  if (!torrentManager) {
    torrentManager = new TorrentManager(getDownloadDir());
    try {
      await torrentManager.start();
      await torrentManager.setSpeedLimit(getStoredTorrentSpeedLimit() * 1024);
      await torrentManager.setSessionOptions(getTorrentSettings());
      if (!torrentRestorePromise) {
        torrentRestorePromise = restorePersistedDownloads(torrentManager).finally(() => {
          torrentRestorePromise = null;
        });
      }
      await torrentRestorePromise;
      if (!torrentRulesInterval) {
        torrentRulesInterval = setInterval(() => {
          enforceTorrentRules();
        }, 4000);
      }
    } catch (e) {
      console.error('[Main] Failed to start torrent service:', e.message);
      torrentManager = null;
      torrentRestorePromise = null;
      throw e;
    }
  }
  return torrentManager;
};

const getAppRoot = () => app.isPackaged ? app.getAppPath() : __dirname;
const sourcesModulePath = pathToFileURL(path.join(getAppRoot(), 'src', 'sources', 'index.mjs')).href;

const getSourcesModule = () => import(sourcesModulePath);

const getProwlarrConfig = () => store.get('prowlarr') || {};
let prowlarrProcess = null;
const getStoredAuthUser = () => store.get('authUser') || null;
const getStoredAuthSession = () => store.get('authSession') || { authenticated: false, rememberMe: false, username: '' };

// Initialize defaults
if (!store.has('language')) {
  store.set('language', 'tr');
}
if (!store.has('authSession')) {
  store.set('authSession', { authenticated: false, rememberMe: false, username: '' });
}

// Balanced GPU strategy:
// - Default: keep hardware acceleration for smoother UI.
// - Fallback: if GPU process crashes, switch to software rendering on next launch.
const shouldForceSoftwareRendering = store.get(FORCE_SOFTWARE_RENDERING_KEY) === true;
if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_ID);
}
if (shouldForceSoftwareRendering) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

function createWindow() {
  const windowIconPath = path.join(__dirname, 'build', 'icon.png');
  const isDevMode = !app.isPackaged;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    icon: fs.existsSync(windowIconPath) ? windowIconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
    title: 'Cinesoft',
    autoHideMenuBar: true,
  });

  if (isDevMode) {
    win.loadURL('http://localhost:5173');
  } else {
    const indexFile = path.join(__dirname, 'renderer', 'index.html');
    win.loadFile(indexFile).catch((error) => {
      console.error('[Main] Failed to load renderer:', error.message);
    });
  }

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[Main] Renderer load failed', { errorCode, errorDescription, validatedURL });
  });

  // if (isDev) {
  //   win.webContents.openDevTools();
  // }
}

app.whenReady().then(() => {
  initMetadataDb();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('child-process-gone', (_event, details) => {
  if (details?.type === 'GPU' && details?.reason === 'crashed') {
    store.set(FORCE_SOFTWARE_RENDERING_KEY, true);
    console.warn('[Main] GPU process crashed; software rendering will be enabled on next launch.');
  }
});

app.on('window-all-closed', async () => {
  stopManagedProwlarr();
  if (torrentRulesInterval) {
    clearInterval(torrentRulesInterval);
    torrentRulesInterval = null;
  }
  if (torrentManager) {
    try {
      const all = await torrentManager.getAll();
      const torrents = Array.isArray(all?.torrents) ? all.torrents : [];
      updateCompletionNotifications(torrents);
      pruneCompletedPersistedDownloads(torrents);
    } catch (err) {
      console.error('[Main] Failed to persist final torrent snapshot:', err.message);
    }
    torrentManager.destroy();
    torrentManager = null;
  } else {
    pruneCompletedPersistedDownloads([]);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const getManagedProwlarrDataDir = () => path.join(app.getPath('userData'), 'prowlarr');

const getBundledProwlarrExecutable = () => {
  const basePath = app.isPackaged ? process.resourcesPath : __dirname;
  const executable = process.platform === 'win32' ? 'Prowlarr.exe' : 'Prowlarr';
  return path.join(basePath, 'resources', 'prowlarr', executable);
};

const getProwlarrExecutablePath = (config = {}) => {
  if (config.executablePath && fs.existsSync(config.executablePath)) {
    return config.executablePath;
  }

  const bundled = getBundledProwlarrExecutable();
  return fs.existsSync(bundled) ? bundled : '';
};

const ensureProwlarrConfigFile = (config = {}) => {
  const dataDir = getManagedProwlarrDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const configPath = path.join(dataDir, 'config.xml');
  const port = Number(config.port) || 9696;
  let apiKey = config.apiKey || crypto.randomBytes(16).toString('hex');

  if (fs.existsSync(configPath)) {
    const xml = fs.readFileSync(configPath, 'utf8');
    apiKey = readXmlValue(xml, 'ApiKey') || apiKey;
    const updated = upsertXmlValues(xml, {
      BindAddress: '127.0.0.1',
      Port: String(port),
      ApiKey: apiKey,
      AuthenticationMethod: 'None',
      AuthenticationRequired: 'DisabledForLocalAddresses',
      AuthenticationRequiredWarningDismissed: 'True',
      UrlBase: '',
    });
    fs.writeFileSync(configPath, updated);
  } else {
    fs.writeFileSync(configPath, [
      '<Config>',
      '  <BindAddress>127.0.0.1</BindAddress>',
      `  <Port>${port}</Port>`,
      '  <SslPort>6969</SslPort>',
      '  <EnableSsl>False</EnableSsl>',
      '  <LaunchBrowser>False</LaunchBrowser>',
      '  <AuthenticationMethod>None</AuthenticationMethod>',
      '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>',
      '  <AuthenticationRequiredWarningDismissed>True</AuthenticationRequiredWarningDismissed>',
      `  <ApiKey>${apiKey}</ApiKey>`,
      '  <UrlBase></UrlBase>',
      '  <LogLevel>info</LogLevel>',
      '  <UpdateMechanism>BuiltIn</UpdateMechanism>',
      '  <Branch>master</Branch>',
      '</Config>',
      '',
    ].join('\n'));
  }

  return { dataDir, apiKey, port };
};

const readXmlValue = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
};

const upsertXmlValues = (xml, values) => {
  let updated = xml;
  Object.entries(values).forEach(([tag, value]) => {
    const pattern = new RegExp(`<${tag}>.*?</${tag}>`, 'i');
    const replacement = `<${tag}>${value}</${tag}>`;
    if (pattern.test(updated)) {
      updated = updated.replace(pattern, replacement);
    } else {
      updated = updated.replace('</Config>', `  ${replacement}\n</Config>`);
    }
  });
  return updated;
};

const hashSecret = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const sanitizeAuthState = () => {
  const user = getStoredAuthUser();
  const session = getStoredAuthSession();
  return {
    hasAccount: Boolean(user),
    isAuthenticated: Boolean(session.authenticated && user && session.username === user.username),
    rememberedUsername: session.rememberMe ? session.username || '' : '',
    username: session.authenticated ? session.username || '' : '',
  };
};

const isSystemProwlarrRunning = () => {
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist /FI "IMAGENAME eq Prowlarr.exe" /FO CSV /NH', { encoding: 'utf8' });
      return output.toLowerCase().includes('prowlarr.exe');
    }
    const output = execSync('pgrep -f Prowlarr', { encoding: 'utf8' });
    return Boolean(String(output).trim());
  } catch {
    return false;
  }
};

const stopSystemProwlarr = () => {
  if (!isSystemProwlarrRunning()) {
    return false;
  }

  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM Prowlarr.exe /T', { stdio: 'ignore' });
    } else {
      execSync('pkill -f Prowlarr', { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
};

const startManagedProwlarr = (config = {}) => {
  const externalProcessStopped = stopSystemProwlarr();
  if (prowlarrProcess && !prowlarrProcess.killed) {
    prowlarrProcess.kill();
    prowlarrProcess = null;
  }

  const executablePath = getProwlarrExecutablePath(config);
  if (!executablePath) {
    return {
      ok: false,
      message: 'Prowlarr executable was not found',
      expectedPath: getBundledProwlarrExecutable(),
    };
  }

  const prepared = ensureProwlarrConfigFile(config);
  const nextConfig = buildManagedProwlarrConfig({
    ...config,
    ...prepared,
    executablePath,
  });

  prowlarrProcess = spawn(executablePath, [`-data=${prepared.dataDir}`, '-nobrowser'], {
    cwd: path.dirname(executablePath),
    windowsHide: true,
    stdio: 'ignore',
  });

  prowlarrProcess.once('exit', () => {
    prowlarrProcess = null;
  });

  store.set('prowlarr', nextConfig);
  return {
    ok: true,
    alreadyRunning: false,
    externalProcessStopped,
    ...nextConfig,
  };
};

const stopManagedProwlarr = () => {
  const externalProcessStopped = stopSystemProwlarr();
  if (prowlarrProcess && !prowlarrProcess.killed) {
    prowlarrProcess.kill();
    prowlarrProcess = null;
    return true;
  }
  return externalProcessStopped;
};

const buildManagedProwlarrConfig = (config = {}) => {
  const port = Number(config.port) || 9696;
  return {
    ...config,
    enabled: true,
    managed: true,
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    apiKey: config.apiKey,
  };
};

// IPC Handlers
ipcMain.handle('get-settings', () => {
  const torrentio = store.get('torrentio') || {};
  return {
    apiKey: store.get('apiKey'),
    language: store.get('language'),
    prowlarr: store.get('prowlarr'),
    torrentioEnabled: store.get('torrentioEnabled') || false,
    useQbittorrent: store.get('useQbittorrent') || false,
    qbittorrent: store.get('qbittorrent') || {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    },
    torrentio: {
      ...DEFAULT_TORRENTIO_SETTINGS,
      ...torrentio,
      enabledSites: {
        ...DEFAULT_TORRENTIO_SETTINGS.enabledSites,
        ...(torrentio.enabledSites?.unknown !== undefined && torrentio.enabledSites?.all === undefined
          ? { all: torrentio.enabledSites.unknown }
          : {}),
        ...(torrentio.enabledSites || {}),
      },
    },
  };
});

ipcMain.handle('get-auth-state', () => sanitizeAuthState());

ipcMain.handle('register-user', (event, payload) => {
  const existingUser = getStoredAuthUser();
  if (existingUser) {
    return { ok: false, message: 'Account already exists' };
  }

  const username = String(payload?.username || '').trim();
  const password = String(payload?.password || '');
  const recoveryPhrase = String(payload?.recoveryPhrase || '').trim();
  const rememberMe = payload?.rememberMe === true;

  if (!username || !password || !recoveryPhrase) {
    return { ok: false, message: 'Missing required fields' };
  }

  store.set('authUser', {
    username,
    passwordHash: hashSecret(password),
    recoveryPhraseHash: hashSecret(recoveryPhrase.toLowerCase()),
    createdAt: new Date().toISOString(),
  });
  store.set('authSession', {
    authenticated: true,
    rememberMe,
    username,
  });

  return { ok: true, auth: sanitizeAuthState() };
});

ipcMain.handle('login-user', (event, payload) => {
  const user = getStoredAuthUser();
  if (!user) {
    return { ok: false, message: 'No account found' };
  }

  const username = String(payload?.username || '').trim();
  const password = String(payload?.password || '');
  const rememberMe = payload?.rememberMe === true;

  if (username !== user.username || hashSecret(password) !== user.passwordHash) {
    return { ok: false, message: 'Invalid credentials' };
  }

  store.set('authSession', {
    authenticated: true,
    rememberMe,
    username,
  });

  return { ok: true, auth: sanitizeAuthState() };
});

ipcMain.handle('logout-user', () => {
  const session = getStoredAuthSession();
  store.set('authSession', {
    authenticated: false,
    rememberMe: session.rememberMe,
    username: session.rememberMe ? session.username : '',
  });
  return { ok: true, auth: sanitizeAuthState() };
});

ipcMain.handle('reset-password', (event, payload) => {
  const user = getStoredAuthUser();
  if (!user) {
    return { ok: false, message: 'No account found' };
  }

  const username = String(payload?.username || '').trim();
  const recoveryPhrase = String(payload?.recoveryPhrase || '').trim().toLowerCase();
  const newPassword = String(payload?.newPassword || '');

  if (
    username !== user.username ||
    hashSecret(recoveryPhrase) !== user.recoveryPhraseHash ||
    !newPassword
  ) {
    return { ok: false, message: 'Recovery validation failed' };
  }

  store.set('authUser', {
    ...user,
    passwordHash: hashSecret(newPassword),
    updatedAt: new Date().toISOString(),
  });

  return { ok: true };
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set('apiKey', settings.apiKey);
  store.set('language', settings.language);
  store.set('prowlarr', settings.prowlarr || {});
  store.set('torrentioEnabled', settings.torrentioEnabled || false);
  store.set('useQbittorrent', settings.useQbittorrent || false);
  store.set('qbittorrent', settings.qbittorrent || {
    baseUrl: 'http://127.0.0.1:8080',
    username: 'admin',
    password: 'adminadmin',
  });
  const nextTorrentio = settings.torrentio || {};
  store.set('torrentio', {
    ...DEFAULT_TORRENTIO_SETTINGS,
    ...nextTorrentio,
    enabledSites: {
      ...DEFAULT_TORRENTIO_SETTINGS.enabledSites,
      ...(nextTorrentio.enabledSites?.unknown !== undefined && nextTorrentio.enabledSites?.all === undefined
        ? { all: nextTorrentio.enabledSites.unknown }
        : {}),
      ...(nextTorrentio.enabledSites || {}),
    },
  });
  const savedApiKey = store.get('apiKey') || '';
  const savedProwlarr = store.get('prowlarr') || {};
  const settingsVerified = String(savedApiKey) === String(settings.apiKey || '')
    && store.get('language') === settings.language
    && store.get('torrentioEnabled') === (settings.torrentioEnabled || false);
  logSafeEvent('settings', 'saved', 'Settings saved and verified', {
    storePath: store.path,
    userDataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
    settingsVerified,
    hasTmdbApiKey: Boolean(savedApiKey),
    tmdbApiKeyLength: String(savedApiKey).length,
    prowlarrEnabled: savedProwlarr.enabled === true,
    hasProwlarrBaseUrl: Boolean(savedProwlarr.baseUrl),
    hasProwlarrApiKey: Boolean(savedProwlarr.apiKey),
    torrentioEnabled: store.get('torrentioEnabled') === true,
  });
  return settingsVerified;
});

ipcMain.handle('app-log', (event, payload = {}) => {
  logSafeEvent(
    payload.source || 'renderer',
    payload.code || 'info',
    payload.message || 'Renderer event',
    payload.details || {},
  );
  return true;
});

ipcMain.handle('qbittorrent-add', async (event, opts = {}, qbConfig = {}) => {
  try {
    const baseUrl = String(qbConfig.baseUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    const username = String(qbConfig.username || 'admin');
    const password = String(qbConfig.password || 'adminadmin');
    const magnetOrHash = opts?.magnetOrHash || '';
    const torrentUrl = opts?.torrentUrl || '';
    const contentUrl = magnetOrHash || torrentUrl;

    if (!contentUrl) {
      logEvent('qbittorrent', 'parse', 'No torrent source provided');
      return { ok: false, error: 'No torrent source provided' };
    }

    const commonHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${baseUrl}/`,
      Origin: baseUrl,
    };

    const loginResponse = await fetch(`${baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: commonHeaders,
      body: new URLSearchParams({ username, password }).toString(),
    });

    const loginText = await loginResponse.text();
    if (!loginResponse.ok || !String(loginText).toLowerCase().includes('ok')) {
      logEvent('qbittorrent', 'auth', 'qBittorrent login failed', { status: loginResponse.status });
      return { ok: false, error: `qBittorrent login failed (${loginResponse.status}): ${loginText || 'Unknown error'}` };
    }

    const cookieHeader = loginResponse.headers.get('set-cookie') || '';
    const sidMatch = cookieHeader.match(/SID=([^;]+)/i);
    const sidCookie = sidMatch ? `SID=${sidMatch[1]}` : '';
    const addHeaders = { ...commonHeaders };
    if (sidCookie) {
      addHeaders.Cookie = sidCookie;
    }

    const addResponse = await fetch(`${baseUrl}/api/v2/torrents/add`, {
      method: 'POST',
      headers: addHeaders,
      body: new URLSearchParams({
        urls: contentUrl,
        savepath: getDownloadDir(),
      }).toString(),
    });

    const addBody = await addResponse.text();
    if (!addResponse.ok) {
      const body = addBody;
      logEvent('qbittorrent', classifyError(body), 'qBittorrent add failed', { status: addResponse.status, body });
      return { ok: false, error: `qBittorrent add failed (${addResponse.status}): ${body || 'Unknown error'}` };
    }
    if (typeof addBody === 'string' && addBody.trim().toLowerCase() === 'fails.') {
      logEvent('qbittorrent', 'unknown', 'qBittorrent rejected torrent');
      return { ok: false, error: 'qBittorrent rejected torrent (response: Fails.)' };
    }

    return { ok: true, message: addBody || 'Ok.' };
  } catch (err) {
    logEvent('qbittorrent', classifyError(err.message), 'qBittorrent add exception', { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('search-movie-sources', async (event, params) => {
  const startedAt = Date.now();
  const prowlarrConfig = getProwlarrConfig();
  logSafeEvent('source-search', 'start', 'Movie source search started', {
    provider: 'Prowlarr',
    providerEnabled: prowlarrConfig.enabled === true,
    hasBaseUrl: Boolean(prowlarrConfig.baseUrl),
    hasApiKey: Boolean(prowlarrConfig.apiKey),
    requestSent: Boolean(prowlarrConfig.enabled && prowlarrConfig.baseUrl && prowlarrConfig.apiKey),
    endpoint: '/api/v1/search',
    params,
  });
  try {
    const { searchStreamSourcesForMovie } = await getSourcesModule();
    const results = await searchStreamSourcesForMovie({
      ...prowlarrConfig,
      logger: (entry) => logSafeEvent('prowlarr', entry.code || 'info', entry.message || 'Prowlarr event', entry.details || {}),
    }, params);
    logSafeEvent('source-search', 'success', 'Movie source search finished', {
      provider: 'Prowlarr',
      resultCount: Array.isArray(results) ? results.length : 0,
      durationMs: Date.now() - startedAt,
    });
    return results;
  } catch (err) {
    logSafeEvent('prowlarr', classifyError(err.message), 'Movie source search failed', {
      error: err.message,
      stack: err.stack,
      durationMs: Date.now() - startedAt,
    });
    return [];
  }
});

ipcMain.handle('search-episode-sources', async (event, params) => {
  const startedAt = Date.now();
  const prowlarrConfig = getProwlarrConfig();
  logSafeEvent('source-search', 'start', 'Episode source search started', {
    provider: 'Prowlarr',
    providerEnabled: prowlarrConfig.enabled === true,
    hasBaseUrl: Boolean(prowlarrConfig.baseUrl),
    hasApiKey: Boolean(prowlarrConfig.apiKey),
    requestSent: Boolean(prowlarrConfig.enabled && prowlarrConfig.baseUrl && prowlarrConfig.apiKey),
    endpoint: '/api/v1/search',
    params,
  });
  try {
    const { searchStreamSourcesForEpisode } = await getSourcesModule();
    const results = await searchStreamSourcesForEpisode({
      ...prowlarrConfig,
      logger: (entry) => logSafeEvent('prowlarr', entry.code || 'info', entry.message || 'Prowlarr event', entry.details || {}),
    }, params);
    logSafeEvent('source-search', 'success', 'Episode source search finished', {
      provider: 'Prowlarr',
      resultCount: Array.isArray(results) ? results.length : 0,
      durationMs: Date.now() - startedAt,
    });
    return results;
  } catch (err) {
    logSafeEvent('prowlarr', classifyError(err.message), 'Episode source search failed', {
      error: err.message,
      stack: err.stack,
      durationMs: Date.now() - startedAt,
    });
    return [];
  }
});

ipcMain.handle('test-prowlarr-connection', async (event, prowlarrConfig) => {
  const { testProwlarrConnection } = await getSourcesModule();
  return testProwlarrConnection(prowlarrConfig || getProwlarrConfig());
});

ipcMain.handle('get-prowlarr-indexers', async (event, prowlarrConfig) => {
  const { getProwlarrIndexers } = await getSourcesModule();
  return getProwlarrIndexers(prowlarrConfig || getProwlarrConfig());
});

ipcMain.handle('get-prowlarr-indexer-schemas', async (event, prowlarrConfig) => {
  const { getProwlarrIndexerSchemas } = await getSourcesModule();
  return getProwlarrIndexerSchemas(prowlarrConfig || getProwlarrConfig());
});

ipcMain.handle('test-prowlarr-indexer', async (event, prowlarrConfig, indexerResource) => {
  const { testProwlarrIndexer } = await getSourcesModule();
  return testProwlarrIndexer(prowlarrConfig || getProwlarrConfig(), indexerResource);
});

ipcMain.handle('add-prowlarr-indexer', async (event, prowlarrConfig, indexerResource) => {
  const { addProwlarrIndexer } = await getSourcesModule();
  return addProwlarrIndexer(prowlarrConfig || getProwlarrConfig(), indexerResource);
});

ipcMain.handle('delete-prowlarr-indexer', async (event, prowlarrConfig, indexerId) => {
  const { deleteProwlarrIndexer } = await getSourcesModule();
  return deleteProwlarrIndexer(prowlarrConfig || getProwlarrConfig(), indexerId);
});

ipcMain.handle('select-prowlarr-executable', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Prowlarr executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Prowlarr', extensions: ['exe'] }]
      : [{ name: 'Prowlarr', extensions: ['*'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return '';
  }

  return result.filePaths[0];
});

ipcMain.handle('start-managed-prowlarr', async (event, prowlarrConfig) => {
  return startManagedProwlarr(prowlarrConfig || getProwlarrConfig());
});

ipcMain.handle('stop-managed-prowlarr', async () => {
  return {
    ok: true,
    stopped: stopManagedProwlarr(),
  };
});

ipcMain.handle('get-managed-prowlarr-status', async () => {
  return {
    running: Boolean(prowlarrProcess && !prowlarrProcess.killed) || isSystemProwlarrRunning(),
    expectedPath: getBundledProwlarrExecutable(),
    dataDir: getManagedProwlarrDataDir(),
  };
});

// ═══════════════════════════════════════════════════════════════
// TORRENT IPC HANDLERS
// ═══════════════════════════════════════════════════════════════

ipcMain.handle('torrent-add', async (event, opts) => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.add(opts);
    if (result?.ok && opts?.mode === 'download') {
      upsertPersistedDownload({
        key: result.id,
        magnetOrHash: opts?.magnetOrHash || '',
        torrentUrl: opts?.torrentUrl || '',
        title: opts?.title || '',
        mediaInfo: opts?.mediaInfo || {},
        paused: false,
        manuallyPaused: false,
        queueOrder: getNextQueueOrder(),
      });
    }
    return result;
  } catch (err) {
    logEvent('torrent', classifyError(err.message), 'Torrent add failed', { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-prepare', async (event, opts) => {
  try {
    const tm = await ensureTorrentManager();
    return await tm.prepare(opts);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-get-files', async (event, id) => {
  try {
    const tm = await ensureTorrentManager();
    return await tm.getFiles(id);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-select-files', async (event, id, fileIndexes = [], resume = true, sequentialDownload = false) => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.selectFiles(id, fileIndexes, resume, sequentialDownload);
    if (result?.ok && id) {
      const all = await tm.getAll();
      const current = (all?.torrents || []).find((torrent) => torrent.id === id);
      if (current) {
        upsertPersistedDownload({
          key: current.id,
          magnetOrHash: current.id,
          torrentUrl: '',
          title: current.title || current.name || '',
          mediaInfo: current.mediaInfo || {},
          paused: Boolean(current.paused),
          manuallyPaused: false,
          selectedFileIndexes: Array.isArray(result.selectedFileIndexes) ? result.selectedFileIndexes : fileIndexes,
          sequentialDownload: result.sequentialDownload === true || sequentialDownload === true,
        });
      }
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-get-status', async (event, id) => {
  try {
    const tm = await ensureTorrentManager();
    const status = await tm.getStatus(id);
    return status || { ok: false, error: 'Torrent not found' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-get-all', async () => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.getAll();
    if (Array.isArray(result?.torrents)) {
      result.torrents = result.torrents.map((torrent) => ({
        ...torrent,
        queueOrder: getQueueOrderForKey(torrent.id),
      }));
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message, torrents: [] };
  }
});

ipcMain.handle('torrent-reorder', async (event, id, direction) => {
  try {
    const tm = await ensureTorrentManager();
    const all = await tm.getAll();
    const active = (all?.torrents || [])
      .filter((torrent) => !torrent.done)
      .sort((a, b) => {
        const orderA = getQueueOrderForKey(a.id);
        const orderB = getQueueOrderForKey(b.id);
        if (orderA !== orderB) return orderA - orderB;
        return Number(a.addedAt || 0) - Number(b.addedAt || 0);
      });

    const currentIndex = active.findIndex((torrent) => String(torrent.id) === String(id));
    if (currentIndex < 0) return { ok: false, error: 'Torrent not found in queue' };

    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= active.length) return { ok: true, unchanged: true };

    const reordered = [...active];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    setQueueOrderForKeys(reordered.map((torrent) => torrent.id));

    await enforceTorrentRules();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-pause', async (event, id) => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.pause(id);
    if (result?.ok) {
      const all = await tm.getAll();
      const current = (all?.torrents || []).find((torrent) => torrent.id === id);
      if (current) {
        upsertPersistedDownload({
          key: current.id,
          magnetOrHash: current.id,
          torrentUrl: '',
          title: current.title || current.name || '',
          mediaInfo: current.mediaInfo || {},
          paused: true,
          manuallyPaused: true,
          selectedFileIndexes: Array.isArray(current.selectedFileIndexes) ? current.selectedFileIndexes : [],
          sequentialDownload: current.sequentialDownload === true,
        });
      }
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-resume', async (event, id) => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.resume(id);
    if (result?.ok) {
      const all = await tm.getAll();
      const current = (all?.torrents || []).find((torrent) => torrent.id === id);
      if (current) {
        upsertPersistedDownload({
          key: current.id,
          magnetOrHash: current.id,
          torrentUrl: '',
          title: current.title || current.name || '',
          mediaInfo: current.mediaInfo || {},
          paused: false,
          manuallyPaused: false,
          selectedFileIndexes: Array.isArray(current.selectedFileIndexes) ? current.selectedFileIndexes : [],
          sequentialDownload: current.sequentialDownload === true,
        });
      }
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-remove', async (event, id, deleteFiles) => {
  try {
    const tm = await ensureTorrentManager();
    const status = await tm.getStatus(id);
    if (status?.ok) {
      cacheTorrentLibraryMetadata(status);
    }
    const result = await tm.remove(id, deleteFiles);
    if (result?.ok) {
      removePersistedDownload(id);
      completedTorrentNotified.delete(String(id));
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-get-speed-limit', async () => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.getSpeedLimit();
    if (result?.ok) {
      return {
        ok: true,
        downloadRateLimit: result.downloadRateLimit,
        downloadRateLimitKbps: Math.round((Number(result.downloadRateLimit) || 0) / 1024),
      };
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-set-speed-limit', async (event, kbps) => {
  try {
    const safeKbps = Math.max(0, Number(kbps) || 0);
    const tm = await ensureTorrentManager();
    const result = await tm.setSpeedLimit(safeKbps * 1024);
    if (result?.ok) {
      store.set(TORRENT_SPEED_LIMIT_KEY, safeKbps);
      return {
        ok: true,
        downloadRateLimit: result.downloadRateLimit,
        downloadRateLimitKbps: safeKbps,
      };
    }
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-get-settings', async () => {
  return { ok: true, settings: getTorrentSettings() };
});

ipcMain.handle('torrent-save-settings', async (event, nextSettings) => {
  const saved = saveTorrentSettings(nextSettings || {});
  if (torrentManager) {
    await torrentManager.setSessionOptions(saved);
  }
  await enforceTorrentRules();
  return { ok: true, settings: saved };
});

ipcMain.handle('select-download-dir', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select download directory',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return '';
  store.set('downloadDir', result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle('get-download-dir', async () => {
  return getDownloadDir();
});

ipcMain.handle('open-torrent-video', async (event, payload = {}) => {
  try {
    const tm = await ensureTorrentManager();
    const status = await tm.getStatus(payload.id);
    if (!status?.ok) {
      return { ok: false, error: status?.error || 'Torrent not found' };
    }
    const savePath = String(status.savePath || getDownloadDir());
    const relPath = String(status.videoFile?.path || '');
    if (!relPath) {
      return { ok: false, error: 'Video file not available' };
    }
    const fullPath = path.resolve(savePath, relPath);
    const fileUrl = pathToFileURL(fullPath).href;
    await shell.openExternal(fileUrl);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.ts']);

const scanLibraryItems = (rootDir) => {
  const items = [];
  const queue = [rootDir];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      const parent = path.basename(path.dirname(fullPath));
      const title = parent && parent !== path.basename(rootDir)
        ? parent
        : path.parse(entry.name).name;
      let size = 0;
      let mtimeMs = 0;
      try {
        const stat = fs.statSync(fullPath);
        size = Number(stat.size || 0);
        mtimeMs = Number(stat.mtimeMs || 0);
      } catch {}
      items.push({
        id: fullPath,
        title,
        fileName: entry.name,
        fullPath,
        relativePath: path.relative(rootDir, fullPath),
        size,
        mtimeMs,
        fileHash: crypto.createHash('sha1').update(`${fullPath}|${size}|${mtimeMs}`).digest('hex'),
      });
    }
  }
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

ipcMain.handle('library-scan', async () => {
  try {
    const rootDir = getDownloadDir();
    if (!fs.existsSync(rootDir)) return { ok: true, items: [] };
    const items = scanLibraryItems(rootDir);
    return { ok: true, items, rootDir };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('library-metadata-get', async (event, filePaths = []) => {
  try {
    if (!metadataDb || !Array.isArray(filePaths) || !filePaths.length) return { ok: true, items: [] };
    const stmt = metadataDb.prepare('SELECT file_path as filePath, file_hash as fileHash, title, year, poster_url as posterUrl, tmdb_id as tmdbId, media_type as mediaType, updated_at as updatedAt FROM media_metadata_cache WHERE file_path = ?');
    const items = filePaths.map((filePath) => stmt.get(String(filePath))).filter(Boolean);
    return { ok: true, items };
  } catch (err) {
    logEvent('library', classifyError(err.message), 'Metadata get failed', { error: err.message });
    return { ok: false, items: [], error: err.message };
  }
});

ipcMain.handle('library-metadata-upsert', async (event, payload = {}) => {
  try {
    return upsertLibraryMetadata(payload);
  } catch (err) {
    logEvent('library', classifyError(err.message), 'Metadata upsert failed', { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('torrent-validate-candidate', async (event, payload = {}) => {
  const releaseTitle = String(payload.releaseTitle || '');
  const expected = payload.expected || {};
  const result = {
    ok: true,
    score: 0,
    checks: {
      year: 'unknown',
      quality: 'unknown',
      language: 'unknown',
      episode: 'unknown',
      size: 'unknown',
    },
    reasons: [],
  };

  const lowered = releaseTitle.toLowerCase();
  const expectedYear = Number(expected.year) || 0;
  if (expectedYear) {
    const hasYear = lowered.includes(String(expectedYear));
    result.checks.year = hasYear ? 'pass' : 'fail';
    if (hasYear) result.score += 20; else result.reasons.push('year_mismatch');
  }
  const q = String(expected.quality || '').toLowerCase();
  if (q && q !== 'unknown') {
    const passQ = lowered.includes(q);
    result.checks.quality = passQ ? 'pass' : 'warn';
    if (passQ) result.score += 15;
  }
  const lang = String(expected.language || '').toLowerCase();
  if (lang) {
    const passLang = lang === 'tr' ? /\b(tr|turk|türk|turkish)\b/i.test(releaseTitle) : /\b(en|english)\b/i.test(releaseTitle);
    result.checks.language = passLang ? 'pass' : 'warn';
    if (passLang) result.score += 10;
  }
  const season = Number(expected.season) || 0;
  const episode = Number(expected.episode) || 0;
  if (season && episode) {
    const code = `s${String(season).padStart(2, '0')}e${String(episode).padStart(2, '0')}`;
    const seasonCode = `s${String(season).padStart(2, '0')}`;
    const allowSeasonPack = expected.allowSeasonPack === true;
    const looksLikeSeasonPack = allowSeasonPack && (
      lowered.includes(seasonCode)
      || /\b(complete|season|sezon|pack)\b/i.test(releaseTitle)
    );
    const passEp = lowered.includes(code);
    result.checks.episode = passEp ? 'pass' : looksLikeSeasonPack ? 'warn' : 'fail';
    if (passEp) result.score += 30;
    else if (looksLikeSeasonPack) result.score += 10;
    else result.reasons.push('episode_mismatch');
  }
    const size = Number(payload.size) || 0;
  if (size > 0) {
    const gib = size / (1024 ** 3);
    const passSize = gib > 0.2;
    result.checks.size = passSize ? 'pass' : 'fail';
    if (passSize) result.score += 10; else result.reasons.push('size_too_small');
  }

  if (result.reasons.includes('episode_mismatch')) {
    result.ok = false;
  }

  return result;
});

const getSubtitleAddonBaseUrl = () => {
  const custom = String(store.get('subtitleAddonBaseUrl') || '').trim();
  const base = custom || DEFAULT_SUBTITLE_ADDON_BASE_URL;
  return base.replace(/\/+$/, '');
};

const getSubtitleAddonBaseUrls = () => {
  const custom = String(store.get('subtitleAddonBaseUrl') || '').trim().replace(/\/+$/, '');
  const list = custom ? [custom] : [];
  for (const url of FALLBACK_SUBTITLE_ADDON_BASE_URLS) {
    const normalized = String(url || '').trim().replace(/\/+$/, '');
    if (!normalized) continue;
    if (!list.includes(normalized)) list.push(normalized);
  }
  return list;
};

const fetchJsonWithTimeout = async (url, timeoutMs = 20000) => {
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers: SUBTITLE_REQUEST_HEADERS,
      responseType: 'json',
      maxRedirects: 5,
      httpAgent: subtitleHttpAgent,
      httpsAgent: subtitleHttpsAgent,
      validateStatus: () => true,
    });
    if (!response || response.status < 200 || response.status >= 300) {
      const err = new Error(`HTTP ${response?.status || 0}`);
      err.code = `HTTP_${response?.status || 0}`;
      throw err;
    }
    return response.data;
  } catch (err) {
    if (err?.response?.status) {
      const wrapped = new Error(`HTTP ${err.response.status}`);
      wrapped.code = `HTTP_${err.response.status}`;
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }
};

const fetchTextWithTimeout = async (url, timeoutMs = 20000) => {
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      headers: SUBTITLE_REQUEST_HEADERS,
      responseType: 'text',
      maxRedirects: 5,
      httpAgent: subtitleHttpAgent,
      httpsAgent: subtitleHttpsAgent,
      validateStatus: () => true,
    });
    if (!response || response.status < 200 || response.status >= 300) {
      const err = new Error(`HTTP ${response?.status || 0}`);
      err.code = `HTTP_${response?.status || 0}`;
      throw err;
    }
    return {
      text: String(response.data || ''),
      contentType: String(response.headers?.['content-type'] || ''),
    };
  } catch (err) {
    if (err?.response?.status) {
      const wrapped = new Error(`HTTP ${err.response.status}`);
      wrapped.code = `HTTP_${err.response.status}`;
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  }
};

const extractRequestErrorDetails = (err) => {
  const cause = err?.cause || err?.innerError || null;
  return {
    error: String(err?.message || 'request failed'),
    name: String(err?.name || ''),
    cause: cause ? String(cause?.message || '') : '',
    code: String(cause?.code || err?.code || ''),
    errno: String(cause?.errno || err?.errno || ''),
    syscall: String(cause?.syscall || err?.syscall || ''),
    address: String(cause?.address || err?.address || ''),
    port: Number(cause?.port || err?.port || 0) || null,
  };
};

const resolveImdbIdForSubtitle = async ({ imdbId, tmdbType, tmdbId }) => {
  const direct = String(imdbId || '').trim();
  if (direct.startsWith('tt')) return direct;
  const type = String(tmdbType || '').trim().toLowerCase();
  const id = Number(tmdbId) || 0;
  const apiKey = String(store.get('apiKey') || '').trim();
  if (!apiKey || !id || !type) return '';
  const endpointType = type === 'tv' || type === 'anime' ? 'tv' : 'movie';
  const url = new URL(`https://api.themoviedb.org/3/${endpointType}/${id}/external_ids`);
  url.searchParams.set('api_key', apiKey);
  const data = await fetchJsonWithTimeout(url.toString(), 15000);
  const resolved = String(data?.imdb_id || '').trim();
  return resolved.startsWith('tt') ? resolved : '';
};

const normalizeSubtitleType = (tmdbType = '') => {
  const type = String(tmdbType || '').toLowerCase();
  return type === 'movie' ? 'movie' : 'series';
};

const buildSubtitleCandidatePaths = ({ type, target }) => {
  const list = [
    `/subtitles/${type}/${target}.json`,
    `/addon/subtitles/${type}/${target}.json`,
  ];
  if (type === 'series') {
    list.push(`/subtitles/tv/${target}.json`);
    list.push(`/addon/subtitles/tv/${target}.json`);
  }
  return list;
};

const buildSubtitleRequestCandidates = ({ type, target }) => {
  const candidates = [];
  const opensubBase = OPENSUBTITLES_V3_BASE_URL.replace(/\/+$/, '');
  if (opensubBase) {
    candidates.push({
      provider: 'opensubtitles-v3',
      base: opensubBase,
      route: `/subtitles/${type}/${target}.json`,
    });
  }
  for (const base of getSubtitleAddonBaseUrls()) {
    for (const route of buildSubtitleCandidatePaths({ type, target })) {
      candidates.push({
        provider: 'turkcealtyaziorg-stremio-addon',
        base,
        route,
      });
    }
  }
  return candidates;
};

const getSubtitleCacheKey = ({ type, target }) => `${String(type || '').toLowerCase()}|${String(target || '').toLowerCase()}`;

const getCachedSubtitleSearch = (cacheKey) => {
  const hit = subtitleSearchCache.get(cacheKey);
  if (!hit) return null;
  if ((Date.now() - Number(hit.cachedAt || 0)) > SUBTITLE_SEARCH_CACHE_TTL_MS) {
    subtitleSearchCache.delete(cacheKey);
    return null;
  }
  return hit.payload || null;
};

const setCachedSubtitleSearch = (cacheKey, payload) => {
  subtitleSearchCache.set(cacheKey, {
    cachedAt: Date.now(),
    payload,
  });
};

const stripSubtitleFileExtension = (value = '') => String(value || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim();

const decodeContentDispositionFilename = (headerValue = '') => {
  const raw = String(headerValue || '').trim();
  if (!raw) return '';
  const extended = raw.match(/filename\*\s*=\s*(?:UTF-8''|utf-8''|)([^;]+)/i);
  const basic = raw.match(/filename\s*=\s*"?([^\";]+)"?/i);
  const candidate = extended?.[1] || basic?.[1] || '';
  if (!candidate) return '';
  try {
    return decodeURIComponent(candidate.replace(/^["']|["']$/g, '')).trim();
  } catch {
    return candidate.replace(/^["']|["']$/g, '').trim();
  }
};

const extractSubtitleDownloadCount = (subtitle = {}) => {
  const candidates = [
    subtitle?.downloadCount,
    subtitle?.download_count,
    subtitle?.downloads,
    subtitle?.downloads_count,
    subtitle?.downloadsCount,
    subtitle?.g,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
};

const getCachedSubtitleMetadata = (url = '') => {
  const key = String(url || '').trim();
  if (!key) return null;
  return subtitleMetadataCache.get(key) || null;
};

const setCachedSubtitleMetadata = (url = '', payload = {}) => {
  const key = String(url || '').trim();
  if (!key) return;
  subtitleMetadataCache.set(key, payload);
};

const fetchSubtitleMetadata = async (url, timeoutMs = 8000) => {
  const cached = getCachedSubtitleMetadata(url);
  if (cached) return cached;
  try {
    const response = await axios.head(url, {
      timeout: timeoutMs,
      headers: SUBTITLE_REQUEST_HEADERS,
      maxRedirects: 5,
      httpAgent: subtitleHttpAgent,
      httpsAgent: subtitleHttpsAgent,
      validateStatus: () => true,
    });
    if (!response || response.status < 200 || response.status >= 300) {
      const empty = {};
      setCachedSubtitleMetadata(url, empty);
      return empty;
    }
    const metadata = {
      fileName: decodeContentDispositionFilename(response.headers?.['content-disposition'] || ''),
    };
    setCachedSubtitleMetadata(url, metadata);
    return metadata;
  } catch {
    const empty = {};
    setCachedSubtitleMetadata(url, empty);
    return empty;
  }
};

const mapWithConcurrency = async (items = [], limit = 6, mapper) => {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, list.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= list.length) return;
      results[currentIndex] = await mapper(list[currentIndex], currentIndex);
    }
  }));
  return results;
};

const guessSubtitleLabel = (subtitle = {}, url = '') => {
  const direct = String(
    subtitle?.label
    || subtitle?.title
    || subtitle?.name
    || subtitle?.fileName
    || subtitle?.filename
    || ''
  ).trim();
  if (direct) return direct;
  try {
    const parsed = new URL(url);
    const file = decodeURIComponent(path.basename(parsed.pathname || '')).trim();
    if (file) return file;
  } catch {}
  return '';
};

const sanitizeSubtitleList = (subtitles = [], baseUrl = '', provider = '') => {
  if (!Array.isArray(subtitles)) return [];
  return subtitles
    .map((subtitle, index) => {
      let url = String(subtitle?.url || '').trim();
      if (!url) return null;
      if (url.startsWith('/')) {
        url = `${String(baseUrl || '').replace(/\/+$/, '')}${url}`;
      }
      return {
        id: String(subtitle?.id || `sub-${index + 1}`),
        lang: String(subtitle?.lang || 'unknown'),
        url,
        label: guessSubtitleLabel(subtitle, url),
        fileName: String(subtitle?.fileName || subtitle?.filename || '').trim(),
        downloadCount: extractSubtitleDownloadCount(subtitle),
        provider: provider || '',
      };
    })
    .filter(Boolean);
};

const enrichSubtitleList = async (subtitles = []) => {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];

  const normalized = subtitles.map((subtitle) => ({
    ...subtitle,
    fileName: String(subtitle?.fileName || subtitle?.label || '').trim(),
  }));

  const indexesNeedingLookup = normalized
    .map((subtitle, index) => ({ subtitle, index }))
    .filter(({ subtitle }) => !subtitle.fileName && subtitle.provider === 'opensubtitles-v3' && subtitle.url)
    .slice(0, 40);

  await mapWithConcurrency(indexesNeedingLookup, 6, async ({ subtitle, index }) => {
    const metadata = await fetchSubtitleMetadata(subtitle.url, 8000);
    const resolvedFileName = String(metadata?.fileName || '').trim();
    if (!resolvedFileName) return;
    normalized[index] = {
      ...normalized[index],
      fileName: resolvedFileName,
      label: resolvedFileName,
    };
  });

  return normalized.map((subtitle) => ({
    ...subtitle,
    fileName: stripSubtitleFileExtension(subtitle.fileName),
    label: stripSubtitleFileExtension(subtitle.label || subtitle.fileName),
  }));
};

const isPrivateOrLocalHost = (hostname = '') => {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

ipcMain.handle('library-subtitles-search', async (event, payload = {}) => {
  try {
    const filePath = String(payload.fullPath || '').trim();
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'Video file not found' };
    }
    const season = Math.max(0, Number(payload.season) || 0);
    const episode = Math.max(0, Number(payload.episode) || 0);
    const tmdbType = String(payload.tmdbType || '').trim();
    const imdbId = await resolveImdbIdForSubtitle({
      imdbId: payload.imdbId,
      tmdbType,
      tmdbId: payload.tmdbId,
    });
    if (!imdbId) {
      return { ok: false, error: 'IMDB id not available for this item' };
    }

    const type = normalizeSubtitleType(tmdbType);
    const targets = type === 'movie'
      ? [`${imdbId}`]
      : [`${imdbId}:${season}:${episode}`];
    const cacheKey = getSubtitleCacheKey({ type, target: targets.join('|') });
    const cached = getCachedSubtitleSearch(cacheKey);
    if (cached) {
      return {
        ...cached,
        debug: {
          ...(cached.debug || {}),
          cache: 'hit',
        },
      };
    }
    let data = null;
    let resolvedBase = '';
    let resolvedProvider = '';
    let resolvedTarget = '';
    const tried = [];
    const errors = [];
    for (const target of targets) {
      const requestCandidates = buildSubtitleRequestCandidates({ type, target });
      for (const candidate of requestCandidates) {
        const url = `${candidate.base}${candidate.route}`;
        tried.push(url);
        try {
          data = await fetchJsonWithTimeout(url, 20000);
          if (data) {
            resolvedBase = candidate.base;
            resolvedProvider = candidate.provider;
            resolvedTarget = target;
            break;
          }
        } catch (err) {
          const errDetails = extractRequestErrorDetails(err);
          errors.push({
            provider: candidate.provider,
            url,
            ...errDetails,
          });
        }
      }
      if (data) break;
    }
    if (!data) {
      logSafeEvent('subtitles', 'search_failed_all_sources', 'Subtitle search failed on all addon endpoints', {
        imdbId,
        tmdbType,
        season,
        episode,
        tried,
        errors,
      });
      const responsePayload = {
        ok: true,
        subtitles: [],
        imdbId,
        debug: {
          source: 'multi-provider',
          tried,
          errors,
          message: 'No subtitle payload received from addon endpoints',
        },
      };
      setCachedSubtitleSearch(cacheKey, responsePayload);
      return responsePayload;
    }
    const rawSubs = Array.isArray(data?.subtitles)
      ? data.subtitles
      : (Array.isArray(data?.all) ? data.all : (Array.isArray(data) ? data : []));
    const subtitles = await enrichSubtitleList(sanitizeSubtitleList(rawSubs, resolvedBase, resolvedProvider));
    const responsePayload = {
      ok: true,
      subtitles,
      imdbId,
      debug: {
        source: resolvedProvider || 'unknown',
        tried,
        errors,
        resolvedTarget,
        resolvedProvider,
        resolvedBase,
        rawCount: rawSubs.length,
      },
    };
    setCachedSubtitleSearch(cacheKey, responsePayload);
    return responsePayload;
  } catch (err) {
    logSafeEvent('subtitles', 'search_failed', 'Library subtitle search failed', { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('library-subtitles-download', async (event, payload = {}) => {
  try {
    const filePath = String(payload.fullPath || '').trim();
    const subtitleUrl = String(payload.subtitleUrl || '').trim();
    const subtitleProvider = String(payload.subtitleProvider || '').trim();
    const outputBaseName = String(payload.outputBaseName || '').trim();
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Video file not found' };
    if (!subtitleUrl) return { ok: false, error: 'Subtitle URL missing' };
    let parsedUrl;
    try {
      parsedUrl = new URL(subtitleUrl);
    } catch {
      return { ok: false, error: 'Invalid subtitle URL' };
    }
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      return { ok: false, error: 'Unsupported subtitle URL protocol' };
    }
    if (isPrivateOrLocalHost(parsedUrl.hostname)) {
      return { ok: false, error: 'Subtitle host is not allowed' };
    }
    if (subtitleProvider === 'turkcealtyaziorg-stremio-addon') {
      const allowedBases = getSubtitleAddonBaseUrls();
      if (!allowedBases.some((base) => subtitleUrl.startsWith(base))) {
        return { ok: false, error: 'Subtitle source not allowed' };
      }
    }

    const { text, contentType } = await fetchTextWithTimeout(subtitleUrl, 25000);
    if (!text || !text.trim()) return { ok: false, error: 'Subtitle content is empty' };
    const videoDir = path.dirname(filePath);
    const videoBase = outputBaseName || path.parse(filePath).name;
    const extByUrl = path.extname(new URL(subtitleUrl).pathname || '').toLowerCase();
    const extByType = /\b(vtt)\b/i.test(contentType) ? '.vtt' : '.srt';
    const subtitleExt = extByUrl && extByUrl.length <= 5 ? extByUrl : extByType;
    const subtitlePath = path.join(videoDir, `${videoBase}${subtitleExt}`);
    fs.writeFileSync(subtitlePath, text, 'utf8');
    return { ok: true, path: subtitlePath };
  } catch (err) {
    logSafeEvent('subtitles', 'download_failed', 'Library subtitle download failed', { error: err.message });
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('logs-get', async () => ({ ok: true, logs: appLogs }));
ipcMain.handle('logs-clear', async () => {
  appLogs.length = 0;
  return { ok: true };
});

ipcMain.handle('open-library-video', async (event, payload = {}) => {
  try {
    const filePath = String(payload.fullPath || '');
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }
    const fileUrl = pathToFileURL(filePath).href;
    await shell.openExternal(fileUrl);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-library-folder', async (event, payload = {}) => {
  try {
    const filePath = String(payload.fullPath || '');
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

