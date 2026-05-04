const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const isDev = require('electron-is-dev');
const Store = require('electron-store');
const store = new Store();
const { TorrentManager } = require('./src/torrent/torrentManager.cjs');

// Torrent manager - lazy init
let torrentManager = null;
let torrentRestorePromise = null;
let metadataDb = null;
const appLogs = [];
const MAX_APP_LOGS = 500;

const PERSISTED_DOWNLOADS_KEY = 'torrentDownloads';
const TORRENT_SPEED_LIMIT_KEY = 'torrentDownloadSpeedLimitKbps';
const TORRENT_SETTINGS_KEY = 'torrentSettings';
const DEFAULT_TORRENT_SETTINGS = {
  seedAfterDownload: true,
  maxActiveDownloads: 3,
  dhtEnabled: true,
  lsdEnabled: true,
  upnpEnabled: true,
  natPmpEnabled: true,
  announceToAllTrackers: true,
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

const enforceTorrentRules = async () => {
  if (!torrentManager) return;
  try {
    const settings = getTorrentSettings();
    const all = await torrentManager.getAll();
    const torrents = Array.isArray(all?.torrents) ? all.torrents : [];
    const sorted = [...torrents].sort((a, b) => {
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

    const downloadingActive = sorted.filter((t) => !t.done && !t.paused);
    if (downloadingActive.length > settings.maxActiveDownloads) {
      for (const t of downloadingActive.slice(settings.maxActiveDownloads)) {
        await torrentManager.pause(t.id);
      }
    }

    const currentActive = sorted.filter((t) => !t.done && !t.paused).length;
    if (currentActive < settings.maxActiveDownloads) {
      const pausedQueue = sorted.filter((t) => !t.done && t.paused);
      const toResumeCount = settings.maxActiveDownloads - currentActive;
      for (const t of pausedQueue.slice(0, toResumeCount)) {
        await torrentManager.resume(t.id);
      }
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
      const result = await tm.add({
        magnetOrHash: entry.magnetOrHash || '',
        torrentUrl: entry.torrentUrl || '',
        mode: 'download',
        title: entry.title || 'Unknown',
        mediaInfo: entry.mediaInfo || {},
      });

      if (result?.ok && entry.paused) {
        await tm.pause(result.id);
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

const sourcesModulePath = pathToFileURL(path.join(__dirname, 'src', 'sources', 'index.mjs')).href;

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    title: 'Cinesoft',
    autoHideMenuBar: true,
  });
  const url = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, 'dist/index.html')}`;

  win.loadURL(url);

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

app.on('window-all-closed', () => {
  stopManagedProwlarr();
  if (torrentRulesInterval) {
    clearInterval(torrentRulesInterval);
    torrentRulesInterval = null;
  }
  if (torrentManager) {
    torrentManager.destroy();
    torrentManager = null;
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
    torrentio: store.get('torrentio') || {
      baseUrl: 'https://torrentio.strem.fun',
      maxResults: 80,
      excludeKeywords: 'cam,ts,tc',
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
  store.set('torrentio', settings.torrentio || {
    baseUrl: 'https://torrentio.strem.fun',
    maxResults: 80,
    excludeKeywords: 'cam,ts,tc',
  });
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
  try {
    const { searchStreamSourcesForMovie } = await getSourcesModule();
    return await searchStreamSourcesForMovie(getProwlarrConfig(), params);
  } catch (err) {
    logEvent('prowlarr', classifyError(err.message), 'Movie source search failed', { error: err.message });
    return [];
  }
});

ipcMain.handle('search-episode-sources', async (event, params) => {
  try {
    const { searchStreamSourcesForEpisode } = await getSourcesModule();
    return await searchStreamSourcesForEpisode(getProwlarrConfig(), params);
  } catch (err) {
    logEvent('prowlarr', classifyError(err.message), 'Episode source search failed', { error: err.message });
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

ipcMain.handle('torrent-select-files', async (event, id, fileIndexes = [], resume = true) => {
  try {
    const tm = await ensureTorrentManager();
    const result = await tm.selectFiles(id, fileIndexes, resume);
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
    return result;
  } catch (err) {
    return { ok: false, error: err.message, torrents: [] };
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
    const result = await tm.remove(id, deleteFiles);
    if (result?.ok) {
      removePersistedDownload(id);
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
    const passEp = lowered.includes(code);
    result.checks.episode = passEp ? 'pass' : 'fail';
    if (passEp) result.score += 30; else result.reasons.push('episode_mismatch');
  }
  const size = Number(payload.size) || 0;
  if (size > 0) {
    const gib = size / (1024 ** 3);
    const passSize = gib > 0.2;
    result.checks.size = passSize ? 'pass' : 'fail';
    if (passSize) result.score += 10; else result.reasons.push('size_too_small');
  }
  if (result.reasons.includes('episode_mismatch'))
{
  return result;
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
