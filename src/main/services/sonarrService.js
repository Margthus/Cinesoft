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
  const timeoutOverride = Number(options.timeout);
  const timeout = Number.isFinite(timeoutOverride) && timeoutOverride > 0
    ? timeoutOverride
    : getRequestTimeout(settings);
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

const getLanguageProfiles = async (settings = {}) => {
  const rows = await sonarrRequest(settings, '/api/v3/languageprofile');
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

const setEpisodesMonitored = async (settings = {}, episodeIds = [], monitored = true) => {
  const ids = (Array.isArray(episodeIds) ? episodeIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error('At least one valid Sonarr episode id is required.');
  await sonarrRequest(settings, '/api/v3/episode/monitor', {
    method: 'PUT',
    data: {
      episodeIds: ids,
      monitored: monitored === true,
    },
  });
  return { ok: true, episodeIds: ids, monitored: monitored === true };
};

const searchEpisodes = async (settings = {}, episodeIds = []) => {
  const ids = (Array.isArray(episodeIds) ? episodeIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) throw new Error('At least one valid Sonarr episode id is required.');
  const command = await sonarrRequest(settings, '/api/v3/command', {
    method: 'POST',
    data: {
      name: 'EpisodeSearch',
      episodeIds: ids,
    },
  });
  return { ok: true, command };
};

const searchSeason = async (settings = {}, seriesId, seasonNumber) => {
  const id = Number(seriesId);
  const season = Number(seasonNumber);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');
  if (!Number.isFinite(season) || season <= 0) throw new Error('Valid Sonarr season number is required.');
  const command = await sonarrRequest(settings, '/api/v3/command', {
    method: 'POST',
    data: {
      name: 'SeasonSearch',
      seriesId: id,
      seasonNumber: season,
    },
  });
  return { ok: true, command };
};

const getEpisodeReleases = async (settings = {}, episodeId) => {
  const id = Number(episodeId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr episode id is required.');
  const loadReleases = () => sonarrRequest(settings, '/api/v3/release', {
    params: { episodeId: id },
    timeout: 30000,
  });
  try {
    const rows = await loadReleases();
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    // Sonarr release queries can spike on cold indexer sessions; retry once.
    if (/timed out/i.test(String(error?.message || ''))) {
      const rows = await loadReleases();
      return Array.isArray(rows) ? rows : [];
    }
    throw error;
  }
};

const grabRelease = async (settings = {}, release = {}) => {
  if (!release || typeof release !== 'object') throw new Error('Valid Sonarr release payload is required.');
  const guid = String(release?.guid || '').trim();
  const indexerId = Number(release?.indexerId || 0);
  const payloads = [
    release,
    guid && indexerId ? { guid, indexerId } : null,
    guid ? { guid } : null,
  ].filter(Boolean);

  let lastError = null;
  for (const payload of payloads) {
    try {
      const response = await sonarrRequest(settings, '/api/v3/release', {
        method: 'POST',
        data: payload,
      });
      return { ok: true, release: response || release };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not grab release.');
};

const scoreSeasonRelease = (release = {}, seasonNumber = 0) => {
  const title = String(release.title || release.releaseTitle || '').toLowerCase();
  const seasonCode = seasonNumber ? `s${String(seasonNumber).padStart(2, '0')}` : '';
  let score = 0;
  if (release.fullSeason === true) score += 120;
  if (Array.isArray(release.episodeNumbers) && release.episodeNumbers.length > 1) score += 80;
  if (seasonCode && title.includes(seasonCode) && !/\bs\d{1,2}e\d{1,3}\b/i.test(title)) score += 55;
  if (/\b(complete|season|sezon|pack)\b/i.test(title)) score += 35;
  if (release.rejections?.length) score -= 200;
  if (release.downloadAllowed === false) score -= 200;
  score += Math.min(40, Number(release.seeders || 0));
  score += Math.min(20, Math.round((Number(release.size || 0) || 0) / (1024 ** 3)));
  return score;
};

const grabBestSeasonPack = async (settings = {}, seriesId, seasonNumber) => {
  const id = Number(seriesId);
  const season = Number(seasonNumber);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Valid Sonarr series id is required.');
  if (!Number.isFinite(season) || season <= 0) throw new Error('Valid Sonarr season number is required.');

  const releases = await sonarrRequest(settings, '/api/v3/release', {
    params: { seriesId: id, seasonNumber: season },
    timeout: 30000,
  });
  const releaseList = Array.isArray(releases) ? releases : [];
  const best = releaseList
    .filter((release) => scoreSeasonRelease(release, season) > 0)
    .sort((a, b) => scoreSeasonRelease(b, season) - scoreSeasonRelease(a, season))[0];

  if (!best) {
    const fallback = await searchSeason(settings, id, season);
    return { ok: true, grabbed: false, fallbackCommand: fallback.command, releaseCount: releaseList.length };
  }

  const grabbed = await sonarrRequest(settings, '/api/v3/release', {
    method: 'POST',
    data: best,
  });
  return {
    ok: true,
    grabbed: true,
    release: grabbed || best,
    releaseCount: releaseList.length,
  };
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
  getLanguageProfiles,
  getSeries,
  getEpisodesBySeries,
  setEpisodesMonitored,
  searchEpisodes,
  searchSeason,
  getEpisodeReleases,
  grabRelease,
  grabBestSeasonPack,
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
