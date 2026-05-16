import React, { useState, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  Home,
  Film,
  Tv,
  Settings as SettingsIcon,
  Search,
  Bookmark,
  Sparkles,
  Download,
  Library,
  ChevronUp,
  ChevronDown,
  Cog,
} from 'lucide-react';
import HomeView from './components/HomeView';
import MoviesView from './components/MoviesView';
import TVShowsView from './components/TVShowsView';
import AnimeView from './components/AnimeView';
import DetailView from './components/DetailView';
import SettingsView from './components/SettingsView';
import MyListView from './components/MyListView';
import DownloadsView from './components/DownloadsView';
import SearchView from './components/SearchView';
import LibraryView from './components/LibraryView';
import RadarrView from './components/RadarrView';
import SonarrView from './components/SonarrView';
import { DEFAULT_PROWLARR_CONFIG } from './sources/index.mjs';
import { normalizeTorrentioConfig } from './utils/torrentio';
import { WATCH_STATUS_STORAGE_KEY, buildWatchStatusKey } from './utils/watchStatus';
import './styles/App.css';

const WELCOME_OVERLAY_SEEN_KEY = 'cinesoftWelcomeSeenV1';
const DEFAULT_PAGE_ROUTE_MAP = {
  home: '/',
  movies: '/movies',
  tv: '/tv',
  anime: '/anime',
  library: '/library',
  mylist: '/mylist',
  downloads: '/downloads',
  search: '/search',
  radarr: '/radarr',
  sonarr: '/sonarr',
  settings: '/settings',
};
const APP_TOAST_EVENT = 'cinesoft:toast';
let appToastId = 0;

export const showAppToast = (detail = {}) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(APP_TOAST_EVENT, { detail }));
};

