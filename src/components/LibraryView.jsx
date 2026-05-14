import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Captions, CheckCircle2, Download, Film, FolderOpen, HardDrive, Library, PlayCircle, Tv, X } from 'lucide-react';
import SourceSearchPanel from './SourceSearchPanel';
import { fetchDetails, fetchSeasonDetails, searchContent } from '../utils/tmdb';
import '../styles/LibraryView.css';

const imageUrl = (path, size = 'w500') => path ? `https://image.tmdb.org/t/p/${size}${path}` : '';

const normalizePathKey = (value = '') => String(value || '').replace(/\//g, '\\').toLowerCase();

const stripReleaseJunk = (value = '') => {
  const withoutExt = String(value || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return withoutExt
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, (chunk) => (/\b(19|20)\d{2}\b/.test(chunk) ? chunk : ' '))
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.[^\s-]+(?:\s*-\s*)?/gi, ' ')
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|io|me|tv|to|cc|xyz)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ')
    .replace(/\b\d{1,2}x\d{1,3}\b/gi, ' ')
    .replace(/\bS\d{1,2}\b/gi, ' ')
    .replace(/\bE\d{1,3}\b/gi, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|x264|x265|h264|h265|hevc|avc|10bit|bluray|brrip|web[- ]?dl|webrip|hdrip|dvdrip|proper|repack|remux|aac|ddp?5?\.?1|atmos|yify|yts|rarbg|eztv|tgx|torrentgalaxy|ettv|amzn|nf|hulu)\b/gi, ' ')
    .replace(/\b(ac3|eac3|dts|truehd|flac|opus|mp3|2ch|5\.1|7\.1)\b/gi, ' ')
    .replace(/\b(aac|ac3|ddp?|dts)\s*\d(?:\.\d)?\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:gb|gib|mb|mib)\b/gi, ' ')
    .replace(/\b(part|cd|disk|disc)\s?\d+\b/gi, ' ')
    .replace(/\b(multi|dubbed|dual audio|turkish|english|subs?|subbed|complete|season pack|proper|uncut|extended)\b/gi, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\b(\d{1,2})\s+\1\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeSearchQuery = (value = '') => {
  let cleaned = stripReleaseJunk(value)
    .replace(/\b(remaster(?:ed)?|extended|unrated|proper|repack)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const tail = tokens[tokens.length - 1];
    if (/^[A-Z0-9]{5,}$/.test(tail) || /^[A-Z]{3,}\d+$/.test(tail)) {
      tokens.pop();
      cleaned = tokens.join(' ').trim();
    }
  }
  return cleaned;
};

const buildMetadataQueries = (item) => {
  const candidates = [item.query, item.cleanTitle, item.displayTitle, item.title, item.fileName];
  const unique = new Set();
  const pushVariant = (text = '') => {
    const query = normalizeSearchQuery(text);
    if (!query) return;
    unique.add(query);
    unique.add(query.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim());
    unique.add(query.replace(/[:|-].*$/g, '').trim());
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length > 2) unique.add(words.slice(0, -1).join(' '));
  };
  candidates.forEach((candidate) => {
    pushVariant(candidate);
  });
  return Array.from(unique).filter(Boolean).slice(0, 10);
};

const looksLikeReleaseName = (value = '') => {
  const text = String(value || '');
  return /\bS\d{1,2}\s*E\d{1,3}\b/i.test(text)
    || /\b\d{1,2}x\d{1,3}\b/i.test(text)
    || /\b(2160p|1080p|720p|480p|web[- ]?dl|webrip|bluray|x264|x265|h264|h265|hevc|amzn|nf|ddp|aac)\b/i.test(text)
    || /\bwww\.|(?:\.com|\.net|\.org|\.io)\b/i.test(text);
};

const cleanLibraryTitle = (...candidates) => {
  for (const candidate of candidates) {
    const base = stripReleaseJunk(candidate);
    const cleaned = /[a-z]/i.test(base.replace(/\b(19|20)\d{2}\b/g, ''))
      ? base.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\s+/g, ' ').trim()
      : base;
    if (cleaned && !looksLikeReleaseName(cleaned)) return cleaned;
  }
  return stripReleaseJunk(candidates.find(Boolean) || '') || 'Unknown';
};

const titleCase = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/\b\w/g, (char) => char.toUpperCase())
  .replace(/\bTv\b/g, 'TV');

const getPathSegments = (fullPath = '') => String(fullPath || '')
  .replace(/\\/g, '/')
  .split('/')
  .map((segment) => segment.trim())
  .filter(Boolean)
  .filter((segment) => !/^[a-z]:$/i.test(segment));

const getSeriesTitleFromPath = (item, season, episode) => {
  const fileBase = String(item.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const segments = getPathSegments(item.fullPath);
  const fileSegment = segments[segments.length - 1] || fileBase;
  const parentSegments = segments.slice(0, -1).reverse();
  const markerPatterns = [
    /\bS\d{1,2}\s*E\d{1,3}\b/i,
    /\b\d{1,2}x\d{1,3}\b/i,
    /\bS\d{1,2}\b/i,
    /\bSeason\s*\d{1,2}\b/i,
    /\bSezon\s*\d{1,2}\b/i,
  ];

  const fileMarker = fileBase.search(/\bS\d{1,2}\s*E\d{1,3}\b/i);
  if (fileMarker > 0) {
    const cleaned = stripReleaseJunk(fileBase.slice(0, fileMarker));
    if (cleaned) return cleaned;
  }

  for (const segment of parentSegments) {
    const cleaned = stripReleaseJunk(segment);
    if (!cleaned) continue;
    if (markerPatterns.some((pattern) => pattern.test(segment))) {
      const withoutMarker = stripReleaseJunk(segment.replace(/\b(Season|Sezon)\s*\d{1,2}\b/gi, ' ').replace(/\bS\d{1,2}\b/gi, ' '));
      if (withoutMarker) return withoutMarker;
      continue;
    }
    if (!/^(downloads|cinesoft|movies|tv|series|season|sezon)$/i.test(cleaned)) return cleaned;
  }

  const fallback = stripReleaseJunk(fileSegment
    .replace(new RegExp(`\\bS${String(season).padStart(2, '0')}\\s*E${String(episode).padStart(2, '0')}\\b`, 'i'), ' ')
    .replace(/\b(episode|ep)\s*\d{1,3}\b/gi, ' '));
  return fallback || stripReleaseJunk(item.title || fileBase);
};

const parseLibraryMedia = (item) => {
  const fileBase = String(item.fileName || item.title || '');
  const full = `${item.title || ''} ${item.fileName || ''} ${item.fullPath || ''}`;
  const episodeMatch = full.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) || full.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  const seasonOnlyMatch = full.match(/\b(?:Season|Sezon)\s*(\d{1,2})\b/i) || full.match(/\bS(\d{1,2})\b/i);
  const episodeOnlyMatch = fileBase.match(/\b(?:Episode|Ep|Bolum|Bölüm)\s*(\d{1,3})\b/i) || fileBase.match(/\bE(\d{1,3})\b/i);
  const yearMatch = full.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const season = episodeMatch ? Number(episodeMatch[1]) : Number(seasonOnlyMatch?.[1]);
  const episode = episodeMatch ? Number(episodeMatch[2]) : Number(episodeOnlyMatch?.[1]);

  if (season && episode) {
    const markerIndex = fileBase.search(/\bS\d{1,2}\s*E\d{1,3}\b/i);
    const fallbackIndex = fileBase.search(/\b\d{1,2}x\d{1,3}\b/i);
    const splitIndex = markerIndex >= 0 ? markerIndex : fallbackIndex;
    const rawTitle = splitIndex > 0 ? stripReleaseJunk(fileBase.slice(0, splitIndex)) : '';
    const query = rawTitle || getSeriesTitleFromPath(item, season, episode);
    return {
      mediaType: 'tv',
      query,
      displayTitle: query || titleCase(stripReleaseJunk(item.title || fileBase)) || 'Unknown Series',
      season,
      episode,
      year,
    };
  }

  const query = stripReleaseJunk(fileBase);
  const isNumericTitle = /^\d{4}$/.test(String(query || '').trim());
  return {
    mediaType: 'movie',
    query,
    displayTitle: query || titleCase(stripReleaseJunk(item.title || fileBase)) || 'Unknown Movie',
    season: null,
    episode: null,
    year: isNumericTitle ? null : year,
  };
};

