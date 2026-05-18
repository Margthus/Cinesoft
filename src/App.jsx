import React, { useState, useEffect, useMemo } from 'react';
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
  X,
  Play,
  Pause,
  Volume2,
  Maximize2,
  Captions,
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
const DEFAULT_NATIVE_PLAYER_STATE = {
  active: false,
  title: '',
  torrentStatus: null,
  fullscreen: false,
  startedAt: 0,
  subtitles: {
    activeKey: 'spu:-1',
    activeId: -1,
    tracks: [],
  },
  playback: {
    time: 0,
    length: 0,
    volume: 80,
    playing: false,
  },
};

const NATIVE_PLAYER_TOPBAR_HEIGHT = 0;
const NATIVE_PLAYER_CONTROLS_HEIGHT = 84;

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
    torrserver: {
      enabled: false,
      exePath: '',
      port: 8090,
      autoStartOnStream: true,
      stopWhenPlaybackEnds: true,
      dataDir: '',
      cacheDir: '',
      cacheSize: null,
    },
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
  const [nativePlayer, setNativePlayer] = useState(DEFAULT_NATIVE_PLAYER_STATE);

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
            torrserver: {
              enabled: savedSettings?.torrserver?.enabled === true,
              exePath: String(savedSettings?.torrserver?.exePath || ''),
              port: Number(savedSettings?.torrserver?.port || 8090),
              autoStartOnStream: savedSettings?.torrserver?.autoStartOnStream !== false,
              stopWhenPlaybackEnds: savedSettings?.torrserver?.stopWhenPlaybackEnds !== false,
              dataDir: String(savedSettings?.torrserver?.dataDir || ''),
              cacheDir: String(savedSettings?.torrserver?.cacheDir || ''),
              cacheSize: Number.isFinite(Number(savedSettings?.torrserver?.cacheSize))
                ? Number(savedSettings?.torrserver?.cacheSize)
                : null,
            },
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

  useEffect(() => {
    const onPlayerStarted = (event) => {
      const detail = event?.detail || {};
      setNativePlayer({
        ...DEFAULT_NATIVE_PLAYER_STATE,
        active: true,
        title: String(detail.title || 'CineSoft Stream'),
        torrentStatus: detail.torrentStatus || null,
        fullscreen: detail.fullscreen === true,
        startedAt: Date.now(),
      });
    };
    window.addEventListener('cinesoft:native-player-started', onPlayerStarted);
    const unsubscribeStarted = window.electronAPI?.onNativePlayerStarted?.((payload = {}) => {
      setNativePlayer({
        ...DEFAULT_NATIVE_PLAYER_STATE,
        active: true,
        title: String(payload.title || 'CineSoft Stream'),
        torrentStatus: payload.torrentStatus || null,
        fullscreen: payload.fullscreen === true,
        startedAt: Date.now(),
      });
    });
    const unsubscribeState = window.electronAPI?.onNativePlayerState?.((payload = {}) => {
      setNativePlayer((prev) => ({
        ...prev,
        subtitles: payload.subtitleState
          ? {
            activeKey: String(payload.subtitleState?.activeKey || 'spu:-1'),
            activeId: Number(payload.subtitleState?.activeId ?? -1),
            tracks: Array.isArray(payload.subtitleState?.tracks) ? payload.subtitleState.tracks : [],
          }
          : prev.subtitles,
        playback: {
          time: payload.time === undefined ? prev.playback.time : Math.max(0, Number(payload.time) || 0),
          length: payload.length === undefined ? prev.playback.length : Math.max(0, Number(payload.length) || 0),
          volume: payload.volume === undefined ? prev.playback.volume : Math.max(0, Math.min(100, Number(payload.volume) || 0)),
          playing: payload.playing === undefined ? prev.playback.playing : payload.playing === true,
        },
      }));
    });
    const unsubscribeStopped = window.electronAPI?.onNativePlayerStopped?.(() => {
      setNativePlayer(DEFAULT_NATIVE_PLAYER_STATE);
    });
    return () => {
      window.removeEventListener('cinesoft:native-player-started', onPlayerStarted);
      if (typeof unsubscribeStarted === 'function') unsubscribeStarted();
      if (typeof unsubscribeState === 'function') unsubscribeState();
      if (typeof unsubscribeStopped === 'function') unsubscribeStopped();
    };
  }, []);

  const closeNativePlayer = async () => {
    try {
      await window.electronAPI?.stopNativePlayer?.();
    } finally {
      setNativePlayer(DEFAULT_NATIVE_PLAYER_STATE);
    }
  };

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

  if (loading) return <div className="loading">Loading...</div>;
  const defaultRoute = DEFAULT_PAGE_ROUTE_MAP[settings.defaultPage] || '/';

  return (
    <Router>
      <div className={`app-container ${nativePlayer.active ? 'app-container-player-mode' : ''}`}>
        {nativePlayer.active ? (
          <NativePlayerShell title={nativePlayer.title} torrentStatus={nativePlayer.torrentStatus} playback={nativePlayer.playback} fullscreen={nativePlayer.fullscreen} startedAt={nativePlayer.startedAt} language={settings.language} onClose={closeNativePlayer} subtitles={nativePlayer.subtitles} />
        ) : (
          <>
            <Sidebar settings={settings} />
            <main className="main-content">
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
          </>
        )}
        {showWelcome && <WelcomeOverlay language={settings.language} onClose={dismissWelcome} />}
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

const formatPlaybackTime = (ms) => {
  const totalMs = Math.max(0, Number(ms) || 0);
  if (!totalMs) return '00:00';
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const NativePlayerShell = ({ title = 'CineSoft Stream', torrentStatus = null, playback = DEFAULT_NATIVE_PLAYER_STATE.playback, fullscreen = false, startedAt = 0, language = 'tr', onClose, subtitles = DEFAULT_NATIVE_PLAYER_STATE.subtitles }) => {
  const hash = String(torrentStatus?.infoHash || '').trim();
  const hashPreview = hash ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : '-';
  const playbackLength = Math.max(0, Number(playback?.length) || 0);
  const playbackTime = Math.max(0, Number(playback?.time) || 0);
  const playbackProgressValue = playbackLength > 0
    ? Math.max(0, Math.min(100, Math.round((playbackTime / Math.max(1, playbackLength)) * 100)))
    : null;
  const torrentProgressValue = Number.isFinite(Number(torrentStatus?.progress)) ? Math.max(0, Math.min(100, Math.round(Number(torrentStatus.progress)))) : null;
  const resolvedProgressValue = playbackProgressValue ?? torrentProgressValue;
  const progress = resolvedProgressValue !== null ? `${resolvedProgressValue}%` : '--%';
  const seeders = Number(torrentStatus?.seeders || 0) || 0;
  const peers = Number(torrentStatus?.peers || 0) || 0;
  const provider = String(torrentStatus?.provider || '').trim();
  const quality = String(torrentStatus?.quality || '').trim();
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [volumeValue, setVolumeValue] = useState(Math.max(0, Math.min(100, Number(playback?.volume) || 80)));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const hasPlayback = Number(playback?.length) > 0 || Number(playback?.time) > 0 || playback?.playing === true;
  const subtitleTracks = Array.isArray(subtitles?.tracks) ? subtitles.tracks : [];
  const activeSubtitleKey = String(subtitles?.activeKey || 'spu:-1');
  const isTr = language === 'tr';
  const subtitleOptions = useMemo(() => {
    const offTrack = subtitleTracks.find((track) => (track?.key || `spu:${track?.id}`) === 'spu:-1')
      || { key: 'spu:-1', id: -1, label: isTr ? 'Off' : 'Off', source: 'builtin' };
    const playableTracks = subtitleTracks.filter((track) => (track?.key || `spu:${track?.id}`) !== 'spu:-1');
    const options = [offTrack];
    if (playableTracks.length > 0) {
      options.push({
        key: playableTracks[0]?.key || `spu:${playableTracks[0]?.id}`,
        id: playableTracks[0]?.id,
        label: isTr ? 'Default' : 'Default',
        source: 'default',
      });
    }
    options.push(...playableTracks);
    return options;
  }, [isTr, subtitleTracks]);

  useEffect(() => {
    if (!startedAt || hasPlayback) {
      setLoadingSeconds(0);
      return undefined;
    }
    const update = () => setLoadingSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [hasPlayback, startedAt]);

  useEffect(() => {
    if (!isSeeking) {
      const length = Math.max(0, Number(playback?.length) || 0);
      const time = Math.max(0, Number(playback?.time) || 0);
      setSeekValue(length > 0 ? Math.round(Math.min(1000, (time / Math.max(1, length)) * 1000)) : 0);
    }
  }, [isSeeking, playback?.length, playback?.time]);

  useEffect(() => {
    setVolumeValue(Math.max(0, Math.min(100, Number(playback?.volume) || 0)));
  }, [playback?.volume]);

  useEffect(() => {
    setIsFullscreen(fullscreen === true);
  }, [fullscreen]);

  useEffect(() => {
    const rightInset = subtitleMenuOpen
      ? (isFullscreen ? 248 : 266)
      : 0;
    const leftInset = 0;
    const topInset = NATIVE_PLAYER_TOPBAR_HEIGHT;
    const bottomInset = NATIVE_PLAYER_CONTROLS_HEIGHT;
    window.electronAPI?.controlNativePlayer?.({
      command: 'set-insets',
      value: `${leftInset} ${topInset} ${rightInset} ${bottomInset}`,
    });
  }, [isFullscreen, subtitleMenuOpen]);

  useEffect(() => {
    if (!subtitleMenuOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSubtitleMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [subtitleMenuOpen]);

  const commitSeek = async () => {
    setIsSeeking(false);
    await window.electronAPI?.controlNativePlayer?.({
      command: 'seek-percent',
      value: seekValue,
    });
  };

  const togglePlayback = async () => {
    await window.electronAPI?.controlNativePlayer?.({ command: 'toggle-play' });
  };

  const changeVolume = async (nextVolume) => {
    const value = Math.max(0, Math.min(100, Number(nextVolume) || 0));
    setVolumeValue(value);
    await window.electronAPI?.controlNativePlayer?.({
      command: 'set-volume',
      value,
    });
  };

  const toggleFullscreen = async () => {
    const result = await window.electronAPI?.toggleNativePlayerFullscreen?.();
    if (result && typeof result.fullscreen === 'boolean') {
      setIsFullscreen(result.fullscreen);
    }
  };

  const selectSubtitle = async (subtitleKey) => {
    await window.electronAPI?.controlNativePlayer?.({
      command: 'set-subtitle',
      value: subtitleKey,
    });
    setSubtitleMenuOpen(false);
  };

  const playbackStatusLabel = !hasPlayback
    ? (isTr ? 'Hazirlaniyor' : 'Preparing')
    : (playback?.playing ? (isTr ? 'Streaming' : 'Streaming') : (isTr ? 'Duraklatildi' : 'Paused'));
  const progressLabel = isTr ? 'Ilerleme' : 'Progress';
  const seedLabel = isTr ? 'seed' : (seeders === 1 ? 'seed' : 'seeds');
  const peerLabel = isTr ? 'peer' : (peers === 1 ? 'peer' : 'peers');
  const hashLabel = 'Hash';
  const unavailableHashTitle = isTr ? 'Hash bilgisi yok' : 'Hash unavailable';
  const loadingKicker = isTr ? 'Yayin Hazirlaniyor' : 'Preparing Stream';
  const loadingMessage = loadingSeconds >= 8
    ? (isTr
      ? 'Akis hazirlaniyor. Ilk baglanti ve buffer islemleri suruyor.'
      : 'The stream is being prepared. Initial connection and buffering are still in progress.')
    : loadingSeconds >= 3
      ? (isTr
        ? 'Kaynak baglantisi kuruluyor, oynatma hazirlaniyor.'
        : 'Connecting to the source and preparing playback.')
      : (isTr
        ? 'Stream baslatiliyor...'
        : 'Starting stream...');

  return (
    <main className={`native-player-shell ${isFullscreen ? 'native-player-shell-fullscreen' : ''}`}>
      <div className="native-player-frame">
        <div className={`native-player-viewport ${subtitleMenuOpen ? 'native-player-viewport-with-subtitles' : ''}`}>
          <section className="native-player-stage" aria-label="Native video player" />
          {subtitleMenuOpen ? (
            <aside className="native-player-subtitle-panel">
              <div className="native-player-subtitle-panel-head">
                <span>{isTr ? 'Altyazilar' : 'Subtitles'}</span>
              </div>
              <div className="native-player-subtitle-panel-list">
                {subtitleOptions.map((track, index) => {
                  const trackKey = track.key || `spu:${track.id}`;
                  const isDefaultOption = track.source === 'default';
                  const isSelected = isDefaultOption ? activeSubtitleKey !== 'spu:-1' : trackKey === activeSubtitleKey;
                  return (
                    <button
                      key={`${trackKey}-${track.label}-${index}`}
                      type="button"
                      className={`native-player-subtitle-item ${isSelected ? 'active' : ''}`}
                      onClick={() => selectSubtitle(trackKey)}
                      title={track.label || (isTr ? 'Bilinmeyen altyazi' : 'Unknown subtitle')}
                    >
                      <span>{track.label || (isTr ? 'Bilinmeyen altyazi' : 'Unknown subtitle')}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </div>
        {!hasPlayback && (
          <div className="native-player-loading">
            <div className="native-player-loading-card">
              <div className="native-player-loading-kicker">{loadingKicker}</div>
              <div className="native-player-loading-title">{title}</div>
              <div className="native-player-loading-text">{loadingMessage}</div>
              <div className="native-player-loading-bar">
                <div className="native-player-loading-bar-fill" />
              </div>
            </div>
          </div>
        )}
        <footer className="native-player-controls">
          <div className="native-player-controls-row">
            <button type="button" className="native-player-action native-player-action-close" onClick={onClose} aria-label={isTr ? 'Oynaticiyi kapat' : 'Close player'}>
              <X size={18} />
            </button>
            <button type="button" className="native-player-action native-player-action-primary" onClick={togglePlayback} aria-label={playback?.playing ? 'Pause' : 'Play'}>
              {playback?.playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <div className="native-player-time">{formatPlaybackTime(playback?.time)}</div>
            <div className="native-player-seek-wrap">
              <div className="native-player-progress-line">
                <div className="native-player-progress-fill" style={{ width: `${seekValue / 10}%` }} />
              </div>
              <input
                className="native-player-seek"
                type="range"
                min="0"
                max="1000"
                step="1"
                value={seekValue}
                onMouseDown={() => setIsSeeking(true)}
                onTouchStart={() => setIsSeeking(true)}
                onChange={(event) => setSeekValue(Number(event.target.value))}
                onMouseUp={commitSeek}
                onTouchEnd={commitSeek}
                aria-label="Seek"
              />
            </div>
            <div className="native-player-time native-player-time-end">{formatPlaybackTime(playback?.length)}</div>
            <div className="native-player-toolbar-divider" />
            <div className="native-player-volume-wrap">
              <Volume2 size={18} />
              <input
                className="native-player-volume"
                type="range"
                min="0"
                max="100"
                step="1"
                value={volumeValue}
                onChange={(event) => changeVolume(event.target.value)}
                aria-label="Volume"
              />
            </div>
            <div className="native-player-subtitle-wrap">
              <button type="button" className={`native-player-action ${subtitleMenuOpen ? 'native-player-action-active' : ''}`} onClick={() => setSubtitleMenuOpen((current) => !current)} aria-label="Subtitles" aria-expanded={subtitleMenuOpen}>
                <Captions size={17} />
              </button>
            </div>
            <button type="button" className="native-player-action" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
              <Maximize2 size={17} />
            </button>
          </div>
        </footer>
      </div>
    </main>
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
