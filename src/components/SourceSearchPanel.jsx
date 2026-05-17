import React, { useState, useEffect, useRef } from 'react';
import { Search, ShieldAlert, Download, Loader2, X } from 'lucide-react';
import {
  DEFAULT_PROWLARR_CONFIG,
  searchStreamSourcesForEpisode,
  searchStreamSourcesForMovie,
} from '../sources/index.mjs';
import { detectTorrentioSite, normalizeTorrentioConfig } from '../utils/torrentio';
import { fetchSeasonDetails, searchContent, fetchDetails } from '../utils/tmdb';

const TORRENTIO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TORRENTIO_CACHE_MAX_ENTRIES = 1500;
const APP_TOAST_EVENT = 'cinesoft:toast';
const torrentioSearchCache = new Map();

const buildTorrentioCacheKey = (payload = {}) => JSON.stringify(payload);

const getCachedTorrentioSearch = (key) => {
  const entry = torrentioSearchCache.get(key);
  if (!entry) return null;
  if ((Date.now() - Number(entry.cachedAt || 0)) > TORRENTIO_CACHE_TTL_MS) {
    torrentioSearchCache.delete(key);
    return null;
  }
  return Array.isArray(entry.results) ? entry.results : null;
};

const setCachedTorrentioSearch = (key, results = []) => {
  torrentioSearchCache.set(key, {
    cachedAt: Date.now(),
    results: Array.isArray(results) ? results : [],
  });
  if (torrentioSearchCache.size > TORRENTIO_CACHE_MAX_ENTRIES) {
    const oldestKey = torrentioSearchCache.keys().next().value;
    if (oldestKey) torrentioSearchCache.delete(oldestKey);
  }
};