const App = () => {
  const [settings, setSettings] = useState({
    apiKey: '',
    language: 'tr',
    defaultPage: 'home',
    notificationsEnabled: true,
    closeToTray: true,
    minimizeToTrayOnClose: true,
    stopManagedEnginesOnExit: true,
    confirmExitWhileDownloading: true,
    prowlarrAutoStartDisabled: false,
    radarrAutoStartDisabled: false,
    sonarrAutoStartDisabled: false,
    prowlarr: DEFAULT_PROWLARR_CONFIG,
    embeddedTorrentEnabled: true,
    qbittorrentEnabled: true,
    qbittorrent: {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    },
    torrentio: normalizeTorrentioConfig({}),
    radarrEnabled: false,
    radarrManaged: false,
    radarrBaseUrl: 'http://127.0.0.1:7878',
    radarrApiKey: '',
    radarrExecutablePath: '',
    radarrPort: 7878,
    radarrTimeout: 10000,
    radarrDefaultRootFolder: '',
    radarrDefaultQualityProfileId: '',
    radarrSearchAfterAdd: true,
    sonarrEnabled: false,
    sonarrManaged: false,
    sonarrBaseUrl: 'http://127.0.0.1:8989',
    sonarrApiKey: '',
    sonarrExecutablePath: '',
    sonarrPort: 8989,
    sonarrTimeout: 10000,
    sonarrDefaultRootFolder: '',
    sonarrDefaultQualityProfileId: '',
    sonarrSearchAfterAdd: true,
  });
  const [loading, setLoading] = useState(true);
  const [myList, setMyList] = useState([]);
  const [watchStatusMap, setWatchStatusMap] = useState({});
  const [searchState, setSearchState] = useState({ query: '', results: [], inputValue: '' });
  const [movieState, setMovieState] = useState({ movies: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  const [tvState, setTvState] = useState({ shows: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  const [animeState, setAnimeState] = useState({ anime: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  const [showWelcome, setShowWelcome] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [mpvDebugStatus, setMpvDebugStatus] = useState('idle');
  const [mpvDebugAvailable, setMpvDebugAvailable] = useState(false);
  const [mpvDebugError, setMpvDebugError] = useState('');
  const [mpvDebugPath, setMpvDebugPath] = useState('');
  const [mpvDebugProbePath, setMpvDebugProbePath] = useState('');
  const [mpvDebugVersion, setMpvDebugVersion] = useState('');
  const [mpvDebugSource, setMpvDebugSource] = useState('');
  const [mpvDebugBusy, setMpvDebugBusy] = useState(false);
  const [mpvDebugMode, setMpvDebugMode] = useState('native-host');
  const [mpvDebugSourceType, setMpvDebugSourceType] = useState('embedded-file');
  const [mpvDebugEmbedded, setMpvDebugEmbedded] = useState(false);
  const [mpvDebugRenderMode, setMpvDebugRenderMode] = useState('d3d11');
  const [mpvDebugProcessOutput, setMpvDebugProcessOutput] = useState('');
  const [mpvSlotBounds, setMpvSlotBounds] = useState({ x: 260, y: 120, width: 900, height: 500 });
  const [mpvDebugStreamUrl, setMpvDebugStreamUrl] = useState('');
  const [mpvDebugStreamSessionId, setMpvDebugStreamSessionId] = useState('');
  const [streamServerRunning, setStreamServerRunning] = useState(false);
  const [streamServerPort, setStreamServerPort] = useState(null);
  const [streamServerBaseUrl, setStreamServerBaseUrl] = useState('');
  const [streamActiveSessionCount, setStreamActiveSessionCount] = useState(0);
  const [streamSessions, setStreamSessions] = useState([]);
  const [embeddedTorrentSource, setEmbeddedTorrentSource] = useState('');
  const [embeddedTorrentSourceKind, setEmbeddedTorrentSourceKind] = useState('magnet');
  const [embeddedTorrentStreamStatus, setEmbeddedTorrentStreamStatus] = useState(null);
  const [embeddedStopResult, setEmbeddedStopResult] = useState(null);
  const showMpvDebugPanel = window.electronAPI?.isDev === true;
  const mpvNativeSlotRef = useRef(null);
  const mpvBoundsThrottleRef = useRef(null);

  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const savedSettings = await window.electronAPI.getSettings();
        if (savedSettings) {
          setSettings({
            apiKey: savedSettings.apiKey || '',
            language: savedSettings.language || 'tr',
            defaultPage: savedSettings.defaultPage || 'home',
            notificationsEnabled: savedSettings.notificationsEnabled !== false,
            closeToTray: savedSettings.closeToTray !== false,
            minimizeToTrayOnClose: savedSettings.minimizeToTrayOnClose !== false,
            stopManagedEnginesOnExit: savedSettings.stopManagedEnginesOnExit !== false,
            confirmExitWhileDownloading: savedSettings.confirmExitWhileDownloading !== false,
            prowlarrAutoStartDisabled: savedSettings.prowlarrAutoStartDisabled === true,
            radarrAutoStartDisabled: savedSettings.radarrAutoStartDisabled === true,
            sonarrAutoStartDisabled: savedSettings.sonarrAutoStartDisabled === true,
            prowlarr: savedSettings.prowlarr || DEFAULT_PROWLARR_CONFIG,
            torrentioEnabled: savedSettings.torrentioEnabled || false,
            embeddedTorrentEnabled: savedSettings.embeddedTorrentEnabled !== false,
            qbittorrentEnabled: savedSettings.qbittorrentEnabled !== false,
            qbittorrent: savedSettings.qbittorrent || {
              baseUrl: 'http://127.0.0.1:8080',
              username: 'admin',
              password: 'adminadmin',
            },
            torrentio: normalizeTorrentioConfig(savedSettings.torrentio || {}),
            radarrEnabled: savedSettings.radarrEnabled === true,
            radarrManaged: savedSettings.radarrManaged === true,
            radarrBaseUrl: savedSettings.radarrBaseUrl || 'http://127.0.0.1:7878',
            radarrApiKey: savedSettings.radarrApiKey || '',
            radarrExecutablePath: savedSettings.radarrExecutablePath || '',
            radarrPort: Number(savedSettings.radarrPort || 7878),
            radarrTimeout: Number(savedSettings.radarrTimeout || 10000),
            radarrDefaultRootFolder: savedSettings.radarrDefaultRootFolder || '',
            radarrDefaultQualityProfileId: savedSettings.radarrDefaultQualityProfileId ?? '',
            radarrSearchAfterAdd: savedSettings.radarrSearchAfterAdd !== false,
            sonarrEnabled: savedSettings.sonarrEnabled === true,
            sonarrManaged: savedSettings.sonarrManaged === true,
            sonarrBaseUrl: savedSettings.sonarrBaseUrl || 'http://127.0.0.1:8989',
            sonarrApiKey: savedSettings.sonarrApiKey || '',
            sonarrExecutablePath: savedSettings.sonarrExecutablePath || '',
            sonarrPort: Number(savedSettings.sonarrPort || 8989),
            sonarrTimeout: Number(savedSettings.sonarrTimeout || 10000),
            sonarrDefaultRootFolder: savedSettings.sonarrDefaultRootFolder || '',
            sonarrDefaultQualityProfileId: savedSettings.sonarrDefaultQualityProfileId ?? '',
            sonarrSearchAfterAdd: savedSettings.sonarrSearchAfterAdd !== false,
          });

          if (savedSettings.prowlarr?.managed && savedSettings.prowlarr?.enabled && !savedSettings.torrentioEnabled && savedSettings.prowlarrAutoStartDisabled !== true) {
            window.electronAPI?.startManagedProwlarr?.(savedSettings.prowlarr);
          }
          if (savedSettings.radarrManaged === true && savedSettings.radarrEnabled === true && savedSettings.radarrAutoStartDisabled !== true) {
            window.electronAPI?.startManagedRadarr?.(savedSettings);
          }
          if (savedSettings.sonarrManaged === true && savedSettings.sonarrEnabled === true && savedSettings.sonarrAutoStartDisabled !== true) {
            window.electronAPI?.startManagedSonarr?.(savedSettings);
          }
        }
      }

      const savedList = localStorage.getItem('myList');
      if (savedList) setMyList(JSON.parse(savedList));
      try {
        const raw = localStorage.getItem(WATCH_STATUS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        setWatchStatusMap(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        setWatchStatusMap({});
      }
      const welcomeSeen = localStorage.getItem(WELCOME_OVERLAY_SEEN_KEY) === '1';
      setShowWelcome(!welcomeSeen);
      setLoading(false);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    localStorage.setItem('myList', JSON.stringify(myList));
  }, [myList]);

  useEffect(() => {
    localStorage.setItem(WATCH_STATUS_STORAGE_KEY, JSON.stringify(watchStatusMap));
  }, [watchStatusMap]);

  useEffect(() => {
    if (!showMpvDebugPanel || !window.electronAPI?.getMpvStatus) return undefined;

    let active = true;
    const runAvailabilityCheck = async () => {
      if (!window.electronAPI?.checkMpvAvailability) return;
      try {
        const availabilityResult = await window.electronAPI.checkMpvAvailability();
        if (!active) return;
        setMpvDebugAvailable(Boolean(availabilityResult?.available));
        setMpvDebugPath(String(availabilityResult?.path || ''));
        setMpvDebugProbePath(String(availabilityResult?.probePath || ''));
        setMpvDebugVersion(String(availabilityResult?.version || ''));
        if (availabilityResult?.error) {
          setMpvDebugError(String(availabilityResult.error));
        }
      } catch (error) {
        if (!active) return;
        setMpvDebugError(String(error?.message || 'MPV availability check failed.'));
      }
    };

    const refreshMpvStatus = async () => {
      try {
        const statusResult = await window.electronAPI.getMpvStatus();
        if (!active) return;
        setMpvDebugStatus(String(statusResult?.status || 'unknown'));
        setMpvDebugError(String(statusResult?.error || statusResult?.details?.lastError || ''));
        setMpvDebugProcessOutput(String(statusResult?.details?.lastProcessOutput || ''));
      } catch (error) {
        if (!active) return;
        setMpvDebugStatus('error');
        setMpvDebugError(String(error?.message || 'MPV status check failed.'));
      }
    };

    runAvailabilityCheck();
    refreshMpvStatus();
    const timer = window.setInterval(refreshMpvStatus, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [showMpvDebugPanel]);

  useEffect(() => {
    if (!showMpvDebugPanel || !mpvNativeSlotRef.current) return undefined;

    const emitBounds = () => {
      const slot = mpvNativeSlotRef.current;
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      const bounds = {
        x: Math.max(0, Math.round(rect.left)),
        y: Math.max(0, Math.round(rect.top)),
        width: Math.max(100, Math.round(rect.width)),
        height: Math.max(100, Math.round(rect.height)),
      };
      setMpvSlotBounds(bounds);
      window.electronAPI?.updateNativeHostBounds?.(bounds).catch(() => {});
    };

    const scheduleEmit = () => {
      if (mpvBoundsThrottleRef.current) return;
      mpvBoundsThrottleRef.current = window.setTimeout(() => {
        mpvBoundsThrottleRef.current = null;
        emitBounds();
      }, 100);
    };

    emitBounds();
    const observer = new ResizeObserver(() => scheduleEmit());
    observer.observe(mpvNativeSlotRef.current);
    window.addEventListener('resize', scheduleEmit);
    window.addEventListener('scroll', scheduleEmit, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleEmit);
      window.removeEventListener('scroll', scheduleEmit, true);
      if (mpvBoundsThrottleRef.current) {
        window.clearTimeout(mpvBoundsThrottleRef.current);
        mpvBoundsThrottleRef.current = null;
      }
    };
  }, [showMpvDebugPanel]);

  useEffect(() => {
    const onToast = (event) => {
      if (settings.notificationsEnabled === false) return;
      const detail = event?.detail || {};
      const message = String(detail.message || '').trim();
      if (!message) return;
      const id = ++appToastId;
      const tone = ['success', 'error', 'info', 'warn'].includes(detail.tone) ? detail.tone : 'info';
      const durationMs = Math.max(1800, Math.min(8000, Number(detail.durationMs) || 3600));
      setToasts((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, durationMs);
    };
    window.addEventListener(APP_TOAST_EVENT, onToast);
    return () => window.removeEventListener(APP_TOAST_EVENT, onToast);
  }, [settings.notificationsEnabled]);

  const toggleMyList = (item) => {
    setMyList((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) return prev.filter((i) => i.id !== item.id);
      return [...prev, item];
    });
  };

  const setWatchStatus = (item, status, fallbackType = '') => {
    const key = buildWatchStatusKey(item, fallbackType);
    if (!key) return;
    if (status) {
      setMyList((prev) => {
        const exists = prev.some((listItem) => listItem.id === item.id);
        return exists ? prev : [...prev, item];
      });
    }
    setWatchStatusMap((prev) => {
      const next = { ...prev };
      if (!status) {
        delete next[key];
      } else {
        next[key] = status;
      }
      return next;
    });
  };

  const dismissWelcome = () => {
    localStorage.setItem(WELCOME_OVERLAY_SEEN_KEY, '1');
    setShowWelcome(false);
  };

  const handleMpvStart = async () => {
    if (!window.electronAPI?.startMpvPlayback || !mpvDebugSource.trim()) return;
    setMpvDebugBusy(true);
    try {
      const source = mpvDebugSource.trim();
      const startResult = await window.electronAPI.startMpvPlayback({
        sourceType: mpvDebugSourceType,
        source,
        url: mpvDebugSourceType === 'embedded-stream-url' ? source : '',
        filePath: mpvDebugSourceType === 'embedded-file' ? source : '',
        title: 'CineSoft MPV',
        mode: mpvDebugMode,
        embedded: mpvDebugMode === 'external' && mpvDebugEmbedded,
        renderMode: mpvDebugMode === 'external' && mpvDebugEmbedded ? mpvDebugRenderMode : 'default',
        bounds: mpvDebugMode === 'native-host'
          ? mpvSlotBounds
          : (mpvDebugMode === 'external' && mpvDebugEmbedded ? { x: 260, y: 120, width: 900, height: 500 } : undefined),
      });
      setMpvDebugStatus(String(startResult?.status || 'unknown'));
      setMpvDebugError(String(startResult?.error || ''));
    } catch (error) {
      setMpvDebugStatus('error');
      setMpvDebugError(String(error?.message || 'Failed to start MPV.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const refreshStreamServerStatus = async () => {
    if (!window.electronAPI?.getLocalStreamServerStatus) return;
    try {
      const result = await window.electronAPI.getLocalStreamServerStatus();
      if (!result?.ok) return;
      setStreamServerRunning(Boolean(result.running));
      setStreamServerPort(result.port ?? null);
      setStreamServerBaseUrl(String(result.baseUrl || ''));
      setStreamActiveSessionCount(Number(result.activeSessionCount || 0));
      setStreamSessions(Array.isArray(result.sessions) ? result.sessions : []);
    } catch {
      // ignore debug refresh errors
    }
  };

  const handleMpvCheck = async () => {
    if (!window.electronAPI?.checkMpvAvailability) return;
    setMpvDebugBusy(true);
    try {
      const result = await window.electronAPI.checkMpvAvailability();
      setMpvDebugAvailable(Boolean(result?.available));
      setMpvDebugPath(String(result?.path || ''));
      setMpvDebugProbePath(String(result?.probePath || ''));
      setMpvDebugVersion(String(result?.version || ''));
      setMpvDebugError(String(result?.error || ''));
    } catch (error) {
      setMpvDebugError(String(error?.message || 'Failed to check MPV.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const handleMpvStop = async () => {
    if (!window.electronAPI?.stopMpvPlayback) return;
    setMpvDebugBusy(true);
    try {
      const stopResult = await window.electronAPI.stopMpvPlayback();
      setMpvDebugStatus(String(stopResult?.status || 'unknown'));
      setMpvDebugError(String(stopResult?.error || ''));
    } catch (error) {
      setMpvDebugStatus('error');
      setMpvDebugError(String(error?.message || 'Failed to stop MPV.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const handlePlayViaLocalStream = async () => {
    if (!window.electronAPI?.createLocalFileStreamSession || !window.electronAPI?.startMpvPlayback) return;
    if (mpvDebugSourceType !== 'embedded-file' || !mpvDebugSource.trim()) return;
    setMpvDebugBusy(true);
    try {
      const filePath = mpvDebugSource.trim();
      const sessionResult = await window.electronAPI.createLocalFileStreamSession({
        filePath,
        title: 'CineSoft MPV Local Stream',
      });
      if (!sessionResult?.ok || !sessionResult?.streamUrl) {
        throw new Error(sessionResult?.error || 'Failed to create local stream session.');
      }
      setMpvDebugStreamUrl(String(sessionResult.streamUrl));
      setMpvDebugStreamSessionId(String(sessionResult.streamId || ''));
      await refreshStreamServerStatus();

      const startResult = await window.electronAPI.startMpvPlayback({
        sourceType: 'embedded-stream-url',
        source: String(sessionResult.streamUrl),
        url: String(sessionResult.streamUrl),
        title: 'CineSoft MPV Local Stream',
        mode: mpvDebugMode,
        embedded: mpvDebugMode === 'external' && mpvDebugEmbedded,
        renderMode: mpvDebugMode === 'external' && mpvDebugEmbedded ? mpvDebugRenderMode : 'default',
        bounds: mpvDebugMode === 'native-host'
          ? mpvSlotBounds
          : (mpvDebugMode === 'external' && mpvDebugEmbedded ? { x: 260, y: 120, width: 900, height: 500 } : undefined),
      });
      setMpvDebugStatus(String(startResult?.status || 'unknown'));
      setMpvDebugError(String(startResult?.error || ''));
    } catch (error) {
      setMpvDebugStatus('error');
      setMpvDebugError(String(error?.message || 'Failed to play via local stream.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const handleCloseStreamSession = async () => {
    if (!window.electronAPI?.closeStreamSession || !mpvDebugStreamSessionId) return;
    setMpvDebugBusy(true);
    try {
      const result = await window.electronAPI.closeStreamSession(mpvDebugStreamSessionId);
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to close stream session.');
      }
      setMpvDebugStreamSessionId('');
      setMpvDebugStreamUrl('');
      await refreshStreamServerStatus();
    } catch (error) {
      setMpvDebugError(String(error?.message || 'Failed to close stream session.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const refreshEmbeddedTorrentStatus = async () => {
    if (!window.electronAPI?.getEmbeddedTorrentStreamStatus) return;
    try {
      const result = await window.electronAPI.getEmbeddedTorrentStreamStatus();
      if (!result?.ok) return;
      setEmbeddedTorrentStreamStatus({
        status: String(result?.status || 'idle'),
        streamId: result?.streamId || null,
        torrentId: result?.torrentId || null,
        fileIndex: result?.fileIndex ?? null,
        selectedFileName: result?.selectedFileName || null,
        expectedSize: result?.expectedSize ?? null,
        prebufferStart: result?.prebufferStart ?? null,
        prebufferEnd: result?.prebufferEnd ?? null,
        prebufferReady: Boolean(result?.prebufferReady),
        missingPiecesCount: result?.missingPiecesCount ?? null,
        elapsedMs: result?.elapsedMs ?? 0,
        activeStreamCount: Number(result?.activeStreamCount || 0),
        activeStreams: Array.isArray(result?.activeStreams) ? result.activeStreams : [],
        torrentPaused: result?.torrentPaused ?? null,
        torrentState: result?.torrentState ?? null,
        torrentDownloadRate: result?.torrentDownloadRate ?? null,
        torrentUploadRate: result?.torrentUploadRate ?? null,
        pauseVerified: result?.pauseVerified ?? null,
        stopReason: result?.stopReason || '',
        lastError: result?.lastError || '',
      });
    } catch {
      // ignore debug refresh errors
    }
  };

  const handleStartEmbeddedTorrentStream = async () => {
    if (!window.electronAPI?.startEmbeddedTorrentStream) return;
    if (!embeddedTorrentSource.trim()) return;
    setMpvDebugBusy(true);
    try {
      const result = await window.electronAPI.startEmbeddedTorrentStream({
        source: embeddedTorrentSource.trim(),
        sourceKind: embeddedTorrentSourceKind,
        title: 'CineSoft Embedded Torrent Stream',
        bounds: mpvSlotBounds,
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Embedded torrent stream start failed.');
      }
      setMpvDebugStreamSessionId(String(result.streamId || ''));
      setMpvDebugStreamUrl(String(result.streamUrl || ''));
      await refreshStreamServerStatus();
      await refreshEmbeddedTorrentStatus();
    } catch (error) {
      setMpvDebugError(String(error?.message || 'Failed to start embedded torrent stream.'));
      await refreshEmbeddedTorrentStatus();
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const handleStopEmbeddedTorrentStream = async (mode) => {
    if (!window.electronAPI?.stopEmbeddedTorrentStream) return;
    setMpvDebugBusy(true);
    try {
      const payload = {
        streamId: resolvedEmbeddedStreamId || undefined,
        mode,
        removeFiles: false,
      };
      const result = await window.electronAPI.stopEmbeddedTorrentStream(payload);
      if (!result?.ok && !result?.stopped) {
        throw new Error(result?.error || 'Failed to stop embedded torrent stream.');
      }
      setEmbeddedStopResult(result);
      setMpvDebugStreamSessionId('');
      setMpvDebugStreamUrl('');
      await refreshEmbeddedTorrentStatus();
      await refreshStreamServerStatus();
      await window.electronAPI?.torrentGetAll?.();
      const statusResult = await window.electronAPI?.getMpvStatus?.();
      setMpvDebugStatus(String(statusResult?.status || 'stopped'));
      setMpvDebugError(String(result?.warning || result?.error || ''));
    } catch (error) {
      setMpvDebugError(String(error?.message || 'Failed to stop embedded torrent stream.'));
      await refreshEmbeddedTorrentStatus();
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const resolvedEmbeddedStreamId = (() => {
    if (mpvDebugStreamSessionId) return mpvDebugStreamSessionId;
    if (embeddedTorrentStreamStatus?.streamId) return String(embeddedTorrentStreamStatus.streamId);
    if (Array.isArray(embeddedTorrentStreamStatus?.activeStreams) && embeddedTorrentStreamStatus.activeStreams.length > 0) {
      return String(embeddedTorrentStreamStatus.activeStreams[0]?.streamId || '');
    }
    return '';
  })();
  const showEmbeddedStopControls = Boolean(
    embeddedTorrentStreamStatus?.activeStreamCount > 0
    || embeddedTorrentStreamStatus?.status === 'playing'
    || embeddedTorrentStreamStatus?.streamId
  );

  useEffect(() => {
    if (!showMpvDebugPanel) return;
    refreshStreamServerStatus();
    refreshEmbeddedTorrentStatus();
  }, [showMpvDebugPanel]);

  if (loading) return <div className="loading">Loading...</div>;
  const defaultRoute = DEFAULT_PAGE_ROUTE_MAP[settings.defaultPage] || '/';

  return (
    <Router>
      <div className="app-container">
        <Sidebar settings={settings} />
        <main className="main-content">
          {showMpvDebugPanel && (
            <section className="mpv-native-slot-wrap">
              <div ref={mpvNativeSlotRef} className="mpv-native-slot">
                <span>Native MPV Player Slot</span>
              </div>
            </section>
          )}
          <Routes>
            <Route
              path="/"
              element={defaultRoute === '/'
                ? <HomeView settings={settings} myList={myList} onToggleMyList={toggleMyList} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />
                : <Navigate to={defaultRoute} replace />}
            />
            <Route path="/movies" element={<MoviesView settings={settings} myList={myList} onToggleMyList={toggleMyList} movieState={movieState} setMovieState={setMovieState} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />} />
            <Route path="/tv" element={<TVShowsView settings={settings} myList={myList} onToggleMyList={toggleMyList} tvState={tvState} setTvState={setTvState} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />} />
            <Route path="/anime" element={<AnimeView settings={settings} myList={myList} onToggleMyList={toggleMyList} animeState={animeState} setAnimeState={setAnimeState} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />} />
            <Route path="/downloads" element={<DownloadsView settings={settings} />} />
            <Route path="/radarr" element={<RadarrView settings={settings} />} />
            <Route path="/sonarr" element={<SonarrView settings={settings} />} />
            <Route path="/library" element={<LibraryView settings={settings} />} />
            <Route path="/mylist" element={<MyListView settings={settings} myList={myList} onToggleMyList={toggleMyList} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />} />
            <Route path="/search" element={<SearchView settings={settings} myList={myList} onToggleMyList={toggleMyList} searchState={searchState} setSearchState={setSearchState} watchStatusMap={watchStatusMap} onSetWatchStatus={setWatchStatus} />} />
            <Route path="/detail/:type/:id" element={<DetailView settings={settings} myList={myList} onToggleMyList={toggleMyList} setSearchState={setSearchState} />} />
            <Route path="/settings" element={<SettingsView settings={settings} setSettings={setSettings} />} />
          </Routes>
        </main>
        {showWelcome && <WelcomeOverlay language={settings.language} onClose={dismissWelcome} />}
        {showMpvDebugPanel && (
          <aside className="mpv-debug-panel" role="status" aria-live="polite">
            <strong>MPV Debug</strong>
            <span>status: {mpvDebugStatus}</span>
            <span>available: {String(mpvDebugAvailable)}</span>
            {mpvDebugPath ? <span>path: {mpvDebugPath}</span> : null}
            {mpvDebugProbePath ? <span>probePath: {mpvDebugProbePath}</span> : null}
            {mpvDebugVersion ? <span>version: {mpvDebugVersion}</span> : null}
            {mpvDebugError ? <span>error: {mpvDebugError}</span> : null}
            {mpvDebugProcessOutput ? <span>mpv: {mpvDebugProcessOutput}</span> : null}
            {mpvDebugStreamUrl ? <span>streamUrl: {mpvDebugStreamUrl}</span> : null}
            <span>streamServerRunning: {String(streamServerRunning)}</span>
            <span>streamServerPort: {streamServerPort ?? '-'}</span>
            <span>streamServerBaseUrl: {streamServerBaseUrl || '-'}</span>
            <span>activeSessionCount: {String(streamActiveSessionCount)}</span>
            {streamSessions.slice(0, 3).map((session) => (
              <span key={session.streamId}>
                session[{session.streamId}]: type={session.sourceType || '-'} expectedSize={session.expectedSize ?? '-'} lastServed={session.lastServedStart ?? '-'}-{session.lastServedEnd ?? '-'} lastPrefetchAt={session.lastPrefetchAt ?? '-'}
              </span>
            ))}
            {embeddedTorrentStreamStatus ? (
              <>
                <span>embeddedStatus: {embeddedTorrentStreamStatus.status}</span>
                <span>embeddedActive: {embeddedTorrentStreamStatus.activeStreamCount}</span>
                {embeddedTorrentStreamStatus.torrentId ? <span>embeddedTorrentId: {embeddedTorrentStreamStatus.torrentId}</span> : null}
                {embeddedTorrentStreamStatus.fileIndex != null ? <span>embeddedFileIndex: {embeddedTorrentStreamStatus.fileIndex}</span> : null}
                {embeddedTorrentStreamStatus.selectedFileName ? <span>embeddedFile: {embeddedTorrentStreamStatus.selectedFileName}</span> : null}
                {embeddedTorrentStreamStatus.expectedSize != null ? <span>embeddedExpectedSize: {embeddedTorrentStreamStatus.expectedSize}</span> : null}
                {embeddedTorrentStreamStatus.prebufferStart != null ? <span>prebufferStart: {embeddedTorrentStreamStatus.prebufferStart}</span> : null}
                {embeddedTorrentStreamStatus.prebufferEnd != null ? <span>prebufferEnd: {embeddedTorrentStreamStatus.prebufferEnd}</span> : null}
                <span>prebufferReady: {String(embeddedTorrentStreamStatus.prebufferReady)}</span>
                {embeddedTorrentStreamStatus.missingPiecesCount != null ? <span>missingPieces: {embeddedTorrentStreamStatus.missingPiecesCount}</span> : null}
                {embeddedTorrentStreamStatus.pauseVerified != null ? <span>pauseVerified: {String(embeddedTorrentStreamStatus.pauseVerified)}</span> : null}
                {embeddedTorrentStreamStatus.torrentPaused != null ? <span>torrentPaused: {String(embeddedTorrentStreamStatus.torrentPaused)}</span> : null}
                {embeddedTorrentStreamStatus.torrentState != null ? <span>torrentState: {embeddedTorrentStreamStatus.torrentState}</span> : null}
                {embeddedTorrentStreamStatus.torrentDownloadRate != null ? <span>downloadRate: {embeddedTorrentStreamStatus.torrentDownloadRate}</span> : null}
                {embeddedTorrentStreamStatus.torrentUploadRate != null ? <span>uploadRate: {embeddedTorrentStreamStatus.torrentUploadRate}</span> : null}
                <span>embeddedElapsedMs: {embeddedTorrentStreamStatus.elapsedMs}</span>
                {embeddedTorrentStreamStatus.stopReason ? <span>embeddedStopReason: {embeddedTorrentStreamStatus.stopReason}</span> : null}
                {embeddedTorrentStreamStatus.lastError ? <span>embeddedError: {embeddedTorrentStreamStatus.lastError}</span> : null}
              </>
            ) : null}
            {embeddedStopResult ? (
              <>
                <span>stop.torrentAction: {String(embeddedStopResult.torrentAction || '-')}</span>
                {embeddedStopResult.pauseVerified != null ? <span>stop.pauseVerified: {String(embeddedStopResult.pauseVerified)}</span> : null}
                {embeddedStopResult.torrentPaused != null ? <span>stop.torrentPaused: {String(embeddedStopResult.torrentPaused)}</span> : null}
                {embeddedStopResult.torrentState != null ? <span>stop.torrentState: {embeddedStopResult.torrentState}</span> : null}
                {embeddedStopResult.downloadRate != null ? <span>stop.downloadRate: {embeddedStopResult.downloadRate}</span> : null}
                {embeddedStopResult.removeFiles != null ? <span>stop.removeFiles: {String(embeddedStopResult.removeFiles)}</span> : null}
                {embeddedStopResult.filesRemoved != null ? <span>stop.filesRemoved: {String(embeddedStopResult.filesRemoved)}</span> : null}
              </>
            ) : null}
            <input
              className="mpv-debug-input"
              type="text"
              value={embeddedTorrentSource}
              onChange={(event) => setEmbeddedTorrentSource(event.target.value)}
              placeholder="Magnet / torrent URL / infohash"
            />
            <label className="mpv-debug-check">
              <span>Torrent sourceKind</span>
              <select value={embeddedTorrentSourceKind} onChange={(event) => setEmbeddedTorrentSourceKind(event.target.value)}>
                <option value="magnet">magnet</option>
                <option value="torrent-url">torrent-url</option>
                <option value="infohash">infohash</option>
              </select>
            </label>
            <input
              className="mpv-debug-input"
              type="text"
              value={mpvDebugSource}
              onChange={(event) => setMpvDebugSource(event.target.value)}
              placeholder="Video path or URL"
            />
            <label className="mpv-debug-check">
              <span>Mode</span>
              <select value={mpvDebugMode} onChange={(event) => setMpvDebugMode(event.target.value)}>
                <option value="external">external</option>
                <option value="native-host">native-host</option>
              </select>
            </label>
            <label className="mpv-debug-check">
              <span>Source type</span>
              <select value={mpvDebugSourceType} onChange={(event) => setMpvDebugSourceType(event.target.value)}>
                <option value="embedded-file">embedded-file</option>
                <option value="embedded-stream-url">embedded-stream-url</option>
              </select>
            </label>
            <label className="mpv-debug-check">
              <input
                type="checkbox"
                checked={mpvDebugEmbedded}
                disabled={mpvDebugMode === 'native-host'}
                onChange={(event) => setMpvDebugEmbedded(event.target.checked)}
              />
              Embedded
            </label>
            {mpvDebugMode === 'external' && mpvDebugEmbedded ? (
              <>
                <label className="mpv-debug-check">
                  <span>Embedded render mode</span>
                  <select value={mpvDebugRenderMode} onChange={(event) => setMpvDebugRenderMode(event.target.value)}>
                    <option value="default">default</option>
                    <option value="d3d11">d3d11</option>
                    <option value="angle">angle</option>
                  </select>
                </label>
                <small className="mpv-debug-note">Embedded test bounds uses x:260 y:120 w:900 h:500. If hidden, move terminal/window aside.</small>
              </>
            ) : null}
            {mpvDebugMode === 'native-host' ? (
              <small className="mpv-debug-note">Native host borderless test mode (embedded libtorrent source model)</small>
            ) : null}
            <div className="mpv-debug-actions">
              <button type="button" onClick={handleMpvCheck} disabled={mpvDebugBusy}>
                Check MPV
              </button>
              <button type="button" onClick={refreshStreamServerStatus} disabled={mpvDebugBusy}>
                Refresh Stream Status
              </button>
              <button type="button" onClick={refreshEmbeddedTorrentStatus} disabled={mpvDebugBusy}>
                Refresh Embedded Status
              </button>
              <button type="button" onClick={handleMpvStart} disabled={mpvDebugBusy || !mpvDebugSource.trim()}>
                Start MPV
              </button>
              <button type="button" onClick={handleStartEmbeddedTorrentStream} disabled={mpvDebugBusy || !embeddedTorrentSource.trim()}>
                Start Embedded Torrent Stream
              </button>
              <button
                type="button"
                onClick={handlePlayViaLocalStream}
                disabled={mpvDebugBusy || mpvDebugSourceType !== 'embedded-file' || !mpvDebugSource.trim()}
              >
                Play via Local Stream
              </button>
              <button type="button" onClick={handleMpvStop} disabled={mpvDebugBusy}>
                Stop MPV
              </button>
              <button type="button" onClick={handleCloseStreamSession} disabled={mpvDebugBusy || !mpvDebugStreamSessionId}>
                Close Stream Session
              </button>
            </div>
            {showEmbeddedStopControls ? (
              <>
                <strong>Embedded Stream Controls</strong>
                <span>streamId: {resolvedEmbeddedStreamId || '-'}</span>
                <div className="mpv-debug-actions mpv-debug-actions-embedded">
                  <button
                    type="button"
                    onClick={() => handleStopEmbeddedTorrentStream('playback-only')}
                    disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}
                  >
                    Stop Playback Only
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStopEmbeddedTorrentStream('pause-torrent')}
                    disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}
                  >
                    Stop + Pause Torrent
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStopEmbeddedTorrentStream('remove-torrent')}
                    disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}
                  >
                    Stop + Remove Torrent
                  </button>
                </div>
                <small className="mpv-debug-note">
                  {settings.language === 'tr'
                    ? 'Torrent listeden silinir, dosyalar kalir.'
                    : 'Removes torrent from list, keeps downloaded files.'}
                </small>
              </>
            ) : null}
          </aside>
        )}
        <div className="app-toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`app-toast app-toast-${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </div>
    </Router>
  );
};

const WelcomeOverlay = ({ language = 'tr', onClose }) => {
  const isTr = language === 'tr';

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true">
      <div className="welcome-card">
        <h2>{isTr ? 'CineSofta Hos Geldin' : 'Welcome to CineSoft'}</h2>
        <p>{isTr ? 'Kisa bir baslangic rehberi:' : 'Quick start guide:'}</p>
        <ul className="welcome-list">
          <li>{isTr ? 'Filmler, Diziler ve Anime sayfalarindan hizli kesif yap.' : 'Discover content from Movies, TV Shows, and Anime pages.'}</li>
          <li>{isTr ? 'Poster sag ustundeki arti ile durum sec: Izlemek Istiyorum / Izledim / Biraktim.' : 'Use the top-right plus on posters to set status: Want to Watch / Watched / Dropped.'}</li>
          <li>{isTr ? 'Detay sayfasinda Kaynak Ara ile Torrentio veya Prowlarr kaynaklarini listele.' : 'Use Find Sources on detail pages to list Torrentio or Prowlarr sources.'}</li>
          <li>{isTr ? 'Ayarlar ekranindan indirme motoru ve kaynak seceneklerini yonet.' : 'Manage download engine and source options from Settings.'}</li>
        </ul>
        <button className="welcome-btn" onClick={onClose}>
          {isTr ? 'Baslayalim' : "Let's Start"}
        </button>
      </div>
    </div>
  );
};

const Sidebar = ({ settings }) => {
  const location = useLocation();
  const [automationOpen, setAutomationOpen] = useState(true);

  const t = {
    tr: {
      discover: 'KESFET',
      librarySection: 'KUTUPHANE',
      toolsSection: 'ARACLAR',
      systemSection: 'SISTEM',
      home: 'Ana Sayfa',
      search: 'Arama Yap',
      movies: 'Filmler',
      tv: 'Diziler',
      anime: 'Anime',
      library: 'Kutuphanem',
      myList: 'Listem',
      downloads: 'Indirilenler',
      automation: 'Otomasyon',
      radarr: 'Radarr',
      sonarr: 'Sonarr',
      settings: 'Ayarlar',
    },
    en: {
      discover: 'DISCOVER',
      librarySection: 'LIBRARY',
      toolsSection: 'TOOLS',
      systemSection: 'SYSTEM',
      home: 'Home',
      search: 'Search',
      movies: 'Movies',
      tv: 'TV Shows',
      anime: 'Anime',
      library: 'Library',
      myList: 'My List',
      downloads: 'Downloads',
      automation: 'Automation',
      radarr: 'Radarr',
      sonarr: 'Sonarr',
      settings: 'Settings',
    },
  }[settings.language];
  const automationActive = location.pathname.startsWith('/radarr') || location.pathname.startsWith('/sonarr');
  const discoverItems = [
    { id: 'home', to: '/', end: true, label: t.home, icon: Home },
    { id: 'search', to: '/search', label: t.search, icon: Search },
    { id: 'movies', to: '/movies', label: t.movies, icon: Film },
    { id: 'tv', to: '/tv', label: t.tv, icon: Tv },
    { id: 'anime', to: '/anime', label: t.anime, icon: Sparkles },
  ];
  const libraryItems = [
    { id: 'library', to: '/library', label: t.library, icon: Library },
    { id: 'mylist', to: '/mylist', label: t.myList, icon: Bookmark },
    { id: 'downloads', to: '/downloads', label: t.downloads, icon: Download },
  ];
  const automationItems = [
    { id: 'radarr', to: '/radarr', label: t.radarr, icon: Film },
    { id: 'sonarr', to: '/sonarr', label: t.sonarr, icon: Tv },
  ];
  const systemItems = [
    { id: 'settings', to: '/settings', label: t.settings, icon: SettingsIcon },
  ];

  return (
    <nav className="sidebar">
      <div className="logo">
        <span className="logo-text">CINE<span>SOFT</span></span>
      </div>
      <div className="sidebar-scroll">
        <section className="sidebar-group">
          <h4 className="sidebar-group-title">{t.discover}</h4>
          <div className="nav-links">
            {discoverItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.id} to={item.to} end={item.end === true} className="nav-item">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </section>

        <section className="sidebar-group">
          <h4 className="sidebar-group-title">{t.librarySection}</h4>
          <div className="nav-links">
            {libraryItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.id} to={item.to} className="nav-item">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </section>

        <section className="sidebar-group">
          <h4 className="sidebar-group-title">{t.toolsSection}</h4>
          <div className="automation-wrap">
            <button
              type="button"
              className={`automation-toggle ${automationActive ? 'active' : ''}`}
              onClick={() => setAutomationOpen((prev) => !prev)}
              aria-expanded={automationOpen}
            >
              <span className="automation-label">
                <Cog size={16} />
                {t.automation}
              </span>
              {automationOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {automationOpen && (
              <div className="automation-submenu">
                {automationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.id} to={item.to} className="automation-item">
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        </section>

      </div>

      <div className="nav-footer">
        <section className="sidebar-group sidebar-group-system">
          <h4 className="sidebar-group-title">{t.systemSection}</h4>
          <div className="nav-links">
            {systemItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.id} to={item.to} className="nav-item">
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </section>
      </div>

    </nav>
  );
};

export default App;
