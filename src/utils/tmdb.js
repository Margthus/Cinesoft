import axios from 'axios';

const BASE_URL = 'https://api.themoviedb.org/3';

const languageCode = (language) => language === 'tr' ? 'tr-TR' : 'en-US';

const maskApiKeyInUrl = (url = '') => String(url).replace(/([?&]api_key=)[^&]+/i, '$1***');

const buildMaskedUrl = (endpoint, params = {}) => {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries({ api_key: '***', ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
};

const logTmdb = (code, message, details = {}) => {
  if (typeof window === 'undefined') return;
  window.electronAPI?.logEvent?.({
    source: 'tmdb',
    code,
    message,
    details: {
      ...details,
      url: details.url ? maskApiKeyInUrl(details.url) : undefined,
      hasApiKey: details.hasApiKey,
    },
  });
};

const fetchTmdbData = async (apiKey, endpoint, params = {}, fallback = null) => {
  const startedAt = Date.now();
  if (!apiKey) {
    logTmdb('config_missing', 'TMDB API key missing', {
      endpoint,
      requestSent: false,
      hasApiKey: false,
      requestTime: new Date(startedAt).toISOString(),
    });
    return fallback;
  }

  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      params: {
        api_key: apiKey,
        ...params,
      },
    });
    logTmdb('response', 'TMDB response received', {
      endpoint,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      durationMs: Date.now() - startedAt,
      requestTime: new Date(startedAt).toISOString(),
      url: buildMaskedUrl(endpoint, params),
      hasApiKey: true,
    });
    return response.data;
  } catch (error) {
    logTmdb('error', 'TMDB request failed', {
      endpoint,
      status: error.response?.status || null,
      ok: false,
      error: error.response?.data?.status_message || error.message,
      durationMs: Date.now() - startedAt,
      requestTime: new Date(startedAt).toISOString(),
      url: buildMaskedUrl(endpoint, params),
      hasApiKey: true,
    });
    console.error(`TMDB request failed for ${endpoint}:`, error);
    return fallback;
  }
};

const filterAdultResults = (items = []) => {
  return (Array.isArray(items) ? items : []).filter((item) => item?.adult !== true);
};

export const fetchTrending = async (apiKey, language, type = 'all', page = 1) => {
  const data = await fetchTmdbData(apiKey, `/trending/${type}/day`, {
    page,
    language: languageCode(language),
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchMovies = async (apiKey, language, category = 'popular', page = 1) => {
  const data = await fetchTmdbData(apiKey, `/movie/${category}`, {
    page,
    language: languageCode(language),
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchTVShows = async (apiKey, language, category = 'popular', page = 1) => {
  const data = await fetchTmdbData(apiKey, `/tv/${category}`, {
    page,
    language: languageCode(language),
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchDetails = async (apiKey, language, type, id) => {
  return fetchTmdbData(apiKey, `/${type}/${id}`, {
    language: languageCode(language),
    append_to_response: 'credits,images,videos,external_ids',
    include_image_language: 'en,null',
  }, null);
};

export const searchContent = async (apiKey, language, query, page = 1) => {
  if (!query) return [];
  const data = await fetchTmdbData(apiKey, '/search/multi', {
    page,
    language: languageCode(language),
    query,
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchPersonCredits = async (apiKey, language, personId, page = 1) => {
  if (!personId) return [];
  const data = await fetchTmdbData(apiKey, `/person/${personId}/combined_credits`, {
    page,
    language: languageCode(language),
  }, { cast: [] });
  return data.cast || [];
};

export const fetchGenres = async (apiKey, language, type = 'movie') => {
  const data = await fetchTmdbData(apiKey, `/genre/${type}/list`, {
    language: languageCode(language),
  }, { genres: [] });
  return data.genres || [];
};

export const fetchByGenre = async (apiKey, language, type, genreId, page = 1) => {
  if (!genreId) return [];
  const data = await fetchTmdbData(apiKey, `/discover/${type}`, {
    language: languageCode(language),
    with_genres: genreId,
    sort_by: 'popularity.desc',
    page,
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchByKeyword = async (apiKey, language, type, keywordId, page = 1) => {
  if (!keywordId) return [];
  const data = await fetchTmdbData(apiKey, `/discover/${type}`, {
    language: languageCode(language),
    with_keywords: keywordId,
    sort_by: 'popularity.desc',
    page,
    include_adult: 'false',
  }, { results: [] });
  return filterAdultResults(data.results || []);
};

export const fetchSeasonDetails = async (apiKey, language, tvShowId, seasonNumber) => {
  if (!tvShowId) return null;
  return fetchTmdbData(apiKey, `/tv/${tvShowId}/season/${seasonNumber}`, {
    language: languageCode(language),
  }, null);
};
