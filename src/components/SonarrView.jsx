import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  ExternalLink,
  Folder,
  Grid2X2,
  HardDrive,
  MonitorDown,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  X,
} from 'lucide-react';
import '../styles/RadarrView.css';
const APP_TOAST_EVENT = 'cinesoft:toast';
const QUICK_SETTINGS_EVENT = 'cinesoft:quick-settings-changed';

const normalizeMediaText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findBestQbTorrentForSeries = (series, torrents = []) => {
  const title = normalizeMediaText(series?.title || series?.sortTitle || '');
  if (!title) return null;
  const year = String(series?.year || '').trim();
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

const isTorrentForSeries = (series = {}, torrentName = '') => {
  const title = normalizeMediaText(series?.title || series?.sortTitle || '');
  const name = normalizeMediaText(torrentName || '');
  if (!title || !name) return false;
  if (name.includes(title)) return true;
  const tokens = title.split(' ').filter((token) => token.length >= 3);
  if (!tokens.length) return false;
  let hits = 0;
  for (const token of tokens) {
    if (name.includes(token)) hits += 1;
  }
  return hits >= Math.min(2, tokens.length);
};

const extractEpisodeCode = (text = '') => {
  const match = String(text || '').match(/\bS(\d{1,2})E(\d{1,3})\b/i);
  if (!match) return null;
  return `S${String(Number(match[1])).padStart(2, '0')}E${String(Number(match[2])).padStart(2, '0')}`;
};

const extractSeasonNumber = (text = '') => {
  const source = String(text || '');
  const compact = source.match(/\bS(\d{1,2})(?!E)\b/i);
  if (compact) return Number(compact[1]);
  const verbose = source.match(/\bseason[\s._-]*(\d{1,2})\b/i);
  if (verbose) return Number(verbose[1]);
  return 0;
};

const buildEpisodeCode = (seasonNumber, episodeNumber) => `S${String(Number(seasonNumber || 0)).padStart(2, '0')}E${String(Number(episodeNumber || 0)).padStart(2, '0')}`;

const normalizeQbProgressPercent = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, percent));
};

const isQbEpisodeCompleted = (qbEpisode = null) => {
  if (!qbEpisode) return false;
  const progress = normalizeQbProgressPercent(qbEpisode?.progress || 0);
  const state = String(qbEpisode?.state || '').toLowerCase();
  return progress >= 99.9 || state.includes('seed') || state.includes('upload') || state.includes('up') || state.includes('complete');
};

const isEpisodeResolvedAsDownloaded = (episode = {}, qbEpisode = null) => episode?.hasFile === true || isQbEpisodeCompleted(qbEpisode);

const isEpisodeAired = (episode = {}) => {
  const rawDate = episode?.airDateUtc || episode?.airDate;
  if (!rawDate) return true;
  const airTime = new Date(rawDate).getTime();
  if (!Number.isFinite(airTime)) return true;
  return airTime <= Date.now();
};

