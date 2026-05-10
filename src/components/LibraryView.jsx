import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ArrowLeft, CheckCircle2, Download, Film, HardDrive, Library, PlayCircle, Tv, X } from 'lucide-react';
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
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|x264|x265|h264|h265|hevc|avc|10bit|bluray|brrip|web[- ]?dl|webrip|hdrip|dvdrip|proper|repack|remux|aac|ddp?5?\.?1|atmos|yify|yts|rarbg|eztv|tgx|torrentgalaxy|ettv|amzn|nf|hulu)\b/gi, ' ')
    .replace(/\b(multi|dubbed|dual audio|turkish|english|subs?|complete|season pack)\b/gi, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  return {
    mediaType: 'movie',
    query,
    displayTitle: query || titleCase(stripReleaseJunk(item.title || fileBase)) || 'Unknown Movie',
    season: null,
    episode: null,
    year,
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

const scoreTmdbResult = (result, parsed) => {
  const dateRaw = result.release_date || result.first_air_date || '';
  const resultYear = Number(String(dateRaw).slice(0, 4)) || 0;
  const yearPenalty = parsed.year && resultYear ? Math.abs(resultYear - parsed.year) : 1;
  const typePenalty = result.media_type === parsed.mediaType ? 0 : 4;
  return yearPenalty + typePenalty;
};

const pickBestResult = (results, parsed) => {
  const usable = (results || []).filter((result) => {
    if (!result?.poster_path) return false;
    if (parsed.mediaType === 'tv') return result.media_type === 'tv' || !result.media_type;
    return result.media_type === 'movie' || !result.media_type;
  });
  if (!usable.length) return null;
  return usable
    .map((item) => ({ item, score: scoreTmdbResult(item, parsed) }))
    .sort((a, b) => a.score - b.score)[0]?.item || usable[0];
};

const LibraryView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [rootDir, setRootDir] = useState('');
  const [selectedSeriesKey, setSelectedSeriesKey] = useState('');
  const [seriesDetails, setSeriesDetails] = useState(null);
  const [seasonDetails, setSeasonDetails] = useState({});
  const metadataPending = useRef(new Set());

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
        const tmdbId = Number(cache?.tmdbId || mediaInfo.tmdbId || currentItem.tmdbId) || null;
        const poster = mediaInfo.poster || cache?.posterUrl || currentItem.poster || '';
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
      const missing = items
        .filter((item) => !item.poster || !item.tmdbId)
        .filter((item) => item.query && !metadataPending.current.has(item.id))
        .slice(0, 12);
      if (!missing.length) return;

      missing.forEach((item) => metadataPending.current.add(item.id));
      const updates = await Promise.all(missing.map(async (item) => {
        const results = await searchContent(settings.apiKey, 'en', item.query, 1);
        const picked = pickBestResult(results, item);
        if (!picked) return { id: item.id, poster: '', tmdbId: null };
        const details = await fetchDetails(settings.apiKey, 'en', item.mediaType, picked.id);
        return {
          id: item.id,
          title: details?.name || details?.title || picked.name || picked.title || item.cleanTitle,
          poster: imageUrl(details?.poster_path || picked.poster_path),
          tmdbId: picked.id,
          tmdbType: item.mediaType,
          year: Number(String(details?.first_air_date || details?.release_date || '').slice(0, 4)) || item.year || null,
        };
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
  }, [items, settings?.apiKey]);

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
      />
    );
  }

  return (
    <div className="library-view">
      <header className="library-header">
        <h1>{isTr ? 'Kutuphanem' : 'Library'}</h1>
        <p>{isTr ? 'Secili indirme dizini taranarak video dosyalari listelenir.' : 'Video files are listed by scanning the selected download directory.'}</p>
        {!!rootDir && <span className="library-root">{rootDir}</span>}
      </header>

      {!libraryCards.length && (
        <div className="library-empty">
          <Library size={56} />
          <strong>{isTr ? 'Henuz kutuphane icerigi yok' : 'No library items yet'}</strong>
        </div>
      )}

      <div className="library-grid">
        {libraryCards.map((card) => {
          const item = card.type === 'movie' ? card.item : card;
          const title = cleanLibraryTitle(card.type === 'movie' ? item.cleanTitle : card.title, item.query, item.displayTitle);
          const subtitle = card.type === 'movie'
            ? (item.year ? String(item.year) : (isTr ? 'Film' : 'Movie'))
            : `${card.episodes.length} ${isTr ? 'bolum indi' : 'episodes downloaded'}`;
          return (
            <button
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
              </div>
              <div className="library-meta">
                <div className="marquee"><strong>{title}</strong></div>
                <span>{subtitle}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const SeriesLibraryView = ({ isTr, series, settings, details, seasonDetails, onBack, onOpenVideo }) => {
  const [searchTarget, setSearchTarget] = useState(null);
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
              <h2>{tmdbSeason?.name || season.name || `${isTr ? 'Sezon' : 'Season'} ${number}`}</h2>
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
                        <button className="episode-ready episode-action" onClick={() => onOpenVideo(local)}>
                          <CheckCircle2 size={15} /> {isTr ? 'Oynat' : 'Play'}
                        </button>
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
    </div>
  );
};

export default LibraryView;
