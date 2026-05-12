const axios = require('axios');

const normalizeBaseUrl = (baseUrl = '') => {
  const raw = String(baseUrl || '').trim();
  if (!raw) throw new Error('Radarr Base URL is required.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const normalized = withProtocol.replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('Radarr Base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Radarr Base URL must use http or https.');
  }
  return normalized;
};

const getApiKey = (settings = {}) => {
  const apiKey = String(settings.radarrApiKey || '').trim();
  if (!apiKey) throw new Error('Radarr API Key is required.');
  return apiKey;
};

const getRequestTimeout = (settings = {}) => {
  const timeout = Number(settings.radarrTimeout || settings.timeout || 10000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 10000;
};

const buildRequestError = (error, fallback = 'Radarr request failed.') => {
  if (error?.response) {
    const status = Number(error.response.status || 0);
    const data = error.response.data;
    const message = typeof data === 'string'
      ? data
      : (data?.message || data?.error || JSON.stringify(data || {}));
    if (status === 401 || status === 403) return new Error('Radarr authentication failed. Check API key.');
    if (status === 404) return new Error('Radarr endpoint not found. Check Base URL and API version.');
    if (message && message.length < 300) return new Error(`Radarr error (${status}): ${message}`);
    return new Error(`Radarr error (${status}).`);
  }
  if (error?.code === 'ECONNREFUSED') return new Error('Could not connect to Radarr. Is it running?');
  if (error?.code === 'ETIMEDOUT' || /timeout/i.test(String(error?.message || ''))) {
    return new Error('Radarr request timed out.');
  }
  return new Error(error?.message || fallback);
};

const radarrRequest = async (settings = {}, path = '', options = {}) => {
  const baseUrl = normalizeBaseUrl(settings.radarrBaseUrl);
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

const getSystemStatus = async (settings = {}) => radarrRequest(settings, '/api/v3/system/status');

const testConnection = async (settings = {}) => {
  const system = await getSystemStatus(settings);
  return {
    ok: true,
    version: String(system?.version || ''),
    appName: String(system?.appName || 'Radarr'),
  };
};

const getRootFolders = async (settings = {}) => {
  const rows = await radarrRequest(settings, '/api/v3/rootfolder');
  return Array.isArray(rows) ? rows : [];
};

const getQualityProfiles = async (settings = {}) => {
  const rows = await radarrRequest(settings, '/api/v3/qualityprofile');
  return Array.isArray(rows) ? rows : [];
};

const lookupMovieByTmdbId = async (settings = {}, tmdbId) => {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('TMDB ID is required to add this movie to Radarr.');
  const rows = await radarrRequest(settings, '/api/v3/movie/lookup/tmdb', { params: { tmdbId: id } });
  if (Array.isArray(rows)) return rows[0] || null;
  return rows || null;
};

const lookupMovie = async (settings = {}, term = '') => {
  const query = String(term || '').trim();
  if (!query) throw new Error('Lookup term is required.');
  const rows = await radarrRequest(settings, '/api/v3/movie/lookup', { params: { term: query } });
  return Array.isArray(rows) ? rows : [];
};

const addMovie = async (settings = {}, payload = {}) => {
  try {
    const response = await radarrRequest(settings, '/api/v3/movie', {
      method: 'POST',
      data: payload,
    });
    return { ok: true, movie: response };
  } catch (error) {
    const msg = String(error?.message || '');
    if (/already exists|has already been added|duplicate/i.test(msg)) {
      return { ok: false, alreadyExists: true, error: 'Already exists in Radarr.' };
    }
    return { ok: false, error: msg || 'Failed to add movie to Radarr.' };
  }
};

module.exports = {
  normalizeBaseUrl,
  radarrRequest,
  testConnection,
  getSystemStatus,
  getRootFolders,
  getQualityProfiles,
  lookupMovieByTmdbId,
  lookupMovie,
  addMovie,
};