const formatAirDate = (episode = {}, language = 'tr') => {
  const rawDate = episode?.airDateUtc || episode?.airDate;
  if (!rawDate) return '--';
  const date = new Date(rawDate);
  if (!Number.isFinite(date.getTime())) return '--';
  return date.toLocaleDateString(language === 'en' ? 'en-US' : 'tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatReleaseSize = (bytes = 0) => {
  const value = Number(bytes) || 0;
  if (value <= 0) return '-';
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${Math.round(value)} B`;
};

const getReleaseQualityName = (release = {}) => String(
  release?.quality?.quality?.name
  || release?.quality?.name
  || release?.quality
  || '-',
);

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
  if (!rows.length) return '-';
  return rows
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return String(entry?.reason || entry?.message || entry?.type || '').trim();
    })
    .filter(Boolean)
    .join(', ') || '-';
};

const getSeriesQualityProfileName = (series = {}, qualityProfiles = []) => {
  const direct = series?.qualityProfile?.name || series?.qualityProfileName || series?.profileName;
  if (direct) return String(direct);
  const id = Number(series?.qualityProfileId ?? series?.qualityProfile?.id ?? 0);
  if (!id) return '-';
  const found = (Array.isArray(qualityProfiles) ? qualityProfiles : []).find((profile) => Number(profile?.id || 0) === id);
  return found?.name ? String(found.name) : '-';
};

const getSeriesLanguageProfileName = (series = {}, languageProfiles = []) => {
  const direct = series?.languageProfile?.name || series?.languageProfileName;
  if (direct) return String(direct);
  const id = Number(series?.languageProfileId ?? series?.languageProfile?.id ?? 0);
  if (!id) return '-';
  const found = (Array.isArray(languageProfiles) ? languageProfiles : []).find((profile) => Number(profile?.id || 0) === id);
  return found?.name ? String(found.name) : `#${id}`;
};

const getSeriesQualityName = (series = {}, qualityProfiles = []) => {
  const direct = series?.qualityProfile?.name || series?.qualityProfileName || series?.profileName;
  if (direct) return String(direct);
  const id = Number(series?.qualityProfileId ?? series?.qualityProfile?.id ?? 0);
  if (!id) return '-';
  const found = (Array.isArray(qualityProfiles) ? qualityProfiles : []).find((profile) => Number(profile?.id || 0) === id);
  return found?.name ? String(found.name) : '-';
};

const getSeriesMonitoringMode = (series = {}, t = {}) => {
  const mode = String(series?.monitorNewItems || '').toLowerCase();
  if (mode === 'all') return t.monitoringAll || 'All Episodes';
  if (mode === 'none') return t.monitoringNone || 'Off';
  if (mode === 'new') return t.monitoringFuture || 'Future Episodes';
  if (mode === 'newepisodes') return t.monitoringFuture || 'Future Episodes';
  if (series?.monitored === true) return t.monitoringFuture || 'Future Episodes';
  return t.monitoringNone || 'Off';
};

const getSeriesSeasonFolderLabel = (series = {}, t = {}) => {
  const enabled = series?.seasonFolder === true || series?.addOptions?.seasonFolder === true;
  return enabled ? (t.enabled || 'Enabled') : (t.disabledSmall || 'Disabled');
};

const formatBytes = (value = 0) => {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 GB';
  if (bytes >= 1024 ** 4) return `${(bytes / (1024 ** 4)).toFixed(2)} TB`;
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
};

const formatBinarySize = (value = 0) => {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 GiB';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${Math.round(bytes)} B`;
};

const classifyConnectionError = (message = '') => {
  const text = String(message || '').toLowerCase();
  if (!text) return 'unreachable';
  if (text.includes('authentication failed') || text.includes('api key')) return 'api_key_invalid';
  if (text.includes('connect') || text.includes('timed out') || text.includes('unreachable')) return 'unreachable';
  return 'unreachable';
};

const SonarrView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [removingId, setRemovingId] = useState(null);
  const [editingSeries, setEditingSeries] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [languageProfiles, setLanguageProfiles] = useState([]);
  const [editRootFolder, setEditRootFolder] = useState('');
  const [editQualityProfileId, setEditQualityProfileId] = useState('');
  const [editMonitored, setEditMonitored] = useState(true);
  const [editMonitorNewItems, setEditMonitorNewItems] = useState('all');
  const [editSeasonFolder, setEditSeasonFolder] = useState(true);
  const [editSeriesType, setEditSeriesType] = useState('standard');
  const [editTagsText, setEditTagsText] = useState('');
  const [qbProgressBySeries, setQbProgressBySeries] = useState({});
  const [qbEpisodeStatusBySeries, setQbEpisodeStatusBySeries] = useState({});
  const [activeSeriesId, setActiveSeriesId] = useState(null);
  const [episodesBySeries, setEpisodesBySeries] = useState({});
  const [episodesLoadingBySeries, setEpisodesLoadingBySeries] = useState({});
  const [selectedSeasonBySeries, setSelectedSeasonBySeries] = useState({});
  const [selectedEpisodeIdsBySeries, setSelectedEpisodeIdsBySeries] = useState({});
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [episodeActionLoading, setEpisodeActionLoading] = useState({});
  const [confirmLatestMissing, setConfirmLatestMissing] = useState(null);
  const [health, setHealth] = useState({
    sonarr: { ok: false, version: '' },
    prowlarr: { ok: false },
    downloadClient: { ok: false },
  });
  const [manualSearchModal, setManualSearchModal] = useState({
    open: false,
    seriesId: 0,
    episodeId: 0,
    episodeCode: '',
    episodeTitle: '',
    loading: false,
    error: '',
    releases: [],
    grabbingGuid: '',
  });
  const [manualReleaseSort, setManualReleaseSort] = useState({ key: '', direction: 'desc' });
  const [searchAfterAdd, setSearchAfterAdd] = useState(settings?.sonarrSearchAfterAdd !== false);

  const getSonarrConnectionSettings = () => ({
    sonarrEnabled: settings.sonarrEnabled === true,
    sonarrBaseUrl: settings.sonarrBaseUrl,
    sonarrApiKey: settings.sonarrApiKey,
    sonarrTimeout: settings.sonarrTimeout || 10000,
  });
  const notify = (message, tone = 'info', durationMs) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(APP_TOAST_EVENT, { detail: { message, tone, durationMs } }));
  };

  const loadSeries = async ({ silent = false } = {}) => {
    if (!settings?.sonarrEnabled || !settings?.sonarrBaseUrl || !settings?.sonarrApiKey) {
      setStatus('disabled');
      setItems([]);
      return;
    }
    if (!silent) setStatus('loading');
    try {
      const [seriesRes, qualityRes, languageRes] = await Promise.all([
        window.electronAPI?.sonarrGetSeries?.(getSonarrConnectionSettings()),
        window.electronAPI?.sonarrGetQualityProfiles?.(getSonarrConnectionSettings()),
        window.electronAPI?.sonarrGetLanguageProfiles?.(getSonarrConnectionSettings()),
      ]);
      if (!seriesRes?.ok) {
        setStatus('error');
        setItems([]);
        return;
      }
      const nextItems = Array.isArray(seriesRes.items) ? seriesRes.items : [];
      setQualityProfiles(Array.isArray(qualityRes?.items) ? qualityRes.items : []);
      setLanguageProfiles(Array.isArray(languageRes?.items) ? languageRes.items : []);
      setItems(nextItems);
      setStatus('ready');
      refreshQbProgress(nextItems).catch(() => {});
    } catch {
      setStatus('error');
      setItems([]);
    }
  };

  useEffect(() => {
    loadSeries();
  }, [settings?.sonarrEnabled, settings?.sonarrBaseUrl, settings?.sonarrApiKey]);

  useEffect(() => {
    setSearchAfterAdd(settings?.sonarrSearchAfterAdd !== false);
  }, [settings?.sonarrSearchAfterAdd]);

  useEffect(() => {
    const onQuickSettingsChanged = (event) => {
      const detail = event?.detail || {};
      if (detail.key !== 'sonarrSearchAfterAdd') return;
      setSearchAfterAdd(detail.value === true);
    };
    window.addEventListener(QUICK_SETTINGS_EVENT, onQuickSettingsChanged);
    return () => window.removeEventListener(QUICK_SETTINGS_EVENT, onQuickSettingsChanged);
  }, []);

  const saveSearchAfterAdd = async (nextValue) => {
    setSearchAfterAdd(nextValue);
    try {
      await window.electronAPI?.saveSettings?.({
        ...(settings || {}),
        sonarrSearchAfterAdd: nextValue === true,
      });
      if (settings && typeof settings === 'object') settings.sonarrSearchAfterAdd = nextValue === true;
      window.dispatchEvent(new CustomEvent(QUICK_SETTINGS_EVENT, { detail: { key: 'sonarrSearchAfterAdd', value: nextValue === true } }));
    } catch {
      setSearchAfterAdd(settings?.sonarrSearchAfterAdd !== false);
    }
  };

  const refreshQbProgress = async (seriesArg) => {
    const seriesList = Array.isArray(seriesArg) ? seriesArg : items;
    if (!seriesList.length || settings?.qbittorrentEnabled === false) {
      setQbProgressBySeries({});
      setQbEpisodeStatusBySeries({});
      return;
    }
    const qbConfig = settings?.qbittorrent || {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    };
    const result = await window.electronAPI?.qbittorrentGetTorrents?.(qbConfig);
    if (!result?.ok || !Array.isArray(result.items)) return;

    const map = {};
    const episodeMap = {};
    for (const series of seriesList) {
      const match = findBestQbTorrentForSeries(series, result.items);
      const seriesId = Number(series?.id || 0);
      if (!seriesId) continue;
      if (match) {
        map[seriesId] = {
          progress: normalizeQbProgressPercent(match.progress || 0),
        };
      }

      const episodes = Array.isArray(episodesBySeries[seriesId]) ? episodesBySeries[seriesId] : [];
      if (!episodes.length) continue;
      const episodeByCode = new Map();
      const episodeIdsBySeason = new Map();
      for (const ep of episodes) {
        const code = buildEpisodeCode(ep?.seasonNumber, ep?.episodeNumber);
        const epId = Number(ep?.id || 0);
        const seasonNo = Number(ep?.seasonNumber || 0);
        if (epId) {
          episodeByCode.set(code, epId);
          if (seasonNo > 0) {
            if (!episodeIdsBySeason.has(seasonNo)) episodeIdsBySeason.set(seasonNo, []);
            episodeIdsBySeason.get(seasonNo).push(epId);
          }
        }
      }
      if (!episodeByCode.size) continue;
      for (const torrent of result.items) {
        if (!isTorrentForSeries(series, torrent?.name || '')) continue;
        const code = extractEpisodeCode(torrent?.name || '');
        const nextProgress = normalizeQbProgressPercent(torrent?.progress || 0);
        const applyProgressToEpisode = (epId) => {
          const current = episodeMap[seriesId]?.[epId];
          if (!episodeMap[seriesId]) episodeMap[seriesId] = {};
          if (!current || nextProgress > Number(current.progress || 0)) {
            episodeMap[seriesId][epId] = {
              progress: nextProgress,
              state: String(torrent?.state || ''),
              size: Number(torrent?.size || torrent?.totalSize || torrent?.total_size || 0),
            };
          }
        };
        if (code && episodeByCode.has(code)) {
          applyProgressToEpisode(episodeByCode.get(code));
          continue;
        }
        const seasonNo = extractSeasonNumber(torrent?.name || '');
        if (!seasonNo) continue;
        const seasonEpisodeIds = episodeIdsBySeason.get(seasonNo) || [];
        if (!seasonEpisodeIds.length) continue;
        if (!episodeMap[seriesId]) episodeMap[seriesId] = {};
        seasonEpisodeIds.forEach((epId) => applyProgressToEpisode(epId));
      }
    }
    setQbProgressBySeries(map);
    setQbEpisodeStatusBySeries((prev) => {
      const next = { ...prev };
      for (const [seriesId, byEpisode] of Object.entries(episodeMap)) {
        next[seriesId] = {
          ...(prev?.[seriesId] || {}),
          ...(byEpisode || {}),
        };
      }
      for (const series of seriesList) {
        const sId = String(Number(series?.id || 0));
        if (!sId || !next[sId]) continue;
        const episodes = Array.isArray(episodesBySeries[sId]) ? episodesBySeries[sId] : [];
        const valid = new Set(episodes.map((ep) => String(Number(ep?.id || 0))));
        next[sId] = Object.fromEntries(
          Object.entries(next[sId]).filter(([epId]) => valid.has(String(epId))),
        );
      }
      return next;
    });
  };

  useEffect(() => {
    if (status !== 'ready' || !items.length) return undefined;
    const timer = setInterval(() => {
      refreshQbProgress(items).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [status, items, episodesBySeries, settings?.qbittorrentEnabled, settings?.qbittorrent?.baseUrl, settings?.qbittorrent?.username, settings?.qbittorrent?.password]);

  useEffect(() => {
    const id = Number(activeSeriesId || 0);
    if (!id) return;
    const episodes = episodesBySeries[id];
    if (!Array.isArray(episodes) || !episodes.length) return;
    refreshQbProgress(items).catch(() => {});
  }, [activeSeriesId, episodesBySeries, items]);

  useEffect(() => {
    if (!settings?.sonarrEnabled || !settings?.sonarrBaseUrl || !settings?.sonarrApiKey) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadSeries({ silent: true }).catch(() => {});
    }, 7000);
    return () => clearInterval(timer);
  }, [settings?.sonarrEnabled, settings?.sonarrBaseUrl, settings?.sonarrApiKey]);

  useEffect(() => {
    let mounted = true;
    const runHealthCheck = async () => {
      const sonarrSettings = getSonarrConnectionSettings();
      const prowlarrCfg = settings?.prowlarr || {};
      const qbPayload = {
        settings: sonarrSettings,
        qbittorrent: settings?.qbittorrent || {},
      };

      const [sonarrRes, prowlarrRes, clientRes] = await Promise.all([
        window.electronAPI?.sonarrTestConnection?.(sonarrSettings),
        (prowlarrCfg?.enabled && prowlarrCfg?.baseUrl && prowlarrCfg?.apiKey)
          ? window.electronAPI?.testProwlarrConnection?.(prowlarrCfg)
          : Promise.resolve({ ok: false, error: 'missing' }),
        window.electronAPI?.sonarrCheckQbittorrentClient?.(qbPayload),
      ]);

      if (!mounted) return;
      setHealth({
        sonarr: sonarrRes?.ok
          ? { ok: true, version: String(sonarrRes?.version || '') }
          : { ok: false, reason: classifyConnectionError(sonarrRes?.error) },
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
    settings?.sonarrEnabled,
    settings?.sonarrBaseUrl,
    settings?.sonarrApiKey,
    settings?.prowlarr?.enabled,
    settings?.prowlarr?.baseUrl,
    settings?.prowlarr?.apiKey,
    settings?.qbittorrent?.baseUrl,
    settings?.qbittorrent?.username,
    settings?.qbittorrent?.password,
  ]);

  const handleRemove = async (series) => {
    const id = Number(series?.id || 0);
    if (!id) return;
    const title = series?.title || 'series';
    const confirmText = settings?.language === 'tr'
      ? `"${title}" Sonarr listesinden kaldirilsin mi?`
      : `Remove "${title}" from Sonarr?`;
    if (!window.confirm(confirmText)) return;
    const deleteFilesPrompt = settings?.language === 'tr'
      ? 'Klasordeki dosyalari da tamamen silmek istiyor musun?\n\nTamam = Evet, Iptal = Hayir'
      : 'Also delete all files from disk?\n\nOK = Yes, Cancel = No';
    const deleteFiles = window.confirm(deleteFilesPrompt);

    setRemovingId(id);
    try {
      const result = await window.electronAPI?.sonarrDeleteSeries?.({
        seriesId: id,
        settings: getSonarrConnectionSettings(),
        options: {
          deleteFiles,
          addImportListExclusion: true,
        },
      });
      if (result?.ok) {
        setItems((prev) => prev.filter((entry) => Number(entry?.id) !== id));
      } else {
        alert(result?.error || 'Could not remove series from Sonarr.');
      }
    } catch {
      alert(settings?.language === 'tr' ? 'Dizi Sonarrdan kaldirilamadi.' : 'Could not remove series from Sonarr.');
    } finally {
      setRemovingId(null);
    }
  };

  const openEditModal = async (series) => {
    setEditingSeries(series || null);
    setEditLoading(true);
    setEditRootFolder(String(series?.rootFolderPath || ''));
    setEditQualityProfileId(String(series?.qualityProfileId ?? ''));
    setEditMonitored(series?.monitored === true);
    setEditMonitorNewItems(String(series?.monitorNewItems || 'all'));
    setEditSeasonFolder(series?.seasonFolder !== false);
    setEditSeriesType(String(series?.seriesType || 'standard'));
    setEditTagsText(Array.isArray(series?.tags) ? series.tags.join(', ') : '');
    try {
      const [rootRes, qualityRes] = await Promise.all([
        window.electronAPI?.sonarrGetRootFolders?.(getSonarrConnectionSettings()),
        window.electronAPI?.sonarrGetQualityProfiles?.(getSonarrConnectionSettings()),
      ]);
      const roots = Array.isArray(rootRes?.items) ? rootRes.items : [];
      const profiles = Array.isArray(qualityRes?.items) ? qualityRes.items : [];
      setRootFolders(roots);
      setQualityProfiles(profiles);
      if (!String(series?.rootFolderPath || '') && roots[0]?.path) {
        setEditRootFolder(roots[0].path);
      }
      if ((series?.qualityProfileId == null || series?.qualityProfileId === '') && profiles[0]?.id != null) {
        setEditQualityProfileId(String(profiles[0].id));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const closeEditModal = () => {
    setEditingSeries(null);
    setRootFolders([]);
    setQualityProfiles([]);
    setEditRootFolder('');
    setEditQualityProfileId('');
    setEditMonitored(true);
    setEditMonitorNewItems('all');
    setEditSeasonFolder(true);
    setEditSeriesType('standard');
    setEditTagsText('');
    setEditLoading(false);
  };

  const handleSaveEdit = async () => {
    const seriesId = Number(editingSeries?.id || 0);
    if (!seriesId || !editRootFolder || !editQualityProfileId) return;
    const parsedTags = String(editTagsText || '')
      .split(',')
      .map((item) => Number(String(item).trim()))
      .filter((value) => Number.isFinite(value) && value >= 0);
    setEditLoading(true);
    try {
      const result = await window.electronAPI?.sonarrUpdateSeries?.({
        seriesId,
        settings: getSonarrConnectionSettings(),
        series: {
          rootFolderPath: String(editRootFolder || ''),
          qualityProfileId: Number(editQualityProfileId),
          monitored: editMonitored === true,
          monitorNewItems: String(editMonitorNewItems || 'all'),
          seasonFolder: editSeasonFolder === true,
          seriesType: String(editSeriesType || 'standard'),
          tags: parsedTags,
        },
      });
      if (!result?.ok) {
        alert(result?.error || 'Could not update series in Sonarr.');
        return;
      }
      setItems((prev) => prev.map((entry) => (
        Number(entry?.id) === seriesId
          ? {
              ...entry,
              rootFolderPath: String(editRootFolder || entry?.rootFolderPath || ''),
              qualityProfileId: Number(editQualityProfileId),
              monitored: editMonitored === true,
              monitorNewItems: String(editMonitorNewItems || 'all'),
              seasonFolder: editSeasonFolder === true,
              seriesType: String(editSeriesType || 'standard'),
              tags: parsedTags,
            }
          : entry
      )));
      closeEditModal();
    } catch {
      alert(settings?.language === 'tr' ? 'Dizi ayarlari guncellenemedi.' : 'Could not update series settings.');
    } finally {
      setEditLoading(false);
    }
  };

  const loadEpisodes = async (seriesId) => {
    const id = Number(seriesId || 0);
    if (!id) return;
    if (episodesLoadingBySeries[id]) return;
    setEpisodesLoadingBySeries((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await window.electronAPI?.sonarrGetEpisodes?.({
        seriesId: id,
        settings: getSonarrConnectionSettings(),
      });
      const itemsList = Array.isArray(result?.items) ? result.items : [];
      const sorted = itemsList
        .slice()
        .sort((a, b) => {
          const sa = Number(a?.seasonNumber || 0);
          const sb = Number(b?.seasonNumber || 0);
          if (sa !== sb) return sa - sb;
          return Number(a?.episodeNumber || 0) - Number(b?.episodeNumber || 0);
        });
      setEpisodesBySeries((prev) => ({ ...prev, [id]: sorted }));
      const firstSeason = sorted.find((ep) => Number(ep?.seasonNumber || 0) > 0)?.seasonNumber;
      if (firstSeason != null) {
        setSelectedSeasonBySeries((prev) => {
          if (prev[id] != null) return prev;
          return { ...prev, [id]: Number(firstSeason) };
        });
      }
      refreshQbProgress(items.length ? items : [{ id }]).catch(() => {});
    } catch {
      setEpisodesBySeries((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setEpisodesLoadingBySeries((prev) => ({ ...prev, [id]: false }));
    }
  };

  const openSeriesPage = async (seriesId) => {
    const id = Number(seriesId || 0);
    if (!id) return;
    setActiveSeriesId(id);
    if (!Array.isArray(episodesBySeries[id])) {
      await loadEpisodes(id);
    }
  };

  const toggleEpisodeSelection = (seriesId, episodeId) => {
    const sId = Number(seriesId || 0);
    const eId = Number(episodeId || 0);
    if (!sId || !eId) return;
    setSelectedEpisodeIdsBySeries((prev) => {
      const current = Array.isArray(prev[sId]) ? prev[sId] : [];
      const exists = current.includes(eId);
      return {
        ...prev,
        [sId]: exists ? current.filter((id) => id !== eId) : [...current, eId],
      };
    });
  };

  const patchEpisodes = (seriesId, episodeIds, patch) => {
    const id = Number(seriesId || 0);
    const ids = new Set((Array.isArray(episodeIds) ? episodeIds : []).map((episodeId) => Number(episodeId)));
    if (!id || !ids.size) return;
    setEpisodesBySeries((prev) => ({
      ...prev,
      [id]: (Array.isArray(prev[id]) ? prev[id] : []).map((episode) => (
        ids.has(Number(episode?.id || 0)) ? { ...episode, ...patch } : episode
      )),
    }));
  };

  const runEpisodeAction = async (key, task) => {
    setEpisodeActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await task();
    } finally {
      setEpisodeActionLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const setEpisodesMonitored = async (seriesId, episodeIds, monitored) => {
    const ids = (Array.isArray(episodeIds) ? episodeIds : []).filter(Boolean);
    if (!ids.length) return;
    const key = `monitor-${seriesId}-${ids.join('-')}-${monitored ? 'on' : 'off'}`;
    await runEpisodeAction(key, async () => {
      const result = await window.electronAPI?.sonarrSetEpisodesMonitored?.({
        settings: getSonarrConnectionSettings(),
        episodeIds: ids,
        monitored,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not update episode monitoring.');
      patchEpisodes(seriesId, ids, { monitored: monitored === true });
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Bolum takip ayari guncellenemedi: ${error.message}` : `Could not update episode monitoring: ${error.message}`);
    });
  };

  const searchEpisodes = async (seriesId, episodeIds) => {
    const ids = (Array.isArray(episodeIds) ? episodeIds : []).filter(Boolean);
    if (!ids.length) return;
    const key = `search-${seriesId}-${ids.join('-')}`;
    await runEpisodeAction(key, async () => {
      const result = await window.electronAPI?.sonarrSearchEpisodes?.({
        settings: getSonarrConnectionSettings(),
        episodeIds: ids,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not start episode search.');
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Bolum aramasi baslatilamadi: ${error.message}` : `Could not start episode search: ${error.message}`);
    });
  };

  const searchSeasonPack = async (seriesId, seasonNumber) => {
    const season = Number(seasonNumber || 0);
    if (!seriesId || !season) return;
    const key = `season-search-${seriesId}-${season}`;
    await runEpisodeAction(key, async () => {
      const result = await window.electronAPI?.sonarrGrabBestSeasonPack?.({
        settings: getSonarrConnectionSettings(),
        seriesId,
        seasonNumber: season,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not start season search.');
    }).catch((error) => {
      alert(settings?.language === 'tr' ? `Sezon paketi aramasi baslatilamadi: ${error.message}` : `Could not start season search: ${error.message}`);
    });
  };

  const monitorLatestMissing = async (seriesId, episodes = []) => {
    const latest = episodes
      .filter((ep) => !ep?.hasFile && Number(ep?.id || 0) > 0)
      .sort((a, b) => {
        const dateA = new Date(a?.airDateUtc || a?.airDate || 0).getTime() || 0;
        const dateB = new Date(b?.airDateUtc || b?.airDate || 0).getTime() || 0;
        if (dateA !== dateB) return dateB - dateA;
        return Number(b?.episodeNumber || 0) - Number(a?.episodeNumber || 0);
      })[0];
    if (!latest?.id) return;
    await setEpisodesMonitored(seriesId, [Number(latest.id)], true);
  };

  const openManualSearchModal = async (seriesId, episode = {}) => {
    const episodeId = Number(episode?.id || 0);
    const epNo = Number(episode?.episodeNumber || 0);
    if (!episodeId) return;
    const seasonNo = Number(episode?.seasonNumber || selectedSeasonBySeries[seriesId] || 0);
    const episodeCode = `S${String(seasonNo).padStart(2, '0')}E${String(epNo).padStart(2, '0')}`;
    setManualReleaseSort({ key: '', direction: 'desc' });
    setManualSearchModal({
      open: true,
      seriesId: Number(seriesId || 0),
      episodeId,
      episodeCode,
      episodeTitle: String(episode?.title || `Episode ${epNo}`),
      loading: true,
      error: '',
      releases: [],
      grabbingGuid: '',
    });
    try {
      const result = await window.electronAPI?.sonarrGetEpisodeReleases?.({
        settings: getSonarrConnectionSettings(),
        episodeId,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not load releases.');
      const list = Array.isArray(result.items) ? result.items : [];
      setManualSearchModal((prev) => ({
        ...prev,
        loading: false,
        releases: list,
      }));
    } catch (error) {
      setManualSearchModal((prev) => ({
        ...prev,
        loading: false,
        error: String(error?.message || error || 'Could not load releases.'),
      }));
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
      seriesId: 0,
      episodeId: 0,
      episodeCode: '',
      episodeTitle: '',
      loading: false,
      error: '',
      releases: [],
      grabbingGuid: '',
    });
  };

  const openSeriesInSonarr = async (series = null) => {
    const id = Number(series?.id || 0);
    if (!id) return;
    const result = await window.electronAPI?.openSonarrSeriesPage?.({
      settings: getSonarrConnectionSettings(),
      seriesId: id,
      tvdbId: Number(series?.tvdbId || 0),
      tmdbId: Number(series?.tmdbId || 0),
      slug: String(series?.titleSlug || ''),
      title: String(series?.title || series?.sortTitle || ''),
    });
    if (!result?.ok) {
      alert(result?.error || 'Could not open Sonarr series page.');
    }
  };

  const handleGrabRelease = async (release = {}) => {
    const guid = String(release?.guid || release?.downloadUrl || '');
    if (!guid || manualSearchModal.grabbingGuid) return;
    setManualSearchModal((prev) => ({ ...prev, grabbingGuid: guid }));
    try {
      const result = await window.electronAPI?.sonarrGrabRelease?.({
        settings: getSonarrConnectionSettings(),
        release,
      });
      if (!result?.ok) throw new Error(result?.error || 'Could not grab release.');
      closeManualSearchModal();
      notify(
        settings?.language === 'tr'
          ? 'Torrent Sonarr tarafindan eklendi.'
          : 'Torrent queued by Sonarr.',
        'success',
      );
    } catch (error) {
      setManualSearchModal((prev) => ({
        ...prev,
        grabbingGuid: '',
        error: String(error?.message || error || 'Could not grab release.'),
      }));
      notify(
        settings?.language === 'tr'
          ? `Grab basarisiz: ${String(error?.message || error || '')}`
          : `Grab failed: ${String(error?.message || error || '')}`,
        'error',
        5000,
      );
    }
  };

  const t = settings?.language === 'tr'
    ? {
        title: 'Sonarr',
        subtitle: '',
        addedToSonarr: "Sonarr'a eklendi",
        monitoringEnabled: 'Takip acik',
        monitoringDisabled: 'Takip kapali',
        qualityProfileLabel: 'Kalite Profili',
        rootFolderLabel: 'Root Folder',
        languageLabel: 'Dil',
        languageNotUsed: 'Bu Sonarr surumunde kullanilmiyor',
        monitoringModeLabel: 'Monitoring',
        seasonFolderLabel: 'Season Folder',
        pathLabel: 'Path',
        sizeOnDiskLabel: 'Diskteki boyut',
        monitoringFuture: 'Future Episodes',
        monitoringAll: 'All Episodes',
        monitoringNone: 'Off',
        enabled: 'Enabled',
        disabledSmall: 'Disabled',
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
        monitorNewItems: 'Yeni sezon takibi',
        monitorAllSeasons: 'Tum sezonlar',
        monitorFutureEpisodes: 'Gelecek bolumler',
        monitorNone: 'Kapali',
        useSeasonFolder: 'Sezon klasoru kullan',
        seriesType: 'Dizi tipi',
        seriesTypeStandard: 'Standard',
        seriesTypeDaily: 'Daily',
        seriesTypeAnime: 'Anime',
        tagsLabel: 'Etiket IDleri (virgulle)',
        tagsPlaceholder: 'Orn: 1, 4, 12',
        downloadProgress: 'Indirme',
        seasons: 'Sezonlar',
        episodes: 'Bolumler',
        episodeListLoading: 'Bolumler yukleniyor...',
        noEpisodes: 'Bu dizi icin bolum listesi bulunamadi.',
        selectSeason: 'Sezon sec',
        selectedCount: 'secili',
        selectedEpisodes: 'Secili bolumler',
        clearSelection: 'Secimi temizle',
        selectAll: 'Sezonu sec',
        unselectAll: 'Sezon secimini kaldir',
        monitorSeason: 'Sezonu takip et',
        unmonitorSeason: 'Sezon takibini kapat',
        monitoredSmall: 'Takipte',
        unmonitoredSmall: 'Takipte degil',
        downloadSelected: 'Secilileri ara',
        searchSeasonPack: 'Sezonu tek kaynaktan ara',
        seasonPackFallback: 'Paket bulunmazsa Sonarr sezon aramasi calisir',
        monitorSelected: 'Secilileri otomatik indir',
        unmonitorSelected: 'Takibi kapat',
        downloadEpisode: 'Bolumu indir',
        downloadEpisodeTooltip: 'Manual search episode',
        autoEpisode: 'Torrent cikinca indir',
        stopAutoEpisode: 'Otomatigi kapat',
        alreadyMonitored: 'Zaten takipte',
        enableMonitoring: 'Takibi ac',
        disableMonitoring: 'Takibi kapat',
        unairedSearchDisabled: 'Yayinlanmamis bolum manuel aranamaz',
        notAiredYet: 'Henuz yayinlanmadi',
        manualSearchTitle: 'Manual search',
        manualSearchEmpty: 'Bu bolum icin release bulunamadi.',
        releaseName: 'Release',
        indexer: 'Indexer',
        size: 'Boyut',
        quality: 'Kalite',
        seeders: 'Seeder',
        rejectedReason: 'Red nedeni',
        grab: 'Indir',
        monitoringUpdating: 'Takip durumu guncelleniyor',
        monitorLatest: 'Son eksik bolumu otomatik indir',
        confirmTitle: 'Onay gerekiyor',
        confirmLatestBody: '"{title}" icin son eksik bolumler aranip indirilecek. Devam edilsin mi?',
        confirmRuleMonitored: 'Sadece takipte olan bolumler',
        confirmRuleQuality: 'Kalite profiline uyulur',
        continueAction: 'Devam et',
        fileReady: 'Dosya var',
        fileMissing: 'Eksik',
        unaired: 'Yayinlanmadi',
        airDate: 'Yayin',
        autoOn: 'Otomatik',
        autoQueued: 'Oto indirilecek',
        autoOff: 'Kapali',
        loading: 'Yukleniyor...',
        backToSeries: 'Dizilere Don',
        selectRoot: 'Root folder sec',
        selectQuality: 'Kalite profili sec',
        disabled: 'Sonarr etkin degil veya baglanti ayarlari eksik.',
        error: 'Sonarr dizi listesi alinamadi.',
        empty: 'Sonarr icinde henuz dizi yok.',
        monitored: 'Takipte',
        unmonitored: 'Takipte degil',
        sonarrConnected: 'Sonarr bagli',
        sonarrUnreachable: 'Sonarr ulasilamiyor',
        apiKeyInvalid: 'API key gecersiz',
        prowlarrConnected: 'Prowlarr bagli',
        prowlarrMissing: 'Prowlarr eksik',
        prowlarrUnreachable: 'Prowlarr ulasilamiyor',
        downloadClientConnected: 'Download Client bagli',
        downloadClientMissing: 'Download Client eksik',
        downloadClientMismatch: 'Download Client uyumsuz',
        openInSonarr: "Sonarr'da ac",
        managedBySonarr: 'Sonarr tarafindan yonetiliyor',
        downloaded: 'Indirildi',
        missing: 'Eksik',
        searchEpisodesPlaceholder: 'Bolumlerde ara...',
        filters: 'Filtreler',
        actions: 'Aksiyonlar',
        episodeCode: 'Bolum',
        episodeTitle: 'Baslik',
        selectedEpisodeCodes: 'Secili bolumler',
        torrentDownloading: 'Indiriliyor',
        torrentCompleted: 'Tamamlandi',
        torrentPaused: 'Durduruldu',
        torrentQueued: 'Kuyrukta',
        torrentMetadata: 'Metadata',
        torrentChecking: 'Kontrol ediliyor',
        torrentSeeding: 'Seeding',
        torrentDoneWaitingImport: 'Bolum indirildi',
      }
    : {
        title: 'Sonarr',
        subtitle: '',
        addedToSonarr: 'Added to Sonarr',
        monitoringEnabled: 'Monitoring enabled',
        monitoringDisabled: 'Monitoring disabled',
        qualityProfileLabel: 'Quality Profile',
        rootFolderLabel: 'Root Folder',
        languageLabel: 'Language',
        languageNotUsed: 'Not used by this Sonarr version',
        monitoringModeLabel: 'Monitoring',
        seasonFolderLabel: 'Season Folder',
        pathLabel: 'Path',
        sizeOnDiskLabel: 'Size on disk',
        monitoringFuture: 'Future Episodes',
        monitoringAll: 'All Episodes',
        monitoringNone: 'Off',
        enabled: 'Enabled',
        disabledSmall: 'Disabled',
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
        monitorNewItems: 'Monitor New Seasons',
        monitorAllSeasons: 'All Seasons',
        monitorFutureEpisodes: 'Future Episodes',
        monitorNone: 'Off',
        useSeasonFolder: 'Use Season Folder',
        seriesType: 'Series Type',
        seriesTypeStandard: 'Standard',
        seriesTypeDaily: 'Daily',
        seriesTypeAnime: 'Anime',
        tagsLabel: 'Tag IDs (comma-separated)',
        tagsPlaceholder: 'e.g. 1, 4, 12',
        downloadProgress: 'Download',
        seasons: 'Seasons',
        episodes: 'Episodes',
        episodeListLoading: 'Loading episodes...',
        noEpisodes: 'No episodes found for this series.',
        selectSeason: 'Select season',
        selectedCount: 'selected',
        selectedEpisodes: 'Selected episodes',
        clearSelection: 'Clear selection',
        selectAll: 'Select season',
        unselectAll: 'Unselect season',
        monitorSeason: 'Monitor season',
        unmonitorSeason: 'Unmonitor season',
        monitoredSmall: 'Monitored',
        unmonitoredSmall: 'Unmonitored',
        downloadSelected: 'Search selected',
        searchSeasonPack: 'Search season pack',
        seasonPackFallback: 'Falls back to Sonarr season search if no pack is found',
        monitorSelected: 'Auto download selected',
        unmonitorSelected: 'Disable monitoring',
        downloadEpisode: 'Download episode',
        downloadEpisodeTooltip: 'Manual search episode',
        autoEpisode: 'Download when available',
        stopAutoEpisode: 'Disable auto',
        alreadyMonitored: 'Already monitored',
        enableMonitoring: 'Enable monitoring',
        disableMonitoring: 'Disable monitoring',
        unairedSearchDisabled: 'Cannot manually search unaired episode',
        notAiredYet: 'Not aired yet',
        manualSearchTitle: 'Manual search',
        manualSearchEmpty: 'No releases found for this episode.',
        releaseName: 'Release',
        indexer: 'Indexer',
        size: 'Size',
        quality: 'Quality',
        seeders: 'Seeders',
        rejectedReason: 'Rejected reason',
        grab: 'Grab',
        monitoringUpdating: 'Updating monitoring',
        monitorLatest: 'Auto download latest missing',
        confirmTitle: 'Confirmation required',
        confirmLatestBody: 'This will search and grab the latest missing episodes for "{title}". Continue?',
        confirmRuleMonitored: 'Only monitored episodes',
        confirmRuleQuality: 'Respect quality profile',
        continueAction: 'Continue',
        fileReady: 'File',
        fileMissing: 'Missing',
        unaired: 'Unaired',
        airDate: 'Air date',
        autoOn: 'Auto',
        autoQueued: 'Will auto download',
        autoOff: 'Off',
        loading: 'Loading...',
        backToSeries: 'Back to Series',
        selectRoot: 'Select root folder',
        selectQuality: 'Select quality profile',
        disabled: 'Sonarr is disabled or connection settings are missing.',
        error: 'Could not load Sonarr series.',
        empty: 'No series found in Sonarr.',
        monitored: 'Monitored',
        unmonitored: 'Unmonitored',
        sonarrConnected: 'Sonarr Connected',
        sonarrUnreachable: 'Sonarr unreachable',
        apiKeyInvalid: 'API key invalid',
        prowlarrConnected: 'Prowlarr Connected',
        prowlarrMissing: 'Prowlarr missing',
        prowlarrUnreachable: 'Prowlarr unreachable',
        downloadClientConnected: 'Download Client Connected',
        downloadClientMissing: 'Download client missing',
        downloadClientMismatch: 'Download client mismatch',
        openInSonarr: 'Open in Sonarr',
        managedBySonarr: 'Managed by Sonarr',
        downloaded: 'Downloaded',
        missing: 'Missing',
        searchEpisodesPlaceholder: 'Search episodes...',
        filters: 'Filters',
        actions: 'Actions',
        episodeCode: 'Episode',
        episodeTitle: 'Title',
        selectedEpisodeCodes: 'Selected episodes',
        torrentDownloading: 'Downloading',
        torrentCompleted: 'Completed',
        torrentPaused: 'Paused',
        torrentQueued: 'Queued',
        torrentMetadata: 'Metadata',
        torrentChecking: 'Checking',
        torrentSeeding: 'Seeding',
        torrentDoneWaitingImport: 'Episode Downloaded',
      };

  const sonarrHealthText = health.sonarr.ok
    ? `${t.sonarrConnected}${health.sonarr.version ? ` · v${health.sonarr.version}` : ''}`
    : (health.sonarr.reason === 'api_key_invalid' ? t.apiKeyInvalid : t.sonarrUnreachable);
  const prowlarrHealthText = health.prowlarr.ok
    ? t.prowlarrConnected
    : (health.prowlarr.reason === 'missing' ? t.prowlarrMissing : t.prowlarrUnreachable);
  const clientHealthText = health.downloadClient.ok
    ? t.downloadClientConnected
    : (health.downloadClient.reason === 'missing' ? t.downloadClientMissing : health.downloadClient.reason === 'mismatch' ? t.downloadClientMismatch : t.sonarrUnreachable);
  const searchAfterAddHelp = settings?.language === 'tr'
    ? 'Acikken icerik eklendigi anda Sonarr/Radarr uygun release arar.'
    : 'When enabled, Sonarr/Radarr will search immediately after adding content.';

  const activeSeries = items.find((entry) => Number(entry?.id || 0) === Number(activeSeriesId || 0)) || null;
  const headerSubtitle = activeSeries
    ? [
        t.addedToSonarr,
        activeSeries?.monitored === true ? t.monitoringEnabled : t.monitoringDisabled,
        `${t.qualityProfileLabel}: ${getSeriesQualityProfileName(activeSeries, qualityProfiles)}`,
      ].join(' · ')
    : '';

  const renderSeriesDetailPage = () => {
    if (!activeSeries) return null;
    const seriesId = Number(activeSeries?.id || 0);
    const title = activeSeries?.title || activeSeries?.sortTitle || 'Unknown';
    const year = activeSeries?.year ? `(${activeSeries.year})` : '';
    const poster = activeSeries?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl || '';
    const allEpisodes = Array.isArray(episodesBySeries[seriesId]) ? episodesBySeries[seriesId] : [];
    const seasons = [...new Set(allEpisodes.map((ep) => Number(ep?.seasonNumber || 0)).filter((n) => n > 0))].sort((a, b) => a - b);
    const selectedSeason = Number(selectedSeasonBySeries[seriesId] || seasons[0] || 0);
    const seasonEpisodes = allEpisodes.filter((ep) => Number(ep?.seasonNumber || 0) === selectedSeason);
    const normalizedEpisodeQuery = normalizeMediaText(episodeQuery);
    const displayedSeasonEpisodes = normalizedEpisodeQuery
      ? seasonEpisodes.filter((ep) => {
          const epNo = Number(ep?.episodeNumber || 0);
          return normalizeMediaText(`S${selectedSeason}E${epNo} ${ep?.title || ''}`).includes(normalizedEpisodeQuery);
        })
      : seasonEpisodes;
    const displayedEpisodeIds = displayedSeasonEpisodes.map((ep) => Number(ep?.id || 0)).filter(Boolean);
    const selectedIds = Array.isArray(selectedEpisodeIdsBySeries[seriesId]) ? selectedEpisodeIdsBySeries[seriesId] : [];
    const allDisplayedSelected = displayedEpisodeIds.length > 0 && displayedEpisodeIds.every((id) => selectedIds.includes(id));
    const visibleSelectedIds = seasonEpisodes
      .map((ep) => Number(ep?.id || 0))
      .filter((id) => selectedIds.includes(id));
    const visibleSelectedAiredIds = seasonEpisodes
      .filter((ep) => isEpisodeAired(ep))
      .map((ep) => Number(ep?.id || 0))
      .filter((id) => selectedIds.includes(id));
    const airedCount = seasonEpisodes.filter((ep) => isEpisodeAired(ep)).length;
    const resolvedDownloadedCount = seasonEpisodes.filter((ep) => isEpisodeResolvedAsDownloaded(ep, qbEpisodeStatusBySeries[seriesId]?.[Number(ep?.id || 0)] || null)).length;
    const missingCount = seasonEpisodes.filter((ep) => isEpisodeAired(ep) && !isEpisodeResolvedAsDownloaded(ep, qbEpisodeStatusBySeries[seriesId]?.[Number(ep?.id || 0)] || null)).length;
    const downloadedCount = resolvedDownloadedCount;
    const unairedCount = seasonEpisodes.filter((ep) => !isEpisodeAired(ep)).length;
    const monitoredCount = seasonEpisodes.filter((ep) => ep?.monitored === true).length;
    const allEpisodeIds = seasonEpisodes.map((ep) => Number(ep?.id || 0)).filter(Boolean);
    const allSeasonSelected = allEpisodeIds.length > 0 && allEpisodeIds.every((id) => selectedIds.includes(id));
    const selectedSeasonMonitored = seasonEpisodes.length > 0 && seasonEpisodes.every((ep) => ep?.monitored === true);
    const seasonSearchKey = `season-search-${seriesId}-${selectedSeason}`;
    const infoQuality = getSeriesQualityName(activeSeries, qualityProfiles);
    const infoLanguageRaw = getSeriesLanguageProfileName(activeSeries, languageProfiles);
    const infoLanguage = /deprecated/i.test(String(infoLanguageRaw || ''))
      ? t.languageNotUsed
      : infoLanguageRaw;
    const infoMonitoring = getSeriesMonitoringMode(activeSeries, t);
    const infoSeasonFolder = getSeriesSeasonFolderLabel(activeSeries, t);
    const infoRoot = String(activeSeries?.rootFolderPath || '-');
    const infoPath = String(activeSeries?.path || '-');
    const sonarrSizeOnDisk = Number(activeSeries?.statistics?.sizeOnDisk || activeSeries?.sizeOnDisk || 0);
    const episodeSizeFallback = allEpisodes.reduce((sum, ep) => {
      if (ep?.hasFile === true) {
        return sum + Number(ep?.sizeOnDisk || ep?.fileSize || ep?.size || 0);
      }
      const qb = qbEpisodeStatusBySeries[seriesId]?.[Number(ep?.id || 0)] || null;
      if (isQbEpisodeCompleted(qb)) return sum + Number(qb?.size || 0);
      return sum;
    }, 0);
    const infoSizeOnDisk = formatBytes(Math.max(sonarrSizeOnDisk, episodeSizeFallback));
    const selectedEpisodeCodes = seasonEpisodes
      .filter((ep) => selectedIds.includes(Number(ep?.id || 0)))
      .map((ep) => `S${String(Number(ep?.seasonNumber || selectedSeason)).padStart(2, '0')}E${String(Number(ep?.episodeNumber || 0)).padStart(2, '0')}`);

    return (
      <section className="sonarr-series-page">
        <header className="sonarr-detail-shell-header">
          <div className="sonarr-title-cluster">
            <button
              type="button"
              className="sonarr-icon-back"
              onClick={() => setActiveSeriesId(null)}
              aria-label={t.backToSeries}
              title={t.backToSeries}
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h1>{title} {year}</h1>
              <p>{t.managedBySonarr} <span className="sonarr-live-dot" /></p>
            </div>
          </div>
          <div className="radarr-header-actions">
            <label className="automation-inline-toggle">
              <span title={searchAfterAddHelp}>{t.searchAfterAdd}</span>
              <button
                type="button"
                className={`automation-toggle-btn ${searchAfterAdd ? 'on' : 'off'}`}
                onClick={() => saveSearchAfterAdd(!searchAfterAdd)}
                aria-pressed={searchAfterAdd}
              >
                <span />
              </button>
            </label>
            <button type="button" className="radarr-refresh-btn" onClick={loadSeries}>
              <RefreshCw size={14} />
              {t.refresh}
            </button>
          </div>
        </header>

        <div className="sonarr-detail-health-row">
          <span className={`sonarr-health-pill ${health.sonarr.ok ? 'ok' : 'off'}`}>
            <Server size={15} />
            <strong>Sonarr</strong>
            <em>{health.sonarr.ok ? 'Connected' : sonarrHealthText}</em>
          </span>
          <span className={`sonarr-health-pill ${health.prowlarr.ok ? 'ok' : 'off'}`}>
            <Server size={15} />
            <strong>Prowlarr</strong>
            <em>{health.prowlarr.ok ? 'Connected' : prowlarrHealthText}</em>
          </span>
          <span className={`sonarr-health-pill ${health.downloadClient.ok ? 'ok' : 'off'}`}>
            <MonitorDown size={15} />
            <strong>Download Client</strong>
            <em>{health.downloadClient.ok ? 'Connected' : clientHealthText}</em>
          </span>
          <button
            type="button"
            className="sonarr-health-pill sonarr-open-pill"
            onClick={() => openSeriesInSonarr(activeSeries)}
          >
            <ExternalLink size={15} />
            <strong>{t.openInSonarr}</strong>
          </button>
        </div>

        <div className="sonarr-series-page-card">
          <div className="sonarr-series-page-visual">
            {poster ? <img src={poster} alt={title} className="radarr-poster" /> : <div className="radarr-poster-fallback">{title.slice(0, 1)}</div>}
            <button
              type="button"
              className="sonarr-poster-edit-btn"
              onClick={() => openEditModal(activeSeries)}
            >
              {t.edit}
            </button>
          </div>
          <div className="sonarr-series-page-body">
            <div className="sonarr-info-grid">
              <div className="sonarr-info-item">
                <span><Grid2X2 size={15} /></span>
                <div><small>{t.qualityProfileLabel}</small><strong>{infoQuality}</strong></div>
              </div>
              <div className="sonarr-info-item">
                <span><Folder size={15} /></span>
                <div><small>{t.rootFolderLabel}</small><strong title={infoRoot}>{infoRoot}</strong></div>
              </div>
              <div className="sonarr-info-item">
                <span><Bell size={15} /></span>
                <div><small>{t.monitoringModeLabel}</small><strong>{infoMonitoring}</strong></div>
              </div>
              <div className="sonarr-info-item">
                <span><Grid2X2 size={15} /></span>
                <div><small>{t.languageLabel}</small><strong>{infoLanguage}</strong></div>
              </div>
              <div className="sonarr-info-item">
                <span><Grid2X2 size={15} /></span>
                <div><small>{t.seasonFolderLabel}</small><strong>{infoSeasonFolder}</strong></div>
              </div>
              <div className="sonarr-info-item">
                <span><HardDrive size={15} /></span>
                <div><small>{t.sizeOnDiskLabel}</small><strong>{infoSizeOnDisk}</strong></div>
              </div>
              <div className="sonarr-info-item wide">
                <span><Folder size={15} /></span>
                <div><small>{t.pathLabel}</small><strong title={infoPath}>{infoPath}</strong></div>
              </div>
            </div>
            <div className="sonarr-season-summary-row">
            <div className="sonarr-season-bar">
              <span>{t.seasons}</span>
              <div className="sonarr-season-chips">
                {seasons.map((seasonNo) => (
                  (() => {
                    const chipEpisodes = allEpisodes.filter((ep) => Number(ep?.seasonNumber || 0) === seasonNo);
                    const chipMonitored = chipEpisodes.length > 0 && chipEpisodes.every((ep) => ep?.monitored === true);
                    return (
                  <button
                    key={`${seriesId}-detail-s-${seasonNo}`}
                    type="button"
                    className={`sonarr-season-chip ${selectedSeason === seasonNo ? 'active' : ''}`}
                    onClick={() => setSelectedSeasonBySeries((prev) => ({ ...prev, [seriesId]: seasonNo }))}
                  >
                    S{seasonNo} · {chipMonitored ? t.monitoredSmall : t.unmonitoredSmall}
                  </button>
                    );
                  })()
                ))}
              </div>
            </div>
            <div className="sonarr-series-stats">
              <span className="ok"><CheckCircle2 size={14} /><strong>{downloadedCount}</strong><small>{t.downloaded}</small></span>
              <span className="missing"><X size={14} /><strong>{missingCount}</strong><small>{t.missing}</small></span>
              <span className="unaired"><Bell size={14} /><strong>{unairedCount}</strong><small>{t.unaired}</small></span>
            </div>
            </div>
            <div className="sonarr-bulk-toolbar">
              <div className="sonarr-season-tools">
                <button
                  type="button"
                  className="sonarr-tool-btn"
                  onClick={() => setSelectedEpisodeIdsBySeries((prev) => ({ ...prev, [seriesId]: allSeasonSelected ? [] : allEpisodeIds }))}
                  disabled={!allEpisodeIds.length}
                >
                  <CheckCircle2 size={15} />
                  {allSeasonSelected ? t.unselectAll : t.selectAll}
                </button>
                {visibleSelectedIds.length > 0 && (
                  <button
                    type="button"
                    className="sonarr-tool-btn"
                    onClick={() => setSelectedEpisodeIdsBySeries((prev) => ({ ...prev, [seriesId]: [] }))}
                  >
                    <BellOff size={15} />
                    {t.clearSelection}
                  </button>
                )}
                <button
                  type="button"
                  className="sonarr-tool-btn"
                  onClick={() => setEpisodesMonitored(seriesId, allEpisodeIds, !selectedSeasonMonitored)}
                  disabled={!allEpisodeIds.length}
                >
                  <Bell size={15} />
                  {selectedSeasonMonitored ? t.unmonitorSeason : t.monitorSeason}
                </button>
              </div>
              <div className="sonarr-main-actions">
                <button
                  type="button"
                  className="sonarr-tool-btn sonarr-pack-btn"
                  title={t.seasonPackFallback}
                  onClick={() => searchSeasonPack(seriesId, selectedSeason)}
                  disabled={!selectedSeason || episodeActionLoading[seasonSearchKey]}
                >
                  {episodeActionLoading[seasonSearchKey] ? <RefreshCw size={15} className="spin-animation" /> : <Sparkles size={15} />}
                  {t.searchSeasonPack}
                </button>
                <button
                  type="button"
                  className="sonarr-tool-btn sonarr-latest-btn"
                  onClick={() => setConfirmLatestMissing({ seriesId, title, episodes: allEpisodes })}
                  disabled={!allEpisodes.some((ep) => !ep?.hasFile)}
                >
                  <Sparkles size={15} />
                  {t.monitorLatest}
                </button>
              </div>
            </div>

        <div className="sonarr-episode-toolbar">
          <label className="sonarr-episode-search">
            <Search size={14} />
            <input
              type="text"
              value={episodeQuery}
              onChange={(event) => setEpisodeQuery(event.target.value)}
              placeholder={t.searchEpisodesPlaceholder}
            />
          </label>
        </div>

            {episodesLoadingBySeries[seriesId] ? (
              <div className="sonarr-episodes-loading">{t.episodeListLoading}</div>
            ) : (
              <>
                {seasons.length > 0 ? (
                  <>
                    <div className="sonarr-episode-list sonarr-episode-list-wide">
                      <div className="sonarr-episode-row sonarr-episode-head">
                        <span>
                          <button
                            type="button"
                            className="sonarr-tool-btn sonarr-head-select-btn"
                            title={allDisplayedSelected ? t.unselectAll : t.selectAll}
                            aria-label={allDisplayedSelected ? t.unselectAll : t.selectAll}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedEpisodeIdsBySeries((prev) => {
                                const current = Array.isArray(prev[seriesId]) ? prev[seriesId] : [];
                                const currentSet = new Set(current);
                                if (allDisplayedSelected) {
                                  for (const id of displayedEpisodeIds) currentSet.delete(id);
                                } else {
                                  for (const id of displayedEpisodeIds) currentSet.add(id);
                                }
                                return { ...prev, [seriesId]: [...currentSet] };
                              });
                            }}
                            disabled={!displayedEpisodeIds.length}
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        </span>
                        <span>{t.episodeCode}</span>
                        <span>{t.episodeTitle}</span>
                        <span>{t.airDate}</span>
                        <span>Status</span>
                        <span>{t.downloadProgress}</span>
                        <span>{t.actions}</span>
                      </div>
                      {displayedSeasonEpisodes.map((ep) => {
                        const epId = Number(ep?.id || 0);
                        const epNo = Number(ep?.episodeNumber || 0);
                        const epTitle = ep?.title || `Episode ${epNo}`;
                        const airDateText = formatAirDate(ep, settings?.language);
                        const isSelected = selectedIds.includes(epId);
                        const isMonitored = ep?.monitored === true;
                        const aired = isEpisodeAired(ep);
                        const qbEpisode = qbEpisodeStatusBySeries[seriesId]?.[epId] || null;
                        const resolvedDownloaded = isEpisodeResolvedAsDownloaded(ep, qbEpisode);
                        const statusText = resolvedDownloaded
                          ? t.downloaded
                          : aired
                            ? (isMonitored ? `${t.fileMissing} + ${t.monitored}` : t.fileMissing)
                            : (isMonitored ? t.autoQueued : t.notAiredYet);
                        const statusClass = resolvedDownloaded ? 'ok' : aired ? 'off' : isMonitored ? 'watch' : 'unaired';
                        const qbProgressPercent = qbEpisode ? Math.round(normalizeQbProgressPercent(qbEpisode.progress || 0)) : 0;
                        const qbStateRaw = String(qbEpisode?.state || '').toLowerCase();
                        const qbCompleted = isQbEpisodeCompleted(qbEpisode);
                        const qbSizeText = formatBinarySize(Number(qbEpisode?.size || 0));
                        let qbStateText = '';
                        if (qbEpisode) {
                          if (qbStateRaw.includes('paused')) qbStateText = t.torrentPaused;
                          else if (qbStateRaw.includes('queued')) qbStateText = t.torrentQueued;
                          else if (qbStateRaw.includes('meta')) qbStateText = t.torrentMetadata;
                          else if (qbStateRaw.includes('check')) qbStateText = t.torrentChecking;
                          else if (qbStateRaw.includes('up') || qbStateRaw.includes('seed')) qbStateText = t.torrentSeeding;
                          else if (qbProgressPercent >= 100 || qbStateRaw.includes('complete')) qbStateText = t.torrentCompleted;
                          else qbStateText = t.torrentDownloading;
                        }
                        const searchKey = `search-${seriesId}-${epId}`;
                        const monitorOnKey = `monitor-${seriesId}-${epId}-on`;
                        const monitorOffKey = `monitor-${seriesId}-${epId}-off`;
                        const monitorBusy = Boolean(episodeActionLoading[monitorOnKey] || episodeActionLoading[monitorOffKey]);
                        const searchTooltip = aired ? t.downloadEpisodeTooltip : t.unairedSearchDisabled;
                        const monitorTooltip = monitorBusy
                          ? t.monitoringUpdating
                          : isMonitored
                            ? `${t.disableMonitoring} (${t.alreadyMonitored})`
                            : t.enableMonitoring;
                        return (
                          <label key={epId || `${seriesId}-${selectedSeason}-${epNo}`} className="sonarr-episode-row">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleEpisodeSelection(seriesId, epId)}
                            />
                            <span className="code">E{String(epNo).padStart(2, '0')}</span>
                            <span className="title">{epTitle}</span>
                            <span className="air-date" title={t.airDate}>{airDateText}</span>
                            <span className={`state ${statusClass}`}>
                              <span>{statusText}</span>
                            </span>
                            <span className="sonarr-episode-download">
                              {qbEpisode ? (
                                qbCompleted ? (
                                  <span className="sonarr-episode-download-done">{t.torrentDoneWaitingImport} - {qbSizeText}</span>
                                ) : (
                                  <span className="sonarr-episode-download-live">
                                    <small>{qbStateText}</small>
                                    <span className="sonarr-episode-download-bar-row">
                                      <span className="sonarr-episode-download-bar-track">
                                        <span
                                          className="sonarr-episode-download-bar-fill"
                                          style={{ width: `${qbProgressPercent}%` }}
                                        />
                                      </span>
                                      <strong>{qbProgressPercent}%</strong>
                                    </span>
                                  </span>
                                )
                              ) : (
                                <span className="sonarr-episode-download-empty">-</span>
                              )}
                            </span>
                            <span className="sonarr-episode-actions">
                              {aired ? (
                                <button
                                  type="button"
                                  title={searchTooltip}
                                  aria-label={searchTooltip}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openManualSearchModal(seriesId, ep);
                                  }}
                                  disabled={!epId || episodeActionLoading[searchKey]}
                                >
                                  {episodeActionLoading[searchKey] ? <RefreshCw size={14} className="spin-animation" /> : <Download size={14} />}
                                </button>
                              ) : (
                                <span
                                  className="sonarr-action-disabled-label"
                                  title={t.unairedSearchDisabled}
                                  aria-label={t.unairedSearchDisabled}
                                >
                                  {t.notAiredYet}
                                </span>
                              )}
                              <button
                                type="button"
                                className={`monitor-toggle ${isMonitored ? 'is-on' : 'is-off'}`}
                                title={monitorTooltip}
                                aria-label={monitorTooltip}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setEpisodesMonitored(seriesId, [epId], !isMonitored);
                                }}
                                disabled={!epId || monitorBusy}
                              >
                                {isMonitored ? <BellOff size={14} /> : <Bell size={14} />}
                              </button>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="sonarr-episode-footer">
                      <span>{visibleSelectedIds.length} {t.selectedCount}</span>
                    </div>
                    {visibleSelectedIds.length > 0 && (
                      <div className="sonarr-selection-bar">
                        <div className="sonarr-selection-summary">
                          <strong><CheckCircle2 size={17} /></strong>
                          <span>
                            {visibleSelectedIds.length} {t.selectedEpisodes}
                            <small>{selectedEpisodeCodes.join(', ')}</small>
                          </span>
                        </div>
                        <div className="sonarr-selection-actions">
                          <button
                            type="button"
                            onClick={() => searchEpisodes(seriesId, visibleSelectedAiredIds)}
                            disabled={!visibleSelectedAiredIds.length}
                          >
                            <Download size={15} />
                            {t.downloadSelected}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEpisodesMonitored(seriesId, visibleSelectedIds, true)}
                          >
                            <Bell size={15} />
                            {t.monitorSelected}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEpisodesMonitored(seriesId, visibleSelectedIds, false)}
                          >
                            <BellOff size={15} />
                            {t.unmonitorSelected}
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => setSelectedEpisodeIdsBySeries((prev) => ({ ...prev, [seriesId]: [] }))}
                          >
                            <X size={15} />
                            {t.clearSelection}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="sonarr-episodes-empty">{t.noEpisodes}</div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    );
  };

  const sortedManualReleases = manualReleaseSort.key
    ? manualSearchModal.releases.slice().sort((a, b) => {
        const direction = manualReleaseSort.direction === 'asc' ? 1 : -1;
        if (manualReleaseSort.key === 'size') {
          return ((Number(a?.size || 0) - Number(b?.size || 0)) * direction);
        }
        if (manualReleaseSort.key === 'seeders') {
          return ((Number(a?.seeders || 0) - Number(b?.seeders || 0)) * direction);
        }
        if (manualReleaseSort.key === 'quality') {
          const rankA = getQualityRank(getReleaseQualityName(a));
          const rankB = getQualityRank(getReleaseQualityName(b));
          if (rankA !== rankB) return (rankA - rankB) * direction;
          return getReleaseQualityName(a).localeCompare(getReleaseQualityName(b)) * direction;
        }
        return 0;
      })
    : manualSearchModal.releases;

  return (
    <div className="radarr-view">
      {!activeSeries && <header className="radarr-view-header">
        <div>
          <h1>{t.title}</h1>
          {headerSubtitle && <p>{headerSubtitle}</p>}
          <div className="sonarr-health-strip">
            <span className={`sonarr-health-item ${health.sonarr.ok ? 'ok' : 'off'}`}>{sonarrHealthText}</span>
            <span className={`sonarr-health-item ${health.prowlarr.ok ? 'ok' : 'off'}`}>{prowlarrHealthText}</span>
            <span className={`sonarr-health-item ${health.downloadClient.ok ? 'ok' : 'off'}`}>{clientHealthText}</span>
          </div>
        </div>
        <div className="radarr-header-actions">
          <label className="automation-inline-toggle">
            <span title={searchAfterAddHelp}>{t.searchAfterAdd}</span>
            <button
              type="button"
              className={`automation-toggle-btn ${searchAfterAdd ? 'on' : 'off'}`}
              onClick={() => saveSearchAfterAdd(!searchAfterAdd)}
              aria-pressed={searchAfterAdd}
            >
              <span />
            </button>
          </label>
          <button type="button" className="radarr-refresh-btn" onClick={loadSeries}>
            {t.refresh}
          </button>
        </div>
      </header>}

      {status === 'disabled' && <div className="radarr-note">{t.disabled}</div>}
      {status === 'error' && <div className="radarr-note radarr-note-error">{t.error}</div>}
      {status === 'ready' && items.length === 0 && <div className="radarr-note">{t.empty}</div>}

      {status === 'ready' && items.length > 0 && (
        <>
          {activeSeries ? (
            renderSeriesDetailPage()
          ) : (
            <section className="radarr-grid">
          {items.map((series) => {
            const title = series?.title || series?.sortTitle || 'Unknown';
            const year = series?.year ? `(${series.year})` : '';
            const poster = series?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl || '';
            const monitored = series?.monitored === true;
            const seriesId = Number(series?.id || 0);
            return (
              <article
                key={seriesId || `${title}-${year}`}
                className="radarr-card sonarr-card"
                onClick={() => openSeriesPage(seriesId)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openSeriesPage(seriesId);
                  }
                }}
              >
                <div className="radarr-poster-wrap">
                  {poster ? <img src={poster} alt={title} className="radarr-poster" /> : <div className="radarr-poster-fallback">{title.slice(0, 1)}</div>}
                </div>
                <div className="radarr-meta">
                  <strong>{title} {year}</strong>
                  <span className={monitored ? 'ok' : 'off'}>{monitored ? t.monitored : t.unmonitored}</span>
                </div>
                <div className="radarr-card-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="radarr-edit-btn"
                    disabled={removingId === seriesId}
                    onClick={() => openEditModal(series)}
                  >
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    className="radarr-remove-btn"
                    disabled={removingId === seriesId}
                    onClick={() => handleRemove(series)}
                  >
                    {removingId === seriesId ? t.removing : t.remove}
                  </button>
                </div>

              </article>
            );
          })}
            </section>
          )}
        </>
      )}

      {editingSeries && (
        <div className="lightbox" onClick={closeEditModal}>
          <div className="radarr-modal-card sonarr-edit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.edit}</h3>
            </div>
            {editLoading ? (
              <p>{t.loading}</p>
            ) : (
              <div className="radarr-modal-body sonarr-edit-modal-body">
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
                <label className="radarr-check sonarr-edit-check">
                  <input type="checkbox" checked={editMonitored} onChange={(event) => setEditMonitored(event.target.checked)} />
                  <span>{t.monitoredEdit}</span>
                </label>
                <label>
                  <span>{t.monitorNewItems}</span>
                  <select value={editMonitorNewItems} onChange={(event) => setEditMonitorNewItems(event.target.value)}>
                    <option value="all">{t.monitorAllSeasons}</option>
                    <option value="newEpisodes">{t.monitorFutureEpisodes}</option>
                    <option value="none">{t.monitorNone}</option>
                  </select>
                </label>
                <label className="radarr-check sonarr-edit-check">
                  <input type="checkbox" checked={editSeasonFolder} onChange={(event) => setEditSeasonFolder(event.target.checked)} />
                  <span>{t.useSeasonFolder}</span>
                </label>
                <label>
                  <span>{t.seriesType}</span>
                  <select value={editSeriesType} onChange={(event) => setEditSeriesType(event.target.value)}>
                    <option value="standard">{t.seriesTypeStandard}</option>
                    <option value="daily">{t.seriesTypeDaily}</option>
                    <option value="anime">{t.seriesTypeAnime}</option>
                  </select>
                </label>
                <label>
                  <span>{t.tagsLabel}</span>
                  <input
                    type="text"
                    value={editTagsText}
                    onChange={(event) => setEditTagsText(event.target.value)}
                    placeholder={t.tagsPlaceholder}
                  />
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

      {confirmLatestMissing && (
        <div className="lightbox" onClick={() => setConfirmLatestMissing(null)}>
          <div className="radarr-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.confirmTitle}</h3>
            </div>
            <div className="radarr-modal-body">
              <p>{t.confirmLatestBody.replace('{title}', String(confirmLatestMissing.title || 'Series'))}</p>
              <p className="radarr-success">{t.confirmRuleMonitored}</p>
              <p className="radarr-success">{t.confirmRuleQuality}</p>
              <div className="radarr-modal-actions">
                <button className="btn btn-secondary" onClick={() => setConfirmLatestMissing(null)}>{t.cancel}</button>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    const payload = confirmLatestMissing;
                    setConfirmLatestMissing(null);
                    await monitorLatestMissing(payload?.seriesId, payload?.episodes || []);
                  }}
                >
                  {t.continueAction}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {manualSearchModal.open && (
        <div className="lightbox" onClick={closeManualSearchModal}>
          <div className="radarr-modal-card sonarr-manual-modal" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.manualSearchTitle}: {manualSearchModal.episodeCode} - {manualSearchModal.episodeTitle}</h3>
            </div>
            <div className="radarr-modal-body">
              {manualSearchModal.loading ? (
                <p>{t.loading}</p>
              ) : (
                <>
                  {manualSearchModal.error && <p className="radarr-note radarr-note-error">{manualSearchModal.error}</p>}
                  {!manualSearchModal.error && manualSearchModal.releases.length === 0 && (
                    <p className="radarr-note">{t.manualSearchEmpty}</p>
                  )}
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
                            <th>{t.rejectedReason}</th>
                            <th>{t.grab}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedManualReleases.map((release, index) => {
                            const guid = String(release?.guid || release?.downloadUrl || `row-${index}`);
                            const canGrab = release?.downloadAllowed !== false;
                            const qualityName = getReleaseQualityName(release);
                            const indexerName = String(release?.indexer || release?.indexerName || '-');
                            const rejected = extractRejectedReason(release);
                            return (
                              <tr key={guid}>
                                <td title={String(release?.title || release?.releaseTitle || '-')}>{String(release?.title || release?.releaseTitle || '-')}</td>
                                <td>{indexerName}</td>
                                <td>{formatReleaseSize(release?.size)}</td>
                                <td>{qualityName}</td>
                                <td>{Number(release?.seeders || 0)}</td>
                                <td>{rejected}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn-primary sonarr-grab-btn"
                                    disabled={!canGrab || manualSearchModal.grabbingGuid === guid}
                                    onClick={() => handleGrabRelease(release)}
                                  >
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
                  <div className="radarr-modal-actions">
                    <button className="btn btn-secondary" onClick={closeManualSearchModal}>{t.cancel}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SonarrView;
