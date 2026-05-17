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
const NATIVE_STREAM_EVENT = 'cinesoft:native-stream-start';
const NATIVE_LOCAL_PLAY_EVENT = 'cinesoft:native-local-play';
const PLAYER_TOPBAR_HEIGHT = 52;
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
  const [embeddedUiStatus, setEmbeddedUiStatus] = useState('idle');
  const [embeddedUiError, setEmbeddedUiError] = useState('');
  const [isPlayerMode, setIsPlayerMode] = useState(false);
  const [activePlaybackKind, setActivePlaybackKind] = useState('');
  const [activePlayerTitle, setActivePlayerTitle] = useState('');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [activeStreamId, setActiveStreamId] = useState('');
  const [playerError, setPlayerError] = useState('');
  const [isStoppingPlayer, setIsStoppingPlayer] = useState(false);
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const nativeStreamEnabled = (window.electronAPI?.isDev === true)
    || String(import.meta.env.VITE_ENABLE_NATIVE_STREAM || '').toLowerCase() === 'true';
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

  const logPlayerModeBounds = (phase, bounds, extra = {}) => {
    console.info('[PlayerMode:Bounds]', {
      phase,
      bounds,
      windowInnerWidth: window.innerWidth,
      windowInnerHeight: window.innerHeight,
      refExists: Boolean(mpvNativeSlotRef.current),
      topbarHeight: PLAYER_TOPBAR_HEIGHT,
      ...extra,
    });
  };

  const waitForPlayerSlotBounds = async () => {
    const fallback = isPlayerMode
      ? {
          x: 0,
          y: PLAYER_TOPBAR_HEIGHT,
          width: Math.max(100, Math.round(window.innerWidth || 0)),
          height: Math.max(100, Math.round((window.innerHeight || 0) - PLAYER_TOPBAR_HEIGHT)),
        }
      : {
          x: 0,
          y: 0,
          width: Math.max(100, Math.round(window.innerWidth || 0)),
          height: Math.max(100, Math.round(window.innerHeight || 0)),
        };
    let lastRect = null;
    let fallbackUsed = true;
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      const slot = mpvNativeSlotRef.current;
      if (!slot) continue;
      const rect = slot.getBoundingClientRect();
      lastRect = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width >= 300 && height >= 300) {
        fallbackUsed = false;
        const resolved = {
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width,
          height,
        };
        logPlayerModeBounds('wait-slot', resolved, { slotRect: lastRect, fallbackUsed });
        return resolved;
      }
    }
    logPlayerModeBounds('wait-fallback', fallback, { slotRect: lastRect, fallbackUsed });
    return fallback;
  };

  useEffect(() => {
    if (!nativeStreamEnabled || !mpvNativeSlotRef.current) return undefined;

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
      logPlayerModeBounds('resize', bounds, {
        slotRect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        fallbackUsed: false,
      });
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
  }, [nativeStreamEnabled, isPlayerMode]);

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
        runId: result?.runId || null,
        cancelled: Boolean(result?.cancelled),
        stopRequested: Boolean(result?.stopRequested),
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
        minimumPrebufferStart: result?.minimumPrebufferStart ?? null,
        minimumPrebufferEnd: result?.minimumPrebufferEnd ?? null,
        minimumPrebufferReady: result?.minimumPrebufferReady ?? null,
        minimumMissingPiecesCount: result?.minimumMissingPiecesCount ?? null,
        targetPrebufferStart: result?.targetPrebufferStart ?? null,
        targetPrebufferEnd: result?.targetPrebufferEnd ?? null,
        targetPrebufferReady: result?.targetPrebufferReady ?? null,
        targetMissingPiecesCount: result?.targetMissingPiecesCount ?? null,
        prebufferDownloadRate: result?.prebufferDownloadRate ?? null,
        prebufferPeerCount: result?.prebufferPeerCount ?? null,
        waitingForFirstPiece: Boolean(result?.waitingForFirstPiece),
        firstPiece: result?.firstPiece ?? null,
        pieceLength: result?.pieceLength ?? null,
        firstPieceAvailability: result?.firstPieceAvailability ?? null,
        totalWantedDone: result?.totalWantedDone ?? null,
        lastProgressAt: result?.lastProgressAt ?? null,
        noProgressElapsedMs: result?.noProgressElapsedMs ?? null,
        lastPauseAttemptAt: result?.lastPauseAttemptAt ?? null,
        pauseRetryCount: result?.pauseRetryCount ?? null,
        lastEnsureResult: result?.lastEnsureResult ?? null,
        lastMinimumRangeStatus: result?.lastMinimumRangeStatus ?? null,
        lastMinimumEnsureResult: result?.lastMinimumEnsureResult ?? null,
        lastTargetEnsureResult: result?.lastTargetEnsureResult ?? null,
        lastTargetRangeStatus: result?.lastTargetRangeStatus ?? null,
        selectedFileIndex: result?.selectedFileIndex ?? null,
        selectedFileSize: result?.selectedFileSize ?? null,
        fileOffset: result?.fileOffset ?? null,
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

  const startEmbeddedTorrentStreamFromUi = async (payload = {}) => {
    if (!window.electronAPI?.startEmbeddedTorrentStream) return;
    if (isStoppingPlayer) return;
    const source = String(payload?.source || '').trim();
    const sourceKind = String(payload?.sourceKind || 'magnet');
    if (!source) return;
    const enterPlayerMode = payload?.enterPlayerMode !== false;
    if (enterPlayerMode) setIsPlayerMode(true);
    const title = String(payload?.title || 'CineSoft Embedded Torrent Stream');
    setActivePlayerTitle(title);
    setMpvDebugBusy(true);
    setEmbeddedUiError('');
    setPlayerError('');
    setEmbeddedUiStatus('preparing');
    setPlayerStatus('preparing');
    try {
      setActivePlaybackKind('embedded-stream');
      setEmbeddedUiStatus('selecting-file');
      setPlayerStatus('selecting-file');
      const resolvedBounds = enterPlayerMode
        ? await waitForPlayerSlotBounds()
        : (payload?.bounds || mpvSlotBounds);
      logPlayerModeBounds('before-start', resolvedBounds, { fallbackUsed: false });
      setMpvSlotBounds(resolvedBounds);
      const result = await window.electronAPI.startEmbeddedTorrentStream({
        source,
        sourceKind,
        title,
        bounds: resolvedBounds,
        isPlayerMode: enterPlayerMode,
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Embedded torrent stream start failed.');
      }
      setMpvDebugStreamSessionId(String(result.streamId || ''));
      setActiveStreamId(String(result.streamId || ''));
      setMpvDebugStreamUrl(String(result.streamUrl || ''));
      window.requestAnimationFrame(() => {
        window.electronAPI?.updateNativeHostBounds?.(resolvedBounds).catch(() => {});
        logPlayerModeBounds('after-start', resolvedBounds, { fallbackUsed: false });
        window.requestAnimationFrame(() => {
          const slot = mpvNativeSlotRef.current;
          const rect = slot?.getBoundingClientRect?.();
          const freshBounds = rect
            ? {
                x: Math.max(0, Math.round(rect.left)),
                y: Math.max(0, Math.round(rect.top)),
                width: Math.max(100, Math.round(rect.width)),
                height: Math.max(100, Math.round(rect.height)),
              }
            : resolvedBounds;
          window.electronAPI?.updateNativeHostBounds?.(freshBounds).catch(() => {});
          logPlayerModeBounds('after-start-raf2', freshBounds, { fallbackUsed: false });
        });
      });
      setEmbeddedUiStatus('prebuffering');
      setPlayerStatus('prebuffering');
      await refreshStreamServerStatus();
      await refreshEmbeddedTorrentStatus();
    } catch (error) {
      setMpvDebugError(String(error?.message || 'Failed to start embedded torrent stream.'));
      setEmbeddedUiError(String(error?.message || 'Stream hazırlanamadı, yeterli parça indirilemedi.'));
      setPlayerError(String(error?.message || 'Stream hazırlanamadı.'));
      setEmbeddedUiStatus('error');
      setPlayerStatus('error');
      await refreshEmbeddedTorrentStatus();
    } finally {
      setMpvDebugBusy(false);
    }
  };

  const handleStartEmbeddedTorrentStream = async () => {
    await startEmbeddedTorrentStreamFromUi({
      source: embeddedTorrentSource.trim(),
      sourceKind: embeddedTorrentSourceKind,
      title: 'CineSoft Embedded Torrent Stream',
      bounds: mpvSlotBounds,
      enterPlayerMode: false,
    });
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
      setActiveStreamId('');
      setEmbeddedUiStatus(mode === 'playback-only' ? 'idle' : 'stopped');
      if (mode === 'playback-only') {
        setEmbeddedUiError('');
      }
      setPlayerStatus(mode === 'playback-only' ? 'idle' : 'stopped');
      if (mode === 'playback-only' || mode === 'pause-torrent' || mode === 'remove-torrent') {
        setIsPlayerMode(false);
        setActivePlaybackKind('');
        setPlayerError('');
      }
      await refreshEmbeddedTorrentStatus();
      await refreshStreamServerStatus();
      await window.electronAPI?.torrentGetAll?.();
      window.dispatchEvent(new CustomEvent('cinesoft:torrents-refresh'));
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
  const showEmbeddedStatusPanel = Boolean(
    showEmbeddedStopControls
    || embeddedUiStatus === 'preparing'
    || embeddedUiStatus === 'selecting-file'
    || embeddedUiStatus === 'prebuffering'
    || embeddedUiStatus === 'error'
    || embeddedUiError
  );

  useEffect(() => {
    if (!nativeStreamEnabled) return;
    refreshStreamServerStatus();
    refreshEmbeddedTorrentStatus();
  }, [nativeStreamEnabled]);

  useEffect(() => {
    if (!nativeStreamEnabled) return undefined;
    const onStartNativeStream = async (event) => {
      const detail = event?.detail || {};
      await startEmbeddedTorrentStreamFromUi({
        source: detail.source || '',
        sourceKind: detail.sourceKind || 'magnet',
        title: detail.title || 'CineSoft Embedded Torrent Stream',
        enterPlayerMode: true,
      });
      if (typeof window !== 'undefined') {
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          window.scrollTo(0, 0);
        }
      }
    };
    window.addEventListener(NATIVE_STREAM_EVENT, onStartNativeStream);
    return () => window.removeEventListener(NATIVE_STREAM_EVENT, onStartNativeStream);
  }, [nativeStreamEnabled, mpvSlotBounds]);

  useEffect(() => {
    if (!nativeStreamEnabled) return undefined;
    const onStartNativeLocalPlay = async (event) => {
      const detail = event?.detail || {};
      await startLocalFilePlaybackFromUi({
        localFilePath: detail.localFilePath || '',
        title: detail.title || 'CineSoft Local File',
      });
    };
    window.addEventListener(NATIVE_LOCAL_PLAY_EVENT, onStartNativeLocalPlay);
    return () => window.removeEventListener(NATIVE_LOCAL_PLAY_EVENT, onStartNativeLocalPlay);
  }, [nativeStreamEnabled, mpvSlotBounds, isStoppingPlayer]);

  useEffect(() => {
    if (!embeddedTorrentStreamStatus) return;
    if (activePlaybackKind === 'local-file') return;
    const status = String(embeddedTorrentStreamStatus.status || '').toLowerCase();
    const hasActiveStream = Boolean(
      embeddedTorrentStreamStatus.streamId
      || (Number(embeddedTorrentStreamStatus.activeStreamCount || 0) > 0)
    );
    if (!hasActiveStream && status === 'playing') {
      setEmbeddedUiStatus('idle');
      setPlayerStatus('idle');
      return;
    }
    if (status === 'playing') {
      setEmbeddedUiStatus('playing');
      setPlayerStatus('playing');
      setEmbeddedUiError('');
      setPlayerError('');
    } else if (status === 'prebuffering') {
      setEmbeddedUiStatus('prebuffering');
      setPlayerStatus('prebuffering');
    } else if (status === 'stopped') {
      setEmbeddedUiStatus('stopped');
      setPlayerStatus('stopped');
    } else if (status === 'idle') {
      setEmbeddedUiStatus('idle');
      setPlayerStatus('idle');
      setEmbeddedUiError('');
      setPlayerError('');
    }
    if (embeddedTorrentStreamStatus.streamId) {
      setActiveStreamId(String(embeddedTorrentStreamStatus.streamId));
    }
    if (embeddedTorrentStreamStatus.lastError) {
      const message = String(embeddedTorrentStreamStatus.lastError);
      const lower = message.toLowerCase();
      setEmbeddedUiStatus('error');
      setPlayerStatus('error');
      setEmbeddedUiError(
        lower.includes('first piece unavailable')
          ? 'Stream hazirlanamadi, ilk parca su anda erisilemez.'
          : (lower.includes('minimum prebuffer timeout') || lower.includes('prebuffer stalled')
            ? 'Stream hazirlanamadi, baslangic parcasi indirilemedi.'
            : message),
      );
      setPlayerError(
        lower.includes('first piece unavailable')
          ? 'Stream hazirlanamadi, ilk parca su anda erisilemez.'
          : (lower.includes('minimum prebuffer timeout') || lower.includes('prebuffer stalled')
            ? 'Stream hazirlanamadi, baslangic parcasi indirilemedi.'
            : message),
      );
    } else if (status === 'prebuffering' && embeddedTorrentStreamStatus.waitingForFirstPiece) {
      const peers = Number(embeddedTorrentStreamStatus.prebufferPeerCount || 0);
      const rate = Number(embeddedTorrentStreamStatus.prebufferDownloadRate || 0);
      const mbps = rate > 0 ? `${(rate / (1024 * 1024)).toFixed(2)} MB/s` : '0 MB/s';
      setPlayerError(`Baslangic parcasi bekleniyor... Peers: ${peers} | Speed: ${mbps}`);
    }
  }, [embeddedTorrentStreamStatus, activePlaybackKind]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('player-mode-active', isPlayerMode);
    return () => document.body.classList.remove('player-mode-active');
  }, [isPlayerMode]);

  const handleClosePlayer = async () => {
    if (isStoppingPlayer) return;
    setIsStoppingPlayer(true);
    try {
      if (activePlaybackKind === 'local-file') {
        try {
          await window.electronAPI?.stopMpvPlayback?.();
        } catch {
          // best effort close
        }
      } else {
        const streamId = activeStreamId || resolvedEmbeddedStreamId || undefined;
        if (streamId && window.electronAPI?.stopEmbeddedTorrentStream) {
          try {
            await window.electronAPI.stopEmbeddedTorrentStream({
              streamId,
              mode: 'pause-torrent',
              removeFiles: false,
            });
          } catch {
            // best effort close
          }
        }
      }
      setIsPlayerMode(false);
      setActivePlaybackKind('');
      setActivePlayerTitle('');
      setPlayerStatus('idle');
      setPlayerError('');
      setActiveStreamId('');
      setEmbeddedUiStatus('idle');
      setEmbeddedUiError('');
      setMpvDebugStreamSessionId('');
      setMpvDebugStreamUrl('');
      await refreshEmbeddedTorrentStatus();
      await refreshStreamServerStatus();
      if (activePlaybackKind !== 'local-file') {
        await window.electronAPI?.torrentGetAll?.();
        window.dispatchEvent(new CustomEvent('cinesoft:torrents-refresh'));
      }
    } finally {
      setIsStoppingPlayer(false);
    }
  };

  const startLocalFilePlaybackFromUi = async (payload = {}) => {
    if (!window.electronAPI?.startMpvPlayback) return;
    if (isStoppingPlayer) return;
    const localFilePath = String(payload?.localFilePath || '').trim();
    if (!localFilePath) return;
    const title = String(payload?.title || 'CineSoft Local File');
    setIsPlayerMode(true);
    setActivePlaybackKind('local-file');
    setActivePlayerTitle(title);
    setMpvDebugBusy(true);
    setPlayerError('');
    setEmbeddedUiError('');
    setPlayerStatus('preparing');
    try {
      const resolvedBounds = await waitForPlayerSlotBounds();
      logPlayerModeBounds('before-start-local-file', resolvedBounds, { fallbackUsed: false });
      setMpvSlotBounds(resolvedBounds);
      console.info('[PlayerMode:LocalFilePlay]', {
        localFilePath,
        title,
        bounds: resolvedBounds,
      });
      const result = await window.electronAPI.startMpvPlayback({
        sourceType: 'embedded-file',
        source: localFilePath,
        filePath: localFilePath,
        title,
        mode: 'native-host',
        bounds: resolvedBounds,
        isPlayerMode: true,
      });
      if (!result?.ok) throw new Error(result?.error || 'Local file playback failed.');
      setPlayerStatus('playing');
      setActiveStreamId('');
      setMpvDebugStreamSessionId('');
      setMpvDebugStreamUrl('');
      window.requestAnimationFrame(() => {
        window.electronAPI?.updateNativeHostBounds?.(resolvedBounds).catch(() => {});
      });
    } catch (error) {
      setPlayerStatus('error');
      setPlayerError(String(error?.message || 'Local file play failed.'));
    } finally {
      setMpvDebugBusy(false);
    }
  };

  useEffect(() => {
    if (!isPlayerMode) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClosePlayer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayerMode, activeStreamId, resolvedEmbeddedStreamId]);

  if (loading) return <div className="loading">Loading...</div>;
  const defaultRoute = DEFAULT_PAGE_ROUTE_MAP[settings.defaultPage] || '/';

  return (
    <Router>
      <div className={`app-container${isPlayerMode ? ' player-mode-active' : ''}`}>
        <Sidebar settings={settings} />
        <main className="main-content">
          {nativeStreamEnabled && !isPlayerMode && showEmbeddedStatusPanel && (
            <section className="embedded-player-controls" aria-live="polite">
              <div className="embedded-player-controls-header">
                <strong>{settings.language === 'tr' ? 'Embedded Stream' : 'Embedded Stream'}</strong>
                <span>
                  {settings.language === 'tr' ? 'Durum' : 'Status'}: {embeddedUiStatus}
                </span>
                {embeddedTorrentStreamStatus?.torrentDownloadRate != null ? (
                  <span>DL: {embeddedTorrentStreamStatus.torrentDownloadRate}</span>
                ) : null}
              </div>
              {embeddedUiError ? <small className="embedded-player-error">{embeddedUiError}</small> : null}
              <div className="embedded-player-actions">
                <button type="button" onClick={() => handleStopEmbeddedTorrentStream('playback-only')} disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}>
                  {settings.language === 'tr' ? 'Stop Playback Only' : 'Stop Playback Only'}
                </button>
                <button type="button" onClick={() => handleStopEmbeddedTorrentStream('pause-torrent')} disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}>
                  {settings.language === 'tr' ? 'Pause Torrent' : 'Pause Torrent'}
                </button>
                <button type="button" onClick={() => handleStopEmbeddedTorrentStream('remove-torrent')} disabled={mpvDebugBusy || !resolvedEmbeddedStreamId}>
                  {settings.language === 'tr' ? 'Remove Torrent' : 'Remove Torrent'}
                </button>
              </div>
              <small className="embedded-player-note">
                {settings.language === 'tr'
                  ? 'Torrent listeden silinir, dosyalar kalir.'
                  : 'Removes torrent from list, keeps downloaded files.'}
              </small>
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
        {nativeStreamEnabled && isPlayerMode ? (
          <div className="cinesoft-player-overlay" aria-live="polite">
            <div className="cinesoft-player-topbar">
              <div className="player-topbar-left">
                <button type="button" className="player-close-button" onClick={handleClosePlayer} aria-label="Close player" disabled={isStoppingPlayer}>
                  ×
                </button>
                <div className="player-title">{activePlayerTitle || 'CineSoft Embedded Torrent Stream'}</div>
              </div>
              <div className="player-actions">
                {activePlaybackKind === 'local-file' ? (
                  <button type="button" onClick={handleClosePlayer} disabled={isStoppingPlayer || mpvDebugBusy}>
                    Stop Playback
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => handleStopEmbeddedTorrentStream('playback-only')} disabled={isStoppingPlayer || mpvDebugBusy || !resolvedEmbeddedStreamId}>
                      Stop Playback Only
                    </button>
                    <button type="button" onClick={() => handleStopEmbeddedTorrentStream('pause-torrent')} disabled={isStoppingPlayer || mpvDebugBusy || !resolvedEmbeddedStreamId}>
                      Pause Torrent
                    </button>
                    <button type="button" onClick={() => handleStopEmbeddedTorrentStream('remove-torrent')} disabled={isStoppingPlayer || mpvDebugBusy || !resolvedEmbeddedStreamId}>
                      Remove Torrent
                    </button>
                  </>
                )}
              </div>
            </div>
            <div ref={mpvNativeSlotRef} className="fullscreen-player-slot">
              <span>Native MPV Player Slot</span>
            </div>
            {playerStatus !== 'playing' ? (
              <div className="player-overlay-status">
                <span>
                  {playerStatus === 'preparing' ? 'Preparing stream...' : null}
                  {playerStatus === 'selecting-file' ? 'Selecting file...' : null}
                  {playerStatus === 'prebuffering' ? (playerError || 'Baslangic parcasi bekleniyor...') : null}
                  {playerStatus === 'error' ? (playerError || 'Stream hazirlanamadi, baslangic parcasi indirilemedi.') : null}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {showWelcome && <WelcomeOverlay language={settings.language} onClose={dismissWelcome} />}
        {showMpvDebugPanel && !isPlayerMode && (
          <>
            <button
              type="button"
              className={`mpv-debug-toggle ${isDebugPanelOpen ? 'open' : 'closed'}`}
              onClick={() => setIsDebugPanelOpen((prev) => !prev)}
              aria-expanded={isDebugPanelOpen}
              aria-controls="mpv-debug-panel"
            >
              {isDebugPanelOpen ? 'Hide Debug' : 'Show Debug'}
            </button>
            <aside
              id="mpv-debug-panel"
              className={`mpv-debug-panel ${isDebugPanelOpen ? 'open' : 'closed'}`}
              role="status"
              aria-live="polite"
            >
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
                {embeddedTorrentStreamStatus.runId ? <span>runId: {embeddedTorrentStreamStatus.runId}</span> : null}
                <span>cancelled: {String(Boolean(embeddedTorrentStreamStatus.cancelled))}</span>
                <span>stopRequested: {String(Boolean(embeddedTorrentStreamStatus.stopRequested))}</span>
                <span>embeddedActive: {embeddedTorrentStreamStatus.activeStreamCount}</span>
                {embeddedTorrentStreamStatus.torrentId ? <span>embeddedTorrentId: {embeddedTorrentStreamStatus.torrentId}</span> : null}
                {embeddedTorrentStreamStatus.fileIndex != null ? <span>embeddedFileIndex: {embeddedTorrentStreamStatus.fileIndex}</span> : null}
                {embeddedTorrentStreamStatus.selectedFileName ? <span>embeddedFile: {embeddedTorrentStreamStatus.selectedFileName}</span> : null}
                {embeddedTorrentStreamStatus.expectedSize != null ? <span>embeddedExpectedSize: {embeddedTorrentStreamStatus.expectedSize}</span> : null}
                {embeddedTorrentStreamStatus.prebufferStart != null ? <span>prebufferStart: {embeddedTorrentStreamStatus.prebufferStart}</span> : null}
                {embeddedTorrentStreamStatus.prebufferEnd != null ? <span>prebufferEnd: {embeddedTorrentStreamStatus.prebufferEnd}</span> : null}
                <span>prebufferReady: {String(embeddedTorrentStreamStatus.prebufferReady)}</span>
                {embeddedTorrentStreamStatus.missingPiecesCount != null ? <span>missingPieces: {embeddedTorrentStreamStatus.missingPiecesCount}</span> : null}
                {embeddedTorrentStreamStatus.minimumPrebufferStart != null ? <span>minimumPrebufferStart: {embeddedTorrentStreamStatus.minimumPrebufferStart}</span> : null}
                {embeddedTorrentStreamStatus.minimumPrebufferEnd != null ? <span>minimumPrebufferEnd: {embeddedTorrentStreamStatus.minimumPrebufferEnd}</span> : null}
                {embeddedTorrentStreamStatus.minimumPrebufferReady != null ? <span>minimumPrebufferReady: {String(embeddedTorrentStreamStatus.minimumPrebufferReady)}</span> : null}
                {embeddedTorrentStreamStatus.minimumMissingPiecesCount != null ? <span>minimumMissingPieces: {embeddedTorrentStreamStatus.minimumMissingPiecesCount}</span> : null}
                {embeddedTorrentStreamStatus.targetPrebufferStart != null ? <span>targetPrebufferStart: {embeddedTorrentStreamStatus.targetPrebufferStart}</span> : null}
                {embeddedTorrentStreamStatus.targetPrebufferEnd != null ? <span>targetPrebufferEnd: {embeddedTorrentStreamStatus.targetPrebufferEnd}</span> : null}
                {embeddedTorrentStreamStatus.targetPrebufferReady != null ? <span>targetPrebufferReady: {String(embeddedTorrentStreamStatus.targetPrebufferReady)}</span> : null}
                {embeddedTorrentStreamStatus.targetMissingPiecesCount != null ? <span>targetMissingPieces: {embeddedTorrentStreamStatus.targetMissingPiecesCount}</span> : null}
                {embeddedTorrentStreamStatus.prebufferDownloadRate != null ? <span>prebufferDownloadRate: {embeddedTorrentStreamStatus.prebufferDownloadRate}</span> : null}
                {embeddedTorrentStreamStatus.prebufferPeerCount != null ? <span>prebufferPeerCount: {embeddedTorrentStreamStatus.prebufferPeerCount}</span> : null}
                {embeddedTorrentStreamStatus.waitingForFirstPiece != null ? <span>waitingForFirstPiece: {String(embeddedTorrentStreamStatus.waitingForFirstPiece)}</span> : null}
                {embeddedTorrentStreamStatus.firstPiece != null ? <span>firstPiece: {embeddedTorrentStreamStatus.firstPiece}</span> : null}
                {embeddedTorrentStreamStatus.pieceLength != null ? <span>pieceLength: {embeddedTorrentStreamStatus.pieceLength}</span> : null}
                {embeddedTorrentStreamStatus.firstPieceAvailability != null ? <span>firstPieceAvailability: {embeddedTorrentStreamStatus.firstPieceAvailability}</span> : null}
                {embeddedTorrentStreamStatus.totalWantedDone != null ? <span>progressBytes: {embeddedTorrentStreamStatus.totalWantedDone}</span> : null}
                {embeddedTorrentStreamStatus.noProgressElapsedMs != null ? <span>noProgressElapsedMs: {embeddedTorrentStreamStatus.noProgressElapsedMs}</span> : null}
                {embeddedTorrentStreamStatus.lastEnsureResult ? (
                  <span>
                    lastEnsure: phase={embeddedTorrentStreamStatus.lastEnsureResult.phase || '-'} ok={String(embeddedTorrentStreamStatus.lastEnsureResult.ok)} ready={String(embeddedTorrentStreamStatus.lastEnsureResult.ready)} missing={embeddedTorrentStreamStatus.lastEnsureResult.missingPiecesCount ?? '-'} prioritized={embeddedTorrentStreamStatus.lastEnsureResult.prioritizedPieces ?? '-'} deadlineMs={embeddedTorrentStreamStatus.lastEnsureResult.deadlineMs ?? '-'}
                  </span>
                ) : null}
                {embeddedTorrentStreamStatus.fileOffset != null ? <span>fileOffset: {embeddedTorrentStreamStatus.fileOffset}</span> : null}
                {embeddedTorrentStreamStatus.selectedFileIndex != null ? <span>selectedFileIndex: {embeddedTorrentStreamStatus.selectedFileIndex}</span> : null}
                {embeddedTorrentStreamStatus.selectedFileSize != null ? <span>selectedFileSize: {embeddedTorrentStreamStatus.selectedFileSize}</span> : null}
                {embeddedTorrentStreamStatus.lastMinimumRangeStatus ? (
                  <span>
                    minRange: piece={embeddedTorrentStreamStatus.lastMinimumRangeStatus.firstPiece ?? '-'}-{embeddedTorrentStreamStatus.lastMinimumRangeStatus.lastPiece ?? '-'} missing={embeddedTorrentStreamStatus.lastMinimumRangeStatus.missingPiecesCount ?? '-'} dl={embeddedTorrentStreamStatus.lastMinimumRangeStatus.downloadRate ?? '-'} peers={embeddedTorrentStreamStatus.lastMinimumRangeStatus.numPeers ?? '-'} state={embeddedTorrentStreamStatus.lastMinimumRangeStatus.state ?? '-'} uploadMode={String(embeddedTorrentStreamStatus.lastMinimumRangeStatus.uploadMode ?? '-')}
                  </span>
                ) : null}
                {embeddedTorrentStreamStatus.lastMinimumEnsureResult ? (
                  <span>
                    minEnsure: piece={embeddedTorrentStreamStatus.lastMinimumEnsureResult.firstPiece ?? '-'}-{embeddedTorrentStreamStatus.lastMinimumEnsureResult.lastPiece ?? '-'} missing={JSON.stringify((embeddedTorrentStreamStatus.lastMinimumEnsureResult.missingPieces || []).slice(0, 20))} prio={JSON.stringify((embeddedTorrentStreamStatus.lastMinimumEnsureResult.piecePriorities || []).slice(0, 20))} avail={JSON.stringify((embeddedTorrentStreamStatus.lastMinimumEnsureResult.pieceAvailability || []).slice(0, 20))} dl={embeddedTorrentStreamStatus.lastMinimumEnsureResult.downloadRate ?? '-'} peers={embeddedTorrentStreamStatus.lastMinimumEnsureResult.numPeers ?? '-'} state={embeddedTorrentStreamStatus.lastMinimumEnsureResult.state ?? '-'} uploadMode={String(embeddedTorrentStreamStatus.lastMinimumEnsureResult.uploadMode ?? '-')} deadlineApplied={embeddedTorrentStreamStatus.lastMinimumEnsureResult.deadlineAppliedPieces ?? '-'} pErr={(embeddedTorrentStreamStatus.lastMinimumEnsureResult.priorityErrors || []).length} dErr={(embeddedTorrentStreamStatus.lastMinimumEnsureResult.deadlineErrors || []).length}
                  </span>
                ) : null}
                {embeddedTorrentStreamStatus.lastTargetEnsureResult ? (
                  <span>
                    targetEnsure: piece={embeddedTorrentStreamStatus.lastTargetEnsureResult.firstPiece ?? '-'}-{embeddedTorrentStreamStatus.lastTargetEnsureResult.lastPiece ?? '-'} missing={embeddedTorrentStreamStatus.lastTargetEnsureResult.missingPiecesCount ?? '-'} dl={embeddedTorrentStreamStatus.lastTargetEnsureResult.downloadRate ?? '-'} peers={embeddedTorrentStreamStatus.lastTargetEnsureResult.numPeers ?? '-'} state={embeddedTorrentStreamStatus.lastTargetEnsureResult.state ?? '-'} uploadMode={String(embeddedTorrentStreamStatus.lastTargetEnsureResult.uploadMode ?? '-')}
                  </span>
                ) : null}
                {embeddedTorrentStreamStatus.pauseVerified != null ? <span>pauseVerified: {String(embeddedTorrentStreamStatus.pauseVerified)}</span> : null}
                {embeddedTorrentStreamStatus.pauseRetryCount != null ? <span>pauseRetryCount: {embeddedTorrentStreamStatus.pauseRetryCount}</span> : null}
                {embeddedTorrentStreamStatus.lastPauseAttemptAt != null ? <span>lastPauseAttemptAt: {embeddedTorrentStreamStatus.lastPauseAttemptAt}</span> : null}
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
          </>
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




