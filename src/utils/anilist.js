import axios from 'axios';

const DEFAULT_ANILIST_API_URL = 'https://graphql.anilist.co';

const CATEGORY_SORTS = {
  popular: ['POPULARITY_DESC', 'SCORE_DESC'],
  top_rated: ['SCORE_DESC', 'POPULARITY_DESC'],
  trending: ['TRENDING_DESC', 'POPULARITY_DESC'],
  action: ['POPULARITY_DESC'],
  comedy: ['POPULARITY_DESC'],
  drama: ['POPULARITY_DESC'],
  fantasy: ['POPULARITY_DESC'],
  romance: ['POPULARITY_DESC'],
  sci_fi: ['POPULARITY_DESC'],
  horror: ['POPULARITY_DESC'],
  mystery: ['POPULARITY_DESC'],
};

const CATEGORY_GENRES = {
  action: ['Action'],
  comedy: ['Comedy'],
  drama: ['Drama'],
  fantasy: ['Fantasy'],
  romance: ['Romance'],
  sci_fi: ['Sci-Fi'],
  horror: ['Horror'],
  mystery: ['Mystery'],
};

const ANIME_LIST_QUERY = `
  query AnimeList($page: Int, $sort: [MediaSort], $genreIn: [String]) {
    Page(page: $page, perPage: 24) {
      pageInfo {
        hasNextPage
      }
      media(type: ANIME, isAdult: false, sort: $sort, genre_in: $genreIn) {
        id
        title {
          romaji
          english
          native
        }
        description(asHtml: false)
        coverImage {
          extraLarge
          large
        }
        bannerImage
        averageScore
        popularity
        episodes
        seasonYear
        startDate {
          year
          month
          day
        }
        genres
        format
        status
      }
    }
  }
`;

export const fetchAnime = async (apiUrl = DEFAULT_ANILIST_API_URL, category = 'popular', page = 1) => {
  try {
    const response = await axios.post(apiUrl || DEFAULT_ANILIST_API_URL, {
      query: ANIME_LIST_QUERY,
      variables: {
        page,
        sort: CATEGORY_SORTS[category] || CATEGORY_SORTS.popular,
        genreIn: CATEGORY_GENRES[category] || null,
      },
    });

    const media = response.data?.data?.Page?.media || [];
    const hasNextPage = response.data?.data?.Page?.pageInfo?.hasNextPage !== false;

    return {
      results: media.map(mapAniListMedia),
      hasNextPage,
    };
  } catch (error) {
    console.error('Error fetching anime:', error);
    return {
      results: [],
      hasNextPage: false,
    };
  }
};

export const getAniListApiUrl = (settings = {}) =>
  settings.anilistApiUrl || DEFAULT_ANILIST_API_URL;

const mapAniListMedia = (item) => {
  const title = item.title?.english || item.title?.romaji || item.title?.native || 'Anime';
  const releaseDate = formatAniListDate(item.startDate);

  return {
    id: `anilist-${item.id}`,
    anilistId: item.id,
    title,
    name: title,
    original_name: item.title?.romaji || title,
    media_type: 'anime',
    poster_path: item.coverImage?.extraLarge || item.coverImage?.large || null,
    backdrop_path: item.bannerImage || null,
    vote_average: typeof item.averageScore === 'number' ? item.averageScore / 10 : null,
    popularity: item.popularity,
    release_date: releaseDate,
    first_air_date: releaseDate,
    overview: stripHtml(item.description || ''),
    genres: (item.genres || []).map((name) => ({ id: name, name })),
    episodes: item.episodes,
    status: item.status,
    format: item.format,
    externalCatalog: true,
  };
};

const formatAniListDate = (date = {}) => {
  if (!date.year) return '';
  const month = String(date.month || 1).padStart(2, '0');
  const day = String(date.day || 1).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
};

const stripHtml = (value) => String(value).replace(/<[^>]*>/g, '').trim();
