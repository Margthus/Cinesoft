const axios = require('axios');

const normalizeBaseUrl = (baseUrl = '') => {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('Sonarr Base URL is required.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const normalized = withProtocol.replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Sonarr Base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Sonarr Base URL must use http or https.');
  }
  return normalized;
};

const getApiKey = (settings = {}) => {
  const apiKey = String(settings.sonarrApiKey || '').trim();
  if (!apiKey) throw new Error('Sonarr API Key is required.');
  return apiKey;
};

const getRequestTimeout = (settings = {}) => {
  const timeout = Number(settings.sonarrTimeout || settings.timeout || 10000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
};

const buildRequestError = (error, fallback = 'Sonarr request failed.') => {
  if (error?.response) {
    const status = Number(error.response.status || 0);
    const data = error.response.data;
    const message = typeof data === 'string'
      ? data
      : (data?.message || data?.error || JSON.stringify(data || {}));
    if (status === 401 || status === 403) return new Error('Sonarr authentication failed. Check API key.');
    if (status === 404) return new Error('Sonarr endpoint not found. Check Base URL and API version.');
    if (message && message.length < 300) return new Error(`Sonarr error (${status}): ${message}`);
    return new Error(`Sonarr error (${status}).`);
  }
  if (error?.code === 'ECONNREFUSED') return new Error('Could not connect to Sonarr. Is it running?');
  if (error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message || ''))) {
    return new Error('Sonarr request timed out.');
  }
  return new Error(error?.message || fallback);
};

const sonarrRequest = async (settings = {}, path = '', options = {}) => {
  const baseUrl = normalizeBaseUrl(settings.sonarrBaseUrl);
  const apiKey = getApiKey(settings);
  const timeout = getRequestTimeout(settings);
  const method = String(options.method || 'GET').toUpperCase();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const response = await axios({
      url,
      method,
      data: options.data,
      params: options.params,
      timeout,
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
    throw buildRequestError(error);
  }
};

const getSystemStatus = async (settings = {}) => sonarrRequest(settings, '/api/v3/system/status');

const testConnection = async (settings = {}) => {
  const system = await getSystemStatus(settings);
  return {
    ok: true,
    version: String(system?.version || ''),
    appName: String(system?.appName || 'Sonarr'),
  };
};

const getRootFolders = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/rootfolder');
  return Array.isArray(rows) ? rows : [];
};

const getQualityProfiles = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/qualityprofile');
  return Array.isArray(rows) ? rows : [];
};

const getSeries = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/series');
  return Array.isArray(rows) ? rows : [];
};

