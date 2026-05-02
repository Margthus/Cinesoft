import React, { useState, useEffect } from 'react';
import { Search, ShieldAlert, Download, Loader2, X } from 'lucide-react';
import {
  DEFAULT_PROWLARR_CONFIG,
  searchStreamSourcesForEpisode,
  searchStreamSourcesForMovie,
} from '../sources/index.mjs';
import { fetchSeasonDetails, searchContent, fetchDetails } from '../utils/tmdb';

const formatSize = (bytes) => {
  if (!bytes) return '-';
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
};

const SourceSearchPanel = ({ item, type, settings }) => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const [seasonData, setSeasonData] = useState(null);
  const [searchSeasonData, setSearchSeasonData] = useState(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [tmdbMatch, setTmdbMatch] = useState(null);
  const [tmdbMatchAttempted, setTmdbMatchAttempted] = useState(false);
  const [searched, setSearched] = useState(false);
  const [qualityFilter, setQualityFilter] = useState('all');
  const [indexerFilter, setIndexerFilter] = useState('all');
  const [sortBy, setSortBy] = useState('seeders');
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState({});
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerLoading, setFilePickerLoading] = useState(false);
  const [filePickerSource, setFilePickerSource] = useState(null);
  const [filePickerTorrentId, setFilePickerTorrentId] = useState('');
  const [filePickerFiles, setFilePickerFiles] = useState([]);
  const [selectedFileIndexes, setSelectedFileIndexes] = useState([]);

  const prowlarrConfig = settings.prowlarr || DEFAULT_PROWLARR_CONFIG;
  const activeCount = prowlarrConfig.enabled ? 1 : 0;
  const isEpisodic = type === 'tv' || type === 'anime';

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
            const searchResults = await searchContent(settings.apiKey, 'en', title);
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
    try {
      const response = await fetch(`https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${idToUse}/external_ids?api_key=${settings.apiKey}`);
      const data = await response.json();
      return data.imdb_id;
    } catch {
      return null;
    }
  };

  const parseTorrentioSize = (title) => {
    const match = title.match(/([0-9.]+)\s*(GB|MB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return value * 1024 * 1024 * 1024;
    if (unit === 'MB') return value * 1024 * 1024;
    return 0;
  };

  const getSearchEpisodeTitle = (episodeNumber, fallbackName = '') => {
    const englishEpisode = searchSeasonData?.episodes?.find((ep) => ep.episode_number === episodeNumber);
    return englishEpisode?.name || fallbackName;
  };

  const searchTorrentioSources = async (imdbId, targetSeason, targetEpisode, isMovie) => {
    if (!imdbId) return [];
    const baseUrl = String(settings?.torrentio?.baseUrl || 'https://torrentio.strem.fun').replace(/\/+$/, '');
    const maxResults = Math.max(10, Number(settings?.torrentio?.maxResults) || 80);
    const blocked = String(settings?.torrentio?.excludeKeywords || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const url = isMovie
      ? `${baseUrl}/stream/movie/${imdbId}.json`
      : `${baseUrl}/stream/series/${imdbId}:${targetSeason}:${targetEpisode}.json`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      return (data.streams || []).map((stream, index) => {
        const titleParts = stream.title ? stream.title.split('\n') : ['Unknown Title'];
        const qMatch = stream.name ? stream.name.toLowerCase() : '';
        let quality = 'unknown';
        if (qMatch.includes('2160p') || qMatch.includes('4k')) quality = '2160p';
        else if (qMatch.includes('1080p')) quality = '1080p';
        else if (qMatch.includes('720p')) quality = '720p';
        else if (qMatch.includes('480p')) quality = '480p';

        const providerMatch = titleParts.find(p => p.includes('⚙️'));
        const provider = providerMatch ? providerMatch.split('⚙️')[1].trim() : (titleParts[0] || 'Torrentio');

        const seedersMatch = titleParts.find(p => p.includes('👤'));
        let seeders = 0;
        if (seedersMatch) {
          const s = seedersMatch.match(/👤\s*(\d+)/);
          if (s) seeders = parseInt(s[1]);
        }

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
          quality,
          size: parseTorrentioSize(stream.title || ''),
          seeders,
          languages: [],
          sourceType: 'torrent',
          infoHash: stream.infoHash,
          magnet: magnetFromUrl || magnetWithTrackers,
        };
      }).filter((stream) => {
        if (stream.provider.toLowerCase().includes('rutor')) return false;
        if (!blocked.length) return true;
        const hay = `${stream.title || ''} ${stream.provider || ''}`.toLowerCase();
        return !blocked.some((token) => hay.includes(token));
      }).slice(0, maxResults);
    } catch (e) {
      console.error('Torrentio error', e);
      return [];
    }
  };

  const handleTorrentDownload = async (source) => {
    if (!window.electronAPI?.torrentAdd) return;

    setActionLoading(prev => ({ ...prev, [source.id]: true }));

    try {
      const validation = await window.electronAPI?.validateTorrentCandidate?.({
        releaseTitle: source.title || '',
        size: source.size || 0,
        expected: {
          year: new Date(item.release_date || item.first_air_date || Date.now()).getFullYear(),
          quality: source.quality || '',
          language: settings.language || 'tr',
          season: isEpisodic ? season : 0,
          episode: isEpisodic && selectedEpisode?.episode_number ? selectedEpisode.episode_number : 0,
        },
      });
      if (validation && validation.ok === false) {
        alert(settings.language === 'en'
          ? `Blocked: ${validation.reasons?.join(', ') || 'validation failed'}`
          : `Engellendi: ${validation.reasons?.join(', ') || 'dogrulama basarisiz'}`);
        return;
      }

      const magnetOrHash = source.magnet || source.infoHash || null;
      const torrentUrl = source.torrentUrl || null;
      const displayTitle = source.title || item.title || item.name || 'Unknown';

      if (settings.useQbittorrent) {
        const result = await window.electronAPI?.qbittorrentAdd?.({
          magnetOrHash,
          torrentUrl,
          mode: 'download',
          title: displayTitle,
        }, settings.qbittorrent || {});
        if (!result || typeof result !== 'object' || !result?.ok) {
          const rawMessage = result && typeof result === 'object'
            ? (result.error || JSON.stringify(result))
            : String(result || '');
          alert(settings.language === 'en'
            ? 'Failed to add torrent: ' + (rawMessage || 'Unknown error')
            : 'Torrent eklenemedi: ' + (rawMessage || 'Bilinmeyen hata'));
        }
        return;
      }

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
          quality: source.quality,
          provider: source.provider,
        },
      });
      if (!prepared?.ok || !prepared?.id) {
        throw new Error(prepared?.error || 'Prepare failed');
      }

      let files = Array.isArray(prepared.files) ? prepared.files : [];
      if (!prepared.metadataReady) {
        for (let i = 0; i < 8 && !files.length; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const latest = await window.electronAPI.torrentGetFiles(prepared.id);
          if (latest?.ok && Array.isArray(latest.files)) {
            files = latest.files;
          }
        }
      }
      if (!files.length) {
        throw new Error(settings.language === 'en' ? 'Torrent metadata not ready' : 'Torrent metadata hazir degil');
      }

      setFilePickerTorrentId(prepared.id);
      setFilePickerFiles(files);
      setSelectedFileIndexes(files.map((file) => file.index));
      setFilePickerSource(source);
      setFilePickerOpen(true);

    } catch (err) {
      console.error('Torrent action error:', err);
      alert(settings.language === 'en' ? `Failed to add torrent: ${err.message}` : `Torrent eklenemedi: ${err.message}`);
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
      const result = await window.electronAPI.torrentSelectFiles(filePickerTorrentId, selectedFileIndexes, true);
      if (!result?.ok) {
        throw new Error(result?.error || 'Select files failed');
      }
      closePicker();
    } catch (err) {
      alert(settings.language === 'en' ? `Failed: ${err.message}` : `Islem basarisiz: ${err.message}`);
    } finally {
      setFilePickerLoading(false);
    }
  };

  const handleEpisodeSelect = async (ep) => {
    setEpisode(ep.episode_number);
    setSelectedEpisode(ep);

    setLoading(true);
    setSearched(true);
    setQualityFilter('all');
    setIndexerFilter('all');
    setSourceSearchQuery('');
    try {
      if (settings.torrentioEnabled) {
        const imdbId = await getImdbId();
        const sources = await searchTorrentioSources(imdbId, season, ep.episode_number, false);
        setResults(sources);
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
    } finally {
      setLoading(false);
    }
  };

  const handleSeasonPackSearch = async (targetSeason) => {
    setLoading(true);
    setSearched(true);
    setQualityFilter('all');
    setIndexerFilter('all');
    setSourceSearchQuery('');
    setSelectedEpisode({
      isPack: true,
      name: targetSeason === 'all'
        ? (settings.language === 'tr' ? 'Bütün Sezonlar Paketi' : 'Complete Series Pack')
        : `${settings.language === 'tr' ? 'Sezon' : 'Season'} ${targetSeason} ${settings.language === 'tr' ? 'Paketi' : 'Pack'}`,
      episode_number: null,
    });
    try {
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
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    setQualityFilter('all');
    setIndexerFilter('all');
    setSourceSearchQuery('');
    try {
      if (settings.torrentioEnabled) {
        const imdbId = await getImdbId();
        const sources = await searchTorrentioSources(imdbId, isEpisodic ? season : null, isEpisodic ? episode : null, !isEpisodic);
        setResults(sources);
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
    } finally {
      setLoading(false);
    }
  };

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
                {settings.language === 'tr' ? 'Sezon Paket İndir' : 'Season Pack'}
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
          <span>{t.noSources}</span>
        </div>
      )}

      {filteredAndSortedResults.length > 0 && (
        <div className="source-results">
          {filteredAndSortedResults.map((source) => {
            const isLoadingAction = actionLoading[source.id];
            const hasTorrentData = source.magnet || source.infoHash || source.torrentUrl;

            return (
              <div className="source-row" key={source.id}>
                <div className="source-main">
                  <span className="source-title">{source.title}</span>
                  <span className="source-subtitle">{source.provider} / {source.sourceType}</span>
                </div>
                <div className="source-badges">
                  <span>{source.quality}</span>
                  <span>{formatSize(source.size)}</span>
                  <span>{source.seeders} seed</span>
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
            <div className="torrent-file-picker-list">
              {filePickerFiles.map((file) => (
                <label key={file.index} className="torrent-file-picker-row">
                  <input
                    type="checkbox"
                    checked={selectedFileIndexes.includes(file.index)}
                    onChange={() => toggleSelectedFile(file.index)}
                  />
                  <span className="torrent-file-picker-name">{file.path || file.name}</span>
                  <span className="torrent-file-picker-size">{formatSize(file.size)}</span>
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

const searchEpisodeSources = (prowlarrConfig, payload) => {
  if (window.electronAPI?.searchEpisodeSources) {
    return window.electronAPI.searchEpisodeSources(payload);
  }
  return searchStreamSourcesForEpisode(prowlarrConfig, payload);
};

export default SourceSearchPanel;
