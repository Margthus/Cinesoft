import React, { useEffect, useState } from 'react';
import '../styles/RadarrView.css';
const formatBytes = (value = 0) => {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 GB';
  if (bytes >= 1024 ** 4) return `${(bytes / (1024 ** 4)).toFixed(2)} TB`;
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
};
const isReleasedMovie = (movie = {}) => {
  const status = String(movie?.status || '').toLowerCase();
  if (status.includes('released')) return true;
  const now = Date.now();
  const digital = movie?.digitalRelease ? new Date(movie.digitalRelease).getTime() : NaN;
  const physical = movie?.physicalRelease ? new Date(movie.physicalRelease).getTime() : NaN;
  const inCinemas = movie?.inCinemas ? new Date(movie.inCinemas).getTime() : NaN;
  if (Number.isFinite(digital) && digital <= now) return true;
  if (Number.isFinite(physical) && physical <= now) return true;
  if (Number.isFinite(inCinemas) && inCinemas <= now) return true;
  return false;
};
const isCutoffUnmetMovie = (movie = {}) => movie?.qualityCutoffNotMet === true || movie?.movieFile?.qualityCutoffNotMet === true;
const getReleaseQualityName = (release = {}) => String(release?.quality?.quality?.name || release?.quality?.name || release?.quality || '-');
const formatReleaseSize = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value <= 0) return '-';
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
};
const getQualityRank = (qualityName = '') => {
  const value = String(qualityName || '').toLowerCase();
  let rank = 0;
  if (value.includes('2160') || value.includes('4k')) rank += 4000;
  else if (value.includes('1080')) rank += 3000;
  else if (value.includes('720')) rank += 2000;
  else if (value.includes('480')) rank += 1000;
  if (value.includes('bluray')) rank += 80;
  if (value.includes('webdl') || value.includes('web-dl')) rank += 70;
  if (value.includes('webrip')) rank += 60;
  if (value.includes('hdtv')) rank += 40;
  return rank;
};
const extractRejectedReason = (release = {}) => {
  const rows = Array.isArray(release?.rejections) ? release.rejections : [];
  if (!rows.length) return '';
  return rows.map((entry) => (typeof entry === 'string' ? entry : String(entry?.reason || entry?.message || entry?.type || '').trim())).filter(Boolean).join(', ');
};
const formatEta = (seconds = 0) => {
  const s = Number(seconds) || 0;
  if (!Number.isFinite(s) || s <= 0) return '-';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
};

const normalizeMediaText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findBestQbTorrentForMovie = (movie, torrents = []) => {
  const title = normalizeMediaText(movie?.title || movie?.sortTitle || '');
  if (!title) return null;
  const year = String(movie?.year || '').trim();
  const titleTokens = title.split(' ').filter((token) => token.length >= 3);

  let best = null;
  let bestScore = 0;
  for (const torrent of torrents) {
    const name = normalizeMediaText(torrent?.name || '');
    if (!name) continue;
    let score = 0;
    if (name.includes(title)) score += 5;
    for (const token of titleTokens) {
      if (name.includes(token)) score += 1;
    }
    if (year && name.includes(year)) score += 2;
    if (String(torrent?.state || '').toLowerCase().includes('dl')) score += 1;
    if (score > bestScore) {
      best = torrent;
      bestScore = score;
    }
  }

  if (!best || bestScore < 4) return null;
  return best;
};

const getMovieQualityName = (movie = {}, qualityProfiles = []) => {
  const direct = movie?.qualityProfile?.name || movie?.qualityProfileName;
  if (direct) return String(direct);
  const id = Number(movie?.qualityProfileId ?? movie?.qualityProfile?.id ?? 0);
  if (!id) return '-';
  const found = (Array.isArray(qualityProfiles) ? qualityProfiles : []).find((profile) => Number(profile?.id || 0) === id);
  return found?.name ? String(found.name) : '-';
};

