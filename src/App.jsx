import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { Home, Film, Tv, Settings as SettingsIcon, Search, Bookmark, Sparkles, Download, Library, ScrollText } from 'lucide-react';
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
import LogsView from './components/LogsView';
import { DEFAULT_PROWLARR_CONFIG } from './sources/index.mjs';
import './styles/App.css';

const App = () => {
  const [settings, setSettings] = useState({
    apiKey: '',
    language: 'tr',
    prowlarr: DEFAULT_PROWLARR_CONFIG,
    useQbittorrent: false,
    qbittorrent: {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    },
    torrentio: {
      baseUrl: 'https://torrentio.strem.fun',
      maxResults: 80,
      excludeKeywords: 'cam,ts,tc',
    },
  });
  const [loading, setLoading] = useState(true);
  const [myList, setMyList] = useState([]);
  const [searchState, setSearchState] = useState({ query: '', results: [], inputValue: '' });
  const [movieState, setMovieState] = useState({ movies: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  const [tvState, setTvState] = useState({ shows: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  const [animeState, setAnimeState] = useState({ anime: [], page: 1, category: 'popular', scrollY: 0, hasMore: true });
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI) {
        const savedSettings = await window.electronAPI.getSettings();
        if (savedSettings) {
          setSettings({
            apiKey: savedSettings.apiKey || '',
            language: savedSettings.language || 'tr',
            prowlarr: savedSettings.prowlarr || DEFAULT_PROWLARR_CONFIG,
            torrentioEnabled: savedSettings.torrentioEnabled || false,
            useQbittorrent: savedSettings.useQbittorrent || false,
            qbittorrent: savedSettings.qbittorrent || {
              baseUrl: 'http://127.0.0.1:8080',
              username: 'admin',
              password: 'adminadmin',
            },
            torrentio: savedSettings.torrentio || {
              baseUrl: 'https://torrentio.strem.fun',
              maxResults: 80,
              excludeKeywords: 'cam,ts,tc',
            },
          });

          if (savedSettings.prowlarr?.managed && !savedSettings.torrentioEnabled) {
            window.electronAPI?.startManagedProwlarr?.(savedSettings.prowlarr);
          }
        }
      }

      const savedList = localStorage.getItem('myList');
      if (savedList) setMyList(JSON.parse(savedList));
      setLoading(false);
    };
    loadSettings();
  }, []);

  useEffect(() => {
    localStorage.setItem('myList', JSON.stringify(myList));
  }, [myList]);

  const toggleMyList = (item) => {
    setMyList((prev) => {
      const exists = prev.find((i) => i.id === item.id);
      if (exists) return prev.filter((i) => i.id !== item.id);
      return [...prev, item];
    });
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <Router>
      <div className="app-container">
        <Sidebar settings={settings} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomeView settings={settings} myList={myList} onToggleMyList={toggleMyList} />} />
            <Route path="/movies" element={<MoviesView settings={settings} myList={myList} onToggleMyList={toggleMyList} movieState={movieState} setMovieState={setMovieState} />} />
            <Route path="/tv" element={<TVShowsView settings={settings} myList={myList} onToggleMyList={toggleMyList} tvState={tvState} setTvState={setTvState} />} />
            <Route path="/anime" element={<AnimeView settings={settings} myList={myList} onToggleMyList={toggleMyList} animeState={animeState} setAnimeState={setAnimeState} />} />
            <Route path="/downloads" element={<DownloadsView settings={settings} />} />
            <Route path="/library" element={<LibraryView settings={settings} />} />
            <Route path="/logs" element={<LogsView settings={settings} />} />
            <Route path="/mylist" element={<MyListView settings={settings} myList={myList} onToggleMyList={toggleMyList} />} />
            <Route path="/search" element={<SearchView settings={settings} myList={myList} onToggleMyList={toggleMyList} searchState={searchState} setSearchState={setSearchState} />} />
            <Route path="/detail/:type/:id" element={<DetailView settings={settings} myList={myList} onToggleMyList={toggleMyList} setSearchState={setSearchState} />} />
            <Route path="/settings" element={<SettingsView settings={settings} setSettings={setSettings} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

const Sidebar = ({ settings }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const t = {
    tr: { home: 'Ana Sayfa', movies: 'Filmler', tv: 'Diziler', anime: 'Anime', settings: 'Ayarlar', library: 'Kutuphanem', logs: 'Sistem Loglari', myList: 'Listem', downloads: 'Indirilenler' },
    en: { home: 'Home', movies: 'Movies', tv: 'TV Shows', anime: 'Anime', settings: 'Settings', library: 'Library', logs: 'System Logs', myList: 'My List', downloads: 'Downloads' },
  }[settings.language];

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <nav className="sidebar">
      <div className="logo">
        <span className="logo-text">CINE<span>SOFT</span></span>
      </div>
      <div className="nav-links">
        <NavLink to="/" end className="nav-item">
          <Home size={20} />
          <span>{t.home}</span>
        </NavLink>
        <NavLink to="/search" className="nav-item">
          <Search size={20} />
          <span>{settings.language === 'tr' ? 'Arama Yap' : 'Search'}</span>
        </NavLink>
        <NavLink to="/movies" className="nav-item">
          <Film size={20} />
          <span>{t.movies}</span>
        </NavLink>
        <NavLink to="/tv" className="nav-item">
          <Tv size={20} />
          <span>{t.tv}</span>
        </NavLink>
        <NavLink to="/anime" className="nav-item">
          <Sparkles size={20} />
          <span>{t.anime}</span>
        </NavLink>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <NavLink to="/library" className="nav-item">
            <Library size={20} />
            <span>{t.library}</span>
          </NavLink>
          <NavLink to="/mylist" className="nav-item">
            <Bookmark size={20} />
            <span>{t.myList}</span>
          </NavLink>
          <NavLink to="/downloads" className="nav-item">
            <Download size={20} />
            <span>{t.downloads}</span>
          </NavLink>
          <NavLink to="/logs" className="nav-item">
            <ScrollText size={20} />
            <span>{t.logs}</span>
          </NavLink>
        </div>
      </div>
      <div className="nav-footer">
        <NavLink to="/settings" className="nav-item">
          <SettingsIcon size={20} />
          <span>{t.settings}</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default App;
