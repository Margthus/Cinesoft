const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const axios = require('axios');
const { pathToFileURL } = require('url');
const radarrService = require('./src/main/services/radarrService');
const sonarrService = require('./src/main/services/sonarrService');
const { createEngineInstallerService } = require('./src/main/services/engineInstallerService');
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
let vpnDisconnectPauseNotified = false;
let mainWindow = null;
let appTray = null;
let trayAvailable = false;
let isQuitting = false;
let cleanupStarted = false;

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

const normalizeHttpUrl = (value = '', label = 'URL') => {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required.`);
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const normalized = withProtocol.replace(/\/+$/, '');
  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }
  return normalized;
};

const mapProwlarrError = (error, fallback = 'Prowlarr request failed.') => {
  if (error?.response) {
    const status = Number(error.response.status || 0);
    const data = error.response.data;
    const message = typeof data === 'string'
      ? data
      : (data?.message || data?.error || JSON.stringify(data || {}));
    if (status === 401 || status === 403) return new Error('Prowlarr authentication failed. Check API key.');
    if (status === 404) return new Error('Prowlarr endpoint not found. Check Base URL.');
    if (message && message.length < 320) return new Error(`Prowlarr error (${status}): ${message}`);
    return new Error(`Prowlarr error (${status}).`);
  }
  if (error?.code === 'ECONNREFUSED') return new Error('Could not connect to Prowlarr. Is it running?');
  if (error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message || ''))) return new Error('Prowlarr request timed out.');
  return new Error(error?.message || fallback);
};

const prowlarrRequest = async (prowlarrConfig = {}, endpoint = '', options = {}) => {
  const baseUrl = normalizeHttpUrl(prowlarrConfig.baseUrl, 'Prowlarr URL');
  const apiKey = String(prowlarrConfig.apiKey || '').trim();
  if (!apiKey) throw new Error('Prowlarr API key is required.');
  const timeout = Number(prowlarrConfig.timeout || 10000);
  const url = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  try {
    const response = await axios({
      method: String(options.method || 'GET').toUpperCase(),
      url,
      data: options.data,
      params: options.params,
      timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 10000,
      validateStatus: () => true,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (response.status < 200 || response.status >= 300) {
      const err = new Error(`HTTP ${response.status}`);
      err.response = response;
      throw err;
    }
    return response.data;
  } catch (error) {
    throw mapProwlarrError(error);
  }
};

const setSchemaFieldValue = (fields = [], names = [], value) => {
  const match = fields.find((field) => names.includes(String(field?.name || '').toLowerCase()));
  if (match) {
    match.value = value;
    return true;
  }
  return false;
};

const triggerProwlarrAppSync = async (prowlarrConfig = {}) => {
  const commandNames = ['ApplicationIndexerSync', 'ApplicationsSync', 'ApplicationSync'];
  for (const name of commandNames) {
    try {
      const cmd = await prowlarrRequest(prowlarrConfig, '/api/v1/command', {
        method: 'POST',
        data: { name },
      });
      if (cmd?.id || cmd?.name) {
        return { ok: true, name, id: cmd?.id };
      }
    } catch {
      // try next known command name
    }
  }
  return { ok: false };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForProwlarrCommand = async (prowlarrConfig = {}, commandId, timeoutMs = 30000) => {
  if (!commandId) return { ok: false, timeout: false };
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const cmd = await prowlarrRequest(prowlarrConfig, `/api/v1/command/${commandId}`);
      const status = String(cmd?.status || '').toLowerCase();
      if (['completed', 'completedwitherrors'].includes(status)) {
        return { ok: true, status };
      }
      if (['failed', 'aborted', 'cancelled'].includes(status)) {
        return { ok: false, status };
      }
    } catch {
      // keep waiting until timeout
    }
    await delay(900);
  }
  return { ok: false, timeout: true };
};

const getRadarrMissingIndexerNames = async (prowlarrConfig = {}, radarrSettings = {}) => {
  try {
    const [prowIdxRows, radIdxRows] = await Promise.all([
      prowlarrRequest(prowlarrConfig, '/api/v1/indexer'),
      radarrService.radarrRequest(radarrSettings, '/api/v3/indexer'),
    ]);
    const prowNames = (Array.isArray(prowIdxRows) ? prowIdxRows : [])
      .filter((row) => row?.enable !== false && String(row?.protocol || '').toLowerCase() === 'torrent')
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean);
    const normalizeName = (value = '') => String(value || '')
      .trim()
      .replace(/\s*\(prowlarr\)\s*$/i, '')
      .toLowerCase();

    const radNames = new Set(
      (Array.isArray(radIdxRows) ? radIdxRows : [])
        .map((row) => normalizeName(row?.name))
        .filter(Boolean),
    );
    return prowNames.filter((name) => !radNames.has(normalizeName(name)));
  } catch {
    return [];
  }
};

const getProwlarrTorznabIndexerPath = (indexerId) => `/api/v1/indexer/${indexerId}/newznab/`;

const setRadarrFieldValue = (fields = [], names = [], value) => {
  const lowerNames = names.map((name) => String(name).toLowerCase());
  const field = fields.find((item) => lowerNames.includes(String(item?.name || '').toLowerCase()));
  if (!field) return false;
  field.value = value;
  return true;
};

const addMissingIndexersToRadarrViaTorznab = async (prowlarrConfig = {}, radarrSettings = {}, missingNames = []) => {
  if (!missingNames.length) return [];
  const [prowIdxRows, radSchemaRows, radIndexerRows] = await Promise.all([
    prowlarrRequest(prowlarrConfig, '/api/v1/indexer'),
    radarrService.radarrRequest(radarrSettings, '/api/v3/indexer/schema'),
    radarrService.radarrRequest(radarrSettings, '/api/v3/indexer'),
  ]);
  const prowlarrIndexers = Array.isArray(prowIdxRows) ? prowIdxRows : [];
  const schemas = Array.isArray(radSchemaRows) ? radSchemaRows : [];
  const radarrIndexers = Array.isArray(radIndexerRows) ? radIndexerRows : [];
  const torznabSchema = schemas.find((row) => String(row?.implementationName || '').toLowerCase() === 'torznab');
  if (!torznabSchema) return [];
  const enabledTemplate = radarrIndexers.find((row) => String(row?.name || '').toLowerCase().includes('(prowlarr)') && row?.enable === true);

  const added = [];
  for (const missingName of missingNames) {
    const sourceIndexer = prowlarrIndexers.find((row) => String(row?.name || '').trim().toLowerCase() === String(missingName).trim().toLowerCase());
    if (!sourceIndexer?.id) continue;

    const payload = JSON.parse(JSON.stringify(enabledTemplate || torznabSchema));
    delete payload.id;
    delete payload.indexerUrls;
    delete payload.capabilities;
    delete payload.protocolCapabilities;
    payload.enable = true;
    payload.enableRss = true;
    payload.enableAutomaticSearch = true;
    payload.enableInteractiveSearch = true;
    payload.name = `${missingName} (Prowlarr)`;
    payload.protocol = 'torrent';
    payload.implementation = payload.implementation || 'Torznab';
    payload.implementationName = payload.implementationName || 'Torznab';
    payload.configContract = payload.configContract || 'TorznabSettings';
    payload.fields = Array.isArray(payload.fields) ? payload.fields : [];
    setRadarrFieldValue(payload.fields, ['baseUrl'], normalizeHttpUrl(prowlarrConfig.baseUrl, 'Prowlarr URL'));
    setRadarrFieldValue(payload.fields, ['apiPath'], getProwlarrTorznabIndexerPath(sourceIndexer.id));
    setRadarrFieldValue(payload.fields, ['apiKey'], String(prowlarrConfig.apiKey || '').trim());

    try {
      const created = await radarrService.radarrRequest(radarrSettings, '/api/v3/indexer', {
        method: 'POST',
        data: payload,
      });
      const createdId = created?.id;
      if (createdId != null) {
        try {
          const fresh = await radarrService.radarrRequest(radarrSettings, `/api/v3/indexer/${createdId}`);
          const updatePayload = {
            ...fresh,
            enable: true,
            enableRss: true,
            enableAutomaticSearch: true,
            enableInteractiveSearch: true,
          };
          await radarrService.radarrRequest(radarrSettings, `/api/v3/indexer/${createdId}`, {
            method: 'PUT',
            data: updatePayload,
          });
        } catch {
          // Fallback update path for Radarr variants expecting /api/v3/indexer
          try {
            const fresh = await radarrService.radarrRequest(radarrSettings, `/api/v3/indexer/${createdId}`);
            const updatePayload = {
              ...fresh,
              enable: true,
              enableRss: true,
              enableAutomaticSearch: true,
              enableInteractiveSearch: true,
            };
            await radarrService.radarrRequest(radarrSettings, '/api/v3/indexer', {
              method: 'PUT',
              data: updatePayload,
            });
          } catch {
            // Keep created indexer even if explicit enable update fails
          }
        }
      }
      added.push(missingName);
    } catch {
      // ignore single indexer failure, continue with others
    }
  }
  return added;
};

const normalizeRadarrProwlarrIndexers = async (radarrSettings = {}) => {
  try {
    const rows = await radarrService.radarrRequest(radarrSettings, '/api/v3/indexer');
    const indexers = Array.isArray(rows) ? rows : [];
    for (const indexer of indexers) {
      const name = String(indexer?.name || '').toLowerCase();
      if (!name.includes('(prowlarr)')) continue;
      const payload = {
        ...indexer,
        enable: true,
        enableRss: true,
        enableAutomaticSearch: true,
        enableInteractiveSearch: true,
      };
      try {
        await radarrService.radarrRequest(radarrSettings, `/api/v3/indexer/${indexer.id}`, {
          method: 'PUT',
          data: payload,
        });
      } catch {
        await radarrService.radarrRequest(radarrSettings, '/api/v3/indexer', {
          method: 'PUT',
          data: payload,
        });
      }
    }
  } catch {
    // non-fatal
  }
};

const getSonarrMissingIndexerNames = async (prowlarrConfig = {}, sonarrSettings = {}) => {
  try {
    const [prowIdxRows, sonIdxRows] = await Promise.all([
      prowlarrRequest(prowlarrConfig, '/api/v1/indexer'),
      sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer'),
    ]);
    const prowNames = (Array.isArray(prowIdxRows) ? prowIdxRows : [])
      .filter((row) => row?.enable !== false && String(row?.protocol || '').toLowerCase() === 'torrent')
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean);
    const normalizeName = (value = '') => String(value || '')
      .trim()
      .replace(/\s*\(prowlarr\)\s*$/i, '')
      .toLowerCase();

    const sonNames = new Set(
      (Array.isArray(sonIdxRows) ? sonIdxRows : [])
        .map((row) => normalizeName(row?.name))
        .filter(Boolean),
    );
    return prowNames.filter((name) => !sonNames.has(normalizeName(name)));
  } catch {
    return [];
  }
};

const setSonarrFieldValue = (fields = [], names = [], value) => {
  const lowerNames = names.map((name) => String(name).toLowerCase());
  const field = fields.find((item) => lowerNames.includes(String(item?.name || '').toLowerCase()));
  if (!field) return false;
  field.value = value;
  return true;
};

const addMissingIndexersToSonarrViaTorznab = async (prowlarrConfig = {}, sonarrSettings = {}, missingNames = []) => {
  if (!missingNames.length) return [];
  const [prowIdxRows, sonSchemaRows, sonIndexerRows] = await Promise.all([
    prowlarrRequest(prowlarrConfig, '/api/v1/indexer'),
    sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer/schema'),
    sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer'),
  ]);
  const prowlarrIndexers = Array.isArray(prowIdxRows) ? prowIdxRows : [];
  const schemas = Array.isArray(sonSchemaRows) ? sonSchemaRows : [];
  const sonarrIndexers = Array.isArray(sonIndexerRows) ? sonIndexerRows : [];
  const torznabSchema = schemas.find((row) => String(row?.implementationName || '').toLowerCase() === 'torznab');
  if (!torznabSchema) return [];
  const enabledTemplate = sonarrIndexers.find((row) => String(row?.name || '').toLowerCase().includes('(prowlarr)') && row?.enable === true);

  const added = [];
  for (const missingName of missingNames) {
    const sourceIndexer = prowlarrIndexers.find((row) => String(row?.name || '').trim().toLowerCase() === String(missingName).trim().toLowerCase());
    if (!sourceIndexer?.id) continue;

    const payload = JSON.parse(JSON.stringify(enabledTemplate || torznabSchema));
    delete payload.id;
    delete payload.indexerUrls;
    delete payload.capabilities;
    delete payload.protocolCapabilities;
    payload.enable = true;
    payload.enableRss = true;
    payload.enableAutomaticSearch = true;
    payload.enableInteractiveSearch = true;
    payload.name = `${missingName} (Prowlarr)`;
    payload.protocol = 'torrent';
    payload.implementation = payload.implementation || 'Torznab';
    payload.implementationName = payload.implementationName || 'Torznab';
    payload.configContract = payload.configContract || 'TorznabSettings';
    payload.fields = Array.isArray(payload.fields) ? payload.fields : [];
    setSonarrFieldValue(payload.fields, ['baseUrl'], normalizeHttpUrl(prowlarrConfig.baseUrl, 'Prowlarr URL'));
    setSonarrFieldValue(payload.fields, ['apiPath'], getProwlarrTorznabIndexerPath(sourceIndexer.id));
    setSonarrFieldValue(payload.fields, ['apiKey'], String(prowlarrConfig.apiKey || '').trim());

    try {
      const created = await sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer', {
        method: 'POST',
        data: payload,
      });
      const createdId = created?.id;
      if (createdId != null) {
        try {
          const fresh = await sonarrService.sonarrRequest(sonarrSettings, `/api/v3/indexer/${createdId}`);
          const updatePayload = {
            ...fresh,
            enable: true,
            enableRss: true,
            enableAutomaticSearch: true,
            enableInteractiveSearch: true,
          };
          await sonarrService.sonarrRequest(sonarrSettings, `/api/v3/indexer/${createdId}`, {
            method: 'PUT',
            data: updatePayload,
          });
        } catch {
          try {
            const fresh = await sonarrService.sonarrRequest(sonarrSettings, `/api/v3/indexer/${createdId}`);
            const updatePayload = {
              ...fresh,
              enable: true,
              enableRss: true,
              enableAutomaticSearch: true,
              enableInteractiveSearch: true,
            };
            await sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer', {
              method: 'PUT',
              data: updatePayload,
            });
          } catch {
            // Keep created indexer even if explicit enable update fails
          }
        }
      }
      added.push(missingName);
    } catch {
      // ignore single indexer failure, continue with others
    }
  }
  return added;
};

const normalizeSonarrProwlarrIndexers = async (sonarrSettings = {}) => {
  try {
    const rows = await sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer');
    const indexers = Array.isArray(rows) ? rows : [];
    for (const indexer of indexers) {
      const name = String(indexer?.name || '').toLowerCase();
      if (!name.includes('(prowlarr)')) continue;
      const payload = {
        ...indexer,
        enable: true,
        enableRss: true,
        enableAutomaticSearch: true,
        enableInteractiveSearch: true,
      };
      try {
        await sonarrService.sonarrRequest(sonarrSettings, `/api/v3/indexer/${indexer.id}`, {
          method: 'PUT',
          data: payload,
        });
      } catch {
        await sonarrService.sonarrRequest(sonarrSettings, '/api/v3/indexer', {
          method: 'PUT',
          data: payload,
        });
      }
    }
  } catch {
    // non-fatal
  }
};

const ensureProwlarrRadarrSync = async (prowlarrConfig = {}, radarrSettings = {}, mode = 'connect') => {
  const prowlarrUrl = normalizeHttpUrl(prowlarrConfig.baseUrl, 'Prowlarr URL');
  const prowlarrApiKey = String(prowlarrConfig.apiKey || '').trim();
  const radarrUrl = normalizeHttpUrl(radarrSettings.radarrBaseUrl, 'Radarr URL');
  const radarrApiKey = String(radarrSettings.radarrApiKey || '').trim();

  if (!prowlarrApiKey) throw new Error('Prowlarr API key is required.');
  if (!radarrApiKey) throw new Error('Radarr API key is required.');

  const prowlarrTest = await (await getSourcesModule()).testProwlarrConnection({
    ...prowlarrConfig,
    enabled: true,
  });
  if (!prowlarrTest?.ok) {
    throw new Error('Prowlarr connection failed.');
  }

  const radarrTest = await radarrService.testConnection({
    ...radarrSettings,
    radarrBaseUrl: radarrUrl,
    radarrApiKey,
  });
  if (!radarrTest?.ok) {
    throw new Error('Radarr connection failed.');
  }

  const existingApps = await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications',
  );
  const apps = Array.isArray(existingApps) ? existingApps : [];
  const existingRadarr = apps.find((appItem) => {
    const impl = String(appItem?.implementationName || appItem?.implementation || '').toLowerCase();
    const name = String(appItem?.name || '').toLowerCase();
    return impl === 'radarr' || name.includes('radarr');
  });

  if (existingRadarr) {
    const updated = { ...existingRadarr };
    const fields = Array.isArray(updated.fields) ? [...updated.fields] : [];
    setSchemaFieldValue(fields, ['baseurl', 'url', 'radarrurl'], radarrUrl);
    setSchemaFieldValue(fields, ['apikey'], radarrApiKey);
    setSchemaFieldValue(fields, ['synclevel'], 'fullSync');
    setSchemaFieldValue(fields, ['tags'], []);
    updated.fields = fields;
    updated.tags = [];
    updated.enable = true;
    await prowlarrRequest(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      '/api/v1/applications',
      { method: 'PUT', data: updated },
    );
    const syncResult = await triggerProwlarrAppSync({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey });
    if (syncResult?.ok && syncResult?.id) {
      await waitForProwlarrCommand({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey }, syncResult.id);
    }
    const missingNames = await getRadarrMissingIndexerNames(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
    );
    const addedByFallback = await addMissingIndexersToRadarrViaTorznab(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
      missingNames,
    );
    await normalizeRadarrProwlarrIndexers({ ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey });
    const remainingMissing = await getRadarrMissingIndexerNames(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
    );
    return {
      ok: true,
      prowlarr: 'connected',
      radarr: 'connected',
      sync: remainingMissing.length ? 'partial' : 'configured',
      message: remainingMissing.length
        ? `Sync completed, but missing indexers in Radarr: ${remainingMissing.join(', ')}`
        : (addedByFallback.length
          ? `Sync updated. Fallback added: ${addedByFallback.join(', ')}`
          : (mode === 'sync' ? 'Sync updated.' : 'Already configured, updated settings.')),
    };
  }

  const schemasResponse = await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications/schema',
  );
  const schemas = Array.isArray(schemasResponse) ? schemasResponse : [];
  const radarrSchema = schemas.find((schema) => String(schema?.implementationName || '').toLowerCase() === 'radarr');
  if (!radarrSchema) {
    throw new Error('Could not find Radarr application schema in Prowlarr.');
  }

  const payload = JSON.parse(JSON.stringify(radarrSchema));
  payload.name = payload.name || 'Radarr';
  payload.enable = true;
  payload.fields = Array.isArray(payload.fields) ? payload.fields : [];
  setSchemaFieldValue(payload.fields, ['baseurl', 'url', 'radarrurl'], radarrUrl);
  setSchemaFieldValue(payload.fields, ['apikey'], radarrApiKey);
  setSchemaFieldValue(payload.fields, ['synclevel'], 'fullSync');
  setSchemaFieldValue(payload.fields, ['tags'], []);
  payload.tags = [];

  await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications',
    { method: 'POST', data: payload },
  );
  const syncResult = await triggerProwlarrAppSync({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey });
  if (syncResult?.ok && syncResult?.id) {
    await waitForProwlarrCommand({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey }, syncResult.id);
  }
  const missingNames = await getRadarrMissingIndexerNames(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
  );

  const addedByFallback = await addMissingIndexersToRadarrViaTorznab(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
    missingNames,
  );
  await normalizeRadarrProwlarrIndexers({ ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey });
  const remainingMissing = await getRadarrMissingIndexerNames(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...radarrSettings, radarrBaseUrl: radarrUrl, radarrApiKey },
  );
  return {
    ok: true,
    prowlarr: 'connected',
    radarr: 'connected',
    sync: remainingMissing.length ? 'partial' : 'configured',
    message: remainingMissing.length
      ? `Connected, but missing indexers in Radarr: ${remainingMissing.join(', ')}`
      : (addedByFallback.length
        ? `Radarr connected to Prowlarr. Fallback added: ${addedByFallback.join(', ')}`
        : 'Radarr connected to Prowlarr.'),
  };
};

const ensureProwlarrSonarrSync = async (prowlarrConfig = {}, sonarrSettings = {}, mode = 'connect') => {
  const prowlarrUrl = normalizeHttpUrl(prowlarrConfig.baseUrl, 'Prowlarr URL');
  const prowlarrApiKey = String(prowlarrConfig.apiKey || '').trim();
  const sonarrUrl = normalizeHttpUrl(sonarrSettings.sonarrBaseUrl, 'Sonarr URL');
  const sonarrApiKey = String(sonarrSettings.sonarrApiKey || '').trim();

  if (!prowlarrApiKey) throw new Error('Prowlarr API key is required.');
  if (!sonarrApiKey) throw new Error('Sonarr API key is required.');

  const prowlarrTest = await (await getSourcesModule()).testProwlarrConnection({
    ...prowlarrConfig,
    enabled: true,
  });
  if (!prowlarrTest?.ok) {
    throw new Error('Prowlarr connection failed.');
  }

  const sonarrTest = await sonarrService.testConnection({
    ...sonarrSettings,
    sonarrBaseUrl: sonarrUrl,
    sonarrApiKey,
  });
  if (!sonarrTest?.ok) {
    throw new Error('Sonarr connection failed.');
  }

  const existingApps = await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications',
  );
  const apps = Array.isArray(existingApps) ? existingApps : [];
  const existingSonarr = apps.find((appItem) => {
    const impl = String(appItem?.implementationName || appItem?.implementation || '').toLowerCase();
    const name = String(appItem?.name || '').toLowerCase();
    return impl === 'sonarr' || name.includes('sonarr');
  });

  if (existingSonarr) {
    const updated = { ...existingSonarr };
    const fields = Array.isArray(updated.fields) ? [...updated.fields] : [];
    setSchemaFieldValue(fields, ['baseurl', 'url', 'sonarrurl'], sonarrUrl);
    setSchemaFieldValue(fields, ['apikey'], sonarrApiKey);
    setSchemaFieldValue(fields, ['synclevel'], 'fullSync');
    setSchemaFieldValue(fields, ['tags'], []);
    updated.fields = fields;
    updated.tags = [];
    updated.enable = true;
    await prowlarrRequest(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      '/api/v1/applications',
      { method: 'PUT', data: updated },
    );
    const syncResult = await triggerProwlarrAppSync({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey });
    if (syncResult?.ok && syncResult?.id) {
      await waitForProwlarrCommand({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey }, syncResult.id);
    }
    const missingNames = await getSonarrMissingIndexerNames(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
    );
    const addedByFallback = await addMissingIndexersToSonarrViaTorznab(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
      missingNames,
    );
    await normalizeSonarrProwlarrIndexers({ ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey });
    const remainingMissing = await getSonarrMissingIndexerNames(
      { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
      { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
    );
    return {
      ok: true,
      prowlarr: 'connected',
      sonarr: 'connected',
      sync: remainingMissing.length ? 'partial' : 'configured',
      message: remainingMissing.length
        ? `Sync completed, but missing indexers in Sonarr: ${remainingMissing.join(', ')}`
        : (addedByFallback.length
          ? `Sync updated. Fallback added: ${addedByFallback.join(', ')}`
          : (mode === 'sync' ? 'Sync updated.' : 'Already configured, updated settings.')),
    };
  }

  const schemasResponse = await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications/schema',
  );
  const schemas = Array.isArray(schemasResponse) ? schemasResponse : [];
  const sonarrSchema = schemas.find((schema) => String(schema?.implementationName || '').toLowerCase() === 'sonarr');
  if (!sonarrSchema) {
    throw new Error('Could not find Sonarr application schema in Prowlarr.');
  }

  const payload = JSON.parse(JSON.stringify(sonarrSchema));
  payload.name = payload.name || 'Sonarr';
  payload.enable = true;
  payload.fields = Array.isArray(payload.fields) ? payload.fields : [];
  setSchemaFieldValue(payload.fields, ['baseurl', 'url', 'sonarrurl'], sonarrUrl);
  setSchemaFieldValue(payload.fields, ['apikey'], sonarrApiKey);
  setSchemaFieldValue(payload.fields, ['synclevel'], 'fullSync');
  setSchemaFieldValue(payload.fields, ['tags'], []);
  payload.tags = [];

  await prowlarrRequest(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    '/api/v1/applications',
    { method: 'POST', data: payload },
  );
  const syncResult = await triggerProwlarrAppSync({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey });
  if (syncResult?.ok && syncResult?.id) {
    await waitForProwlarrCommand({ ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey }, syncResult.id);
  }
  const missingNames = await getSonarrMissingIndexerNames(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
  );

  const addedByFallback = await addMissingIndexersToSonarrViaTorznab(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
    missingNames,
  );
  await normalizeSonarrProwlarrIndexers({ ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey });
  const remainingMissing = await getSonarrMissingIndexerNames(
    { ...prowlarrConfig, baseUrl: prowlarrUrl, apiKey: prowlarrApiKey },
    { ...sonarrSettings, sonarrBaseUrl: sonarrUrl, sonarrApiKey },
  );
  return {
    ok: true,
    prowlarr: 'connected',
    sonarr: 'connected',
    sync: remainingMissing.length ? 'partial' : 'configured',
    message: remainingMissing.length
      ? `Connected, but missing indexers in Sonarr: ${remainingMissing.join(', ')}`
      : (addedByFallback.length
        ? `Sonarr connected to Prowlarr. Fallback added: ${addedByFallback.join(', ')}`
        : 'Sonarr connected to Prowlarr.'),
  };
};
const OPENSUBTITLES_V3_BASE_URL = 'https://opensubtitles-v3.strem.io';
const SUBTITLE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const subtitleSearchCache = new Map();

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
    if (store.get('notificationsEnabled') === false) return;
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

const getPrivacyNetworkSettings = () => ({
  showVpnReminderBeforeTorrentDownload: store.get('showVpnReminderBeforeTorrentDownload') === true,
  warnIfNoVpnAdapterDetected: store.get('warnIfNoVpnAdapterDetected') === true,
  pauseTorrentOnVpnDisconnect: store.get('pauseTorrentOnVpnDisconnect') === true,
  requireConfirmationWithoutVpn: store.get('requireConfirmationWithoutVpn') === true,
});

const VPN_LIKE_ADAPTER_KEYWORDS = [
  'vpn',
  'wireguard',
  'wintun',
  'openvpn',
  'tap',
  'tun',
  'nordlynx',
  'tailscale',
  'zerotier',
  'proton',
  'expressvpn',
  'surfshark',
  'mullvad',
];

const detectVpnLikeNetworkAdapter = () => {
  const interfaces = os.networkInterfaces() || {};
  const names = Object.keys(interfaces);
  const activeNames = names.filter((name) => {
    const rows = Array.isArray(interfaces[name]) ? interfaces[name] : [];
    return rows.some((entry) => entry && entry.internal === false);
  });
  const detectedName = activeNames.find((name) => {
    const normalized = String(name || '').toLowerCase();
    return VPN_LIKE_ADAPTER_KEYWORDS.some((keyword) => normalized.includes(keyword));
  }) || '';
  return {
    detected: Boolean(detectedName),
    detectedName,
    activeNames,
  };
};

const askVpnAwareDownloadConfirmation = async (event, actionLabel = 'torrent download') => {
  const privacy = getPrivacyNetworkSettings();
  if (
    !privacy.showVpnReminderBeforeTorrentDownload
    && !privacy.warnIfNoVpnAdapterDetected
    && !privacy.requireConfirmationWithoutVpn
  ) {
    return { ok: true };
  }

  const isTr = String(store.get('language') || 'tr') === 'tr';
  const ownerWindow = BrowserWindow.fromWebContents(event?.sender) || mainWindow || undefined;

  if (privacy.showVpnReminderBeforeTorrentDownload) {
    const reminder = await dialog.showMessageBox(ownerWindow, {
      type: 'info',
      buttons: isTr ? ['Devam Et', 'Iptal'] : ['Continue', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'CineSoft',
      message: isTr ? 'Torrent indirme oncesi VPN kullanmaniz onerilir.' : 'Using a VPN is recommended before starting torrent downloads.',
      detail: isTr
        ? `${actionLabel} islemi baslatilacak. Devam etmek istiyor musunuz?`
        : `${actionLabel} will be started. Do you want to continue?`,
    });
    if (reminder.response !== 0) {
      return { ok: false, cancelled: true, error: isTr ? 'Indirme iptal edildi.' : 'Download cancelled.' };
    }
  }

  const vpnStatus = detectVpnLikeNetworkAdapter();
  if (!vpnStatus.detected && privacy.warnIfNoVpnAdapterDetected) {
    await dialog.showMessageBox(ownerWindow, {
      type: 'warning',
      buttons: [isTr ? 'Tamam' : 'OK'],
      defaultId: 0,
      noLink: true,
      title: 'CineSoft',
      message: isTr ? 'VPN benzeri bir ag bagdastiricisi tespit edilemedi.' : 'No VPN-like network adapter was detected.',
      detail: isTr
        ? 'VPN olmadan torrent indirmeye devam etmek gizlilik acisindan riskli olabilir.'
        : 'Continuing torrent downloads without VPN may be a privacy risk.',
    });
  }

  if (!vpnStatus.detected && privacy.requireConfirmationWithoutVpn) {
    const confirm = await dialog.showMessageBox(ownerWindow, {
      type: 'warning',
      buttons: isTr ? ['VPN olmadan devam et', 'Iptal'] : ['Continue without VPN', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'CineSoft',
      message: isTr ? 'VPN baglantisi olmadan indirme baslatilacak.' : 'Download will start without a VPN connection.',
      detail: isTr ? 'Yine de devam etmek istiyor musunuz?' : 'Do you still want to continue?',
    });
    if (confirm.response !== 0) {
      return { ok: false, cancelled: true, error: isTr ? 'Indirme iptal edildi.' : 'Download cancelled.' };
    }
  }

  return { ok: true };
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
    const privacy = getPrivacyNetworkSettings();
    const all = await torrentManager.getAll();
    const torrents = Array.isArray(all?.torrents) ? all.torrents : [];

    if (privacy.pauseTorrentOnVpnDisconnect) {
      const vpnStatus = detectVpnLikeNetworkAdapter();
      if (!vpnStatus.detected) {
        const activeTorrents = torrents.filter((torrent) => !torrent.done && !torrent.paused);
        for (const torrent of activeTorrents) {
          await torrentManager.pause(torrent.id);
        }
        if (activeTorrents.length > 0 && !vpnDisconnectPauseNotified) {
          vpnDisconnectPauseNotified = true;
          logSafeEvent('torrent', 'vpn_disconnected', 'Active torrents paused because VPN-like adapter was not detected', {
            pausedCount: activeTorrents.length,
          });
        }
      } else {
        vpnDisconnectPauseNotified = false;
      }
    } else {
      vpnDisconnectPauseNotified = false;
    }

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
const getRadarrConfig = () => ({
  radarrEnabled: store.get('radarrEnabled') === true,
  radarrManaged: store.get('radarrManaged') === true,
  radarrBaseUrl: String(store.get('radarrBaseUrl') || ''),
  radarrApiKey: String(store.get('radarrApiKey') || ''),
  radarrExecutablePath: String(store.get('radarrExecutablePath') || ''),
  radarrPort: Number(store.get('radarrPort') || 7878),
  radarrTimeout: Number(store.get('radarrTimeout') || 10000),
  radarrDefaultRootFolder: String(store.get('radarrDefaultRootFolder') || ''),
  radarrDefaultQualityProfileId: store.get('radarrDefaultQualityProfileId') ?? '',
  radarrSearchAfterAdd: store.get('radarrSearchAfterAdd') !== false,
});
const getSonarrConfig = () => ({
  sonarrEnabled: store.get('sonarrEnabled') === true,
  sonarrManaged: store.get('sonarrManaged') === true,
  sonarrBaseUrl: String(store.get('sonarrBaseUrl') || ''),
  sonarrApiKey: String(store.get('sonarrApiKey') || ''),
  sonarrExecutablePath: String(store.get('sonarrExecutablePath') || ''),
  sonarrPort: Number(store.get('sonarrPort') || 8989),
  sonarrTimeout: Number(store.get('sonarrTimeout') || 10000),
  sonarrDefaultRootFolder: String(store.get('sonarrDefaultRootFolder') || ''),
  sonarrDefaultQualityProfileId: store.get('sonarrDefaultQualityProfileId') ?? '',
  sonarrSearchAfterAdd: store.get('sonarrSearchAfterAdd') !== false,
});
let prowlarrProcess = null;
let radarrProcess = null;
let sonarrProcess = null;
const managedProcesses = new Map();
const startingEngines = new Set();
const getStoredAuthUser = () => store.get('authUser') || null;
const getStoredAuthSession = () => store.get('authSession') || { authenticated: false, rememberMe: false, username: '' };

// Initialize defaults
if (!store.has('language')) {
  store.set('language', 'tr');
}
if (!store.has('defaultPage')) {
  store.set('defaultPage', 'home');
}
if (!store.has('notificationsEnabled')) {
  store.set('notificationsEnabled', true);
}
if (!store.has('embeddedTorrentEnabled')) {
  store.set('embeddedTorrentEnabled', true);
}
if (!store.has('qbittorrentEnabled')) {
  store.set('qbittorrentEnabled', true);
}
if (!store.has('minimizeToTrayOnClose')) {
  store.set('minimizeToTrayOnClose', true);
}
if (!store.has('closeToTray')) {
  store.set('closeToTray', store.get('minimizeToTrayOnClose') !== false);
}
if (!store.has('stopManagedEnginesOnExit')) {
  store.set('stopManagedEnginesOnExit', true);
}
if (!store.has('confirmExitWhileDownloading')) {
  store.set('confirmExitWhileDownloading', true);
}
if (!store.has('showVpnReminderBeforeTorrentDownload')) {
  store.set('showVpnReminderBeforeTorrentDownload', false);
}
if (!store.has('warnIfNoVpnAdapterDetected')) {
  store.set('warnIfNoVpnAdapterDetected', false);
}
if (!store.has('pauseTorrentOnVpnDisconnect')) {
  store.set('pauseTorrentOnVpnDisconnect', false);
}
if (!store.has('requireConfirmationWithoutVpn')) {
  store.set('requireConfirmationWithoutVpn', false);
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

const getWindowIconPath = () => {
  const isDevMode = !app.isPackaged;
  const iconCandidates = process.platform === 'win32'
    ? [
        ...(isDevMode ? [path.join(process.cwd(), 'build', 'icon.ico')] : []),
        path.join(process.resourcesPath, 'build', 'icon.ico'),
        path.join(app.getAppPath(), 'build', 'icon.ico'),
        path.join(__dirname, 'build', 'icon.ico'),
      ]
    : [
        ...(isDevMode ? [path.join(process.cwd(), 'build', 'icon.png')] : []),
        path.join(process.resourcesPath, 'build', 'icon.png'),
        path.join(app.getAppPath(), 'build', 'icon.png'),
        path.join(__dirname, 'build', 'icon.png'),
      ];
  return iconCandidates.find((candidate) => fs.existsSync(candidate));
};

const getTrayIconPath = () => {
  const isPackaged = app.isPackaged;
  const candidates = process.platform === 'win32'
    ? [
        ...(isPackaged ? [
          path.join(process.resourcesPath, 'build', 'tray.ico'),
          path.join(process.resourcesPath, 'build', 'icon.ico'),
        ] : [
          path.join(__dirname, 'build', 'tray.ico'),
          path.join(__dirname, 'build', 'icon.ico'),
          path.join(process.cwd(), 'build', 'tray.ico'),
          path.join(process.cwd(), 'build', 'icon.ico'),
        ]),
      ]
    : [
        ...(isPackaged ? [
          path.join(process.resourcesPath, 'build', 'icon.png'),
        ] : [
          path.join(__dirname, 'build', 'icon.png'),
          path.join(process.cwd(), 'build', 'icon.png'),
        ]),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
};

const shouldMinimizeToTrayOnClose = () => store.get('minimizeToTrayOnClose') !== false;
const shouldCloseToTray = () => store.get('closeToTray') !== false;
const shouldStopManagedEnginesOnExit = () => store.get('stopManagedEnginesOnExit') !== false;
const shouldConfirmExitWhileDownloading = () => store.get('confirmExitWhileDownloading') !== false;

const registerManagedEngine = (name, childProcess) => {
  if (!childProcess || !childProcess.pid) return;
  const key = String(name || '').toLowerCase();
  const pid = Number(childProcess.pid) || 0;
  const existing = managedProcesses.get(key);
  if (existing?.pid) {
    try {
      process.kill(existing.pid, 0);
      console.log('[EngineLifecycle] managed engine already registered, skipping duplicate', { engine: key, pid: existing.pid });
      return;
    } catch {
      managedProcesses.delete(key);
    }
  }
  managedProcesses.set(key, {
    engine: key,
    name: key,
    processRef: childProcess,
    child: childProcess,
    pid,
    startedByCineSoft: true,
    startedAt: Date.now(),
  });
  console.log('[EngineLifecycle] registered managed engine', { engine: key, pid });
  console.log('[EngineLifecycle] registry size', managedProcesses.size);
  console.log('[EngineLifecycle] registry keys', [...managedProcesses.keys()]);
  childProcess.once('exit', () => {
    const current = managedProcesses.get(key);
    if (current?.pid === pid) {
      managedProcesses.delete(key);
    }
  });
};

const stopManagedEngineEntry = async (entry) => {
  if (!entry || entry.startedByCineSoft !== true) {
    console.log('[EngineLifecycle] skipped external engine', { engine: entry?.name || 'unknown' });
    return false;
  }

  const targetPid = Number(entry.pid) || Number(entry.processRef?.pid) || Number(entry.child?.pid) || 0;
  console.log('[EngineLifecycle] stopping managed engine', { engine: entry.name, pid: targetPid || null });

  try {
    const proc = entry.processRef || entry.child;
    if (proc && !proc.killed) {
      proc.kill();
    }
  } catch (error) {
    console.warn('[EngineLifecycle] stop failed', { engine: entry.name, pid: targetPid || null, error: error.message });
  }

  await new Promise((resolve) => setTimeout(resolve, 900));
  if (targetPid > 0) {
    try {
      process.kill(targetPid, 0);
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${targetPid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(targetPid, 'SIGKILL');
      }
    } catch {
      // already stopped
    }
  }

  managedProcesses.delete(entry.name);
  return true;
};

const stopAllManagedEngines = async () => {
  console.log('[EngineLifecycle] stop managed engines requested');
  console.log('[EngineLifecycle] registry size before stop', managedProcesses.size);
  console.log('[EngineLifecycle] registry entries before stop', [...managedProcesses.entries()].map(([engine, item]) => ({ engine, pid: item?.pid || null, startedByCineSoft: item?.startedByCineSoft === true })));
  if (managedProcesses.size === 0) {
    console.log('[EngineLifecycle] no managed engines in registry');
  }
  const entries = [...managedProcesses.values()];
  const result = { stopped: [], skipped: [], errors: [] };
  for (const entry of entries) {
    try {
      const stopped = await stopManagedEngineEntry(entry);
      if (stopped) result.stopped.push(entry.name);
      else result.skipped.push(entry.name);
    } catch (error) {
      result.errors.push({ engine: entry?.name || 'unknown', error: error.message });
      console.warn('[EngineLifecycle] stop failed', { engine: entry?.name || 'unknown', error: error.message });
    }
  }
  return result;
};

const hasActiveDownloads = async () => {
  if (!torrentManager) return false;
  try {
    const all = await torrentManager.getAll();
    const torrents = Array.isArray(all?.torrents) ? all.torrents : [];
    return torrents.some((torrent) => {
      const done = torrent?.done === true || Number(torrent?.progress || 0) >= 99.9;
      const paused = torrent?.paused === true;
      return !done && !paused;
    });
  } catch {
    return false;
  }
};

const ensureMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  createWindow();
  return mainWindow;
};

const showMainWindow = () => {
  const win = ensureMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setSkipTaskbar(false);
  win.show();
  win.focus();
  console.log('[Tray] show window');
};

const hideMainWindowToTray = () => {
  if (!trayAvailable || !appTray) {
    console.warn('[Tray] hide requested but tray is unavailable');
    return false;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) return;
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
  console.log('[Tray] hide window');
  return true;
};

const performAppQuit = async (reason = 'unknown') => {
  if (isQuitting) return;
  if (cleanupStarted) {
    console.log('[AppLifecycle] cleanup already started, skipping duplicate');
    return;
  }
  cleanupStarted = true;
  console.log('[AppLifecycle] real quit requested', { reason });
  if (shouldStopManagedEnginesOnExit()) {
    await stopAllManagedEngines();
  }
  isQuitting = true;
  app.quit();
};

const navigateMainWindow = (routePath = '/') => {
  const normalized = String(routePath || '/').startsWith('/') ? String(routePath || '/') : `/${routePath}`;
  const win = ensureMainWindow();
  if (!win) return;
  showMainWindow();
  const nextHash = `#${normalized}`;
  const applyRoute = () => win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(nextHash)};`).catch(() => {});
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', applyRoute);
    return;
  }
  applyRoute();
};

const requestQuitFromTray = async () => {
  if (isQuitting) return;
  console.log('[AppLifecycle] close requested', { isQuitting, closeToTray: shouldCloseToTray() });
  if (shouldConfirmExitWhileDownloading()) {
    const hasActive = await hasActiveDownloads();
    if (hasActive) {
      const isTr = String(store.get('language') || 'tr') === 'tr';
      const title = 'CineSoft';
      const message = isTr ? 'Aktif indirmeler devam ediyor.' : 'Active downloads are still running.';
      const detail = isTr
        ? 'Simdi cikarsaniz aktif indirmeler durabilir. Yine de cikmak istiyor musunuz?'
        : 'If you exit now, active downloads may stop. Do you want to exit anyway?';
      const answer = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'warning',
        buttons: isTr ? ['Cikis', 'Iptal'] : ['Exit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title,
        message,
        detail,
      });
      if (answer.response !== 0) return;
    }
  }
  await performAppQuit('tray_exit');
};

const createTray = () => {
  if (appTray) return appTray;
  const trayIconPath = getTrayIconPath();
  const trayIconExists = Boolean(trayIconPath) && fs.existsSync(trayIconPath);
  console.log('[Tray] icon path', trayIconPath || '(none)');
  console.log('[Tray] icon exists', trayIconExists);
  if (!trayIconExists) {
    trayAvailable = false;
    console.warn('[Tray] failed', { reason: 'icon_not_found' });
    return null;
  }
  const trayImage = nativeImage.createFromPath(trayIconPath);
  const imageEmpty = trayImage.isEmpty();
  console.log('[Tray] image empty', imageEmpty);
  if (imageEmpty) {
    trayAvailable = false;
    console.warn('[Tray] failed', { reason: 'icon_image_empty' });
    return null;
  }
  try {
    appTray = new Tray(trayImage);
  } catch (error) {
    trayAvailable = false;
    console.warn('[Tray] failed', { reason: 'create_failed', error: error.message });
    return null;
  }
  trayAvailable = true;
  console.log('[Tray] created');
  appTray.setToolTip('CineSoft');
  appTray.on('double-click', () => showMainWindow());

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show CineSoft', click: () => showMainWindow() },
    { label: 'Hide to Tray', click: () => hideMainWindowToTray() },
    {
      label: 'Stop Managed Engines',
      click: () => {
        console.log('[IPC] engines:stop-managed requested');
        stopAllManagedEngines()
          .then((result) => console.log('[IPC] engines:stop-managed result', result))
          .catch((error) => console.warn('[EngineLifecycle] stop failed', { engine: 'all', error: error.message }));
      },
    },
    { type: 'separator' },
    { label: 'Exit', click: () => { requestQuitFromTray().catch(() => {}); } },
  ]);
  appTray.setContextMenu(contextMenu);
  return appTray;
};

function createWindow() {
  const isDevMode = !app.isPackaged;
  const windowIconPath = getWindowIconPath();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#000000',
    icon: windowIconPath || undefined,
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

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.on('close', (event) => {
    console.log('[AppLifecycle] close requested', { isQuitting, closeToTray: shouldCloseToTray(), trayAvailable });
    if (isQuitting) return;
    if (shouldCloseToTray() && shouldMinimizeToTrayOnClose() && trayAvailable && appTray) {
      event.preventDefault();
      console.log('[AppLifecycle] close prevented, hiding to tray');
      hideMainWindowToTray();
      return;
    }
    if (shouldCloseToTray() && shouldMinimizeToTrayOnClose() && !trayAvailable) {
      event.preventDefault();
      console.warn('[AppLifecycle] closeToTray requested but tray is unavailable; quitting instead');
      performAppQuit('tray_unavailable_close').catch(() => {});
      return;
    }
    event.preventDefault();
    requestQuitFromTray().catch(() => {});
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  if (isDevMode) {
    win.loadURL('http://localhost:5173');
  } else {
    const indexFile = path.join(__dirname, 'renderer', 'index.html');
    const indexExists = fs.existsSync(indexFile);
    console.log('[Main] Packaged renderer bootstrap', {
      isPackaged: app.isPackaged,
      __dirname,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      rendererIndexPath: indexFile,
      rendererIndexExists: indexExists,
    });
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
  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  initMetadataDb();
  createWindow();
  createTray();

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('before-quit', () => {
  if (cleanupStarted) {
    console.log('[AppLifecycle] cleanup already started, skipping duplicate');
  }
  isQuitting = true;
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  trayAvailable = false;
  if (torrentRulesInterval) {
    clearInterval(torrentRulesInterval);
    torrentRulesInterval = null;
  }
});

app.on('child-process-gone', (_event, details) => {
  if (details?.type === 'GPU' && details?.reason === 'crashed') {
    store.set(FORCE_SOFTWARE_RENDERING_KEY, true);
    console.warn('[Main] GPU process crashed; software rendering will be enabled on next launch.');
  }
});

app.on('window-all-closed', async () => {
  if (!isQuitting && appTray) {
    return;
  }
  if (!isQuitting && process.platform !== 'darwin') {
    await performAppQuit('window_all_closed');
    return;
  }
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
});

const getManagedProwlarrDataDir = () => path.join(app.getPath('userData'), 'prowlarr');
const getManagedRadarrDataDir = () => path.join(app.getPath('userData'), 'radarr');
const getManagedSonarrDataDir = () => path.join(app.getPath('userData'), 'sonarr');

const getBundledEngineExecutable = (folderName, executableName) => {
  const basePath = app.isPackaged ? process.resourcesPath : __dirname;
  const resourcesCandidates = [
    path.join(process.cwd(), 'resources'),
    path.join(basePath, 'resources'),
  ];
  const folderCandidates = [folderName, String(folderName || '').toLowerCase()];
  for (const resourcesRoot of resourcesCandidates) {
    for (const folderCandidate of folderCandidates) {
      const candidate = path.join(resourcesRoot, folderCandidate, executableName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return path.join(resourcesCandidates[0], folderName, executableName);
};

const getBundledProwlarrExecutable = () => {
  const executable = process.platform === 'win32' ? 'Prowlarr.exe' : 'Prowlarr';
  return getBundledEngineExecutable('Prowlarr', executable);
};

const getProwlarrExecutablePath = (config = {}) => {
  if (config.executablePath && fs.existsSync(config.executablePath)) {
    return config.executablePath;
  }

  const bundled = getBundledProwlarrExecutable();
  return fs.existsSync(bundled) ? bundled : '';
};

const getBundledRadarrExecutable = () => {
  const executable = process.platform === 'win32' ? 'Radarr.exe' : 'Radarr';
  return getBundledEngineExecutable('Radarr', executable);
};

const getRadarrExecutablePath = (config = {}) => {
  if (config.radarrExecutablePath && fs.existsSync(config.radarrExecutablePath)) {
    return config.radarrExecutablePath;
  }
  const bundled = getBundledRadarrExecutable();
  return fs.existsSync(bundled) ? bundled : '';
};

const getBundledSonarrExecutable = () => {
  const executable = process.platform === 'win32' ? 'Sonarr.exe' : 'Sonarr';
  return getBundledEngineExecutable('Sonarr', executable);
};

const getSonarrExecutablePath = (config = {}) => {
  if (config.sonarrExecutablePath && fs.existsSync(config.sonarrExecutablePath)) {
    return config.sonarrExecutablePath;
  }
  const bundled = getBundledSonarrExecutable();
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
      AuthenticationMethod: 'Forms',
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
      '  <AuthenticationMethod>Forms</AuthenticationMethod>',
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

const ensureRadarrConfigFile = (config = {}) => {
  const dataDir = getManagedRadarrDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const configPath = path.join(dataDir, 'config.xml');
  const port = Number(config.radarrPort) || 7878;
  let apiKey = config.radarrApiKey || crypto.randomBytes(16).toString('hex');

  if (fs.existsSync(configPath)) {
    const xml = fs.readFileSync(configPath, 'utf8');
    apiKey = readXmlValue(xml, 'ApiKey') || apiKey;
    const updated = upsertXmlValues(xml, {
      BindAddress: '127.0.0.1',
      Port: String(port),
      ApiKey: apiKey,
      AuthenticationMethod: 'Forms',
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
      '  <SslPort>9898</SslPort>',
      '  <EnableSsl>False</EnableSsl>',
      '  <LaunchBrowser>False</LaunchBrowser>',
      '  <AuthenticationMethod>Forms</AuthenticationMethod>',
      '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>',
      '  <AuthenticationRequiredWarningDismissed>True</AuthenticationRequiredWarningDismissed>',
      `  <ApiKey>${apiKey}</ApiKey>`,
      '  <UrlBase></UrlBase>',
      '  <LogLevel>info</LogLevel>',
      '</Config>',
      '',
    ].join('\n'));
  }

  return { dataDir, apiKey, port };
};

const ensureSonarrConfigFile = (config = {}) => {
  const dataDir = getManagedSonarrDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const configPath = path.join(dataDir, 'config.xml');
  const port = Number(config.sonarrPort) || 8989;
  let apiKey = config.sonarrApiKey || crypto.randomBytes(16).toString('hex');

  if (fs.existsSync(configPath)) {
    const xml = fs.readFileSync(configPath, 'utf8');
    apiKey = readXmlValue(xml, 'ApiKey') || apiKey;
    const updated = upsertXmlValues(xml, {
      BindAddress: '127.0.0.1',
      Port: String(port),
      ApiKey: apiKey,
      AuthenticationMethod: 'Forms',
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
      '  <SslPort>9899</SslPort>',
      '  <EnableSsl>False</EnableSsl>',
      '  <LaunchBrowser>False</LaunchBrowser>',
      '  <AuthenticationMethod>Forms</AuthenticationMethod>',
      '  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>',
      '  <AuthenticationRequiredWarningDismissed>True</AuthenticationRequiredWarningDismissed>',
      `  <ApiKey>${apiKey}</ApiKey>`,
      '  <UrlBase></UrlBase>',
      '  <LogLevel>info</LogLevel>',
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
  return false;
};

const isSystemRadarrRunning = () => {
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist /FI "IMAGENAME eq Radarr.exe" /FO CSV /NH', { encoding: 'utf8' });
      return output.toLowerCase().includes('radarr.exe');
    }
    const output = execSync('pgrep -f Radarr', { encoding: 'utf8' });
    return Boolean(String(output).trim());
  } catch {
    return false;
  }
};

const stopSystemRadarr = () => {
  return false;
};

const isSystemSonarrRunning = () => {
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist /FI "IMAGENAME eq Sonarr.exe" /FO CSV /NH', { encoding: 'utf8' });
      return output.toLowerCase().includes('sonarr.exe');
    }
    const output = execSync('pgrep -f Sonarr', { encoding: 'utf8' });
    return Boolean(String(output).trim());
  } catch {
    return false;
  }
};

const stopSystemSonarr = () => {
  return false;
};

const startManagedProwlarr = (config = {}) => {
  if (startingEngines.has('prowlarr')) {
    console.log('[EngineLifecycle] start skipped because engine is already starting', { engine: 'prowlarr' });
    return { ok: true, starting: true };
  }
  const existingEntry = managedProcesses.get('prowlarr');
  if (existingEntry?.pid) {
    try {
      process.kill(existingEntry.pid, 0);
      console.log('[EngineLifecycle] start skipped, managed engine already running', { engine: 'prowlarr', pid: existingEntry.pid });
      return { ok: true, alreadyRunning: true, pid: existingEntry.pid };
    } catch {
      managedProcesses.delete('prowlarr');
    }
  }
  startingEngines.add('prowlarr');
  try {
  const externalRunning = isSystemProwlarrRunning() && !(prowlarrProcess && !prowlarrProcess.killed);
  if (externalRunning) {
    console.log('[EngineLifecycle] skipped external engine', { engine: 'prowlarr' });
    return { ok: true, alreadyRunning: true, externalProcessStopped: false, externalRunning: true };
  }
  const externalProcessStopped = false;
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
  registerManagedEngine('prowlarr', prowlarrProcess);

  store.set('prowlarr', nextConfig);
  return {
    ok: true,
    alreadyRunning: false,
    externalProcessStopped,
    ...nextConfig,
  };
  } finally {
    startingEngines.delete('prowlarr');
  }
};

const stopManagedProwlarr = () => {
  const entry = managedProcesses.get('prowlarr');
  if (entry) {
    stopManagedEngineEntry(entry).catch((error) => {
      console.warn('[EngineLifecycle] stop failed', { engine: 'prowlarr', error: error.message });
    });
    prowlarrProcess = null;
    return true;
  }
  console.log('[EngineLifecycle] skipped external engine', { engine: 'prowlarr' });
  if (prowlarrProcess && !prowlarrProcess.killed) {
    prowlarrProcess.kill();
    prowlarrProcess = null;
    return true;
  }
  return false;
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

const buildManagedRadarrConfig = (config = {}) => {
  const port = Number(config.radarrPort) || 7878;
  return {
    ...config,
    radarrEnabled: true,
    radarrManaged: true,
    radarrBaseUrl: `http://127.0.0.1:${port}`,
    radarrPort: port,
    radarrApiKey: config.radarrApiKey,
  };
};