const RadarrView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [removingId, setRemovingId] = useState(null);
  const [editingMovie, setEditingMovie] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [editRootFolder, setEditRootFolder] = useState('');
  const [editQualityProfileId, setEditQualityProfileId] = useState('');
  const [editMonitored, setEditMonitored] = useState(true);
  const [qbProgressByMovie, setQbProgressByMovie] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const [viewMode, setViewMode] = useState('grid');
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeMovieId, setActiveMovieId] = useState(null);
  const [selectedMovieIds, setSelectedMovieIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState('');
  const [manualSearchModal, setManualSearchModal] = useState({
    open: false,
    movieId: 0,
    movieTitle: '',
    loading: false,
    error: '',
    releases: [],
    grabbingGuid: '',
  });
  const [removeModal, setRemoveModal] = useState({
    open: false,
    movieIds: [],
    title: '',
    deleteFiles: false,
  });
  const [manualReleaseSort, setManualReleaseSort] = useState({ key: '', direction: 'desc' });
  const [health, setHealth] = useState({
    radarr: { ok: false },
    prowlarr: { ok: false },
    downloadClient: { ok: false },
  });

  const getRadarrConnectionSettings = () => ({
    radarrEnabled: settings.radarrEnabled === true,
    radarrBaseUrl: settings.radarrBaseUrl,
    radarrApiKey: settings.radarrApiKey,
    radarrTimeout: settings.radarrTimeout || 10000,
  });

  const classifyConnectionError = (message = '') => {
    const text = String(message || '').toLowerCase();
    if (!text) return 'unreachable';
    if (text.includes('authentication failed') || text.includes('api key')) return 'api_key_invalid';
    if (text.includes('connect') || text.includes('timed out') || text.includes('unreachable')) return 'unreachable';
    return 'unreachable';
  };

  const loadMovies = async ({ silent = false } = {}) => {
    if (!settings?.radarrEnabled || !settings?.radarrBaseUrl || !settings?.radarrApiKey) {
      setStatus('disabled');
      setItems([]);
      return;
    }
    if (!silent) setStatus('loading');
    try {
      const [result, qualityRes] = await Promise.all([
        window.electronAPI?.radarrGetMovies?.(getRadarrConnectionSettings()),
        window.electronAPI?.radarrGetQualityProfiles?.(getRadarrConnectionSettings()),
      ]);
      if (!result?.ok) {
        setStatus('error');
        setItems([]);
        return;
      }
      setQualityProfiles(Array.isArray(qualityRes?.items) ? qualityRes.items : []);
      const nextItems = Array.isArray(result.items) ? result.items : [];
      setItems(nextItems);
      setStatus('ready');
      refreshQbProgress(nextItems).catch(() => {});
    } catch {
      setStatus('error');
      setItems([]);
    }
  };

  useEffect(() => {
    loadMovies();
  }, [settings?.radarrEnabled, settings?.radarrBaseUrl, settings?.radarrApiKey]);


  const runMovieAction = async (key, task) => {
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await task();
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const searchMovie = async (movieId) => {
    const id = Number(movieId || 0);
    if (!id) return;
    const key = `search-${id}`;
    await runMovieAction(key, async () => {
      const result = await window.electronAPI?.radarrSearchMovie?.({
        movieId: id,
        settings: getRadarrConnectionSettings(),
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not start movie search.');
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Film aramasi baslatilamadi: ${error.message}` : `Could not start movie search: ${error.message}`);
    });
  };

  const autoDownloadMovie = async (movie) => {
    const id = Number(movie?.id || 0);
    if (!id) return;
    const key = `auto-${id}`;
    await runMovieAction(key, async () => {
      if (movie?.monitored !== true) {
        const updateRes = await window.electronAPI?.radarrUpdateMovie?.({
          movieId: id,
          settings: getRadarrConnectionSettings(),
          movie: { monitored: true },
        });
        if (!updateRes?.ok) throw new Error(updateRes?.error || 'Could not enable monitoring.');
        setItems((prev) => prev.map((entry) => (Number(entry?.id) === id ? { ...entry, monitored: true } : entry)));
      }
      const searchRes = await window.electronAPI?.radarrSearchMovie?.({
        movieId: id,
        settings: getRadarrConnectionSettings(),
      });
      if (!searchRes?.ok) throw new Error(searchRes?.error || 'Could not start movie search.');
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Otomatik indirme baslatilamadi: ${error.message}` : `Could not start auto download: ${error.message}`);
    });
  };

  const toggleMovieSelection = (movieId) => {
    const id = Number(movieId || 0);
    if (!id) return;
    setSelectedMovieIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runBulkAction = async (key, task) => {
    if (!selectedMovieIds.length) return;
    setBulkBusy(key);
    try {
      await task();
    } finally {
      setBulkBusy('');
    }
  };

  const bulkSearch = async () => runBulkAction('search', async () => {
    for (const movieId of selectedMovieIds) {
      // eslint-disable-next-line no-await-in-loop
      await searchMovie(movieId);
    }
  });

  const bulkSetMonitored = async (monitored) => runBulkAction(monitored ? 'monitor' : 'unmonitor', async () => {
    for (const movieId of selectedMovieIds) {
      // eslint-disable-next-line no-await-in-loop
      await window.electronAPI?.radarrUpdateMovie?.({
        movieId,
        settings: getRadarrConnectionSettings(),
        movie: { monitored: monitored === true },
      });
    }
    setItems((prev) => prev.map((entry) => (
      selectedMovieIds.includes(Number(entry?.id || 0)) ? { ...entry, monitored: monitored === true } : entry
    )));
  });

  const bulkRefreshScan = async () => runBulkAction('refresh', async () => {
    for (const movieId of selectedMovieIds) {
      // eslint-disable-next-line no-await-in-loop
      await window.electronAPI?.radarrRefreshAndScanMovie?.({ movieId, settings: getRadarrConnectionSettings() });
    }
  });

  const bulkDelete = async () => {
    if (!selectedMovieIds.length) return;
    setRemoveModal({
      open: true,
      movieIds: [...selectedMovieIds],
      title: settings?.language === 'tr' ? `${selectedMovieIds.length} film` : `${selectedMovieIds.length} movies`,
      deleteFiles: false,
    });
  };

  const openManualSearchModal = async (movie = {}) => {
    const movieId = Number(movie?.id || 0);
    if (!movieId) return;
    setManualReleaseSort({ key: '', direction: 'desc' });
    setManualSearchModal({
      open: true,
      movieId,
      movieTitle: String(movie?.title || 'Movie'),
      loading: true,
      error: '',
      releases: [],
      grabbingGuid: '',
    });
    try {
      const result = await window.electronAPI?.radarrGetMovieReleases?.({
        settings: getRadarrConnectionSettings(),
        movieId,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not load releases.');
      setManualSearchModal((prev) => ({ ...prev, loading: false, releases: Array.isArray(result.items) ? result.items : [] }));
    } catch (error) {
      setManualSearchModal((prev) => ({ ...prev, loading: false, error: String(error?.message || error || 'Could not load releases.') }));
    }
  };

  const toggleManualReleaseSort = (key) => {
    setManualReleaseSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const getManualSortLabel = (key) => {
    if (manualReleaseSort.key !== key) return '';
    return manualReleaseSort.direction === 'desc' ? ' ↓' : ' ↑';
  };

  const closeManualSearchModal = () => {
    setManualSearchModal({
      open: false,
      movieId: 0,
      movieTitle: '',
      loading: false,
      error: '',
      releases: [],
      grabbingGuid: '',
    });
  };

  const grabMovieRelease = async (release = {}) => {
    const guid = String(release?.guid || release?.downloadUrl || '');
    if (!guid || manualSearchModal.grabbingGuid) return;
    setManualSearchModal((prev) => ({ ...prev, grabbingGuid: guid }));
    try {
      const result = await window.electronAPI?.radarrGrabMovieRelease?.({
        settings: getRadarrConnectionSettings(),
        release,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not grab release.');
      closeManualSearchModal();
    } catch (error) {
      setManualSearchModal((prev) => ({ ...prev, grabbingGuid: '', error: String(error?.message || error || 'Could not grab release.') }));
    }
  };

  const refreshQbProgress = async (moviesArg) => {
    const movies = Array.isArray(moviesArg) ? moviesArg : items;
    if (!movies.length || settings?.qbittorrentEnabled === false) {
      setQbProgressByMovie({});
      return;
    }
    const qbConfig = settings?.qbittorrent || {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    };
    const result = await window.electronAPI?.qbittorrentGetTorrents?.(qbConfig);
    if (!result?.ok || !Array.isArray(result.items)) {
      setQbProgressByMovie({});
      return;
    }

    const map = {};
    for (const movie of movies) {
      const match = findBestQbTorrentForMovie(movie, result.items);
      if (!match) continue;
      const movieId = Number(movie?.id || 0);
      if (!movieId) continue;
      map[movieId] = {
        progress: Math.max(0, Math.min(100, Number(match.progress || 0))),
        state: String(match.state || ''),
        etaSeconds: Number(match.downloadSpeed || 0) > 0 ? Math.round(Number(match.amountLeft || 0) / Number(match.downloadSpeed || 1)) : 0,
        client: 'qBittorrent',
      };
    }
    setQbProgressByMovie(map);
  };

  useEffect(() => {
    if (status !== 'ready' || !items.length) return undefined;
    const timer = setInterval(() => {
      refreshQbProgress(items).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [status, items, settings?.qbittorrentEnabled, settings?.qbittorrent?.baseUrl, settings?.qbittorrent?.username, settings?.qbittorrent?.password]);

  useEffect(() => {
    if (!settings?.radarrEnabled || !settings?.radarrBaseUrl || !settings?.radarrApiKey) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadMovies({ silent: true }).catch(() => {});
    }, 7000);
    return () => clearInterval(timer);
  }, [settings?.radarrEnabled, settings?.radarrBaseUrl, settings?.radarrApiKey]);

  useEffect(() => {
    let mounted = true;
    const runHealthCheck = async () => {
      const radarrSettings = getRadarrConnectionSettings();
      const prowlarrCfg = settings?.prowlarr || {};
      const qbPayload = {
        settings: radarrSettings,
        qbittorrent: settings?.qbittorrent || {},
      };

      const [radarrRes, prowlarrRes, clientRes] = await Promise.all([
        window.electronAPI?.radarrTestConnection?.(radarrSettings),
        (prowlarrCfg?.enabled && prowlarrCfg?.baseUrl && prowlarrCfg?.apiKey)
          ? window.electronAPI?.testProwlarrConnection?.(prowlarrCfg)
          : Promise.resolve({ ok: false, error: 'missing' }),
        window.electronAPI?.radarrCheckQbittorrentClient?.(qbPayload),
      ]);

      if (!mounted) return;
      setHealth({
        radarr: radarrRes?.ok
          ? { ok: true }
          : { ok: false, reason: classifyConnectionError(radarrRes?.error) },
        prowlarr: prowlarrRes?.ok
          ? { ok: true }
          : { ok: false, reason: prowlarrRes?.error === 'missing' ? 'missing' : classifyConnectionError(prowlarrRes?.error) },
        downloadClient: clientRes?.ok && clientRes?.exists === true && clientRes?.matches === true
          ? { ok: true }
          : { ok: false, reason: clientRes?.ok && clientRes?.exists === false ? 'missing' : (clientRes?.ok ? 'mismatch' : classifyConnectionError(clientRes?.error)) },
      });
    };

    runHealthCheck().catch(() => {});
    const timer = setInterval(() => {
      if (document.hidden) return;
      runHealthCheck().catch(() => {});
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [
    settings?.radarrEnabled,
    settings?.radarrBaseUrl,
    settings?.radarrApiKey,
    settings?.prowlarr?.enabled,
    settings?.prowlarr?.baseUrl,
    settings?.prowlarr?.apiKey,
    settings?.qbittorrent?.baseUrl,
    settings?.qbittorrent?.username,
    settings?.qbittorrent?.password,
  ]);

  const handleRemove = async (movie) => {
    const id = Number(movie?.id || 0);
    if (!id) return;
    const title = String(movie?.title || (settings?.language === 'tr' ? 'film' : 'movie'));
    setRemoveModal({
      open: true,
      movieIds: [id],
      title,
      deleteFiles: false,
    });
  };

  const confirmRemoveModal = async () => {
    const movieIds = Array.isArray(removeModal.movieIds) ? removeModal.movieIds.map((id) => Number(id || 0)).filter(Boolean) : [];
    if (!movieIds.length) {
      setRemoveModal({ open: false, movieIds: [], title: '', deleteFiles: false });
      return;
    }
    const deleteFiles = removeModal.deleteFiles === true;
    setRemoveModal({ open: false, movieIds: [], title: '', deleteFiles: false });

    if (movieIds.length === 1) setRemovingId(movieIds[0]);
    await runBulkAction('delete', async () => {
      for (const movieId of movieIds) {
        // eslint-disable-next-line no-await-in-loop
        const result = await window.electronAPI?.radarrDeleteMovie?.({
          movieId,
          settings: getRadarrConnectionSettings(),
          options: { deleteFiles, addImportExclusion: true },
        });
        if (!result?.ok) throw new Error(result?.error || 'Could not remove movie from Radarr.');
      }
      setItems((prev) => prev.filter((entry) => !movieIds.includes(Number(entry?.id || 0))));
      setSelectedMovieIds((prev) => prev.filter((id) => !movieIds.includes(Number(id || 0))));
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Film kaldirilamadi: ${error.message}` : `Could not remove movie: ${error.message}`);
    });
    setRemovingId(null);
  };

  const openEditModal = async (movie) => {
    setEditingMovie(movie || null);
    setEditLoading(true);
    setEditRootFolder(String(movie?.rootFolderPath || ''));
    setEditQualityProfileId(String(movie?.qualityProfileId ?? ''));
    setEditMonitored(movie?.monitored === true);
    try {
      const [rootRes, qualityRes] = await Promise.all([
        window.electronAPI?.radarrGetRootFolders?.(getRadarrConnectionSettings()),
        window.electronAPI?.radarrGetQualityProfiles?.(getRadarrConnectionSettings()),
      ]);
      const roots = Array.isArray(rootRes?.items) ? rootRes.items : [];
      const profiles = Array.isArray(qualityRes?.items) ? qualityRes.items : [];
      setRootFolders(roots);
      setQualityProfiles(profiles);
      if (!String(movie?.rootFolderPath || '') && roots[0]?.path) {
        setEditRootFolder(roots[0].path);
      }
      if ((movie?.qualityProfileId == null || movie?.qualityProfileId === '') && profiles[0]?.id != null) {
        setEditQualityProfileId(String(profiles[0].id));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const closeEditModal = () => {
    setEditingMovie(null);
    setRootFolders([]);
    setEditRootFolder('');
    setEditQualityProfileId('');
    setEditMonitored(true);
    setEditLoading(false);
  };

  const handleSaveEdit = async () => {
    const movieId = Number(editingMovie?.id || 0);
    if (!movieId || !editRootFolder || !editQualityProfileId) return;
    setEditLoading(true);
    try {
      const result = await window.electronAPI?.radarrUpdateMovie?.({
        movieId,
        settings: getRadarrConnectionSettings(),
        movie: {
          rootFolderPath: String(editRootFolder || ''),
          qualityProfileId: Number(editQualityProfileId),
          monitored: editMonitored === true,
        },
      });
      if (!result?.ok) {
        alert(result?.error || 'Could not update movie in Radarr.');
        return;
      }
      setItems((prev) => prev.map((entry) => (
        Number(entry?.id) === movieId
          ? {
              ...entry,
              rootFolderPath: String(editRootFolder || entry?.rootFolderPath || ''),
              qualityProfileId: Number(editQualityProfileId),
              monitored: editMonitored === true,
            }
          : entry
      )));
      closeEditModal();
    } catch {
      alert(settings?.language === 'tr' ? 'Film ayarlari guncellenemedi.' : 'Could not update movie settings.');
    } finally {
      setEditLoading(false);
    }
  };

  const t = settings?.language === 'tr'
    ? {
        title: 'Radarr',
        subtitle: '',
        refresh: 'Yenile',
        remove: 'Kaldir',
        edit: 'Duzenle',
        removing: 'Kaldiriliyor...',
        save: 'Kaydet',
        cancel: 'Iptal',
        rootFolder: 'Root Folder',
        qualityProfile: 'Kalite Profili',
        monitoredEdit: 'Takipte',
        searchAfterAdd: 'Eklemeden sonra ara',
        downloadProgress: 'Indirme',
        loading: 'Yukleniyor...',
        selectRoot: 'Root folder sec',
        selectQuality: 'Kalite profili sec',
        disabled: 'Radarr etkin degil veya baglanti ayarlari eksik.',
        error: 'Radarr film listesi alinamadi.',
        empty: 'Radarr icinde henuz film yok.',
        monitored: 'Takipte',
        unmonitored: 'Takipte degil',
        statusLabel: 'Durum',
        availabilityLabel: 'Mevcutluk',
        downloadedLabel: 'Indirildi',
        qualityLabel: 'Kalite',
        rootLabel: 'Root',
        pathLabel: 'Path',
        sizeLabel: 'Disk boyutu',
        minAvailabilityLabel: 'Min. mevcutluk',
        yes: 'Evet',
        no: 'Hayir',
        statusNotDownloaded: 'Indirilmedi',
        stateMissing: 'Missing',
        stateDownloading: 'Downloading',
        stateDownloaded: 'Downloaded',
        stateImported: 'Imported',
        stateCutoffUnmet: 'Cutoff unmet',
        downloadedDone: 'Indi',
        etaLabel: 'ETA',
        clientLabel: 'Client',
        search: 'Ara',
        autoDownload: 'Oto indir',
        openInRadarr: "Radarr'da ac",
        openDetails: 'Detay',
        drawerOverview: 'Ozet',
        drawerFileInfo: 'Dosya bilgisi',
        actionManualSearch: 'Manual Search',
        actionAutoSearch: 'Auto Search',
        actionRefreshScan: 'Refresh & Scan',
        actionEditMovie: 'Edit Movie',
        actionDeleteMovie: 'Delete from Radarr',
        removeTitleSingle: 'Filmi kaldir',
        removeTitleBulk: 'Filmleri kaldir',
        removeConfirmSingle: '"{title}" Radarr listesinden kaldirilsin mi?',
        removeConfirmBulk: '{count} film Radarr listesinden kaldirilsin mi?',
        removeDeleteFiles: 'Klasordeki dosyalari da tamamen sil',
        manualSearchTitle: 'Manual Search',
        releaseName: 'Release Name',
        indexer: 'Indexer',
        quality: 'Quality',
        size: 'Size',
        seeders: 'Seeders',
        age: 'Age',
        releaseStatus: 'Status',
        actions: 'Actions',
        statusApproved: 'Approved',
        statusRejected: 'Rejected',
        manualSearchEmpty: 'Release bulunamadi.',
        grab: 'Indir',
        viewGrid: 'Grid',
        viewTable: 'Tablo',
        filterAll: 'Tum',
        filterMissing: 'Eksik',
        filterDownloaded: 'Indirilen',
        filterMonitored: 'Takipte',
        filterUnmonitored: 'Takip disi',
        filterReleased: 'Yayinda',
        filterNotReleased: 'Yayinda degil',
        filterCutoffUnmet: 'Cutoff alti',
        colMovie: 'Film',
        colYear: 'Yil',
        colStatus: 'Durum',
        colDownloaded: 'Indirildi',
        colQualityProfile: 'Kalite Profili',
        colRootFolder: 'Root Folder',
        colSize: 'Boyut',
        colMonitoring: 'Takip',
        colActions: 'Aksiyon',
        selectedCount: 'film secili',
        bulkSearch: 'Secililerde ara',
        bulkMonitor: 'Takibe al',
        bulkUnmonitor: 'Takipten cikar',
        bulkRefresh: 'Yenile & Tara',
        bulkDelete: 'Sil',
        selectAllVisible: 'Hepsini sec',
        unselectAllVisible: 'Secimi temizle',
        totalMovies: 'Toplam Film',
        missingCount: 'Eksik',
        downloadedCount: 'Indirilen',
        cutoffUnmetCount: 'Cutoff alti',
        unmonitoredCount: 'Takip disi',
        radarrConnected: 'Radarr bagli',
        radarrUnreachable: 'Radarr ulasilamiyor',
        apiKeyInvalid: 'API key gecersiz',
        prowlarrConnected: 'Prowlarr bagli',
        prowlarrMissing: 'Prowlarr eksik',
        prowlarrUnreachable: 'Prowlarr ulasilamiyor',
        downloadClientConnected: 'Download Client bagli',
        downloadClientMissing: 'Download Client eksik',
        downloadClientMismatch: 'Download Client uyumsuz',
      }
    : {
        title: 'Radarr',
        subtitle: '',
        refresh: 'Refresh',
        remove: 'Remove',
        edit: 'Edit',
        removing: 'Removing...',
        save: 'Save',
        cancel: 'Cancel',
        rootFolder: 'Root Folder',
        qualityProfile: 'Quality Profile',
        monitoredEdit: 'Monitored',
        searchAfterAdd: 'Search After Add',
        downloadProgress: 'Download',
        loading: 'Loading...',
        selectRoot: 'Select root folder',
        selectQuality: 'Select quality profile',
        disabled: 'Radarr is disabled or connection settings are missing.',
        error: 'Could not load Radarr movies.',
        empty: 'No movies found in Radarr.',
        monitored: 'Monitored',
        unmonitored: 'Unmonitored',
        statusLabel: 'Status',
        availabilityLabel: 'Availability',
        downloadedLabel: 'Downloaded',
        qualityLabel: 'Quality',
        rootLabel: 'Root',
        pathLabel: 'Path',
        sizeLabel: 'Size on Disk',
        minAvailabilityLabel: 'Min Availability',
        yes: 'Yes',
        no: 'No',
        statusNotDownloaded: 'Not downloaded',
        stateMissing: 'Missing',
        stateDownloading: 'Downloading',
        stateDownloaded: 'Downloaded',
        stateImported: 'Imported',
        stateCutoffUnmet: 'Cutoff unmet',
        downloadedDone: 'Downloaded',
        etaLabel: 'ETA',
        clientLabel: 'Client',
        search: 'Search',
        autoDownload: 'Auto Download',
        openInRadarr: 'Open in Radarr',
        openDetails: 'Details',
        drawerOverview: 'Overview',
        drawerFileInfo: 'File info',
        actionManualSearch: 'Manual Search',
        actionAutoSearch: 'Auto Search',
        actionRefreshScan: 'Refresh & Scan',
        actionEditMovie: 'Edit Movie',
        actionDeleteMovie: 'Delete from Radarr',
        removeTitleSingle: 'Remove movie',
        removeTitleBulk: 'Remove movies',
        removeConfirmSingle: 'Remove "{title}" from Radarr?',
        removeConfirmBulk: 'Remove {count} movies from Radarr?',
        removeDeleteFiles: 'Also delete files from disk',
        manualSearchTitle: 'Manual Search',
        releaseName: 'Release Name',
        indexer: 'Indexer',
        quality: 'Quality',
        size: 'Size',
        seeders: 'Seeders',
        age: 'Age',
        releaseStatus: 'Status',
        actions: 'Actions',
        statusApproved: 'Approved',
        statusRejected: 'Rejected',
        manualSearchEmpty: 'No releases found.',
        grab: 'Grab',
        viewGrid: 'Grid',
        viewTable: 'Table',
        filterAll: 'All',
        filterMissing: 'Missing',
        filterDownloaded: 'Downloaded',
        filterMonitored: 'Monitored',
        filterUnmonitored: 'Unmonitored',
        filterReleased: 'Released',
        filterNotReleased: 'Not Released',
        filterCutoffUnmet: 'Cutoff Unmet',
        colMovie: 'Movie',
        colYear: 'Year',
        colStatus: 'Status',
        colDownloaded: 'Downloaded',
        colQualityProfile: 'Quality Profile',
        colRootFolder: 'Root Folder',
        colSize: 'Size',
        colMonitoring: 'Monitoring',
        colActions: 'Actions',
        selectedCount: 'movies selected',
        bulkSearch: 'Search selected',
        bulkMonitor: 'Monitor',
        bulkUnmonitor: 'Unmonitor',
        bulkRefresh: 'Refresh',
        bulkDelete: 'Delete',
        selectAllVisible: 'Select all',
        unselectAllVisible: 'Clear selection',
        totalMovies: 'Total Movies',
        missingCount: 'Missing',
        downloadedCount: 'Downloaded',
        cutoffUnmetCount: 'Cutoff Unmet',
        unmonitoredCount: 'Unmonitored',
        radarrConnected: 'Radarr Connected',
        radarrUnreachable: 'Radarr unreachable',
        apiKeyInvalid: 'API key invalid',
        prowlarrConnected: 'Prowlarr Connected',
        prowlarrMissing: 'Prowlarr missing',
        prowlarrUnreachable: 'Prowlarr unreachable',
        downloadClientConnected: 'Download Client Connected',
        downloadClientMissing: 'Download client missing',
        downloadClientMismatch: 'Download client mismatch',
      };

  const radarrHealthText = health.radarr.ok
    ? t.radarrConnected
    : (health.radarr.reason === 'api_key_invalid' ? t.apiKeyInvalid : t.radarrUnreachable);
  const prowlarrHealthText = health.prowlarr.ok
    ? t.prowlarrConnected
    : (health.prowlarr.reason === 'missing' ? t.prowlarrMissing : t.prowlarrUnreachable);
  const clientHealthText = health.downloadClient.ok
    ? t.downloadClientConnected
    : (health.downloadClient.reason === 'missing' ? t.downloadClientMissing : health.downloadClient.reason === 'mismatch' ? t.downloadClientMismatch : t.radarrUnreachable);
  const filterTabs = [
    { key: 'all', label: t.filterAll },
    { key: 'missing', label: t.filterMissing },
    { key: 'downloaded', label: t.filterDownloaded },
    { key: 'monitored', label: t.filterMonitored },
    { key: 'unmonitored', label: t.filterUnmonitored },
    { key: 'released', label: t.filterReleased },
    { key: 'notReleased', label: t.filterNotReleased },
    { key: 'cutoffUnmet', label: t.filterCutoffUnmet },
  ];
  const filteredItems = items.filter((movie) => {
    const downloaded = movie?.hasFile === true || Number(movie?.sizeOnDisk || movie?.movieFile?.size || 0) > 0;
    const monitored = movie?.monitored === true;
    const released = isReleasedMovie(movie);
    const cutoffUnmet = isCutoffUnmetMovie(movie);
    if (activeFilter === 'missing') return !downloaded;
    if (activeFilter === 'downloaded') return downloaded;
    if (activeFilter === 'monitored') return monitored;
    if (activeFilter === 'unmonitored') return !monitored;
    if (activeFilter === 'released') return released;
    if (activeFilter === 'notReleased') return !released;
    if (activeFilter === 'cutoffUnmet') return cutoffUnmet;
    return true;
  });
  const totalMoviesCount = items.length;
  const missingCount = items.filter((movie) => !(movie?.hasFile === true || Number(movie?.sizeOnDisk || movie?.movieFile?.size || 0) > 0)).length;
  const downloadedCount = items.filter((movie) => (movie?.hasFile === true || Number(movie?.sizeOnDisk || movie?.movieFile?.size || 0) > 0)).length;
  const cutoffUnmetCount = items.filter((movie) => isCutoffUnmetMovie(movie)).length;
  const unmonitoredCount = items.filter((movie) => movie?.monitored !== true).length;
  const visibleMovieIds = filteredItems.map((movie) => Number(movie?.id || 0)).filter(Boolean);
  const allVisibleSelected = visibleMovieIds.length > 0 && visibleMovieIds.every((id) => selectedMovieIds.includes(id));
  const activeMovie = items.find((entry) => Number(entry?.id || 0) === Number(activeMovieId || 0)) || null;
  const sortedManualReleases = manualReleaseSort.key
    ? manualSearchModal.releases.slice().sort((a, b) => {
        const direction = manualReleaseSort.direction === 'asc' ? 1 : -1;
        if (manualReleaseSort.key === 'size') {
          return (Number(a?.size || 0) - Number(b?.size || 0)) * direction;
        }
        if (manualReleaseSort.key === 'seeders') {
          return (Number(a?.seeders || 0) - Number(b?.seeders || 0)) * direction;
        }
        if (manualReleaseSort.key === 'quality') {
          return (getQualityRank(getReleaseQualityName(a)) - getQualityRank(getReleaseQualityName(b))) * direction;
        }
        return 0;
      })
    : manualSearchModal.releases;

  return (
    <div className="radarr-view">
      <header className="radarr-view-header">
        <div>
          <h1>{t.title}</h1>
          {t.subtitle ? <p>{t.subtitle}</p> : null}
          <div className="sonarr-health-strip">
            <span className={`sonarr-health-item ${health.radarr.ok ? 'ok' : 'off'}`}>{radarrHealthText}</span>
            <span className={`sonarr-health-item ${health.prowlarr.ok ? 'ok' : 'off'}`}>{prowlarrHealthText}</span>
            <span className={`sonarr-health-item ${health.downloadClient.ok ? 'ok' : 'off'}`}>{clientHealthText}</span>
          </div>
        </div>
        <div className="radarr-header-actions">
          <div className="radarr-view-switch" role="tablist" aria-label="Radarr view mode">
            <button
              type="button"
              className={`radarr-view-switch-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
            >
              {t.viewGrid}
            </button>
            <button
              type="button"
              className={`radarr-view-switch-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              {t.viewTable}
            </button>
          </div>
          <button type="button" className="radarr-refresh-btn" onClick={loadMovies}>
            {t.refresh}
          </button>
        </div>
      </header>

      {status === 'disabled' && <div className="radarr-note">{t.disabled}</div>}
      {status === 'error' && <div className="radarr-note radarr-note-error">{t.error}</div>}
      {status === 'ready' && items.length === 0 && <div className="radarr-note">{t.empty}</div>}
      {status === 'ready' && items.length > 0 && (
        <div className="radarr-summary-row">
          <div className="radarr-summary-card"><small>{t.totalMovies}</small><strong>{totalMoviesCount}</strong></div>
          <div className="radarr-summary-card"><small>{t.missingCount}</small><strong>{missingCount}</strong></div>
          <div className="radarr-summary-card"><small>{t.downloadedCount}</small><strong>{downloadedCount}</strong></div>
          <div className="radarr-summary-card"><small>{t.cutoffUnmetCount}</small><strong>{cutoffUnmetCount}</strong></div>
          <div className="radarr-summary-card"><small>{t.unmonitoredCount}</small><strong>{unmonitoredCount}</strong></div>
        </div>
      )}
      {status === 'ready' && items.length > 0 && (
        <div className="radarr-filter-bar">
          <button
            type="button"
            className={`radarr-select-all-chip ${allVisibleSelected ? 'active' : ''}`}
            onClick={() => {
              if (allVisibleSelected) {
                setSelectedMovieIds((prev) => prev.filter((id) => !visibleMovieIds.includes(id)));
              } else {
                setSelectedMovieIds((prev) => Array.from(new Set([...prev, ...visibleMovieIds])));
              }
            }}
          >
            <span className={`radarr-select-all-box ${allVisibleSelected ? 'checked' : ''}`} />
            {allVisibleSelected ? t.unselectAllVisible : t.selectAllVisible}
          </button>
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`radarr-filter-chip ${activeFilter === tab.key ? 'active' : ''}`}
              onClick={() => setActiveFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {status === 'ready' && filteredItems.length === 0 && items.length > 0 && <div className="radarr-note">{t.empty}</div>}
      {status === 'ready' && filteredItems.length > 0 && viewMode === 'grid' && (
        <section className="radarr-grid">
          {filteredItems.map((movie) => {
            const title = movie?.title || movie?.sortTitle || 'Unknown';
            const year = movie?.year ? `(${movie.year})` : '';
            const poster = movie?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl || '';
            const monitored = movie?.monitored === true;
            const movieId = Number(movie?.id || 0);
            const qbProgress = qbProgressByMovie[movieId];
            const progressValue = Number(qbProgress?.progress || 0);
            const hasQbProgress = Boolean(
              qbProgress
              && Number.isFinite(progressValue)
              && progressValue > 0
              && progressValue < 100
            );
            const qualityName = getMovieQualityName(movie, qualityProfiles);
            const minAvailability = String(movie?.minimumAvailability || '-');
            const availability = String(movie?.physicalRelease || movie?.digitalRelease || movie?.inCinemas || movie?.minimumAvailability || '-');
            const downloaded = movie?.hasFile === true || Number(movie?.sizeOnDisk || movie?.movieFile?.size || 0) > 0;
            const statusText = downloaded ? t.monitored : t.statusNotDownloaded;
            const sizeOnDisk = formatBytes(movie?.sizeOnDisk || movie?.movieFile?.size || 0);
            const cutoffUnmet = isCutoffUnmetMovie(movie);
            const qbState = String(qbProgress?.state || '').toLowerCase();
            const isDownloading = Boolean(
              qbProgress
              && Number(qbProgress?.progress || 0) > 0
              && Number(qbProgress?.progress || 0) < 100
            );
            const isDownloadedNotImported = Boolean(qbProgress && Number(qbProgress?.progress || 0) >= 100 && !downloaded);
            const lifecycle = [];
            if (!downloaded && !isDownloading && !isDownloadedNotImported) lifecycle.push(t.stateMissing);
            if (isDownloading) lifecycle.push(t.stateDownloading);
            if (isDownloadedNotImported) lifecycle.push(t.stateDownloaded);
            if (downloaded) lifecycle.push(t.stateImported);
            if (cutoffUnmet) lifecycle.push(t.stateCutoffUnmet);
            const actionSearchKey = `search-${movieId}`;
            const actionAutoKey = `auto-${movieId}`;
            return (
              <article key={movieId || `${title}-${year}`} className="radarr-card" onClick={() => setActiveMovieId(movieId)}>
                <div className="radarr-select-wrap" onClick={(event) => event.stopPropagation()}>
                  <input className="radarr-row-checkbox" type="checkbox" checked={selectedMovieIds.includes(movieId)} onChange={() => toggleMovieSelection(movieId)} />
                </div>
                <div className="radarr-poster-wrap">
                  {poster ? <img src={poster} alt={title} className="radarr-poster" /> : <div className="radarr-poster-fallback">{title.slice(0, 1)}</div>}
                </div>
                {hasQbProgress && (
                  <div className="radarr-progress-wrap" aria-label={`${t.downloadProgress} ${Math.round(qbProgress.progress)}%`}>
                    <div className="radarr-progress-track">
                      <div className="radarr-progress-fill" style={{ width: `${progressValue}%` }} />
                    </div>
                    <span className="radarr-progress-text">{Math.round(progressValue)}%</span>
                  </div>
                )}
                <div className="radarr-meta">
                  <strong>{title} {year}</strong>
                  <span className={monitored ? 'ok' : 'off'}>{monitored ? t.monitored : t.unmonitored}</span>
                </div>
                <div className="radarr-lifecycle-row">
                  {lifecycle.map((state) => (
                    <span key={`${movieId}-${state}`} className="radarr-life-chip">{state}</span>
                  ))}
                </div>
                {isDownloading && (
                  <div className="radarr-download-live">
                    <strong>{t.stateDownloading} · {Math.round(Number(qbProgress?.progress || 0))}%</strong>
                    <span>{t.etaLabel}: {formatEta(qbProgress?.etaSeconds || 0)} · {t.clientLabel}: {qbProgress?.client || 'qBittorrent'}</span>
                  </div>
                )}
                <div className="radarr-card-actions">
                  <button
                    type="button"
                    className="radarr-edit-btn"
                    disabled={removingId === movieId}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(movie);
                    }}
                  >
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    className="radarr-remove-btn"
                    disabled={removingId === movieId}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemove(movie);
                    }}
                  >
                    {removingId === movieId ? t.removing : t.remove}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {status === 'ready' && filteredItems.length > 0 && viewMode === 'table' && (
        <section className="radarr-table-wrap">
          <table className="radarr-table">
            <thead>
              <tr>
                <th />
                <th>{t.colMovie}</th>
                <th>{t.colYear}</th>
                <th>{t.colStatus}</th>
                <th>{t.colDownloaded}</th>
                <th>{t.colQualityProfile}</th>
                <th>{t.colRootFolder}</th>
                <th>{t.colSize}</th>
                <th>{t.colMonitoring}</th>
                <th>{t.downloadProgress}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((movie) => {
                const title = movie?.title || movie?.sortTitle || 'Unknown';
                const year = movie?.year || '-';
                const movieId = Number(movie?.id || 0);
                const qualityName = getMovieQualityName(movie, qualityProfiles);
                const downloaded = movie?.hasFile === true || Number(movie?.sizeOnDisk || movie?.movieFile?.size || 0) > 0;
                const sizeOnDisk = formatBytes(movie?.sizeOnDisk || movie?.movieFile?.size || 0);
                const monitored = movie?.monitored === true;
                const qbProgress = qbProgressByMovie[movieId];
                const qbState = String(qbProgress?.state || '').toLowerCase();
                const progressValue = Number(qbProgress?.progress || 0);
                const isDownloading = Boolean(
                  qbProgress
                  && progressValue > 0
                  && progressValue < 100
                );
                const isDownloadDone = Boolean(
                  downloaded
                  || (qbProgress && progressValue >= 100)
                  || qbState.includes('seed')
                  || qbState.includes('upload')
                  || qbState.includes('complete')
                );
                return (
                  <tr key={`table-${movieId || title}`} onClick={() => setActiveMovieId(movieId)}>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input className="radarr-row-checkbox" type="checkbox" checked={selectedMovieIds.includes(movieId)} onChange={() => toggleMovieSelection(movieId)} />
                    </td>
                    <td>
                      <div className="radarr-table-movie-cell" title={title}>
                        <span className="radarr-table-poster">
                          {movie?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl
                            ? <img src={movie.images.find((img) => img.coverType === 'poster').remoteUrl} alt={title} />
                            : <span className="radarr-table-poster-fallback">{String(title || '?').slice(0, 1)}</span>}
                        </span>
                        <span className="radarr-table-title">{title}</span>
                      </div>
                    </td>
                    <td>{year}</td>
                    <td>{String(movie?.status || '-')}</td>
                    <td>{downloaded ? t.yes : t.no}</td>
                    <td title={qualityName}>{qualityName}</td>
                    <td title={String(movie?.rootFolderPath || '-')}>{String(movie?.rootFolderPath || '-')}</td>
                    <td>{sizeOnDisk}</td>
                    <td>{monitored ? t.monitored : t.unmonitored}</td>
                    <td>
                      {isDownloading ? (
                        <div className="radarr-table-download-progress" aria-label={`${t.downloadProgress} ${Math.round(progressValue)}%`}>
                          <div className="radarr-progress-track">
                            <div className="radarr-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progressValue))}%` }} />
                          </div>
                          <span className="radarr-progress-text">{Math.round(progressValue)}%</span>
                        </div>
                      ) : (
                        <span className={`radarr-table-download-status ${isDownloadDone ? 'done' : 'idle'}`}>
                          {isDownloadDone ? t.downloadedDone : '-'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {selectedMovieIds.length > 0 && (
        <div className="radarr-bulk-bar">
          <div className="radarr-bulk-summary">{selectedMovieIds.length} {t.selectedCount}</div>
          <div className="radarr-bulk-actions">
            <button type="button" onClick={bulkSearch} disabled={bulkBusy !== ''}>{bulkBusy === 'search' ? t.loading : t.bulkSearch}</button>
            <button type="button" onClick={() => bulkSetMonitored(true)} disabled={bulkBusy !== ''}>{bulkBusy === 'monitor' ? t.loading : t.bulkMonitor}</button>
            <button type="button" onClick={() => bulkSetMonitored(false)} disabled={bulkBusy !== ''}>{bulkBusy === 'unmonitor' ? t.loading : t.bulkUnmonitor}</button>
            <button type="button" onClick={bulkRefreshScan} disabled={bulkBusy !== ''}>{bulkBusy === 'refresh' ? t.loading : t.bulkRefresh}</button>
            <button type="button" className="danger" onClick={bulkDelete} disabled={bulkBusy !== ''}>{bulkBusy === 'delete' ? t.loading : t.bulkDelete}</button>
          </div>
        </div>
      )}

      {activeMovie && (
        <div className="lightbox radarr-drawer-backdrop" onClick={() => setActiveMovieId(null)}>
          <aside className="radarr-drawer" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="radarr-drawer-close" onClick={() => setActiveMovieId(null)}>×</button>
            <div className="radarr-drawer-head">
              <div className="radarr-drawer-poster">
                {activeMovie?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl
                  ? <img src={activeMovie.images.find((img) => img.coverType === 'poster').remoteUrl} alt={activeMovie?.title || 'Movie'} className="radarr-poster" />
                  : <div className="radarr-poster-fallback">{String(activeMovie?.title || '?').slice(0, 1)}</div>}
              </div>
              <div>
                <h3>{activeMovie?.title || 'Unknown'} {activeMovie?.year ? `(${activeMovie.year})` : ''}</h3>
                <p>{activeMovie?.overview || '-'}</p>
              </div>
            </div>
            <div className="radarr-drawer-grid">
              <div><small>{t.statusLabel}</small><strong>{String(activeMovie?.status || '-')}</strong></div>
              <div><small>{t.qualityLabel}</small><strong>{getMovieQualityName(activeMovie, qualityProfiles)}</strong></div>
              <div><small>{t.rootLabel}</small><strong title={String(activeMovie?.rootFolderPath || '-')}>{String(activeMovie?.rootFolderPath || '-')}</strong></div>
              <div><small>{t.pathLabel}</small><strong title={String(activeMovie?.path || '-')}>{String(activeMovie?.path || '-')}</strong></div>
              <div><small>{t.minAvailabilityLabel}</small><strong>{String(activeMovie?.minimumAvailability || '-')}</strong></div>
              <div><small>{t.downloadedLabel}</small><strong>{(activeMovie?.hasFile === true || Number(activeMovie?.sizeOnDisk || activeMovie?.movieFile?.size || 0) > 0) ? t.yes : t.no}</strong></div>
              <div><small>{t.sizeLabel}</small><strong>{formatBytes(activeMovie?.sizeOnDisk || activeMovie?.movieFile?.size || 0)}</strong></div>
              <div><small>{t.drawerFileInfo}</small><strong title={String(activeMovie?.movieFile?.path || '-')}>{String(activeMovie?.movieFile?.path || '-')}</strong></div>
            </div>
            <div className="radarr-drawer-actions">
              <button type="button" className="radarr-edit-btn" onClick={() => openManualSearchModal(activeMovie)}>{t.actionManualSearch}</button>
              <button type="button" className="radarr-edit-btn" onClick={() => searchMovie(Number(activeMovie?.id || 0))}>{t.actionAutoSearch}</button>
              <button
                type="button"
                className="radarr-edit-btn"
                onClick={async () => {
                  const movieId = Number(activeMovie?.id || 0);
                  if (!movieId) return;
                  const result = await window.electronAPI?.radarrRefreshAndScanMovie?.({ movieId, settings: getRadarrConnectionSettings() });
                  if (!result?.ok) alert(result?.error || 'Could not start refresh & scan.');
                }}
              >
                {t.actionRefreshScan}
              </button>
              <button type="button" className="radarr-edit-btn" onClick={() => openEditModal(activeMovie)}>{t.actionEditMovie}</button>
              <button type="button" className="radarr-remove-btn" onClick={() => handleRemove(activeMovie)}>{t.actionDeleteMovie}</button>
              <button type="button" className="radarr-edit-btn" onClick={() => window.electronAPI?.openRadarrMoviePage?.({ movieId: Number(activeMovie?.id || 0), settings: getRadarrConnectionSettings() })}>{t.openInRadarr}</button>
            </div>
          </aside>
        </div>
      )}

      {manualSearchModal.open && (
        <div className="lightbox" onClick={closeManualSearchModal}>
          <div className="radarr-modal-card sonarr-manual-modal" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.manualSearchTitle}: {manualSearchModal.movieTitle}</h3>
            </div>
            <div className="radarr-modal-body">
              {manualSearchModal.loading ? (
                <p>{t.loading}</p>
              ) : (
                <>
                  {manualSearchModal.error && <p className="radarr-note radarr-note-error">{manualSearchModal.error}</p>}
                  {!manualSearchModal.error && manualSearchModal.releases.length === 0 && <p className="radarr-note">{t.manualSearchEmpty}</p>}
                  {manualSearchModal.releases.length > 0 && (
                    <div className="sonarr-manual-table-wrap">
                      <table className="sonarr-manual-table">
                        <colgroup>
                          <col className="release-col" />
                          <col className="indexer-col" />
                          <col className="size-col" />
                          <col className="quality-col" />
                          <col className="seeders-col" />
                          <col className="rejected-col" />
                          <col className="grab-col" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th>{t.releaseName}</th>
                            <th>{t.indexer}</th>
                            <th>
                              <button type="button" className="sonarr-sort-header" onClick={() => toggleManualReleaseSort('size')}>
                                {t.size}{getManualSortLabel('size')}
                              </button>
                            </th>
                            <th>
                              <button type="button" className="sonarr-sort-header" onClick={() => toggleManualReleaseSort('quality')}>
                                {t.quality}{getManualSortLabel('quality')}
                              </button>
                            </th>
                            <th>
                              <button type="button" className="sonarr-sort-header" onClick={() => toggleManualReleaseSort('seeders')}>
                                {t.seeders}{getManualSortLabel('seeders')}
                              </button>
                            </th>
                            <th>{t.releaseStatus}</th>
                            <th>{t.grab}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedManualReleases.map((release, index) => {
                            const guid = String(release?.guid || release?.downloadUrl || `row-${index}`);
                            const canGrab = release?.downloadAllowed !== false;
                            const rejected = extractRejectedReason(release);
                            const statusText = canGrab ? t.statusApproved : `${t.statusRejected}: ${rejected || '-'}`;
                            return (
                              <tr key={guid}>
                                <td title={String(release?.title || release?.releaseTitle || '-')}>{String(release?.title || release?.releaseTitle || '-')}</td>
                                <td>{String(release?.indexer || release?.indexerName || '-')}</td>
                                <td>{formatReleaseSize(release?.size)}</td>
                                <td>{getReleaseQualityName(release)}</td>
                                <td>{Number(release?.seeders || 0)}</td>
                                <td>{statusText}</td>
                                <td>
                                  <button type="button" className="btn btn-primary sonarr-grab-btn" disabled={!canGrab || manualSearchModal.grabbingGuid === guid} onClick={() => grabMovieRelease(release)}>
                                    {manualSearchModal.grabbingGuid === guid ? t.loading : t.grab}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
              <div className="radarr-modal-actions">
                <button className="btn btn-secondary" onClick={closeManualSearchModal}>{t.cancel}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {removeModal.open && (
        <div className="lightbox" onClick={() => setRemoveModal({ open: false, movieIds: [], title: '', deleteFiles: false })}>
          <div className="radarr-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{removeModal.movieIds.length > 1 ? t.removeTitleBulk : t.removeTitleSingle}</h3>
            </div>
            <div className="radarr-modal-body">
              <p>
                {removeModal.movieIds.length > 1
                  ? t.removeConfirmBulk.replace('{count}', String(removeModal.movieIds.length))
                  : t.removeConfirmSingle.replace('{title}', removeModal.title)}
              </p>
              <label className="radarr-check">
                <input
                  type="checkbox"
                  checked={removeModal.deleteFiles}
                  onChange={(event) => setRemoveModal((prev) => ({ ...prev, deleteFiles: event.target.checked }))}
                />
                <span>{t.removeDeleteFiles}</span>
              </label>
              <div className="radarr-modal-actions">
                <button className="btn btn-secondary" onClick={() => setRemoveModal({ open: false, movieIds: [], title: '', deleteFiles: false })}>{t.cancel}</button>
                <button className="btn btn-danger" onClick={confirmRemoveModal}>{t.remove}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingMovie && (
        <div className="lightbox" onClick={closeEditModal}>
          <div className="radarr-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.edit}</h3>
            </div>
            {editLoading ? (
              <p>{t.loading}</p>
            ) : (
              <div className="radarr-modal-body">
                <label>
                  <span>{t.rootFolder}</span>
                  <select value={editRootFolder} onChange={(event) => setEditRootFolder(event.target.value)}>
                    <option value="">{t.selectRoot}</option>
                    {rootFolders.map((folder) => (
                      <option key={folder.id || folder.path} value={folder.path}>{folder.path}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t.qualityProfile}</span>
                  <select value={String(editQualityProfileId)} onChange={(event) => setEditQualityProfileId(event.target.value)}>
                    <option value="">{t.selectQuality}</option>
                    {qualityProfiles.map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>{profile.name}</option>
                    ))}
                  </select>
                </label>
                <label className="radarr-check">
                  <input type="checkbox" checked={editMonitored} onChange={(event) => setEditMonitored(event.target.checked)} />
                  <span>{t.monitoredEdit}</span>
                </label>
                <div className="radarr-modal-actions">
                  <button className="btn btn-secondary" onClick={closeEditModal}>{t.cancel}</button>
                  <button className="btn btn-primary" onClick={handleSaveEdit} disabled={editLoading}>{t.save}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RadarrView;