const buildTorrentLibraryItem = (torrent, videoFile = null) => {
  const mediaInfo = torrent.mediaInfo || {};
  const relPath = String(videoFile?.path || torrent.videoFile?.path || '');
  const fullPath = torrent.savePath && relPath
    ? `${String(torrent.savePath).replace(/[\\/]$/, '')}\\${relPath}`.replace(/\//g, '\\')
    : '';
  const fallback = {
    title: mediaInfo.title || torrent.title || torrent.name || relPath,
    fileName: relPath || torrent.name || torrent.title || '',
    fullPath,
  };
  const parsed = parseLibraryMedia(fallback);
  const season = Number(parsed.season || mediaInfo.season) || null;
  const episode = Number(parsed.episode || mediaInfo.episode) || null;
  if (!season || !episode) return null;
  const cleanTitle = cleanLibraryTitle(parsed.query, mediaInfo.title, parsed.displayTitle, torrent.title, torrent.name);
  return {
    id: `torrent:${torrent.id}:${videoFile?.index ?? 'main'}`,
    title: fallback.title,
    fileName: fallback.fileName,
    fullPath,
    fileHash: '',
    size: Number(videoFile?.size || torrent.totalSize || 0),
    mtimeMs: Number(torrent.addedAt || 0),
    mediaType: 'tv',
    query: parsed.query || cleanTitle,
    displayTitle: parsed.displayTitle,
    cleanTitle,
    season,
    episode,
    poster: mediaInfo.poster || '',
    tmdbId: Number(mediaInfo.tmdbId) || null,
    tmdbType: mediaInfo.type || 'tv',
    torrentId: torrent.id,
    downloading: videoFile ? !videoFile.done : !torrent.done,
    progress: Math.max(0, Math.min(100, Number(videoFile?.progress ?? torrent.progress ?? 0))),
  };
};

const buildTorrentLibraryItems = (torrent) => {
  const selectedVideos = Array.isArray(torrent.selectedVideoFiles) ? torrent.selectedVideoFiles : [];
  if (selectedVideos.length) {
    return selectedVideos.map((file) => buildTorrentLibraryItem(torrent, file)).filter(Boolean);
  }
  const item = buildTorrentLibraryItem(torrent);
  return item ? [item] : [];
};

const normalizeTitleKey = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const tokenizeTitle = (value = '') => normalizeSearchQuery(value).toLowerCase().split(/\s+/).filter(Boolean);

const isLikelyTitleMismatch = (queryValue = '', titleValue = '') => {
  const queryTokens = tokenizeTitle(queryValue);
  const titleTokens = tokenizeTitle(titleValue);
  if (!queryTokens.length || !titleTokens.length) return false;
  const queryKey = queryTokens.join('');
  const titleKey = titleTokens.join('');
  if (queryKey === titleKey) return false;

  if (queryTokens.length === 1) {
    const query = queryTokens[0];
    const isArticlePrefix = titleTokens.length === 2 && ['the', 'a', 'an'].includes(titleTokens[0]) && titleTokens[1] === query;
    return !isArticlePrefix;
  }

  const titleSet = new Set(titleTokens);
  const overlap = queryTokens.filter((token) => titleSet.has(token)).length;
  const overlapRatio = overlap / queryTokens.length;
  return overlapRatio < 0.6;
};

const scoreTmdbResult = (result, parsed) => {
  const dateRaw = result.release_date || result.first_air_date || '';
  const resultYear = Number(String(dateRaw).slice(0, 4)) || 0;
  const numericTitle = /^\d{4}$/.test(String(parsed?.query || '').trim());
  const yearPenalty = numericTitle
    ? 1
    : (parsed.year && resultYear ? Math.abs(resultYear - parsed.year) : 1);
  const typePenalty = result.media_type === parsed.mediaType ? 0 : 4;
  const posterPenalty = result.poster_path ? 0 : 2;
  const resultTitle = normalizeSearchQuery(result?.title || result?.name || '');
  const queryRaw = normalizeSearchQuery(parsed?.query || parsed?.cleanTitle || '');
  const resultKey = normalizeTitleKey(resultTitle);
  const queryKey = normalizeTitleKey(queryRaw);
  const exactTitleBonus = queryKey && resultKey === queryKey ? -40 : 0;
  const prefixBonus = !exactTitleBonus && queryKey && resultKey.startsWith(queryKey) ? -10 : 0;
  const numericMismatchPenalty = numericTitle && resultTitle && resultTitle !== queryRaw ? 35 : 0;
  const mismatchPenalty = isLikelyTitleMismatch(queryRaw, resultTitle) ? 45 : 0;
  return yearPenalty + typePenalty + posterPenalty + numericMismatchPenalty + mismatchPenalty + exactTitleBonus + prefixBonus;
};

const pickBestResult = (results, parsed) => {
  const usable = (results || []).filter((result) => {
    if (parsed.mediaType === 'tv') return result.media_type === 'tv' || !result.media_type;
    return result.media_type === 'movie' || !result.media_type;
  });
  if (!usable.length) return null;
  const ranked = usable
    .map((item) => ({ item, score: scoreTmdbResult(item, parsed) }))
    .sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (!best) return null;
  if (best.score >= 28) return null;
  return best.item;
};

const buildSubtitleDebugText = (debug, isTr) => {
  if (!debug || typeof debug !== 'object') return '';
  const lines = [];
  const errors = Array.isArray(debug.errors) ? debug.errors : [];
  const tried = Array.isArray(debug.tried) ? debug.tried : [];
  if (errors.length > 0) {
    lines.push(isTr ? 'Donen hatalar:' : 'Returned errors:');
    errors.slice(0, 5).forEach((entry) => {
      const url = String(entry?.url || '').trim();
      const err = String(entry?.error || '').trim();
      const cause = String(entry?.cause || '').trim();
      const code = String(entry?.code || '').trim();
      const address = String(entry?.address || '').trim();
      const port = Number(entry?.port || 0) || 0;
      const detail = [
        err || 'request failed',
        cause ? `cause=${cause}` : '',
        code ? `code=${code}` : '',
        address ? `addr=${address}${port ? `:${port}` : ''}` : '',
      ].filter(Boolean).join(' | ');
      lines.push(`- ${detail}${url ? ` | ${url}` : ''}`);
    });
  }
  if (tried.length > 0) {
    lines.push('');
    lines.push(isTr ? 'Denenen endpointler:' : 'Tried endpoints:');
    tried.slice(0, 8).forEach((url) => lines.push(`- ${url}`));
  }
  if (!lines.length && debug.message) {
    lines.push(String(debug.message));
  }
  return lines.join('\n').trim();
};

const normalizeSubtitleLang = (value = '') => String(value || '').trim().toUpperCase();

const formatSubtitleLang = (value = '', isTr = false) => {
  const code = normalizeSubtitleLang(value);
  const labels = {
    TR: 'Turkish',
    TUR: 'Turkish',
    EN: 'English',
    ENG: 'English',
    PER: 'Persian',
    FAS: 'Persian',
    POB: 'Portuguese (BR)',
    POR: 'Portuguese',
    POL: 'Polish',
    RON: 'Romanian',
    RUS: 'Russian',
    SPA: 'Spanish',
    SWE: 'Swedish',
    THA: 'Thai',
    LIT: 'Lithuanian',
    MAY: 'Malay',
    NLD: 'Dutch',
    NOR: 'Norwegian',
    NEP: 'Nepali',
    SLV: 'Slovenian',
    SRP: 'Serbian',
    ZHT: 'Chinese (Traditional)',
    VIE: 'Vietnamese',
    SIN: 'Sinhala',
    CZE: 'Czech',
    CES: 'Czech',
    DAN: 'Danish',
    FIN: 'Finnish',
    FRE: 'French',
    FRA: 'French',
    GER: 'German',
    DEU: 'German',
    GRE: 'Greek',
    ELL: 'Greek',
    HUN: 'Hungarian',
    ITA: 'Italian',
    JPN: 'Japanese',
    KOR: 'Korean',
    ARA: 'Arabic',
    HEB: 'Hebrew',
    HIN: 'Hindi',
    IND: 'Indonesian',
    UKR: 'Ukrainian',
    BUL: 'Bulgarian',
    HRV: 'Croatian',
    EST: 'Estonian',
    LAV: 'Latvian',
    SLO: 'Slovak',
    SLK: 'Slovak',
    ALB: 'Albanian',
  };
  return labels[code] || code || 'Subtitle';
};

const getPreferredSubtitleLang = (appLanguage = '') => {
  return String(appLanguage || '').toLowerCase() === 'tr' ? 'TUR' : 'ENG';
};

const SUBTITLE_PROVIDER_OPTIONS = [
  { key: 'opensubtitles-v3', label: 'OpenSubtitles' },
  { key: 'turkcealtyaziorg-stremio-addon', label: 'turkcealtyazi.org' },
];

const normalizeSubtitleProvider = (value = '') => (
  String(value || '').trim().toLowerCase() === 'turkcealtyaziorg-stremio-addon'
    ? 'turkcealtyaziorg-stremio-addon'
    : 'opensubtitles-v3'
);

const LibraryView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [rootDir, setRootDir] = useState('');
  const [selectedSeriesKey, setSelectedSeriesKey] = useState('');
  const [libraryCategory, setLibraryCategory] = useState('all');
  const [movieSubtitleTarget, setMovieSubtitleTarget] = useState(null);
  const [movieSubtitleList, setMovieSubtitleList] = useState([]);
  const [movieSubtitleLoading, setMovieSubtitleLoading] = useState(false);
  const [movieSubtitleSavingId, setMovieSubtitleSavingId] = useState('');
  const [movieSubtitleError, setMovieSubtitleError] = useState('');
  const [movieSubtitleSuccess, setMovieSubtitleSuccess] = useState('');
  const [movieSubtitleLangFilter, setMovieSubtitleLangFilter] = useState('ALL');
  const [movieSubtitleProvider, setMovieSubtitleProvider] = useState('opensubtitles-v3');
  const [movieSubtitleProviderOffline, setMovieSubtitleProviderOffline] = useState(false);
  const [seriesDetails, setSeriesDetails] = useState(null);
  const [seasonDetails, setSeasonDetails] = useState({});
  const metadataPending = useRef(new Set());
  const metadataRetryUntil = useRef(new Map());
  const tmdbSearchCache = useRef(new Map());
  const tmdbDetailsCache = useRef(new Map());

  const isTr = settings.language === 'tr';

  const load = useCallback(async () => {
    const [scanResult, torrentResult] = await Promise.all([
      window.electronAPI?.scanLibrary?.(),
      window.electronAPI?.torrentGetAll?.(),
    ]);
    if (!scanResult?.ok) return;

    const scanned = Array.isArray(scanResult.items) ? scanResult.items : [];
    const torrents = Array.isArray(torrentResult?.torrents) ? torrentResult.torrents : [];
    const torrentMeta = new Map();
    const torrentByPath = new Map();
    const torrentFileByPath = new Map();
    torrents.forEach((torrent) => {
      const savePath = String(torrent.savePath || '');
      const videoFiles = Array.isArray(torrent.selectedVideoFiles) && torrent.selectedVideoFiles.length
        ? torrent.selectedVideoFiles
        : [torrent.videoFile].filter(Boolean);
      videoFiles.forEach((videoFile) => {
        const relPath = String(videoFile?.path || '');
        if (!savePath || !relPath) return;
        const fullPath = normalizePathKey(`${savePath}\\${relPath}`);
        torrentMeta.set(fullPath, torrent.mediaInfo || {});
        torrentByPath.set(fullPath, torrent);
        torrentFileByPath.set(fullPath, videoFile);
      });
    });

    const activeTorrentItems = torrents
      .filter((torrent) => !torrent.pendingSelection)
      .flatMap(buildTorrentLibraryItems);
    const scannedKeys = new Set(scanned.map((item) => normalizePathKey(item.fullPath)));
    const virtualItems = activeTorrentItems.filter((item) => !item.fullPath || !scannedKeys.has(normalizePathKey(item.fullPath)));
    const allRawItems = [...scanned, ...virtualItems];

    const cached = await window.electronAPI?.getLibraryMetadata?.(scanned.map((item) => item.fullPath));
    const cacheMap = new Map((cached?.items || []).map((row) => [normalizePathKey(row.filePath), row]));

    setItems((current) => {
      const currentMap = new Map(current.map((entry) => [String(entry.id), entry]));
      return allRawItems.map((item) => {
        if (item.id && String(item.id).startsWith('torrent:')) {
          return item;
        }
        const key = normalizePathKey(item.fullPath);
        const parsed = parseLibraryMedia(item);
        const cache = cacheMap.get(key);
        const mediaInfo = torrentMeta.get(key) || {};
        const torrent = torrentByPath.get(key);
        const torrentFile = torrentFileByPath.get(key);
        const currentItem = currentMap.get(String(item.id)) || {};
        const numericTitleQuery = /^\d{4}$/.test(String(parsed.query || '').trim());
        const cacheTitleMismatch = numericTitleQuery
          && cache?.title
          && normalizeTitleKey(cache.title) !== normalizeTitleKey(parsed.query);
        const safeCacheTmdbId = cacheTitleMismatch ? null : cache?.tmdbId;
        const safeCachePoster = cacheTitleMismatch ? '' : cache?.posterUrl;
        const tmdbId = Number(safeCacheTmdbId || mediaInfo.tmdbId || currentItem.tmdbId) || null;
        const poster = mediaInfo.poster || safeCachePoster || currentItem.poster || '';
        const torrentSeason = Number(parsed.season || mediaInfo.season) || parsed.season;
        const torrentEpisode = Number(parsed.episode || mediaInfo.episode) || parsed.episode;
        const cleanTitle = parsed.mediaType === 'tv'
          ? cleanLibraryTitle(tmdbId && cache?.title, currentItem.cleanTitle, parsed.query, parsed.displayTitle, mediaInfo.title, item.title)
          : cleanLibraryTitle(tmdbId && cache?.title, currentItem.cleanTitle, mediaInfo.title, parsed.displayTitle, item.title, item.fileName);
        return {
          ...item,
          ...parsed,
          season: torrentSeason,
          episode: torrentEpisode,
          cleanTitle,
          poster,
          tmdbId,
          tmdbType: cache?.mediaType || mediaInfo.type || parsed.mediaType,
          torrentId: torrent?.id || currentItem.torrentId || null,
          downloading: torrentFile ? !torrentFile.done : torrent ? !torrent.done : Boolean(currentItem.downloading),
          progress: torrentFile
            ? Math.max(0, Math.min(100, Number(torrentFile.progress || 0)))
            : torrent ? Math.max(0, Math.min(100, Number(torrent.progress || 0))) : Number(currentItem.progress || 0),
        };
      });
    });
    setRootDir(scanResult.rootDir || '');
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const fillMetadata = async () => {
      if (!settings?.apiKey || !items.length) return;
      const cacheNow = Date.now();
      const getCachedSearch = async (apiKey, language, mediaType, query, page = 1) => {
        const key = `${String(language || 'en').toLowerCase()}|${mediaType}|${String(query || '').toLowerCase()}|${page}`;
        const hit = tmdbSearchCache.current.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.data;
        const data = await searchContent(apiKey, language, query, page);
        const ttl = Array.isArray(data) && data.length ? 12 * 60 * 60 * 1000 : 10 * 60 * 1000;
        tmdbSearchCache.current.set(key, { data, expiresAt: Date.now() + ttl });
        return data;
      };
      const getCachedDetails = async (apiKey, language, tmdbType, tmdbId) => {
        const key = `${String(language || 'en').toLowerCase()}|${tmdbType}|${tmdbId}`;
        const hit = tmdbDetailsCache.current.get(key);
        if (hit && hit.expiresAt > Date.now()) return hit.data;
        const data = await fetchDetails(apiKey, language, tmdbType, tmdbId);
        const ttl = data ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000;
        tmdbDetailsCache.current.set(key, { data, expiresAt: Date.now() + ttl });
        return data;
      };
      // Keep cache size bounded.
      if (tmdbSearchCache.current.size > 800) {
        tmdbSearchCache.current.clear();
      }
      if (tmdbDetailsCache.current.size > 800) {
        tmdbDetailsCache.current.clear();
      }
      const missing = items
        .filter((item) => !item.poster || !item.tmdbId)
        .filter((item) => item.query && !metadataPending.current.has(item.id))
        .filter((item) => (metadataRetryUntil.current.get(item.id) || 0) <= cacheNow)
        .slice(0, 12);
      if (!missing.length) return;

      missing.forEach((item) => metadataPending.current.add(item.id));
      const updates = await Promise.all(missing.map(async (item) => {
        try {
          const queries = buildMetadataQueries(item);
          if (!queries.length) return { id: item.id, poster: '', tmdbId: null };
          const preferredLanguage = String(settings.language || 'en').toLowerCase();
          const languages = preferredLanguage === 'en' ? ['en'] : [preferredLanguage, 'en'];
          for (const language of languages) {
            for (const query of queries) {
              for (const page of [1, 2]) {
                const results = await getCachedSearch(settings.apiKey, language, item.mediaType, query, page);
                const picked = pickBestResult(results, item);
                if (!picked) continue;
                const tmdbType = picked.media_type === 'tv' || picked.media_type === 'movie'
                  ? picked.media_type
                  : item.mediaType;
                const details = await getCachedDetails(settings.apiKey, language, tmdbType, picked.id);
                const poster = imageUrl(details?.poster_path || picked.poster_path);
                if (!poster && !picked.id) continue;
                metadataRetryUntil.current.delete(item.id);
                return {
                  id: item.id,
                  title: details?.name || details?.title || picked.name || picked.title || item.cleanTitle,
                  poster,
                  tmdbId: picked.id,
                  tmdbType,
                  year: Number(String(details?.first_air_date || details?.release_date || '').slice(0, 4)) || item.year || null,
                };
              }
            }
          }
        } finally {
          metadataPending.current.delete(item.id);
        }
        metadataRetryUntil.current.set(item.id, Date.now() + 20 * 1000);
        return { id: item.id, poster: '', tmdbId: null };
      }));

      setItems((current) => current.map((item) => {
        const update = updates.find((entry) => entry.id === item.id);
        if (!update?.poster && !update?.tmdbId) return item;
        if (item.fullPath) {
          window.electronAPI?.upsertLibraryMetadata?.({
            filePath: item.fullPath,
            fileHash: item.fileHash || '',
            title: update.title || item.cleanTitle,
            year: update.year || item.year || null,
            posterUrl: update.poster || item.poster || '',
            tmdbId: update.tmdbId || null,
            mediaType: update.tmdbType || item.mediaType,
          });
        }
        return {
          ...item,
          cleanTitle: update.title || item.cleanTitle,
          poster: update.poster || item.poster,
          tmdbId: update.tmdbId || item.tmdbId,
          tmdbType: update.tmdbType || item.tmdbType,
        };
      }));
    };
    fillMetadata();
  }, [items, settings?.apiKey, settings?.language]);

  const libraryCards = useMemo(() => {
    const seriesMap = new Map();
    const movies = [];
    items.forEach((item) => {
      if (item.mediaType === 'tv') {
        const key = item.tmdbId ? `tmdb:${item.tmdbId}` : `title:${item.query.toLowerCase()}`;
        const itemTitle = cleanLibraryTitle(item.cleanTitle, item.query, item.displayTitle);
        const existing = seriesMap.get(key) || {
          key,
          type: 'tv',
          title: itemTitle,
          poster: item.poster,
          tmdbId: item.tmdbId,
          episodes: [],
        };
        if (!existing.title || looksLikeReleaseName(existing.title)) existing.title = itemTitle;
        existing.poster = existing.poster || item.poster;
        existing.tmdbId = existing.tmdbId || item.tmdbId;
        existing.downloading = existing.downloading || item.downloading;
        existing.episodes.push(item);
        seriesMap.set(key, existing);
        return;
      }
      movies.push({ key: item.id, type: 'movie', item: { ...item, cleanTitle: cleanLibraryTitle(item.cleanTitle, item.displayTitle, item.fileName) } });
    });
    return [...Array.from(seriesMap.values()), ...movies];
  }, [items]);

  const selectedSeries = libraryCards.find((card) => card.key === selectedSeriesKey && card.type === 'tv');

  const visibleLibraryCards = useMemo(() => {
    if (libraryCategory === 'all') return libraryCards;
    if (libraryCategory === 'movie') {
      return libraryCards.filter((card) => card.type === 'movie');
    }
    if (libraryCategory === 'anime') {
      return libraryCards.filter((card) => {
        if (card.type !== 'tv') return false;
        const title = String(card.title || '').toLowerCase();
        return title.includes('anime');
      });
    }
    if (libraryCategory === 'tv') {
      return libraryCards.filter((card) => {
        if (card.type !== 'tv') return false;
        const title = String(card.title || '').toLowerCase();
        return !title.includes('anime');
      });
    }
    return libraryCards;
  }, [libraryCards, libraryCategory]);

  useEffect(() => {
    const loadSeries = async () => {
      if (!settings?.apiKey || !selectedSeries?.tmdbId) {
        setSeriesDetails(null);
        setSeasonDetails({});
        return;
      }
      const details = await fetchDetails(settings.apiKey, settings.language || 'en', 'tv', selectedSeries.tmdbId);
      setSeriesDetails(details);
      const tmdbSeasons = (details?.seasons || [])
        .map((season) => Number(season.season_number))
        .filter((season) => Number.isFinite(season) && season > 0);
      const downloadedSeasons = (selectedSeries.episodes || [])
        .map((item) => Number(item.season))
        .filter((season) => Number.isFinite(season) && season > 0);
      const seasons = Array.from(new Set([...tmdbSeasons, ...downloadedSeasons])).sort((a, b) => a - b);
      const loaded = {};
      await Promise.all(seasons.map(async (season) => {
        const data = await fetchSeasonDetails(settings.apiKey, settings.language || 'en', selectedSeries.tmdbId, season);
        if (data) loaded[season] = data;
      }));
      setSeasonDetails(loaded);
    };
    loadSeries();
  }, [selectedSeriesKey, selectedSeries?.tmdbId, selectedSeries?.episodes, settings?.apiKey, settings?.language]);

  const openVideo = async (item) => {
    await window.electronAPI?.openLibraryVideo?.({ fullPath: item.fullPath });
  };

  const openFolder = async (item) => {
    await window.electronAPI?.openLibraryFolder?.({ fullPath: item.fullPath });
  };

  const openMovieSubtitleModal = async (item) => {
    if (!item?.fullPath || !window.electronAPI?.searchLibrarySubtitles) return;
    setMovieSubtitleTarget(item);
    setMovieSubtitleList([]);
    setMovieSubtitleError('');
    setMovieSubtitleSuccess('');
    setMovieSubtitleProviderOffline(false);
    setMovieSubtitleSavingId('');
    setMovieSubtitleLangFilter('ALL');
    setMovieSubtitleLoading(true);
    try {
      const result = await window.electronAPI.searchLibrarySubtitles({
        fullPath: item.fullPath,
        tmdbType: item.tmdbType || 'movie',
        tmdbId: item.tmdbId || null,
        subtitleProvider: normalizeSubtitleProvider(movieSubtitleProvider),
      });
      if (!result?.ok) {
        throw new Error(result?.error || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
      }
      const subtitles = Array.isArray(result.subtitles) ? result.subtitles : [];
      setMovieSubtitleList(subtitles);
      setMovieSubtitleProviderOffline(Boolean(result?.debug?.providerOffline));
      const preferred = getPreferredSubtitleLang(settings?.language);
      const hasPreferred = subtitles.some((sub) => normalizeSubtitleLang(sub?.lang) === preferred);
      setMovieSubtitleLangFilter(hasPreferred ? preferred : 'ALL');
      if (!subtitles.length) {
        setMovieSubtitleError(isTr ? 'Altyazi bulunamadi' : 'No subtitles found');
      }
    } catch (err) {
      setMovieSubtitleError(err.message || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
    } finally {
      setMovieSubtitleLoading(false);
    }
  };

  const closeMovieSubtitleModal = () => {
    setMovieSubtitleTarget(null);
    setMovieSubtitleList([]);
    setMovieSubtitleError('');
    setMovieSubtitleSuccess('');
    setMovieSubtitleSavingId('');
    setMovieSubtitleLangFilter('ALL');
    setMovieSubtitleProvider('opensubtitles-v3');
    setMovieSubtitleProviderOffline(false);
    setMovieSubtitleLoading(false);
  };

  const handleMovieSubtitleDownload = async (subtitle) => {
    if (!movieSubtitleTarget?.fullPath || !subtitle?.url || !window.electronAPI?.downloadLibrarySubtitle) return;
    setMovieSubtitleSavingId(subtitle.id || subtitle.url);
    setMovieSubtitleError('');
    setMovieSubtitleSuccess('');
    try {
      const result = await window.electronAPI.downloadLibrarySubtitle({
        fullPath: movieSubtitleTarget.fullPath,
        subtitleUrl: subtitle.url,
        subtitleProvider: subtitle.provider || '',
      });
      if (!result?.ok) throw new Error(result?.error || (isTr ? 'Altyazi indirilemedi' : 'Subtitle download failed'));
      setMovieSubtitleSuccess(isTr ? 'Altyazi indirildi' : 'Subtitle downloaded');
    } catch (err) {
      setMovieSubtitleError(err.message || (isTr ? 'Altyazi indirilemedi' : 'Subtitle download failed'));
    } finally {
      setMovieSubtitleSavingId('');
    }
  };

  if (selectedSeries) {
    return (
      <SeriesLibraryView
        isTr={isTr}
        series={selectedSeries}
        settings={settings}
        details={seriesDetails}
        seasonDetails={seasonDetails}
        onBack={() => setSelectedSeriesKey('')}
        onOpenVideo={openVideo}
        onOpenFolder={openFolder}
      />
    );
  }

  return (
    <div className="library-view">
      <header className="library-header">
        <h1>{isTr ? 'Kutuphanem' : 'Library'}</h1>
        <p>{isTr ? 'Secili indirme dizini taranarak video dosyalari listelenir.' : 'Video files are listed by scanning the selected download directory.'}</p>
        {!!rootDir && <span className="library-root">{rootDir}</span>}
        <div className="library-filters" role="tablist" aria-label="Library filters">
          <button
            className={`library-filter-btn ${libraryCategory === 'all' ? 'active' : ''}`}
            onClick={() => setLibraryCategory('all')}
          >
            {isTr ? 'Hepsi' : 'All'}
          </button>
          <button
            className={`library-filter-btn ${libraryCategory === 'movie' ? 'active' : ''}`}
            onClick={() => setLibraryCategory('movie')}
          >
            {isTr ? 'Film' : 'Movies'}
          </button>
          <button
            className={`library-filter-btn ${libraryCategory === 'tv' ? 'active' : ''}`}
            onClick={() => setLibraryCategory('tv')}
          >
            {isTr ? 'Dizi' : 'TV Shows'}
          </button>
          <button
            className={`library-filter-btn ${libraryCategory === 'anime' ? 'active' : ''}`}
            onClick={() => setLibraryCategory('anime')}
          >
            Anime
          </button>
        </div>
      </header>

      {!visibleLibraryCards.length && (
        <div className="library-empty">
          <Library size={56} />
          <strong>{isTr ? 'Henuz kutuphane icerigi yok' : 'No library items yet'}</strong>
        </div>
      )}

      <div className="library-grid">
        {visibleLibraryCards.map((card) => {
          const item = card.type === 'movie' ? card.item : card;
          const title = cleanLibraryTitle(card.type === 'movie' ? item.cleanTitle : card.title, item.query, item.displayTitle);
          const subtitle = card.type === 'movie'
            ? (item.year ? String(item.year) : (isTr ? 'Film' : 'Movie'))
            : `${card.episodes.length} ${isTr ? 'bolum indi' : 'episodes downloaded'}`;
          return (
            <div
              key={card.key}
              className="library-card"
              onClick={() => (card.type === 'tv' ? setSelectedSeriesKey(card.key) : openVideo(item))}
            >
              <div className="library-poster">
                {item.poster ? (
                  <img src={item.poster} alt={title} />
                ) : (
                  <div className="library-poster-fallback">{card.type === 'tv' ? <Tv size={24} /> : <Film size={24} />}</div>
                )}
                <div className="library-play-overlay"><PlayCircle size={34} /></div>
                {card.type === 'movie' && (
                  <div className="library-card-actions">
                    <button
                      className="library-card-folder-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        openFolder(item);
                      }}
                    >
                      <FolderOpen size={14} />
                    </button>
                    <button
                      className="library-card-subtitle-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        openMovieSubtitleModal(item);
                      }}
                    >
                      <Captions size={14} />
                      {isTr ? 'Altyazi' : 'Subtitle'}
                    </button>
                  </div>
                )}
              </div>
              <div className="library-meta">
                <div className="marquee"><strong>{title}</strong></div>
                <span>{subtitle}</span>
              </div>
            </div>
          );
        })}
      </div>

      {movieSubtitleTarget && (
        <div
          className="library-subtitle-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMovieSubtitleModal();
          }}
        >
          <div className="library-subtitle-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="library-subtitle-header">
              <div>
                <strong>{movieSubtitleTarget.cleanTitle || movieSubtitleTarget.displayTitle || movieSubtitleTarget.title || 'Movie'}</strong>
                <span>{movieSubtitleTarget.year ? String(movieSubtitleTarget.year) : (isTr ? 'Film' : 'Movie')}</span>
              </div>
              <button className="library-source-close" onClick={closeMovieSubtitleModal} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="library-subtitle-body">
              {movieSubtitleLoading && <p>{isTr ? 'Altyazilar yukleniyor...' : 'Loading subtitles...'}</p>}
              {!movieSubtitleLoading && movieSubtitleError && <p className="library-subtitle-error">{movieSubtitleError}</p>}
              {!movieSubtitleLoading && movieSubtitleSuccess && <p className="library-subtitle-success">{movieSubtitleSuccess}</p>}
              {!movieSubtitleLoading && (
                <>
                <div className="library-subtitle-toolbar">
                  <label htmlFor="movie-subtitle-provider-filter">{isTr ? 'Saglayici' : 'Provider'}</label>
                  <select
                    id="movie-subtitle-provider-filter"
                    className="library-subtitle-select"
                    value={movieSubtitleProvider}
                    onChange={async (event) => {
                      const nextProvider = normalizeSubtitleProvider(event.target.value);
                      setMovieSubtitleProvider(nextProvider);
                      if (!movieSubtitleTarget) return;
                      setMovieSubtitleError('');
                      setMovieSubtitleSuccess('');
                      setMovieSubtitleProviderOffline(false);
                      setMovieSubtitleLoading(true);
                      try {
                        const result = await window.electronAPI.searchLibrarySubtitles({
                          fullPath: movieSubtitleTarget.fullPath,
                          tmdbType: movieSubtitleTarget.tmdbType || 'movie',
                          tmdbId: movieSubtitleTarget.tmdbId || null,
                          subtitleProvider: nextProvider,
                        });
                        if (!result?.ok) throw new Error(result?.error || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
                        const subtitles = Array.isArray(result.subtitles) ? result.subtitles : [];
                        setMovieSubtitleList(subtitles);
                        setMovieSubtitleProviderOffline(Boolean(result?.debug?.providerOffline));
                        const preferred = getPreferredSubtitleLang(settings?.language);
                        const hasPreferred = subtitles.some((sub) => normalizeSubtitleLang(sub?.lang) === preferred);
                        setMovieSubtitleLangFilter(hasPreferred ? preferred : 'ALL');
                        if (!subtitles.length) setMovieSubtitleError(isTr ? 'Altyazi bulunamadi' : 'No subtitles found');
                      } catch (err) {
                        setMovieSubtitleError(err.message || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
                      } finally {
                        setMovieSubtitleLoading(false);
                      }
                    }}
                  >
                    {SUBTITLE_PROVIDER_OPTIONS.map((provider) => (
                      <option key={provider.key} value={provider.key}>{provider.label}</option>
                    ))}
                  </select>
                  {movieSubtitleProvider === 'turkcealtyaziorg-stremio-addon' && movieSubtitleProviderOffline && (
                    <span className="library-subtitle-provider-offline">Offline</span>
                  )}
                  <label htmlFor="movie-subtitle-lang-filter">{isTr ? 'Dil' : 'Language'}</label>
                  <select
                    id="movie-subtitle-lang-filter"
                    className="library-subtitle-select"
                    value={movieSubtitleLangFilter}
                    onChange={(event) => setMovieSubtitleLangFilter(event.target.value)}
                  >
                    <option value="ALL">{isTr ? 'Tum diller' : 'All languages'}</option>
                    {Array.from(new Set(movieSubtitleList.map((item) => normalizeSubtitleLang(item?.lang)).filter(Boolean)))
                      .sort((a, b) => a.localeCompare(b))
                      .map((langCode) => (
                        <option key={langCode} value={langCode}>
                          {formatSubtitleLang(langCode, isTr)} ({langCode})
                        </option>
                      ))}
                  </select>
                </div>
                {movieSubtitleList.length > 0 && (
                  <div className="library-subtitle-list">
                    {movieSubtitleList
                      .filter((item) => movieSubtitleLangFilter === 'ALL' || normalizeSubtitleLang(item?.lang) === movieSubtitleLangFilter)
                      .map((subtitle, index) => (
                        <div className="library-subtitle-row" key={`${subtitle.id || 'sub'}-${index}`}>
                          <div className="library-subtitle-meta">
                            <strong>{formatSubtitleLang(subtitle.lang, isTr)} ({normalizeSubtitleLang(subtitle.lang) || 'SUB'})</strong>
                          </div>
                          <button
                            className="episode-download-btn"
                            disabled={movieSubtitleSavingId === (subtitle.id || subtitle.url)}
                            onClick={() => handleMovieSubtitleDownload(subtitle)}
                          >
                            <Download size={14} />
                            {movieSubtitleSavingId === (subtitle.id || subtitle.url)
                              ? (isTr ? 'Indiriliyor' : 'Downloading')
                              : (isTr ? 'Indir' : 'Download')}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SeriesLibraryView = ({ isTr, series, settings, details, seasonDetails, onBack, onOpenVideo, onOpenFolder }) => {
  const [searchTarget, setSearchTarget] = useState(null);
  const [subtitleTarget, setSubtitleTarget] = useState(null);
  const [subtitleList, setSubtitleList] = useState([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleSavingId, setSubtitleSavingId] = useState('');
  const [subtitleError, setSubtitleError] = useState('');
  const [subtitleSuccess, setSubtitleSuccess] = useState('');
  const [subtitleDebug, setSubtitleDebug] = useState('');
  const [subtitleLangFilter, setSubtitleLangFilter] = useState('ALL');
  const [subtitleProvider, setSubtitleProvider] = useState('opensubtitles-v3');
  const [subtitleProviderOffline, setSubtitleProviderOffline] = useState(false);
  const downloaded = new Map();
  series.episodes.forEach((item) => {
    downloaded.set(`${item.season}:${item.episode}`, item);
  });
  const fallbackSeasons = Array.from(new Set(series.episodes.map((item) => item.season))).sort((a, b) => a - b);
  const seasons = (details?.seasons || [])
    .filter((season) => season.season_number > 0 && (fallbackSeasons.includes(season.season_number) || season.episode_count))
    .sort((a, b) => a.season_number - b.season_number);
  const seasonList = seasons.length ? seasons : fallbackSeasons.map((season) => ({ season_number: season, name: `Season ${season}` }));
  const poster = imageUrl(details?.poster_path) || series.poster;
  const searchItem = searchTarget ? {
    id: details?.id || series.tmdbId,
    title: details?.name || series.title,
    name: details?.name || series.title,
    original_name: details?.original_name || details?.name || series.title,
    poster_path: details?.poster_path || '',
    backdrop_path: details?.backdrop_path || '',
    first_air_date: details?.first_air_date || '',
    seasons: details?.seasons || seasonList,
    external_ids: details?.external_ids || {},
  } : null;

  const openSubtitleModal = async (local, seasonNumber, episodeNumber, episodeName) => {
    if (!local?.fullPath || !window.electronAPI?.searchLibrarySubtitles) return;
    setSubtitleTarget({
      local,
      season: seasonNumber,
      episode: episodeNumber,
      name: episodeName,
    });
    setSubtitleList([]);
    setSubtitleError('');
    setSubtitleSuccess('');
    setSubtitleDebug('');
    setSubtitleProviderOffline(false);
    setSubtitleLangFilter('ALL');
    setSubtitleSavingId('');
    setSubtitleLoading(true);
    try {
      const result = await window.electronAPI.searchLibrarySubtitles({
        fullPath: local.fullPath,
        tmdbType: local.tmdbType || 'tv',
        tmdbId: local.tmdbId || series.tmdbId || details?.id || null,
        imdbId: details?.external_ids?.imdb_id || '',
        season: seasonNumber,
        episode: episodeNumber,
        subtitleProvider: normalizeSubtitleProvider(subtitleProvider),
      });
      if (!result?.ok) {
        throw new Error(result?.error || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
      }
      const subtitles = Array.isArray(result.subtitles) ? result.subtitles : [];
      setSubtitleList(subtitles);
      setSubtitleDebug(buildSubtitleDebugText(result.debug, isTr));
      setSubtitleProviderOffline(Boolean(result?.debug?.providerOffline));
      const preferred = getPreferredSubtitleLang(settings?.language);
      const hasPreferred = subtitles.some((item) => normalizeSubtitleLang(item?.lang) === preferred);
      setSubtitleLangFilter(hasPreferred ? preferred : 'ALL');
      if (!subtitles.length) {
        setSubtitleError(isTr ? 'Altyazi bulunamadi' : 'No subtitles found');
      }
    } catch (err) {
      setSubtitleError(err.message || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
    } finally {
      setSubtitleLoading(false);
    }
  };

  const closeSubtitleModal = () => {
    setSubtitleTarget(null);
    setSubtitleList([]);
    setSubtitleError('');
    setSubtitleSuccess('');
    setSubtitleDebug('');
    setSubtitleLangFilter('ALL');
    setSubtitleProvider('opensubtitles-v3');
    setSubtitleProviderOffline(false);
    setSubtitleSavingId('');
    setSubtitleLoading(false);
  };

  const handleSubtitleDownload = async (subtitle) => {
    if (!subtitleTarget?.local?.fullPath || !subtitle?.url || !window.electronAPI?.downloadLibrarySubtitle) return;
    setSubtitleSavingId(subtitle.id || subtitle.url);
    setSubtitleError('');
    setSubtitleSuccess('');
    try {
      const result = await window.electronAPI.downloadLibrarySubtitle({
        fullPath: subtitleTarget.local.fullPath,
        subtitleUrl: subtitle.url,
        subtitleProvider: subtitle.provider || '',
      });
      if (!result?.ok) throw new Error(result?.error || (isTr ? 'Altyazi indirilemedi' : 'Subtitle download failed'));
      setSubtitleSuccess(isTr ? 'Altyazi indirildi' : 'Subtitle downloaded');
    } catch (err) {
      setSubtitleError(err.message || (isTr ? 'Altyazi indirilemedi' : 'Subtitle download failed'));
    } finally {
      setSubtitleSavingId('');
    }
  };

  const subtitleLanguages = useMemo(() => {
    const langs = Array.from(new Set(subtitleList.map((item) => normalizeSubtitleLang(item?.lang)).filter(Boolean)));
    return langs.sort((a, b) => a.localeCompare(b));
  }, [subtitleList]);

  const filteredSubtitleList = useMemo(() => {
    if (subtitleLangFilter === 'ALL') return subtitleList;
    return subtitleList.filter((item) => normalizeSubtitleLang(item?.lang) === subtitleLangFilter);
  }, [subtitleList, subtitleLangFilter]);

  return (
    <div className="library-view">
      <button className="library-back-btn" onClick={onBack}>
        <ArrowLeft size={17} />
        {isTr ? 'Kutuphaneye Don' : 'Back to Library'}
      </button>

      <section className="series-hero">
        <div className="series-poster">
          {poster ? <img src={poster} alt={details?.name || series.title} /> : <div className="library-poster-fallback"><Tv size={28} /></div>}
        </div>
        <div className="series-copy">
          <h1>{details?.name || series.title}</h1>
          <p>{details?.overview || (isTr ? 'Bu dizi icin indirilen bolumler sezonlara yerlestirildi.' : 'Downloaded episodes are mapped into their seasons.')}</p>
          <span>{series.episodes.length} {isTr ? 'bolum indirildi' : 'episodes downloaded'}</span>
        </div>
      </section>

      <div className="series-season-list">
        {seasonList.map((season) => {
          const number = season.season_number;
          const tmdbSeason = seasonDetails[number];
          const tmdbEpisodes = tmdbSeason?.episodes || [];
          const fallbackEpisodes = series.episodes
            .filter((item) => item.season === number)
            .map((item) => ({ episode_number: item.episode, name: item.cleanTitle || item.fileName }));
          const episodes = tmdbEpisodes.length ? tmdbEpisodes : fallbackEpisodes;
          return (
            <section className="series-season" key={number}>
              <div className="series-season-head">
                <h2>{tmdbSeason?.name || season.name || `${isTr ? 'Sezon' : 'Season'} ${number}`}</h2>
              </div>
              <div className="episode-list">
                {episodes.map((episode) => {
                  const local = downloaded.get(`${number}:${episode.episode_number}`);
                  const isDownloading = local?.downloading;
                  return (
                    <div
                      key={`${number}-${episode.episode_number}`}
                      className={`episode-row ${local ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}`}
                    >
                      <span className="episode-code">S{String(number).padStart(2, '0')}E{String(episode.episode_number).padStart(2, '0')}</span>
                      <span className="episode-title">{episode.name || `${isTr ? 'Bolum' : 'Episode'} ${episode.episode_number}`}</span>
                      {isDownloading ? (
                        <span className="episode-downloading">
                          {isTr ? 'Iniyor' : 'Downloading'} <strong>%{Math.round(local.progress || 0)}</strong>
                        </span>
                      ) : local ? (
                        <>
                        <div className="episode-ready-actions">
                          <button className="episode-ready episode-action" onClick={() => onOpenFolder?.(local)}>
                            <FolderOpen size={15} />
                          </button>
                          <button className="episode-ready episode-action" onClick={() => onOpenVideo(local)}>
                            <CheckCircle2 size={15} /> {isTr ? 'Oynat' : 'Play'}
                          </button>
                        </div>
                        <button
                          className="episode-subtitle-btn episode-subtitle-btn-outside"
                          onClick={() => openSubtitleModal(local, number, episode.episode_number, episode.name || `${isTr ? 'Bolum' : 'Episode'} ${episode.episode_number}`)}
                        >
                          {isTr ? 'Altyazi indir' : 'Download subtitle'}
                        </button>
                        </>
                      ) : (
                        <div className="episode-missing-actions">
                          <span className="episode-missing">{isTr ? 'Yok' : 'Missing'}</span>
                          <button
                            className="episode-download-btn"
                            onClick={() => setSearchTarget({
                              season: number,
                              episode: episode.episode_number,
                              name: episode.name || `${isTr ? 'Bolum' : 'Episode'} ${episode.episode_number}`,
                            })}
                          >
                            <Download size={14} />
                            {isTr ? 'Indir' : 'Download'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {searchTarget && searchItem && (
        <div className="library-source-modal" role="dialog" aria-modal="true">
          <div className="library-source-modal-panel">
            <div className="library-source-modal-header">
              <div>
                <strong>{details?.name || series.title}</strong>
                <span>S{String(searchTarget.season).padStart(2, '0')}E{String(searchTarget.episode).padStart(2, '0')} · {searchTarget.name}</span>
              </div>
              <button className="library-source-close" onClick={() => setSearchTarget(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <SourceSearchPanel
              item={searchItem}
              type="tv"
              settings={settings}
              initialSeason={searchTarget.season}
              initialEpisode={searchTarget.episode}
              initialEpisodeName={searchTarget.name}
              autoSearchKey={`${series.key}:${searchTarget.season}:${searchTarget.episode}`}
            />
          </div>
        </div>
      )}

      {subtitleTarget && (
        <div
          className="library-subtitle-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSubtitleModal();
          }}
        >
          <div className="library-subtitle-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="library-subtitle-header">
              <div>
                <strong>{details?.name || series.title}</strong>
                <span>
                  S{String(subtitleTarget.season).padStart(2, '0')}E{String(subtitleTarget.episode).padStart(2, '0')} · {subtitleTarget.name}
                </span>
              </div>
              <button className="library-source-close" onClick={closeSubtitleModal} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="library-subtitle-body">
              {subtitleLoading && <p>{isTr ? 'Altyazilar yukleniyor...' : 'Loading subtitles...'}</p>}
              {!subtitleLoading && subtitleError && <p className="library-subtitle-error">{subtitleError}</p>}
              {!subtitleLoading && subtitleSuccess && <p className="library-subtitle-success">{subtitleSuccess}</p>}
              {!subtitleLoading && (
                <>
                <div className="library-subtitle-toolbar">
                  <label htmlFor="subtitle-provider-filter">{isTr ? 'Saglayici' : 'Provider'}</label>
                  <select
                    id="subtitle-provider-filter"
                    className="library-subtitle-select"
                    value={subtitleProvider}
                    onChange={async (event) => {
                      const nextProvider = normalizeSubtitleProvider(event.target.value);
                      setSubtitleProvider(nextProvider);
                      if (!subtitleTarget?.local?.fullPath) return;
                      setSubtitleError('');
                      setSubtitleSuccess('');
                      setSubtitleProviderOffline(false);
                      setSubtitleLoading(true);
                      try {
                        const result = await window.electronAPI.searchLibrarySubtitles({
                          fullPath: subtitleTarget.local.fullPath,
                          tmdbType: subtitleTarget.local.tmdbType || 'tv',
                          tmdbId: subtitleTarget.local.tmdbId || series.tmdbId || details?.id || null,
                          imdbId: details?.external_ids?.imdb_id || '',
                          season: subtitleTarget.season,
                          episode: subtitleTarget.episode,
                          subtitleProvider: nextProvider,
                        });
                        if (!result?.ok) throw new Error(result?.error || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
                        const subtitles = Array.isArray(result.subtitles) ? result.subtitles : [];
                        setSubtitleList(subtitles);
                        setSubtitleDebug(buildSubtitleDebugText(result.debug, isTr));
                        setSubtitleProviderOffline(Boolean(result?.debug?.providerOffline));
                        const preferred = getPreferredSubtitleLang(settings?.language);
                        const hasPreferred = subtitles.some((item) => normalizeSubtitleLang(item?.lang) === preferred);
                        setSubtitleLangFilter(hasPreferred ? preferred : 'ALL');
                        if (!subtitles.length) setSubtitleError(isTr ? 'Altyazi bulunamadi' : 'No subtitles found');
                      } catch (err) {
                        setSubtitleError(err.message || (isTr ? 'Altyazi aranirken hata olustu' : 'Subtitle search failed'));
                      } finally {
                        setSubtitleLoading(false);
                      }
                    }}
                  >
                    {SUBTITLE_PROVIDER_OPTIONS.map((provider) => (
                      <option key={provider.key} value={provider.key}>{provider.label}</option>
                    ))}
                  </select>
                  {subtitleProvider === 'turkcealtyaziorg-stremio-addon' && subtitleProviderOffline && (
                    <span className="library-subtitle-provider-offline">Offline</span>
                  )}
                  <label htmlFor="subtitle-lang-filter">{isTr ? 'Dil' : 'Language'}</label>
                  <select
                    id="subtitle-lang-filter"
                    className="library-subtitle-select"
                    value={subtitleLangFilter}
                    onChange={(event) => setSubtitleLangFilter(event.target.value)}
                  >
                    <option value="ALL">{isTr ? 'Tum diller' : 'All languages'}</option>
                    {subtitleLanguages.map((langCode) => (
                      <option key={langCode} value={langCode}>
                        {formatSubtitleLang(langCode, isTr)} ({langCode})
                      </option>
                    ))}
                  </select>
                </div>
                {subtitleList.length > 0 && (
                  <div className="library-subtitle-list">
                    {filteredSubtitleList.map((subtitle, index) => (
                      <div className="library-subtitle-row" key={`${subtitle.id || 'sub'}-${index}`}>
                        <div className="library-subtitle-meta">
                          <strong>{formatSubtitleLang(subtitle.lang, isTr)} ({normalizeSubtitleLang(subtitle.lang) || 'SUB'})</strong>
                        </div>
                        <button
                          className="episode-download-btn"
                          disabled={subtitleSavingId === (subtitle.id || subtitle.url)}
                          onClick={() => handleSubtitleDownload(subtitle)}
                        >
                          <Download size={14} />
                          {subtitleSavingId === (subtitle.id || subtitle.url)
                            ? (isTr ? 'Indiriliyor' : 'Downloading')
                            : (isTr ? 'Indir' : 'Download')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LibraryView;