const getEpisodesBySeries = async (settings = {}, seriesId) => {
  const id = Number(seriesId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');
  const rows = await sonarrRequest(settings, '/api/v3/episode', {
    params: { seriesId: id },
  });
  return Array.isArray(rows) ? rows : [];
};

const getSeriesById = async (settings = {}, seriesId) => {
  const id = Number(seriesId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');
  return await sonarrRequest(settings, `/api/v3/series/${id}`);
};

const lookupSeries = async (settings = {}, term = '') => {
  const query = String(term || '').trim();
  if (!query) throw new Error('Lookup term is required.');
  const rows = await sonarrRequest(settings, '/api/v3/series/lookup', { params: { term: query } });
  return Array.isArray(rows) ? rows : [];
};

const lookupSeriesByTmdbId = async (settings = {}, tmdbId) => {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('TMDB ID is required to add this series to Sonarr.');

  const lookupResults = await lookupSeries(settings, `tmdb:${id}`);
  const direct = lookupResults.find((item) => Number(item?.tmdbId) === id);
  if (direct) return direct;

  const existing = await getSeries(settings);
  const fromLibrary = existing.find((item) => Number(item?.tmdbId) === id);
  return fromLibrary || null;
};

const addSeries = async (settings = {}, payload = {}) => {
  try {
    const response = await sonarrRequest(settings, '/api/v3/series', {
      method: 'POST',
      data: payload,
    });
    return { ok: true, series: response };
  } catch (error) {
    const msg = String(error?.message || '');
    if (/already exists|has already been added|duplicate/i.test(msg)) {
      return { ok: false, alreadyExists: true, error: 'Already exists in Sonarr.' };
    }
    return { ok: false, error: msg || 'Failed to add series to Sonarr.' };
  }
};

const deleteSeries = async (settings = {}, seriesId, options = {}) => {
  const id = Number(seriesId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');
  const params = {
    deleteFiles: options.deleteFiles === true,
    addImportListExclusion: options.addImportListExclusion === true,
  };
  await sonarrRequest(settings, `/api/v3/series/${id}`, {
    method: 'DELETE',
    params,
  });
  return { ok: true };
};

const updateSeries = async (settings = {}, seriesId, patch = {}) => {
  const id = Number(seriesId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');

  const current = await getSeriesById(settings, id);
  const payload = {
    ...current,
    ...patch,
    id,
  };

  const response = await sonarrRequest(settings, `/api/v3/series/${id}`, {
    method: 'PUT',
    data: payload,
  });
  return { ok: true, series: response };
};

const getDownloadClients = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/downloadclient');
  return Array.isArray(rows) ? rows : [];
};

const getDownloadClientSchemas = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/downloadclient/schema');
  return Array.isArray(rows) ? rows : [];
};

const normalizeQbBaseUrlParts = (baseUrl = '') => {
  const raw = String(baseUrl || '').trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(normalized);
  const useSsl = parsed.protocol === 'https:';
  const host = parsed.hostname;
  const port = Number(parsed.port || (useSsl ? 443 : 80));
  const urlBase = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
  return { host, port, useSsl, urlBase };
};

const setFieldValue = (fields = [], names = [], value) => {
  const lowerNames = names.map((item) => String(item).toLowerCase());
  const field = fields.find((item) => lowerNames.includes(String(item?.name || '').toLowerCase()));
  if (!field) return false;
  field.value = value;
  return true;
};

const getFieldValue = (fields = [], names = []) => {
  const lowerNames = names.map((item) => String(item).toLowerCase());
  const field = (Array.isArray(fields) ? fields : []).find((item) => lowerNames.includes(String(item?.name || '').toLowerCase()));
  return field?.value;
};

const upsertQbittorrentDownloadClient = async (settings = {}, qbConfig = {}) => {
  const username = String(qbConfig.username || '').trim();
  const password = String(qbConfig.password || '').trim();
  const { host, port, useSsl, urlBase } = normalizeQbBaseUrlParts(String(qbConfig.baseUrl || ''));
  if (!host) throw new Error('qBittorrent host is required.');
  if (!username || !password) throw new Error('qBittorrent username/password are required.');

  const [clients, schemas] = await Promise.all([
    getDownloadClients(settings),
    getDownloadClientSchemas(settings),
  ]);

  const existing = clients.find((client) => {
    const impl = String(client?.implementationName || client?.implementation || '').toLowerCase();
    return impl.includes('qbittorrent');
  });

  if (existing) {
    const payload = {
      ...existing,
      enable: true,
      fields: Array.isArray(existing.fields) ? [...existing.fields] : [],
    };
    setFieldValue(payload.fields, ['host'], host);
    setFieldValue(payload.fields, ['port'], port);
    setFieldValue(payload.fields, ['usessl', 'ssl'], useSsl);
    setFieldValue(payload.fields, ['urlbase', 'basepath'], urlBase);
    setFieldValue(payload.fields, ['username', 'user'], username);
    setFieldValue(payload.fields, ['password', 'pass'], password);
    const updated = await sonarrRequest(settings, '/api/v3/downloadclient', {
      method: 'PUT',
      data: payload,
    });
    return { ok: true, client: updated, updated: true };
  }

  const schema = schemas.find((item) => {
    const impl = String(item?.implementationName || item?.implementation || '').toLowerCase();
    return impl.includes('qbittorrent');
  });
  if (!schema) {
    throw new Error('Sonarr qBittorrent schema not found.');
  }

  const payload = JSON.parse(JSON.stringify(schema));
  delete payload.id;
  payload.enable = true;
  payload.name = payload.name || 'qBittorrent';
  payload.fields = Array.isArray(payload.fields) ? payload.fields : [];
  setFieldValue(payload.fields, ['host'], host);
  setFieldValue(payload.fields, ['port'], port);
  setFieldValue(payload.fields, ['usessl', 'ssl'], useSsl);
  setFieldValue(payload.fields, ['urlbase', 'basepath'], urlBase);
  setFieldValue(payload.fields, ['username', 'user'], username);
  setFieldValue(payload.fields, ['password', 'pass'], password);
  const created = await sonarrRequest(settings, '/api/v3/downloadclient', {
    method: 'POST',
    data: payload,
  });
  return { ok: true, client: created, updated: false };
};

const checkQbittorrentDownloadClient = async (settings = {}, qbConfig = {}) => {
  const username = String(qbConfig.username || '').trim();
  const { host, port, urlBase } = normalizeQbBaseUrlParts(String(qbConfig.baseUrl || ''));
  const clients = await getDownloadClients(settings);
  const existing = clients.find((client) => {
    const impl = String(client?.implementationName || client?.implementation || '').toLowerCase();
    return impl.includes('qbittorrent');
  });

  if (!existing) {
    return { ok: true, exists: false, matches: false };
  }

  const fields = Array.isArray(existing.fields) ? existing.fields : [];
  const configuredHost = String(getFieldValue(fields, ['host']) || '').trim().toLowerCase();
  const configuredPort = Number(getFieldValue(fields, ['port']) || 0);
  const configuredUrlBase = String(getFieldValue(fields, ['urlbase', 'basepath']) || '').trim().replace(/\/+$/, '');
  const configuredUsername = String(getFieldValue(fields, ['username', 'user']) || '').trim();

  const targetHost = String(host || '').trim().toLowerCase();
  const targetPort = Number(port || 0);
  const targetUrlBase = String(urlBase || '').trim().replace(/\/+$/, '');

  const matches = Boolean(
    configuredHost
    && configuredHost === targetHost
    && configuredPort === targetPort
    && configuredUrlBase === targetUrlBase
    && (!username || configuredUsername === username)
  );

  return { ok: true, exists: true, matches, client: existing };
};

module.exports = {
  normalizeBaseUrl,
  sonarrRequest,
  testConnection,
  getSystemStatus,
  getRootFolders,
  getQualityProfiles,
  getSeries,
  getEpisodesBySeries,
  getSeriesById,
  lookupSeries,
  lookupSeriesByTmdbId,
  addSeries,
  deleteSeries,
  updateSeries,
  getDownloadClients,
  getDownloadClientSchemas,
  upsertQbittorrentDownloadClient,
  checkQbittorrentDownloadClient,
};
