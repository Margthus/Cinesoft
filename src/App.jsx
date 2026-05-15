import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Home, Film, Tv, Settings as SettingsIcon, Search, Bookmark, Sparkles, Download, Library, ChevronUp, ChevronDown, Cog } from 'lucide-react';
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

          if (savedSettings.prowlarr?.managed && savedSettings.prowlarr?.enabled && !savedSettings.torrentioEnabled) {
            window.electronAPI?.startManagedProwlarr?.(savedSettings.prowlarr);
          }
          if (savedSettings.radarrManaged === true && savedSettings.radarrEnabled === true) {
            window.electronAPI?.startManagedRadarr?.(savedSettings);
          }
          if (savedSettings.sonarrManaged === true && savedSettings.sonarrEnabled === true) {
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
      <div className="app-container">
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

  return (
    <nav className="sidebar">
      <div className="logo">
        <span className="logo-text">CINE<span>SOFT</span></span>
      </div>
      <div className="sidebar-scroll">
        <section className="sidebar-group">
          <h4 className="sidebar-group-title">{t.discover}</h4>
          <div className="nav-links">
            <NavLink to="/" end className="nav-item">
              <Home size={18} />
              <span>{t.home}</span>
            </NavLink>
            <NavLink to="/search" className="nav-item">
              <Search size={18} />
              <span>{t.search}</span>
            </NavLink>
            <NavLink to="/movies" className="nav-item">
              <Film size={18} />
              <span>{t.movies}</span>
            </NavLink>
            <NavLink to="/tv" className="nav-item">
              <Tv size={18} />
              <span>{t.tv}</span>
            </NavLink>
            <NavLink to="/anime" className="nav-item">
              <Sparkles size={18} />
              <span>{t.anime}</span>
            </NavLink>
          </div>
        </section>

        <section className="sidebar-group">
          <h4 className="sidebar-group-title">{t.librarySection}</h4>
          <div className="nav-links">
            <NavLink to="/library" className="nav-item">
              <Library size={18} />
              <span>{t.library}</span>
            </NavLink>
            <NavLink to="/mylist" className="nav-item">
              <Bookmark size={18} />
              <span>{t.myList}</span>
            </NavLink>
            <NavLink to="/downloads" className="nav-item">
              <Download size={18} />
              <span>{t.downloads}</span>
            </NavLink>
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
                <NavLink to="/radarr" className="automation-item">
                  <span className="automation-dot" />
                  <span>{t.radarr}</span>
                </NavLink>
                <NavLink to="/sonarr" className="automation-item">
                  <span className="automation-dot" />
                  <span>{t.sonarr}</span>
                </NavLink>
              </div>
            )}
          </div>
        </section>

      </div>

      <div className="nav-footer">
        <section className="sidebar-group sidebar-group-system">
          <h4 className="sidebar-group-title">{t.systemSection}</h4>
          <div className="nav-links">
            <NavLink to="/settings" className="nav-item">
              <SettingsIcon size={18} />
              <span>{t.settings}</span>
            </NavLink>
          </div>
        </section>
      </div>

    </nav>
  );
};

export default App;
