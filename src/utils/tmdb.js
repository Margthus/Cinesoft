import axios from 'axios';

const BASE_URL = 'https://api.themoviedb.org/3';

export const fetchTrending = async (apiKey, language, type = 'all', page = 1) => {
  if (!apiKey) return [];
  try {
    const response = await axios.get(`${BASE_URL}/trending/${type}/day`, {
      params: {
        api_key: apiKey,
        page,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data.results;
  } catch (error) {
    console.error('Error fetching trending:', error);
    return [];
  }
};

export const fetchMovies = async (apiKey, language, category = 'popular', page = 1) => {
  if (!apiKey) return [];
  try {
    const response = await axios.get(`${BASE_URL}/movie/${category}`, {
      params: {
        api_key: apiKey,
        page,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data.results;
  } catch (error) {
    console.error(`Error fetching ${category} movies:`, error);
    return [];
  }
};

export const fetchTVShows = async (apiKey, language, category = 'popular', page = 1) => {
  if (!apiKey) return [];
  try {
    const response = await axios.get(`${BASE_URL}/tv/${category}`, {
      params: {
        api_key: apiKey,
        page,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data.results;
  } catch (error) {
    console.error(`Error fetching ${category} tv shows:`, error);
    return [];
  }
};

export const fetchDetails = async (apiKey, language, type, id) => {
  if (!apiKey) return null;
  try {
    const response = await axios.get(`${BASE_URL}/${type}/${id}`, {
      params: {
        api_key: apiKey,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
        append_to_response: 'credits,images,videos,external_ids',
        include_image_language: 'en,null'
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching details for ${type} ${id}:`, error);
    return null;
  }
};

export const searchContent = async (apiKey, language, query, page = 1) => {
  if (!apiKey || !query) return [];
  try {
    const response = await axios.get(`${BASE_URL}/search/multi`, {
      params: {
        api_key: apiKey,
        page,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
        query,
      },
    });
    return response.data.results;
  } catch (error) {
    console.error(`Error searching for ${query}:`, error);
    return [];
  }
};

export const fetchPersonCredits = async (apiKey, language, personId, page = 1) => {
  if (!apiKey || !personId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/person/${personId}/combined_credits`, {
      params: {
        api_key: apiKey,
        page,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data.cast;
  } catch (error) {
    console.error(`Error fetching credits for person ${personId}:`, error);
    return [];
  }
};

export const fetchGenres = async (apiKey, language, type = 'movie') => {
  if (!apiKey) return [];
  try {
    const response = await axios.get(`${BASE_URL}/genre/${type}/list`, {
      params: {
        api_key: apiKey,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data.genres;
  } catch (error) {
    console.error(`Error fetching genres for ${type}:`, error);
    return [];
  }
};

export const fetchByGenre = async (apiKey, language, type, genreId, page = 1) => {
  if (!apiKey || !genreId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/discover/${type}`, {
      params: {
        api_key: apiKey,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
        with_genres: genreId,
        sort_by: 'popularity.desc',
        page,
      },
    });
    return response.data.results;
  } catch (error) {
    console.error(`Error fetching ${type} by genre ${genreId}:`, error);
    return [];
  }
};

export const fetchByKeyword = async (apiKey, language, type, keywordId, page = 1) => {
  if (!apiKey || !keywordId) return [];
  try {
    const response = await axios.get(`${BASE_URL}/discover/${type}`, {
      params: {
        api_key: apiKey,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
        with_keywords: keywordId,
        sort_by: 'popularity.desc',
        page,
      },
    });
    return response.data.results;
  } catch (error) {
    console.error(`Error fetching ${type} by keyword ${keywordId}:`, error);
    return [];
  }
};

export const fetchSeasonDetails = async (apiKey, language, tvShowId, seasonNumber) => {
  if (!apiKey || !tvShowId) return null;
  try {
    const response = await axios.get(`${BASE_URL}/tv/${tvShowId}/season/${seasonNumber}`, {
      params: {
        api_key: apiKey,
        language: language === 'tr' ? 'tr-TR' : 'en-US',
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching season details for show ${tvShowId} season ${seasonNumber}:`, error);
    return null;
  }
};