const startManagedRadarr = (config = {}) => {
  if (startingEngines.has('radarr')) {
    console.log('[EngineLifecycle] start skipped because engine is already starting', { engine: 'radarr' });
    return { ok: true, starting: true };
  }
  const existingEntry = managedProcesses.get('radarr');
  if (existingEntry?.pid) {
    try {
      process.kill(existingEntry.pid, 0);
      console.log('[EngineLifecycle] start skipped, managed engine already running', { engine: 'radarr', pid: existingEntry.pid });
      return { ok: true, alreadyRunning: true, pid: existingEntry.pid };
    } catch {
      managedProcesses.delete('radarr');
    }
  }
  startingEngines.add('radarr');
  try {
  const externalRunning = isSystemRadarrRunning() && !(radarrProcess && !radarrProcess.killed);
  if (externalRunning) {
    console.log('[EngineLifecycle] skipped external engine', { engine: 'radarr' });
    return { ok: true, alreadyRunning: true, externalProcessStopped: false, externalRunning: true };
  }
  const externalProcessStopped = false;
  if (radarrProcess && !radarrProcess.killed) {
    radarrProcess.kill();
    radarrProcess = null;
  }

  const executablePath = getRadarrExecutablePath(config);
  if (!executablePath) {
    return {
      ok: false,
      message: 'Radarr executable was not found',
      expectedPath: getBundledRadarrExecutable(),
    };
  }

  const prepared = ensureRadarrConfigFile(config);
  const nextConfig = buildManagedRadarrConfig({
    ...config,
    radarrApiKey: prepared.apiKey,
    radarrPort: prepared.port,
    radarrExecutablePath: executablePath,
  });

  radarrProcess = spawn(executablePath, [`-data=${prepared.dataDir}`, '-nobrowser'], {
    cwd: path.dirname(executablePath),
    windowsHide: true,
    stdio: 'ignore',
  });

  radarrProcess.once('exit', () => {
    radarrProcess = null;
  });
  registerManagedEngine('radarr', radarrProcess);

  Object.entries(nextConfig).forEach(([key, value]) => store.set(key, value));
  return {
    ok: true,
    externalProcessStopped,
    ...nextConfig,
  };
  } finally {
    startingEngines.delete('radarr');
  }
};