const formatSize = (bytes) => {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasBlockedKeyword = (text = '', blocked = []) => {
  const hay = String(text || '').toLowerCase();
  return blocked.some((token) => {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) return false;
    // Short tokens like "ts" should match as standalone terms, not inside "yts".
    if (normalized.length <= 2) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalized)}([^a-z0-9]|$)`, 'i');
      return re.test(hay);
    }
    return hay.includes(normalized);
  });
};

const SourceSearchPanel = ({ item, type, settings, initialSeason, initialEpisode, initialEpisodeName, autoSearchKey }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [season, setSeason] = useState(Number(initialSeason) || 1);
  const [episode, setEpisode] = useState(Number(initialEpisode) || 1);
  const [selectedEpisode, setSelectedEpisode] = useState(initialEpisode ? {
    episode_number: Number(initialEpisode) || 1,
    name: initialEpisodeName || `Episode ${initialEpisode}`,
  } : null);
  const [seasonData, setSeasonData] = useState(null);
  const [searchSeasonData, setSearchSeasonData] = useState(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [tmdbMatch, setTmdbMatch] = useState(null);
  const [tmdbMatchAttempted, setTmdbMatchAttempted] = useState(false);
  const [searched, setSearched] = useState(false);
  const [qualityFilter, setQualityFilter] = useState('all');
  const [indexerFilter, setIndexerFilter] = useState('all');
  const [sortBy, setSortBy] = useState(normalizeTorrentioConfig(settings?.torrentio || {}).sortBy || 'seeders');
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerLoading, setFilePickerLoading] = useState(false);
  const [filePickerSource, setFilePickerSource] = useState(null);
  const [filePickerTorrentId, setFilePickerTorrentId] = useState('');
  const [filePickerFiles, setFilePickerFiles] = useState([]);
  const [selectedFileIndexes, setSelectedFileIndexes] = useState([]);
  const [sequentialDownload, setSequentialDownload] = useState(false);
  const [autoStartDownload, setAutoStartDownload] = useState(true);
  const autoSearchDoneRef = useRef('');

  const prowlarrConfig = settings.prowlarr || DEFAULT_PROWLARR_CONFIG;
  const activeCount = prowlarrConfig.enabled ? 1 : 0;
  const isEpisodic = type === 'tv' || type === 'anime';
  const notify = (message, tone = 'info', durationMs) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(APP_TOAST_EVENT, { detail: { message, tone, durationMs } }));
  };

  const logSourceSearch = (code, message, details = {}) => {
    window.electronAPI?.logEvent?.({
      source: 'source-search',
      code,
      message,
      details,
    });
  };

  const validateSourceProvider = () => {
    if (settings.torrentioEnabled) {
      logSourceSearch('start', 'Source search started', {
        provider: 'Torrentio',
        providerEnabled: true,
        hasBaseUrl: Boolean(normalizeTorrentioConfig(settings?.torrentio || {}).baseUrl),
      });
      return '';
    }

    logSourceSearch('start', 'Source search started', {
      provider: 'Prowlarr',
      providerEnabled: prowlarrConfig.enabled === true,
      hasBaseUrl: Boolean(prowlarrConfig.baseUrl),
      hasApiKey: Boolean(prowlarrConfig.apiKey),
    });

    if (!prowlarrConfig.enabled) return 'No source provider enabled';
    if (!prowlarrConfig.baseUrl || !prowlarrConfig.apiKey) return 'Prowlarr base URL/API key missing';
    return '';
  };

  const resetSearchState = () => {
    setSearched(true);
    setSearchError('');
    setQualityFilter('all');
    setIndexerFilter('all');
    setSourceSearchQuery('');
  };

  useEffect(() => {
    if (!settings?.torrentioEnabled) return;
    const nextSort = normalizeTorrentioConfig(settings?.torrentio || {}).sortBy || 'seeders';
    setSortBy(nextSort);
  }, [settings?.torrentioEnabled, settings?.torrentio?.sortBy]);

  useEffect(() => {
    if (!initialSeason && !initialEpisode) return;
    const nextSeason = Number(initialSeason) || 1;
    const nextEpisode = Number(initialEpisode) || 1;
    setSeason(nextSeason);
    setEpisode(nextEpisode);
    setSelectedEpisode({
      episode_number: nextEpisode,
      name: initialEpisodeName || `Episode ${nextEpisode}`,
    });
  }, [initialSeason, initialEpisode, initialEpisodeName]);
  useEffect(() => {
    if (isEpisodic && item?.id) {
      const loadSeason = async () => {
        setLoadingSeason(true);
        if (item.externalCatalog) {
          let mappedId = tmdbMatch?.id;
          let matchData = tmdbMatch;

          // Try to map Anilist anime to TMDB TV show if not attempted yet
          if (!mappedId && !tmdbMatchAttempted) {
            setTmdbMatchAttempted(true);
            const title = item.original_name || item.original_title || item.title || item.name;
            const searchResults = await searchContent(settings.apiKey, 'en', title, 1);
            const tvMatch = searchResults?.find(r => r.media_type === 'tv' || !r.media_type); // sometimes multi search misses media_type

            if (tvMatch) {
              mappedId = tvMatch.id;
              const details = await fetchDetails(settings.apiKey, 'en', 'tv', mappedId);
              if (details) {
                matchData = details;
                setTmdbMatch(details);
              }
            }
          }

          if (mappedId && matchData) {
            const [data, englishData] = await Promise.all([
              fetchSeasonDetails(settings.apiKey, settings.language, mappedId, season),
              settings.language === 'en'
                ? Promise.resolve(null)
                : fetchSeasonDetails(settings.apiKey, 'en', mappedId, season),
            ]);
            if (data && data.episodes && data.episodes.length > 0) {
              setSeasonData(data);
              setSearchSeasonData(englishData?.episodes?.length ? englishData : data);
              setLoadingSeason(false);
              return; // Exit here, TMDB data was successful!
            }
          }

          // Mock season data for Anilist items if TMDB fails
          const episodeCount = item.episodes || 12; // Fallback to 12 if unknown
          const mockEpisodes = Array.from({ length: episodeCount }, (_, i) => ({
            id: `mock-ep-${i + 1}`,
            episode_number: i + 1,
            name: `${settings.language === 'tr' ? 'Bölüm' : 'Episode'} ${i + 1}`,
            overview: '',
            still_path: item.backdrop_path || item.poster_path, // use show's image as fallback
            air_date: item.release_date, // assuming aired if show is aired
          }));
          setSeasonData({ episodes: mockEpisodes });
          setSearchSeasonData({
            episodes: mockEpisodes.map((ep) => ({
              ...ep,
              name: `Episode ${ep.episode_number}`,
            })),
          });
        } else {
          const [data, englishData] = await Promise.all([
            fetchSeasonDetails(settings.apiKey, settings.language, item.id, season),
            settings.language === 'en'
              ? Promise.resolve(null)
              : fetchSeasonDetails(settings.apiKey, 'en', item.id, season),
          ]);
          setSeasonData(data);
          setSearchSeasonData(englishData?.episodes?.length ? englishData : data);
        }
        setLoadingSeason(false);
      };
      loadSeason();
    }
  }, [isEpisodic, item?.id, item?.externalCatalog, item?.episodes, item?.backdrop_path, item?.poster_path, item?.release_date, item?.title, item?.name, item?.original_name, item?.original_title, season, settings.apiKey, settings.language, tmdbMatch?.id, tmdbMatchAttempted]);

  const t = {
    tr: {
      sources: 'Kaynaklar',
      findSources: 'Kaynak Ara',
      searching: 'Araniyor...',
      noSources: 'Uygun kaynak bulunamadi.',
      all: 'Hepsi',
      sort: 'Siralama',
      seeders: 'En cok seeder',
      size: 'En buyuk boyut',
      name: 'Isme gore',
      indexers: 'Dizinler',
      download: 'İndir',
      starting: 'Başlatılıyor...',
    },
    en: {
      sources: 'Sources',
      findSources: 'Find Sources',
      searching: 'Searching...',
      noSources: 'No usable sources found.',
      all: 'All',
      sort: 'Sort',
      seeders: 'Most Seeders',
      size: 'Largest Size',
      name: 'By Name',
      indexers: 'Indexers',
      download: 'Download',
      starting: 'Starting...',
    },
  }[settings.language || 'tr'];

  const getImdbId = async () => {
    if (item.external_ids?.imdb_id) return item.external_ids.imdb_id;
    if (tmdbMatch?.external_ids?.imdb_id) return tmdbMatch.external_ids.imdb_id;

    const idToUse = tmdbMatch ? tmdbMatch.id : item.id;
    if (!idToUse) return null;
    if (!settings.apiKey) {
      logSourceSearch('config_missing', 'TMDB API key missing', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        endpoint: '/external_ids',
        requestSent: false,
      });
      throw new Error('TMDB API key missing');
    }
    try {
      const startedAt = Date.now();
      const endpoint = `/${type === 'movie' ? 'movie' : 'tv'}/${idToUse}/external_ids`;
      logSourceSearch('request', 'TMDB external IDs request sent', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        endpoint,
        requestSent: true,
      });
      const response = await fetch(`https://api.themoviedb.org/3${endpoint}?api_key=${settings.apiKey}`);
      logSourceSearch('response', 'TMDB external IDs response received', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        endpoint,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      const data = await response.json();
      return data.imdb_id;
    } catch (error) {
      logSourceSearch('exception', 'TMDB external IDs request failed', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        endpoint: '/external_ids',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : '',
      });
      if (error?.message === 'TMDB API key missing') throw error;
      return null;
    }
  };

  const parseTorrentioSize = (title) => {
    const match = String(title || '').match(/([0-9.]+)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return value * 1024 * 1024 * 1024;
    if (unit === 'MB') return value * 1024 * 1024;
    if (unit === 'KB') return value * 1024;
    return 0;
  };

  const parseTorrentioProvider = (titleLines = [], name = '') => {
    const cogLine = titleLines.find((line) => line.includes('⚙️'));
    if (cogLine) {
      const cogMatch = cogLine.match(/⚙️\s*([^\n|]+)/);
      if (cogMatch?.[1]) return cogMatch[1].trim();
    }

    const nameLines = String(name || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.toLowerCase() !== 'torrentio');
    if (nameLines.length) return nameLines[0];

    return 'Torrentio';
  };

  const parseTorrentioSeeders = (titleLines = []) => {
    const joined = titleLines.join(' ');
    const seedMatch = joined.match(/👤\s*([0-9]+)/);
    if (!seedMatch) return 0;
    return Number(seedMatch[1]) || 0;
  };

  const getSearchEpisodeTitle = (episodeNumber, fallbackName = '') => {
    const englishEpisode = searchSeasonData?.episodes?.find((ep) => ep.episode_number === episodeNumber);
    return englishEpisode?.name || fallbackName;
  };

  const searchTorrentioSources = async (imdbId, targetSeason, targetEpisode, isMovie) => {
    if (!settings.torrentioEnabled) {
      logSourceSearch('config_missing', 'Torrentio disabled', {
        provider: 'Torrentio',
        requestSent: false,
      });
      throw new Error('Torrentio disabled');
    }
    if (!imdbId) return [];
    const torrentioConfig = normalizeTorrentioConfig(settings?.torrentio || {});
    const baseUrl = String(torrentioConfig.baseUrl || 'https://torrentio.strem.fun').replace(/\/+$/, '');
    const maxResults = Math.max(10, Number(torrentioConfig.maxResults) || 80);
    const blocked = String(torrentioConfig.excludeKeywords || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const enabledSites = torrentioConfig.enabledSites || {};
    const url = isMovie
      ? `${baseUrl}/stream/movie/${imdbId}.json`
      : `${baseUrl}/stream/series/${imdbId}:${targetSeason}:${targetEpisode}.json`;
    const cacheKey = buildTorrentioCacheKey({
      baseUrl,
      imdbId: String(imdbId || ''),
      season: Number(targetSeason || 0),
      episode: Number(targetEpisode || 0),
      isMovie: Boolean(isMovie),
      maxResults,
      blocked,
      enabledSites,
    });
    const cachedResults = getCachedTorrentioSearch(cacheKey);
    if (cachedResults) {
      logSourceSearch('cache_hit', 'Torrentio cache hit', {
        provider: 'Torrentio',
        resultCount: cachedResults.length,
      });
      return cachedResults;
    }

    try {
      const startedAt = Date.now();
      logSourceSearch('request', 'Torrentio request sent', {
        provider: 'Torrentio',
        providerEnabled: true,
        hasBaseUrl: Boolean(baseUrl),
        requestSent: true,
        endpoint: isMovie ? '/stream/movie/:imdbId.json' : '/stream/series/:imdbId:season:episode.json',
      });
      const response = await fetch(url);
      logSourceSearch(response.ok ? 'response' : 'http_error', 'Torrentio response received', {
        provider: 'Torrentio',
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
      });
      const data = await response.json();
      const mapped = (data.streams || []).map((stream, index) => {
        const titleParts = String(stream.title || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const qMatch = `${stream.name || ''} ${titleParts[0] || ''}`.toLowerCase();
        let quality = 'unknown';
        if (qMatch.includes('2160p') || qMatch.includes('4k')) quality = '2160p';
        else if (qMatch.includes('1080p')) quality = '1080p';
        else if (qMatch.includes('720p')) quality = '720p';
        else if (qMatch.includes('480p')) quality = '480p';

        const provider = parseTorrentioProvider(titleParts, stream.name || '');
        const seeders = parseTorrentioSeeders(titleParts);

        const fallbackTrackers = [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://open.stealth.si:80/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://tracker.moeking.me:6969/announce',
          'udp://explodie.org:6969/announce',
        ];
        const magnetFromUrl = typeof stream.url === 'string' && stream.url.startsWith('magnet:') ? stream.url : null;
        const magnetWithTrackers = stream.infoHash
          ? `magnet:?xt=urn:btih:${stream.infoHash}${fallbackTrackers.map((tr) => `&tr=${encodeURIComponent(tr)}`).join('')}`
          : null;

        return {
          id: stream.infoHash || stream.url || `torrentio-${index}`,
          title: titleParts[0] || 'Unknown Release',
          provider,
          siteKey: detectTorrentioSite(provider, titleParts[0] || ''),
          quality,
          size: parseTorrentioSize(stream.title || ''),
          seeders,
          languages: [],
          sourceType: 'torrent',
          infoHash: stream.infoHash,
          magnet: magnetFromUrl || magnetWithTrackers,
        };
      }).filter((stream) => {
        if (stream.siteKey !== 'unknown' && enabledSites[stream.siteKey] === false) return false;
        if (!blocked.length) return true;
        const hay = `${stream.title || ''} ${stream.provider || ''}`.toLowerCase();
        return !hasBlockedKeyword(hay, blocked);
      }).slice(0, maxResults);
      setCachedTorrentioSearch(cacheKey, mapped);
      return mapped;
    } catch (e) {
      logSourceSearch('exception', 'Torrentio request failed', {
        provider: 'Torrentio',
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : '',
      });
      console.error('Torrentio error', e);
      throw e;
    }
  };

  const handleTorrentDownload = async (source) => {
    setActionLoading(prev => ({ ...prev, [source.id]: true }));

    try {
      const sourceEngine = String(source?.engine || source?.source?.engine || '').toLowerCase();
      if (sourceEngine === 'torrserver') {
        if (!window.electronAPI?.startTorrServerStream) {
          throw new Error('TorrServer integration is not available');
        }
        await window.electronAPI.startTorrServerStream({
          magnet: source?.magnet,
          torrentUrl: source?.torrentUrl,
          link: source?.link,
          source,
          result: source,
          title: source?.title || item?.title || 'CineSoft Stream',
        });
        notify(
          settings.language === 'en' ? 'Stream started in external MPV.' : 'Harici MPV ile stream baslatildi.',
          'success',
        );
        return;
      }

      if (!window.electronAPI?.torrentPrepare || !window.electronAPI?.torrentGetFiles || !window.electronAPI?.torrentSelectFiles) return;

      let pendingTorrentId = '';
      const releaseDate = item.release_date || item.first_air_date || '';
      const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : 0;
      const expectedEpisode = isEpisodic && selectedEpisode?.episode_number ? Number(selectedEpisode.episode_number) : 0;
      const expectedCode = expectedEpisode
        ? `S${String(season).padStart(2, '0')}E${String(expectedEpisode).padStart(2, '0')}`
        : '';
      const sourceTitle = String(source.title || '');
      const sourceLower = sourceTitle.toLowerCase();
      const looksLikePackSource = isEpisodic && (
        selectedEpisode?.isPack === true
        || (expectedCode && !sourceLower.includes(expectedCode.toLowerCase()) && /\b(complete|season|sezon|pack)\b/i.test(sourceTitle))
        || /\bS\d{1,2}\b(?!\s*E\d{1,3})/i.test(sourceTitle)
      );
      const validation = await window.electronAPI?.validateTorrentCandidate?.({
        releaseTitle: source.title || '',
        size: source.size || 0,
        expected: {
          year: Number.isFinite(releaseYear) ? releaseYear : 0,
          quality: source.quality || '',
          language: settings.language || 'tr',
          season: isEpisodic ? season : 0,
          episode: expectedEpisode,
          allowSeasonPack: isEpisodic,
        },
      });
      if (validation && validation.ok === false) {
        notify(
          settings.language === 'en'
            ? `Blocked: ${validation.reasons?.join(', ') || 'validation failed'}`
            : `Engellendi: ${validation.reasons?.join(', ') || 'dogrulama basarisiz'}`,
          'warn',
          4200,
        );
        return;
      }

      const magnetOrHash = source.magnet || source.infoHash || null;
      const torrentUrl = source.torrentUrl || null;
      const displayTitle = source.title || item.title || item.name || 'Unknown';

      setFilePickerLoading(true);
      const prepared = await window.electronAPI.torrentPrepare({
        magnetOrHash,
        torrentUrl,
        mode: 'download',
        title: displayTitle,
        mediaInfo: {
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : (item.poster_url || ''),
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : (item.backdrop_url || ''),
          type,
          tmdbId: item.id,
          season: isEpisodic ? season : null,
          episode: looksLikePackSource ? null : (expectedEpisode || null),
          quality: source.quality,
          provider: source.provider,
        },
      });
      if (!prepared?.ok || !prepared?.id) {
        throw new Error(prepared?.error || 'Prepare failed');
      }
      pendingTorrentId = prepared.id;

      setFilePickerTorrentId(prepared.id);
      setFilePickerSource(source);
      setFilePickerOpen(true);
      notify(
        settings.language === 'en'
          ? 'Torrent added. Select files to start download.'
          : 'Torrent eklendi. Indirmeyi baslatmak icin dosya sec.',
        'success',
      );

      let files = Array.isArray(prepared.files) ? prepared.files : [];
      setFilePickerFiles(files);
      setSelectedFileIndexes(files.map((file) => file.index));

      if (!prepared.metadataReady) {
        // Metadata acquisition for magnet links can be slow, especially when another torrent is active.
        // Poll for up to ~3 minutes before failing.
        for (let i = 0; i < 120 && !files.length; i += 1) {
          const delay = i < 60 ? 1000 : 2000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          const latest = await window.electronAPI.torrentGetFiles(prepared.id);
          if (latest?.ok && Array.isArray(latest.files)) {
            files = latest.files;
          }
        }
      }
      if (!files.length) {
        closePicker();
        if (pendingTorrentId) {
          try {
            await window.electronAPI?.torrentRemove?.(pendingTorrentId, false);
          } catch (cleanupError) {
            console.error('Failed to cleanup pending torrent after metadata timeout:', cleanupError);
          }
        }
        throw new Error(settings.language === 'en' ? 'Torrent metadata not ready' : 'Torrent metadata hazir degil');
      }

      setFilePickerFiles(files);
      setSelectedFileIndexes((current) => current.length ? current : files.map((file) => file.index));

    } catch (err) {
      console.error('Torrent action error:', err);
      const errorMessage = String(err?.message || '');
      if (errorMessage === 'TorrServer not running. Start TorrServer on http://127.0.0.1:8090') {
        notify('TorrServer not running. Start TorrServer on http://127.0.0.1:8090', 'error', 6000);
      } else {
        notify(settings.language === 'en' ? `Failed to add torrent: ${err.message}` : `Torrent eklenemedi: ${err.message}`, 'error', 5000);
      }
    } finally {
      setFilePickerLoading(false);
      setTimeout(() => {
        setActionLoading(prev => {
          const next = { ...prev };
          delete next[source.id];
          return next;
        });
      }, 2000);
    }
  };

  const toggleSelectedFile = (fileIndex) => {
    setSelectedFileIndexes((current) => (
      current.includes(fileIndex)
        ? current.filter((idx) => idx !== fileIndex)
        : [...current, fileIndex]
    ));
  };

  const closePicker = () => {
    setFilePickerOpen(false);
    setFilePickerSource(null);
    setFilePickerTorrentId('');
    setFilePickerFiles([]);
    setSelectedFileIndexes([]);
    setSequentialDownload(false);
    setAutoStartDownload(true);
  };

  const cancelPickerAndRemoveTorrent = async () => {
    const pendingId = filePickerTorrentId;
    closePicker();
    if (pendingId) {
      try {
        await window.electronAPI?.torrentRemove?.(pendingId, false);
      } catch (e) {
        console.error('Failed to cleanup pending torrent:', e);
      }
    }
  };

  const confirmSelectedFiles = async () => {
    if (!filePickerTorrentId || !selectedFileIndexes.length) return;
    setFilePickerLoading(true);
    try {
      const selectedSizeBytes = filePickerFiles
        .filter((file) => selectedFileIndexes.includes(file.index))
        .reduce((total, file) => total + Math.max(0, Number(file.size) || 0), 0);
      if (selectedSizeBytes > 0) {
        const disk = await window.electronAPI?.getDownloadDirFreeSpace?.();
        const freeBytes = Number(disk?.freeBytes || 0);
        if (!disk?.ok || freeBytes < selectedSizeBytes) {
          notify(
            settings.language === 'en'
              ? 'Not enough disk space for this download.'
            : 'Bu indirme için yeterli disk alanı yok.');
          return;
        }
      }

      const result = await window.electronAPI.torrentSelectFiles(filePickerTorrentId, selectedFileIndexes, autoStartDownload, sequentialDownload);
      if (!result?.ok) {
        throw new Error(result?.error || 'Select files failed');
      }
      notify(
        settings.language === 'en'
          ? (autoStartDownload ? 'Download started and added to queue.' : 'Torrent added to queue.')
          : (autoStartDownload ? 'Indirme baslatildi ve kuyruga eklendi.' : 'Torrent kuyruga eklendi.'),
        'success',
      );
      closePicker();
    } catch (err) {
      notify(settings.language === 'en' ? `Failed: ${err.message}` : `Islem basarisiz: ${err.message}`, 'error', 5000);
    } finally {
      setFilePickerLoading(false);
    }
  };

  const handleEpisodeSelect = async (ep) => {
    setEpisode(ep.episode_number);
    setSelectedEpisode(ep);

    setLoading(true);
    resetSearchState();
    try {
      const configError = validateSourceProvider();
      if (configError) throw new Error(configError);

      if (settings.torrentioEnabled) {
        const imdbId = await getImdbId();
        const sources = await searchTorrentioSources(imdbId, season, ep.episode_number, false);
        setResults(filterEpisodeSources(sources, {
          title: item.original_title || item.original_name || item.title || item.name,
          season,
          episode: ep.episode_number,
          episodeTitle: getSearchEpisodeTitle(ep.episode_number, ep.name),
          year: new Date(item.release_date || item.first_air_date).getFullYear(),
        }));
      } else {
        const title = item.original_title || item.original_name || item.title || item.name;
        const payload = {
          title,
          year: new Date(item.release_date || item.first_air_date).getFullYear(),
          tmdbId: item.id,
          language: settings.language,
        };
        const sources = await searchEpisodeSources(prowlarrConfig, {
          ...payload,
          season,
          episode: ep.episode_number,
          episodeTitle: getSearchEpisodeTitle(ep.episode_number, ep.name),
        });
        setResults(sources);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResults([]);
      setSearchError(message);
      logSourceSearch('exception', 'Episode source search failed', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        error: message,
        stack: error instanceof Error ? error.stack : '',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSeasonPackSearch = async (targetSeason) => {
    setLoading(true);
    resetSearchState();
    setSelectedEpisode({
      isPack: true,
      name: targetSeason === 'all'
        ? (settings.language === 'tr' ? 'Bütün Sezonlar Paketi' : 'Complete Series Pack')
        : `${settings.language === 'tr' ? 'Sezon' : 'Season'} ${targetSeason} ${settings.language === 'tr' ? 'Paketi' : 'Pack'}`,
      episode_number: null,
    });
    try {
      const configError = validateSourceProvider();
      if (configError) throw new Error(configError);

      const title = item.original_title || item.original_name || item.title || item.name;
      const payload = {
        title,
        year: new Date(item.release_date || item.first_air_date).getFullYear(),
        tmdbId: item.id,
        language: settings.language,
      };

      let sources;
      if (targetSeason === 'all') {
        sources = await searchEpisodeSources(prowlarrConfig, { ...payload });
      } else {
        // Append SXX directly to title to ensure the backend searches for it
        const packTitle = `${payload.title} S${String(targetSeason).padStart(2, '0')}`;
        sources = await searchEpisodeSources(prowlarrConfig, { ...payload, title: packTitle, season: targetSeason });
      }
      setResults(sources);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResults([]);
      setSearchError(message);
      logSourceSearch('exception', 'Season pack source search failed', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        error: message,
        stack: error instanceof Error ? error.stack : '',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    resetSearchState();
    try {
      const configError = validateSourceProvider();
      if (configError) throw new Error(configError);

      if (settings.torrentioEnabled) {
        const imdbId = await getImdbId();
        const sources = await searchTorrentioSources(imdbId, isEpisodic ? season : null, isEpisodic ? episode : null, !isEpisodic);
        if (isEpisodic) {
          setResults(filterEpisodeSources(sources, {
            title: item.original_title || item.original_name || item.title || item.name,
            season,
            episode,
            episodeTitle: selectedEpisode?.isPack
              ? ''
              : getSearchEpisodeTitle(episode, selectedEpisode?.name),
            year: new Date(item.release_date || item.first_air_date).getFullYear(),
          }));
        } else {
          setResults(sources);
        }
      } else {
        const title = item.original_title || item.original_name || item.title || item.name;
        const payload = {
          title,
          year: new Date(item.release_date || item.first_air_date).getFullYear(),
          tmdbId: item.id,
          language: settings.language,
        };

        const sources = isEpisodic
          ? await searchEpisodeSources(prowlarrConfig, {
            ...payload,
            season,
            episode,
            episodeTitle: selectedEpisode?.isPack
              ? ''
              : getSearchEpisodeTitle(episode, selectedEpisode?.name),
          })
          : await searchMovieSources(prowlarrConfig, payload);

        setResults(sources);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResults([]);
      setSearchError(message);
      logSourceSearch('exception', 'Source search failed', {
        provider: settings.torrentioEnabled ? 'Torrentio' : 'Prowlarr',
        error: message,
        stack: error instanceof Error ? error.stack : '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoSearchKey || !initialEpisode || autoSearchDoneRef.current === autoSearchKey) return;
    if (loadingSeason) return;
    autoSearchDoneRef.current = autoSearchKey;
    handleSearch();
  }, [autoSearchKey, initialEpisode, loadingSeason]);

  const uniqueIndexers = [...new Set(results.map(r => r.provider || 'Unknown'))].sort();

  const filteredAndSortedResults = results
    .filter((source) => {
      // Quality Filter
      let passQuality = true;
      if (qualityFilter !== 'all') {
        const q = (source.quality || '').toLowerCase();
        if (qualityFilter === '2160p') passQuality = q.includes('2160p') || q.includes('4k') || q.includes('uhd');
        else if (qualityFilter === '1080p') passQuality = q.includes('1080p');
        else if (qualityFilter === '720p') passQuality = q.includes('720p');
      }

      // Indexer Filter
      let passIndexer = true;
      if (indexerFilter !== 'all') {
        passIndexer = (source.provider || 'Unknown') === indexerFilter;
      }

      // Search Query Filter
      let passSearch = true;
      if (sourceSearchQuery.trim()) {
        const query = sourceSearchQuery.toLowerCase();
        const titleMatch = (source.title || '').toLowerCase().includes(query);
        const providerMatch = (source.provider || '').toLowerCase().includes(query);
        passSearch = titleMatch || providerMatch;
      }

      return passQuality && passIndexer && passSearch;
    })
    .sort((a, b) => {
      const isHevc = (src) => /hevc|x265|h\.?265|10bit|dv|dolby\s*vision/i.test(`${src.title || ''} ${src.quality || ''}`);
      if (sortBy === 'seeders') {
        const aScore = (a.seeders || 0) - (isHevc(a) ? 100000 : 0);
        const bScore = (b.seeders || 0) - (isHevc(b) ? 100000 : 0);
        return bScore - aScore;
      }
      if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
      if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '');
      return 0;
    });

  return (
    <section className="detail-section source-search-section">
      <div className="section-header">
        <h2>{t.sources}</h2>
        <span className="source-provider-count">
          {settings.torrentioEnabled ? 'Torrentio ON' : `Prowlarr ${activeCount ? 'ON' : 'OFF'}`}
        </span>
      </div>

      <div className="source-toolbar">
        {!isEpisodic && (
          <button className="source-search-btn" onClick={handleSearch} disabled={loading}>
            <Search size={18} />
            {loading ? t.searching : t.findSources}
          </button>
        )}
      </div>

      {isEpisodic && (
        <div className="episodes-container">
          <div className="season-selector-wrapper" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="season-selector"
              value={season}
              onChange={(e) => {
                setSeason(Number(e.target.value));
                setSelectedEpisode(null);
                setResults([]);
                setSearched(false);
                setSearchError('');
              }}
            >
              {(tmdbMatch?.seasons || item.seasons || [{ season_number: 1, name: 'Season 1' }])
                .filter(s => s.season_number > 0)
                .map(s => (
                  <option key={s.id || s.season_number} value={s.season_number}>
                    {s.name || `Season ${s.season_number}`}
                  </option>
                ))}
            </select>

            {!settings.torrentioEnabled && (
              <button
                className="filter-btn"
                onClick={() => handleSeasonPackSearch(season)}
                disabled={loading}
                title={settings.language === 'tr' ? 'Seçili sezonun tamamını (paket) arar' : 'Search selected season pack'}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Search size={14} />
                {settings.language === 'tr' ? 'Sezon Paketini İndir' : 'Season Pack'}
              </button>
            )}
          </div>

          {!selectedEpisode && seasonData && (
            <div className="episodes-grid">
              {loadingSeason ? (
                <div className="loading-episodes">Yükleniyor...</div>
              ) : (
                seasonData.episodes?.map(ep => {
                  const isAired = ep.air_date ? new Date(ep.air_date) <= new Date() : true;
                  return (
                    <div
                      className={`episode-card ${!isAired ? 'unaired' : ''}`}
                      key={ep.id}
                      onClick={() => { if (isAired) handleEpisodeSelect(ep); }}
                      style={!isAired ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                    >
                      <div className="episode-img-wrapper">
                        {ep.still_path ? (
                          <img src={`https://image.tmdb.org/t/p/w300${ep.still_path}`} alt={ep.name} />
                        ) : (
                          <div className="episode-no-img">No Image</div>
                        )}
                        <div className="episode-number-badge">E{ep.episode_number}</div>
                        {isAired && (
                          <div className="episode-download-overlay">
                            <Download size={32} />
                          </div>
                        )}
                      </div>
                      <div className="episode-info">
                        <h4>{ep.name}</h4>
                        {!isAired ? (
                          <p style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
                            {settings.language === 'tr' ? 'Yayınlanma Tarihi: ' : 'Air Date: '}
                            {new Date(ep.air_date).toLocaleDateString(settings.language === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                        ) : (
                          <p>{ep.overview || (settings.language === 'tr' ? 'Açıklama bulunmuyor.' : 'No description available.')}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {selectedEpisode && (
            <div className="selected-episode-header">
              <button className="back-to-episodes-btn" onClick={() => {
                setSelectedEpisode(null);
                setResults([]);
                setSearched(false);
                setSearchError('');
              }}>
                &larr; {settings.language === 'tr' ? 'Bölümlere Dön' : 'Back to Episodes'}
              </button>
              <div className="selected-episode-info">
                <h3>{selectedEpisode.name}</h3>
                {!selectedEpisode.isPack && (
                  <span>S{season} E{selectedEpisode.episode_number}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {results.length > 0 && (
        <div className="source-controls">
          <div className="filter-group">
            <div className="quality-filters">
              {['all', '2160p', '1080p', '720p'].map((q) => (
                <button
                  key={q}
                  className={`filter-btn ${qualityFilter === q ? 'active' : ''}`}
                  onClick={() => setQualityFilter(q)}
                >
                  {q === 'all' ? t.all : q.toUpperCase()}
                </button>
              ))}
            </div>

            {uniqueIndexers.length > 1 && (
              <div className="indexer-filters">
                <button
                  className={`filter-btn ${indexerFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setIndexerFilter('all')}
                >
                  {t.all}
                </button>
                {uniqueIndexers.map((name) => (
                  <button
                    key={name}
                    className={`filter-btn ${indexerFilter === name ? 'active' : ''}`}
                    onClick={() => setIndexerFilter(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sort-control" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="source-local-search" style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder={settings.language === 'tr' ? 'Kaynaklarda ara...' : 'Search in sources...'}
                value={sourceSearchQuery}
                onChange={(e) => setSourceSearchQuery(e.target.value)}
                style={{
                  width: '200px',
                  padding: '0.4rem 1rem 0.4rem 2rem',
                  borderRadius: '1rem',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '0.85rem'
                }}
              />
              <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="source-sort-select">
              <option value="seeders">{t.seeders}</option>
              <option value="size">{t.size}</option>
              <option value="name">{t.name}</option>
            </select>
          </div>
        </div>
      )}

      {searched && !loading && filteredAndSortedResults.length === 0 && (
        <div className="source-empty">
          <ShieldAlert size={20} />
          <span>{searchError || t.noSources}</span>
        </div>
      )}

      {filteredAndSortedResults.length > 0 && (
        <div className="source-results">
          {filteredAndSortedResults.map((source) => {
            const isLoadingAction = actionLoading[source.id];
            const hasTorrentData = source.magnet || source.infoHash || source.torrentUrl || source.downloadUrl;

            return (
              <div className="source-row" key={source.id}>
                <div className="source-main">
                  <span className="source-title">{source.title}</span>
                  <span className="source-subtitle">{source.provider} / {source.sourceType}</span>
                </div>
                <div className="source-badges">
                  <span className="source-badge">{source.quality || '-'}</span>
                  <span className="source-badge">{formatSize(source.size)}</span>
                  <span className="source-badge source-badge-seeders">{source.seeders ?? 0} seed</span>
                  {source.languages.map((language) => <span key={language}>{language}</span>)}
                </div>
                {hasTorrentData && (
                  <div className="source-actions">
                    <button
                      className="source-action-btn download-btn"
                      onClick={() => handleTorrentDownload(source)}
                      disabled={!!isLoadingAction}
                      title={t.download}
                    >
                      {isLoadingAction ? (
                        <Loader2 size={16} className="spin-animation" />
                      ) : (
                        <Download size={16} />
                      )}
                      <span>{isLoadingAction ? t.starting : t.download}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {filePickerOpen && (
        <div className="torrent-file-picker-overlay" onClick={cancelPickerAndRemoveTorrent}>
          <div className="torrent-file-picker-modal" onClick={(event) => event.stopPropagation()}>
            <div className="torrent-file-picker-header">
              <h3>{settings.language === 'en' ? 'Select files to download' : 'Indirilecek dosyalari sec'}</h3>
              <button className="modal-icon-btn" onClick={cancelPickerAndRemoveTorrent}><X size={18} /></button>
            </div>
            <div className="torrent-file-picker-subtitle">{filePickerSource?.title}</div>
            <div className="torrent-file-picker-toolbar">
              <button className="modal-secondary-btn" onClick={() => setSelectedFileIndexes(filePickerFiles.map((file) => file.index))}>
                {settings.language === 'en' ? 'Select All' : 'Hepsini Sec'}
              </button>
              <button className="modal-secondary-btn" onClick={() => setSelectedFileIndexes([])}>
                {settings.language === 'en' ? 'Clear All' : 'Hepsini Kaldir'}
              </button>
            </div>
            <label className="torrent-file-picker-option">
              <input
                type="checkbox"
                checked={sequentialDownload}
                onChange={(event) => setSequentialDownload(event.target.checked)}
              />
              <span>
                <strong>{settings.language === 'en' ? 'Download sequentially' : 'Sirayla indir'}</strong>
                <small>{settings.language === 'en' ? 'Downloads selected files in playback order.' : 'Secilen dosyalari izleme sirasina gore indirir.'}</small>
              </span>
            </label>
            <label className="torrent-file-picker-option">
              <input
                type="checkbox"
                checked={autoStartDownload}
                onChange={(event) => setAutoStartDownload(event.target.checked)}
              />
              <span>
                <strong>{settings.language === 'en' ? 'Auto start after adding' : 'Torrent eklendiginde otomatik baslat'}</strong>
                <small>{settings.language === 'en' ? 'Starts downloading immediately after confirmation.' : 'Onaydan sonra indirmeyi otomatik baslatir.'}</small>
              </span>
            </label>
            <div className="torrent-file-picker-list">
              {filePickerLoading && filePickerFiles.length === 0 ? (
                <div className="source-empty">
                  <Loader2 size={18} className="spin-animation" />
                  <span>{settings.language === 'en' ? 'Loading torrent files...' : 'Torrent dosyalari yukleniyor...'}</span>
                </div>
              ) : filePickerFiles.map((file) => (
                <label key={file.index} className="source-file-picker-row">
                  <input
                    type="checkbox"
                    checked={selectedFileIndexes.includes(file.index)}
                    onChange={() => toggleSelectedFile(file.index)}
                  />
                  <span className="source-file-picker-name">
                    <span className="source-file-picker-name-track">{file.path || file.name}</span>
                  </span>
                  <span className="source-file-picker-size">{formatSize(file.size)}</span>
                </label>
              ))}
            </div>
            <div className="torrent-file-picker-footer">
              <button className="modal-secondary-btn" onClick={cancelPickerAndRemoveTorrent}>{settings.language === 'en' ? 'Cancel' : 'Iptal'}</button>
              <button className="modal-save-btn" onClick={confirmSelectedFiles} disabled={filePickerLoading || !selectedFileIndexes.length}>
                {filePickerLoading ? <Loader2 size={16} className="spin-animation" /> : <Download size={16} />}
                {settings.language === 'en' ? 'Confirm Download' : 'Indirmeyi Baslat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const searchMovieSources = (prowlarrConfig, payload) => {
  if (window.electronAPI?.searchMovieSources) {
    return window.electronAPI.searchMovieSources(payload);
  }
  return searchStreamSourcesForMovie(prowlarrConfig, payload);
};

const normalizeText = (value = '') => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (value = '') => {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'your', 'you', 'are', 'was', 'were', 'bir', 've', 'ile', 'icin']);
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && token.length >= 3 && !stop.has(token));
};

const extractEpisodeCodes = (value = '') => {
  const text = String(value || '');
  const found = [];
  const sxe = [...text.matchAll(/\bS(\d{1,2})E(\d{1,3})\b/gi)];
  for (const match of sxe) {
    found.push({
      season: Number(match[1]),
      episode: Number(match[2]),
    });
  }
  const xcode = [...text.matchAll(/\b(\d{1,2})x(\d{1,3})\b/gi)];
  for (const match of xcode) {
    found.push({
      season: Number(match[1]),
      episode: Number(match[2]),
    });
  }
  return found;
};

const findContiguousPhraseStart = (tokens = [], phrase = []) => {
  if (!tokens.length || !phrase.length || phrase.length > tokens.length) return -1;
  for (let i = 0; i <= tokens.length - phrase.length; i += 1) {
    let ok = true;
    for (let j = 0; j < phrase.length; j += 1) {
      if (tokens[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
};

const hasDirectSeasonMarkerAfterTitle = (sourceTitle = '', canonicalTitle = '', expectedSeason = 0) => {
  const sourceTokens = normalizeText(sourceTitle).split(' ').filter(Boolean);
  const titleTokens = normalizeText(canonicalTitle).split(' ').filter(Boolean);
  if (!sourceTokens.length || !titleTokens.length || !expectedSeason) return false;

  const phraseStart = findContiguousPhraseStart(sourceTokens, titleTokens);
  if (phraseStart < 0) return false;

  const nextTokens = sourceTokens.slice(phraseStart + titleTokens.length, phraseStart + titleTokens.length + 3);
  if (!nextTokens.length) return false;

  const seasonCode = `s${String(expectedSeason).padStart(2, '0')}`;
  const seasonNum = String(expectedSeason);
  const t0 = nextTokens[0] || '';
  const t1 = nextTokens[1] || '';
  const t2 = nextTokens[2] || '';

  if (t0 === seasonCode) return true;
  if ((t0 === 'season' || t0 === 'sezon') && (t1 === seasonNum || t1 === `0${seasonNum}` || t1 === seasonCode)) return true;
  if (/^(19|20)\d{2}$/.test(t0) && (t1 === seasonCode || ((t1 === 'season' || t1 === 'sezon') && (t2 === seasonNum || t2 === `0${seasonNum}`)))) return true;
  if (t0 === 'complete' && (t1 === seasonCode || ((t1 === 'season' || t1 === 'sezon') && (t2 === seasonNum || t2 === `0${seasonNum}`)))) return true;

  return false;
};

const filterEpisodeSources = (sources, payload = {}) => {
  const payloadTitleRaw = String(payload.title || '');
  const canonicalTitle = payloadTitleRaw
    .replace(/\bS\d{1,2}E\d{1,3}\b/gi, ' ')
    .replace(/\bS\d{1,2}\b/gi, ' ')
    .replace(/\b(Season|Sezon)\s*\d{1,2}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const titleTokens = tokenize(canonicalTitle || payloadTitleRaw);
  const canonicalWords = normalizeText(canonicalTitle).split(' ').filter(Boolean);
  const episodeTokens = tokenize(payload.episodeTitle || payload.episodeName || '');
  const expectedSeason = Number(payload.season) || 0;
  const expectedEpisode = Number(payload.episode) || 0;
  const expectedYear = Number(payload.year) || 0;
  const seasonOnlySearch = expectedSeason > 0 && expectedEpisode <= 0;
  const expectedCode = expectedSeason && expectedEpisode
    ? `s${String(expectedSeason).padStart(2, '0')}e${String(expectedEpisode).padStart(2, '0')}`
    : '';
  const expectedSeasonCode = expectedSeason
    ? `s${String(expectedSeason).padStart(2, '0')}`
    : '';
  const shortSingleWordTitle = canonicalWords.length === 1 && canonicalWords[0].length <= 4;

  const filtered = (Array.isArray(sources) ? sources : []).filter((source) => {
    const rawTitle = String(source?.title || '');
    const normalizedTitle = normalizeText(rawTitle);
    const sourceTokens = new Set(tokenize(rawTitle));

    if (expectedSeason && expectedEpisode) {
      const codes = extractEpisodeCodes(rawTitle);
      if (codes.length) {
        const hasExpected = codes.some((code) => code.season === expectedSeason && code.episode === expectedEpisode);
        if (!hasExpected) return false;
      } else if (!normalizedTitle.includes(expectedCode)) {
        return false;
      }
    }

    if (episodeTokens.length >= 2) {
      const episodeHit = episodeTokens.some((token) => token.length >= 4 && sourceTokens.has(token));
      if (!episodeHit) return false;
    }

    if (titleTokens.length >= 2) {
      const titleMatchCount = titleTokens.filter((token) => sourceTokens.has(token)).length;
      if (titleMatchCount < 2) return false;
    }

    if (seasonOnlySearch) {
      if (expectedSeasonCode && !new RegExp(`\\b${escapeRegex(expectedSeasonCode)}\\b`, 'i').test(normalizedTitle)) {
        return false;
      }

      if (canonicalWords.length >= 2) {
        const strictSeriesMatch = hasDirectSeasonMarkerAfterTitle(rawTitle, canonicalTitle || payloadTitleRaw, expectedSeason);
        if (!strictSeriesMatch) return false;
      }

      if (shortSingleWordTitle) {
        const word = canonicalWords[0];
        const startsWithWord = new RegExp(`^${escapeRegex(word)}(?:\\b|[ ._\\-\\[])`, 'i').test(normalizedTitle);
        if (!startsWithWord) return false;
        if (expectedYear > 0 && !normalizedTitle.includes(String(expectedYear))) {
          return false;
        }
      }
    }

    return true;
  });

  if (filtered.length > 0) return filtered;
  return Array.isArray(sources) ? sources : [];
};

const searchEpisodeSources = async (prowlarrConfig, payload) => {
  let sources;
  if (window.electronAPI?.searchEpisodeSources) {
    sources = await window.electronAPI.searchEpisodeSources(payload);
  } else {
    sources = await searchStreamSourcesForEpisode(prowlarrConfig, payload);
  }
  return filterEpisodeSources(sources, payload);
};

export default SourceSearchPanel;