const stopManagedRadarr = () => {
  const entry = managedProcesses.get('radarr');
  if (entry) {
    stopManagedEngineEntry(entry).catch((error) => {
      console.warn('[EngineLifecycle] stop failed', { engine: 'radarr', error: error.message });
    });
    radarrProcess = null;
    return true;
  }
  console.log('[EngineLifecycle] skipped external engine', { engine: 'radarr' });
  if (radarrProcess && !radarrProcess.killed) {
    radarrProcess.kill();
    radarrProcess = null;
    return true;
  }
  return false;
};

const buildManagedSonarrConfig = (config = {}) => {
  const port = Number(config.sonarrPort) || 8989;
  return {
    ...config,
    sonarrEnabled: true,
    sonarrManaged: true,
    sonarrBaseUrl: `http://127.0.0.1:${port}`,
    sonarrPort: port,
    sonarrApiKey: config.sonarrApiKey,
  };
};

const startManagedSonarr = (config = {}) => {
  if (startingEngines.has('sonarr')) {
    console.log('[EngineLifecycle] start skipped because engine is already starting', { engine: 'sonarr' });
    return { ok: true, starting: true };
  }
  const existingEntry = managedProcesses.get('sonarr');
  if (existingEntry?.pid) {
    try {
      process.kill(existingEntry.pid, 0);
      console.log('[EngineLifecycle] start skipped, managed engine already running', { engine: 'sonarr', pid: existingEntry.pid });
      return { ok: true, alreadyRunning: true, pid: existingEntry.pid };
    } catch {
      managedProcesses.delete('sonarr');
    }
  }
  startingEngines.add('sonarr');
  try {
  const externalRunning = isSystemSonarrRunning() && !(sonarrProcess && !sonarrProcess.killed);
  if (externalRunning) {
    console.log('[EngineLifecycle] skipped external engine', { engine: 'sonarr' });
    return { ok: true, alreadyRunning: true, externalProcessStopped: false, externalRunning: true };
  }
  const externalProcessStopped = false;
  if (sonarrProcess && !sonarrProcess.killed) {
    sonarrProcess.kill();
    sonarrProcess = null;
  }

  const executablePath = getSonarrExecutablePath(config);
  if (!executablePath) {
    return {
      ok: false,
      message: 'Sonarr executable was not found',
      expectedPath: getBundledSonarrExecutable(),
    };
  }

  const prepared = ensureSonarrConfigFile(config);
  const nextConfig = buildManagedSonarrConfig({
    ...config,
    sonarrApiKey: prepared.apiKey,
    sonarrPort: prepared.port,
    sonarrExecutablePath: executablePath,
  });

  sonarrProcess = spawn(executablePath, [`-data=${prepared.dataDir}`, '-nobrowser'], {
    cwd: path.dirname(executablePath),
    windowsHide: true,
    stdio: 'ignore',
  });

  sonarrProcess.once('exit', () => {
    sonarrProcess = null;
  });
  registerManagedEngine('sonarr', sonarrProcess);

  Object.entries(nextConfig).forEach(([key, value]) => store.set(key, value));
  return {
    ok: true,
    externalProcessStopped,
    ...nextConfig,
  };
  } finally {
    startingEngines.delete('sonarr');
  }
};

const stopManagedSonarr = () => {
  const entry = managedProcesses.get('sonarr');
  if (entry) {
    stopManagedEngineEntry(entry).catch((error) => {
      console.warn('[EngineLifecycle] stop failed', { engine: 'sonarr', error: error.message });
    });
    sonarrProcess = null;
    return true;
  }
  console.log('[EngineLifecycle] skipped external engine', { engine: 'sonarr' });
  if (sonarrProcess && !sonarrProcess.killed) {
    sonarrProcess.kill();
    sonarrProcess = null;
    return true;
  }
  return false;
};

const engineInstaller = createEngineInstallerService({
  stopEngineByName: (appName) => {
    const key = String(appName || '').toLowerCase();
    if (key === 'prowlarr') return stopManagedProwlarr();
    if (key === 'radarr') return stopManagedRadarr();
    if (key === 'sonarr') return stopManagedSonarr();
    return false;
  },
});

// IPC Handlers
ipcMain.handle('get-settings', () => {
  const torrentio = store.get('torrentio') || {};
  const radarr = getRadarrConfig();
  const sonarr = getSonarrConfig();
  return {
    apiKey: store.get('apiKey'),
    language: store.get('language'),
    defaultPage: store.get('defaultPage') || 'home',
    notificationsEnabled: store.get('notificationsEnabled') !== false,
    minimizeToTrayOnClose: store.get('minimizeToTrayOnClose') !== false,
    closeToTray: store.get('closeToTray') !== false,
    stopManagedEnginesOnExit: store.get('stopManagedEnginesOnExit') !== false,
    confirmExitWhileDownloading: store.get('confirmExitWhileDownloading') !== false,
    showVpnReminderBeforeTorrentDownload: store.get('showVpnReminderBeforeTorrentDownload') === true,
    warnIfNoVpnAdapterDetected: store.get('warnIfNoVpnAdapterDetected') === true,
    pauseTorrentOnVpnDisconnect: store.get('pauseTorrentOnVpnDisconnect') === true,
    requireConfirmationWithoutVpn: store.get('requireConfirmationWithoutVpn') === true,
    prowlarr: store.get('prowlarr'),
    torrentioEnabled: store.get('torrentioEnabled') || false,
    embeddedTorrentEnabled: store.get('embeddedTorrentEnabled') !== false,
    qbittorrentEnabled: store.get('qbittorrentEnabled') !== false,
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
    ...radarr,
    ...sonarr,
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
  store.set('defaultPage', String(settings.defaultPage || 'home'));
  store.set('notificationsEnabled', settings.notificationsEnabled !== false);
  store.set('minimizeToTrayOnClose', settings.minimizeToTrayOnClose !== false);
  store.set('closeToTray', settings.closeToTray !== false);
  store.set('stopManagedEnginesOnExit', settings.stopManagedEnginesOnExit !== false);
  store.set('confirmExitWhileDownloading', settings.confirmExitWhileDownloading !== false);
  store.set('showVpnReminderBeforeTorrentDownload', settings.showVpnReminderBeforeTorrentDownload === true);
  store.set('warnIfNoVpnAdapterDetected', settings.warnIfNoVpnAdapterDetected === true);
  store.set('pauseTorrentOnVpnDisconnect', settings.pauseTorrentOnVpnDisconnect === true);
  store.set('requireConfirmationWithoutVpn', settings.requireConfirmationWithoutVpn === true);
  store.set('prowlarr', settings.prowlarr || {});
  store.set('torrentioEnabled', settings.torrentioEnabled || false);
  store.set('embeddedTorrentEnabled', settings.embeddedTorrentEnabled !== false);
  store.set('qbittorrentEnabled', settings.qbittorrentEnabled !== false);
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
  store.set('radarrEnabled', settings.radarrEnabled === true);
  store.set('radarrManaged', settings.radarrManaged === true);
  store.set('radarrBaseUrl', String(settings.radarrBaseUrl || '').trim());
  store.set('radarrApiKey', String(settings.radarrApiKey || '').trim());
  store.set('radarrExecutablePath', String(settings.radarrExecutablePath || '').trim());
  store.set('radarrPort', Number(settings.radarrPort || 7878));
  store.set('radarrTimeout', Number(settings.radarrTimeout || 10000));
  store.set('radarrDefaultRootFolder', String(settings.radarrDefaultRootFolder || '').trim());
  store.set('radarrDefaultQualityProfileId', settings.radarrDefaultQualityProfileId ?? '');
  store.set('radarrSearchAfterAdd', settings.radarrSearchAfterAdd !== false);
  store.set('sonarrEnabled', settings.sonarrEnabled === true);
  store.set('sonarrManaged', settings.sonarrManaged === true);
  store.set('sonarrBaseUrl', String(settings.sonarrBaseUrl || '').trim());
  store.set('sonarrApiKey', String(settings.sonarrApiKey || '').trim());
  store.set('sonarrExecutablePath', String(settings.sonarrExecutablePath || '').trim());
  store.set('sonarrPort', Number(settings.sonarrPort || 8989));
  store.set('sonarrTimeout', Number(settings.sonarrTimeout || 10000));
  store.set('sonarrDefaultRootFolder', String(settings.sonarrDefaultRootFolder || '').trim());
  store.set('sonarrDefaultQualityProfileId', settings.sonarrDefaultQualityProfileId ?? '');
  store.set('sonarrSearchAfterAdd', settings.sonarrSearchAfterAdd !== false);
  const savedApiKey = store.get('apiKey') || '';
  const savedProwlarr = store.get('prowlarr') || {};
  const savedRadarrEnabled = store.get('radarrEnabled') === true;
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
    radarrEnabled: savedRadarrEnabled,
    sonarrEnabled: store.get('sonarrEnabled') === true,
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

const qbittorrentLogin = async (qbConfig = {}) => {
  const baseUrl = String(qbConfig.baseUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const username = String(qbConfig.username || 'admin');
  const password = String(qbConfig.password || 'adminadmin');

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
    return {
      ok: false,
      error: `qBittorrent login failed (${loginResponse.status}): ${loginText || 'Unknown error'}`,
      baseUrl,
      headers: commonHeaders,
    };
  }

  const cookieHeader = loginResponse.headers.get('set-cookie') || '';
  const sidMatch = cookieHeader.match(/SID=([^;]+)/i);
  const sidCookie = sidMatch ? `SID=${sidMatch[1]}` : '';
  const authHeaders = { ...commonHeaders };
  if (sidCookie) authHeaders.Cookie = sidCookie;

  return { ok: true, baseUrl, headers: authHeaders };
};

ipcMain.handle('qbittorrent-add', async (event, opts = {}, qbConfig = {}) => {
  try {
    const magnetOrHash = opts?.magnetOrHash || '';
    const torrentUrl = opts?.torrentUrl || '';
    const contentUrl = magnetOrHash || torrentUrl;

    if (!contentUrl) {
      logEvent('qbittorrent', 'parse', 'No torrent source provided');
      return { ok: false, error: 'No torrent source provided' };
    }

    const auth = await qbittorrentLogin(qbConfig || {});
    if (!auth.ok) {
      logEvent('qbittorrent', 'auth', 'qBittorrent login failed', {});
      return { ok: false, error: auth.error };
    }

    const addResponse = await fetch(`${auth.baseUrl}/api/v2/torrents/add`, {
      method: 'POST',
      headers: auth.headers,
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

ipcMain.handle('qbittorrent-get-torrents', async (event, qbConfig = {}) => {
  try {
    const auth = await qbittorrentLogin(qbConfig || {});
    if (!auth.ok) {
      return { ok: false, error: auth.error, items: [] };
    }
    const response = await fetch(`${auth.baseUrl}/api/v2/torrents/info`, {
      method: 'GET',
      headers: auth.headers,
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: `qBittorrent list failed (${response.status}): ${body || 'Unknown error'}`,
        items: [],
      };
    }
    const rows = await response.json();
    const items = Array.isArray(rows)
      ? rows.map((entry) => ({
          hash: String(entry?.hash || ''),
          name: String(entry?.name || ''),
          progress: Math.max(0, Math.min(100, Number(entry?.progress || 0) * 100)),
          state: String(entry?.state || ''),
          downloadSpeed: Number(entry?.dlspeed || 0),
          amountLeft: Number(entry?.amount_left || 0),
          size: Number(entry?.size || 0),
        }))
      : [];
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
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
  try {
    const { getProwlarrIndexers } = await getSourcesModule();
    const rows = await getProwlarrIndexers(prowlarrConfig || getProwlarrConfig());
    return {
      ok: true,
      reason: 'ok',
      indexers: Array.isArray(rows) ? rows : [],
    };
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (
      message.includes('econnrefused')
      || message.includes('fetch failed')
      || message.includes('connect error')
      || message.includes('could not connect')
    ) {
      return {
        ok: false,
        reason: 'prowlarr_not_running',
        indexers: [],
      };
    }
    return {
      ok: false,
      reason: 'unknown_error',
      error: String(err?.message || 'Failed to fetch Prowlarr indexers'),
      indexers: [],
    };
  }
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

ipcMain.handle('select-radarr-executable', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Radarr executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Radarr', extensions: ['exe'] }]
      : [{ name: 'Radarr', extensions: ['*'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return '';
  }
  return result.filePaths[0];
});

ipcMain.handle('start-managed-radarr', async (event, radarrConfig) => {
  return startManagedRadarr(radarrConfig || getRadarrConfig());
});

ipcMain.handle('stop-managed-radarr', async () => {
  return {
    ok: true,
    stopped: stopManagedRadarr(),
  };
});

ipcMain.handle('get-managed-radarr-status', async () => {
  return {
    running: Boolean(radarrProcess && !radarrProcess.killed) || isSystemRadarrRunning(),
    expectedPath: getBundledRadarrExecutable(),
    dataDir: getManagedRadarrDataDir(),
  };
});

ipcMain.handle('select-sonarr-executable', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Sonarr executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Sonarr', extensions: ['exe'] }]
      : [{ name: 'Sonarr', extensions: ['*'] }],
  });

  if (result.canceled || !result.filePaths[0]) {
    return '';
  }
  return result.filePaths[0];
});

ipcMain.handle('start-managed-sonarr', async (event, sonarrConfig) => {
  return startManagedSonarr(sonarrConfig || getSonarrConfig());
});

ipcMain.handle('stop-managed-sonarr', async () => {
  return {
    ok: true,
    stopped: stopManagedSonarr(),
  };
});

ipcMain.handle('engines:stop-managed', async () => {
  console.log('[IPC] engines:stop-managed requested');
  const result = await stopAllManagedEngines();
  console.log('[IPC] engines:stop-managed result', result);
  return result;
});

ipcMain.handle('get-managed-sonarr-status', async () => {
  return {
    running: Boolean(sonarrProcess && !sonarrProcess.killed) || isSystemSonarrRunning(),
    expectedPath: getBundledSonarrExecutable(),
    dataDir: getManagedSonarrDataDir(),
  };
});

ipcMain.handle('engine:install-latest', async (event, appName) => {
  const result = await engineInstaller.installLatestEngine(appName);
  if (result?.ok) {
    const normalized = engineInstaller.normalizeEngineName(appName);
    if (normalized === 'Prowlarr') {
      const prowlarr = store.get('prowlarr') || {};
      store.set('prowlarr', {
        ...prowlarr,
        executablePath: result.exePath,
      });
    } else if (normalized === 'Radarr') {
      store.set('radarrExecutablePath', String(result.exePath || ''));
    } else if (normalized === 'Sonarr') {
      store.set('sonarrExecutablePath', String(result.exePath || ''));
    }
  }
  return result;
});

ipcMain.handle('engine:get-status', async (event, appName) => {
  return engineInstaller.getEngineStatus(appName);
});

ipcMain.handle('engine:find-exe', async (event, appName) => {
  const exePath = await engineInstaller.findEngineExe(appName);
  return {
    ok: Boolean(exePath),
    appName: engineInstaller.normalizeEngineName(appName) || '',
    exePath: exePath || '',
  };
});

ipcMain.handle('open-prowlarr-download-page', async () => {
  try {
    await shell.openExternal('https://github.com/prowlarr/prowlarr');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-prowlarr-web-ui', async (event, prowlarrConfig = {}) => {
  try {
    const merged = {
      ...(getProwlarrConfig() || {}),
      ...(prowlarrConfig || {}),
    };
    let baseUrl = String(merged.baseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Prowlarr URL is empty' };
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Invalid URL protocol' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:testConnection', async (event, radarrSettings = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(radarrSettings || {}) };
    return await radarrService.testConnection(settings);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:getRootFolders', async (event, radarrSettings = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(radarrSettings || {}) };
    const items = await radarrService.getRootFolders(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('radarr:getQualityProfiles', async (event, radarrSettings = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(radarrSettings || {}) };
    const items = await radarrService.getQualityProfiles(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('radarr:getMovies', async (event, radarrSettings = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(radarrSettings || {}) };
    const items = await radarrService.getMovies(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('radarr:lookupMovieByTmdbId', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const movie = await radarrService.lookupMovieByTmdbId(settings, payload?.tmdbId);
    return { ok: true, movie };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:addMovie', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const result = await radarrService.addMovie(settings, payload?.movie || {});
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:deleteMovie', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    return await radarrService.deleteMovie(settings, payload?.movieId, payload?.options || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:updateMovie', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    return await radarrService.updateMovie(settings, payload?.movieId, payload?.movie || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:searchMovie', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    return await radarrService.searchMovie(settings, payload?.movieId);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:refreshAndScanMovie', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    return await radarrService.refreshAndScanMovie(settings, payload?.movieId);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:getMovieReleases', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const items = await radarrService.getMovieReleases(settings, payload?.movieId);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:grabMovieRelease', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    return await radarrService.grabMovieRelease(settings, payload?.release || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:upsertQbittorrentClient', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const qbittorrent = payload?.qbittorrent || {};
    return await radarrService.upsertQbittorrentDownloadClient(settings, qbittorrent);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('radarr:checkQbittorrentClient', async (event, payload = {}) => {
  try {
    const settings = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const qbittorrent = payload?.qbittorrent || {};
    return await radarrService.checkQbittorrentDownloadClient(settings, qbittorrent);
  } catch (err) {
    return { ok: false, error: err.message, exists: false, matches: false };
  }
});

ipcMain.handle('open-radarr-download-page', async () => {
  try {
    await shell.openExternal('https://github.com/Radarr/Radarr');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-radarr-web-ui', async (event, radarrSettings = {}) => {
  try {
    const merged = { ...getRadarrConfig(), ...(radarrSettings || {}) };
    let baseUrl = String(merged.radarrBaseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Radarr Base URL is empty' };
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Invalid URL protocol' };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:testConnection', async (event, sonarrSettings = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    return await sonarrService.testConnection(settings);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:getRootFolders', async (event, sonarrSettings = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    const items = await sonarrService.getRootFolders(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:getQualityProfiles', async (event, sonarrSettings = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    const items = await sonarrService.getQualityProfiles(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:getLanguageProfiles', async (event, sonarrSettings = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    const items = await sonarrService.getLanguageProfiles(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:getSeries', async (event, sonarrSettings = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    const items = await sonarrService.getSeries(settings);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:getEpisodes', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const items = await sonarrService.getEpisodesBySeries(settings, payload?.seriesId);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:setEpisodesMonitored', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.setEpisodesMonitored(settings, payload?.episodeIds || [], payload?.monitored === true);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:searchEpisodes', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.searchEpisodes(settings, payload?.episodeIds || []);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:searchSeason', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.searchSeason(settings, payload?.seriesId, payload?.seasonNumber);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:getEpisodeReleases', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const items = await sonarrService.getEpisodeReleases(settings, payload?.episodeId);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message, items: [] };
  }
});

ipcMain.handle('sonarr:grabRelease', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.grabRelease(settings, payload?.release || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:grabBestSeasonPack', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.grabBestSeasonPack(settings, payload?.seriesId, payload?.seasonNumber);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:lookupSeriesByTmdbId', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const series = await sonarrService.lookupSeriesByTmdbId(settings, payload?.tmdbId);
    return { ok: true, series };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:addSeries', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.addSeries(settings, payload?.series || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:deleteSeries', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.deleteSeries(settings, payload?.seriesId, payload?.options || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:updateSeries', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    return await sonarrService.updateSeries(settings, payload?.seriesId, payload?.series || {});
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:upsertQbittorrentClient', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const qbittorrent = payload?.qbittorrent || {};
    return await sonarrService.upsertQbittorrentDownloadClient(settings, qbittorrent);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('sonarr:checkQbittorrentClient', async (event, payload = {}) => {
  try {
    const settings = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const qbittorrent = payload?.qbittorrent || {};
    return await sonarrService.checkQbittorrentDownloadClient(settings, qbittorrent);
  } catch (err) {
    return { ok: false, error: err.message, exists: false, matches: false };
  }
});

ipcMain.handle('open-sonarr-download-page', async () => {
  try {
    await shell.openExternal('https://github.com/Sonarr/Sonarr');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-sonarr-web-ui', async (event, sonarrSettings = {}) => {
  try {
    const merged = { ...getSonarrConfig(), ...(sonarrSettings || {}) };
    let baseUrl = String(merged.sonarrBaseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Sonarr Base URL is empty' };
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Invalid URL protocol' };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-sonarr-series-page', async (event, payload = {}) => {
  try {
    const merged = { ...getSonarrConfig(), ...(payload?.settings || {}) };
    const seriesId = Number(payload?.seriesId || 0);
    if (!seriesId) return { ok: false, error: 'Invalid Sonarr series id' };
    let baseUrl = String(merged.sonarrBaseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Sonarr Base URL is empty' };
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Invalid URL protocol' };
    parsed.pathname = `${String(parsed.pathname || '/').replace(/\/+$/, '')}/series/${seriesId}`;
    parsed.search = '';
    parsed.hash = '';
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('prowlarr:connectRadarr', async () => {
  try {
    const prowlarrConfig = getProwlarrConfig();
    const radarrConfig = getRadarrConfig();
    return await ensureProwlarrRadarrSync(prowlarrConfig, radarrConfig, 'connect');
  } catch (err) {
    return { ok: false, error: err.message, prowlarr: 'disconnected', radarr: 'disconnected', sync: 'notConfigured' };
  }
});

ipcMain.handle('prowlarr:syncRadarr', async () => {
  try {
    const prowlarrConfig = getProwlarrConfig();
    const radarrConfig = getRadarrConfig();
    return await ensureProwlarrRadarrSync(prowlarrConfig, radarrConfig, 'sync');
  } catch (err) {
    return { ok: false, error: err.message, prowlarr: 'disconnected', radarr: 'disconnected', sync: 'notConfigured' };
  }
});

// ═══════════════════════════════════════════════════════════════
ipcMain.handle('prowlarr:connectSonarr', async () => {
  try {
    const prowlarrConfig = getProwlarrConfig();
    const sonarrConfig = getSonarrConfig();
    return await ensureProwlarrSonarrSync(prowlarrConfig, sonarrConfig, 'connect');
  } catch (err) {
    return { ok: false, error: err.message, prowlarr: 'disconnected', sonarr: 'disconnected', sync: 'notConfigured' };
  }
});

ipcMain.handle('prowlarr:syncSonarr', async () => {
  try {
    const prowlarrConfig = getProwlarrConfig();
    const sonarrConfig = getSonarrConfig();
    return await ensureProwlarrSonarrSync(prowlarrConfig, sonarrConfig, 'sync');
  } catch (err) {
    return { ok: false, error: err.message, prowlarr: 'disconnected', sonarr: 'disconnected', sync: 'notConfigured' };
  }
});

// TORRENT IPC HANDLERS
// ═══════════════════════════════════════════════════════════════

ipcMain.handle('torrent-add', async (event, opts) => {
  try {
    if (opts?.mode === 'download') {
      const policy = await askVpnAwareDownloadConfirmation(event, 'torrent download');
      if (!policy.ok) {
        return { ok: false, cancelled: policy.cancelled === true, error: policy.error || 'Download cancelled' };
      }
    }
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
    if (resume) {
      const policy = await askVpnAwareDownloadConfirmation(event, 'torrent download');
      if (!policy.ok) {
        return { ok: false, cancelled: policy.cancelled === true, error: policy.error || 'Download cancelled' };
      }
    }
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
    const policy = await askVpnAwareDownloadConfirmation(event, 'torrent download');
    if (!policy.ok) {
      return { ok: false, cancelled: policy.cancelled === true, error: policy.error || 'Download cancelled' };
    }
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

ipcMain.handle('get-download-dir-free-space', async () => {
  try {
    const dir = getDownloadDir();
    const stat = fs.statfsSync(dir);
    const freeBytes = Number(stat?.bavail || 0) * Number(stat?.bsize || 0);
    return { ok: true, freeBytes: Number.isFinite(freeBytes) ? freeBytes : 0, dir };
  } catch (err) {
    return { ok: false, error: err.message, freeBytes: 0 };
  }
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

const normalizeSubtitleProvider = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'turkcealtyaziorg-stremio-addon') return 'turkcealtyaziorg-stremio-addon';
  return 'opensubtitles-v3';
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

const buildSubtitleRequestCandidates = ({ type, target, provider }) => {
  const candidates = [];
  const selectedProvider = normalizeSubtitleProvider(provider);
  const opensubBase = OPENSUBTITLES_V3_BASE_URL.replace(/\/+$/, '');
  if (selectedProvider === 'opensubtitles-v3' && opensubBase) {
    candidates.push({
      provider: 'opensubtitles-v3',
      base: opensubBase,
      route: `/subtitles/${type}/${target}.json`,
    });
  }
  if (selectedProvider === 'turkcealtyaziorg-stremio-addon') {
    for (const base of getSubtitleAddonBaseUrls()) {
      for (const route of buildSubtitleCandidatePaths({ type, target })) {
        candidates.push({
          provider: 'turkcealtyaziorg-stremio-addon',
          base,
          route,
        });
      }
    }
  }
  return candidates;
};

const getSubtitleCacheKey = ({ type, target, provider }) => `${String(type || '').toLowerCase()}|${String(target || '').toLowerCase()}|${normalizeSubtitleProvider(provider)}`;

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
        provider: provider || '',
      };
    })
    .filter(Boolean);
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
    const subtitleProvider = normalizeSubtitleProvider(payload.subtitleProvider);
    const targets = type === 'movie'
      ? [`${imdbId}`]
      : [`${imdbId}:${season}:${episode}`];
    const cacheKey = getSubtitleCacheKey({ type, target: targets.join('|'), provider: subtitleProvider });
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
      const requestCandidates = buildSubtitleRequestCandidates({ type, target, provider: subtitleProvider });
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
          source: subtitleProvider,
          tried,
          errors,
          selectedProvider: subtitleProvider,
          providerOffline: subtitleProvider === 'turkcealtyaziorg-stremio-addon' && tried.length > 0 && errors.length >= tried.length,
          message: 'No subtitle payload received from addon endpoints',
        },
      };
      setCachedSubtitleSearch(cacheKey, responsePayload);
      return responsePayload;
    }
    const rawSubs = Array.isArray(data?.subtitles)
      ? data.subtitles
      : (Array.isArray(data?.all) ? data.all : (Array.isArray(data) ? data : []));
    const subtitles = sanitizeSubtitleList(rawSubs, resolvedBase, resolvedProvider);
    const responsePayload = {
      ok: true,
      subtitles,
      imdbId,
      debug: {
        source: resolvedProvider || 'unknown',
        tried,
        errors,
        selectedProvider: subtitleProvider,
        providerOffline: false,
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

ipcMain.handle('open-radarr-movie-page', async (event, payload = {}) => {
  try {
    const merged = { ...getRadarrConfig(), ...(payload?.settings || {}) };
    const movieId = Number(payload?.movieId || 0);
    if (!movieId) return { ok: false, error: 'Invalid Radarr movie id' };
    let baseUrl = String(merged.radarrBaseUrl || '').trim();
    if (!baseUrl) return { ok: false, error: 'Radarr Base URL is empty' };
    if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Invalid URL protocol' };
    parsed.pathname = `${String(parsed.pathname || '/').replace(/\/+$/, '')}/movies/${movieId}`;
    parsed.search = '';
    parsed.hash = '';
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-library-video', async (event, payload = {}) => {
  try {
    const filePath = String(payload.fullPath || '');
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }
    const openPathError = await shell.openPath(filePath);
    if (openPathError) {
      const fileUrl = pathToFileURL(filePath).href;
      await shell.openExternal(fileUrl);
    }
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

