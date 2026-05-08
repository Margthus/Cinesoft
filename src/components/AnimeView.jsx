import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Filter, Plus, Star } from 'lucide-react';
import { fetchAnime, getAniListApiUrl } from '../utils/anilist';
import PosterStatusMenu, { PosterStatusBadge } from './PosterStatusMenu';
import { buildWatchStatusKey } from '../utils/watchStatus';
import '../styles/ListView.css';

const AnimeView = ({ settings, myList, onToggleMyList, animeState, setAnimeState, watchStatusMap, onSetWatchStatus }) => {
  const navigate = useNavigate();
  const [anime, setAnime] = useState(animeState.anime);
  const [category, setCategory] = useState(animeState.category);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [page, setPage] = useState(animeState.page);
  const [hasMore, setHasMore] = useState(animeState.hasMore);
  const [statusMenu, setStatusMenu] = useState({ open: false, x: 0, y: 0, item: null, status: '' });

  useEffect(() => {
    if (anime.length > 0 && animeState.scrollY > 0) {
      const timer = setTimeout(() => {
        const container = document.querySelector('.main-content');
        if (container) {
          container.scrollTo({ top: animeState.scrollY, behavior: 'instant' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [anime.length]);

  useEffect(() => {
    setAnimeState((prev) => ({ ...prev, anime, page, category, hasMore }));
  }, [anime, page, category, hasMore, setAnimeState]);

  useEffect(() => {
    const container = document.querySelector('.main-content');
    const handleScroll = () => {
      if (container) {
        setAnimeState((prev) => ({ ...prev, scrollY: container.scrollTop }));
      }
    };

    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
    };
  }, [setAnimeState]);

  useEffect(() => {
    if (category !== animeState.category) {
      setAnime([]);
      setPage(1);
      setHasMore(true);
    }
  }, [category, animeState.category]);

  useEffect(() => {
    const load = async () => {
      if (!hasMore || (page === animeState.page && anime.length > 0 && category === animeState.category)) {
        return;
      }

      try {
        setLoading(true);
        const data = await fetchAnime(getAniListApiUrl(settings), category, page);
        if (data.results.length === 0) {
          setHasMore(false);
        } else {
          setAnime((prev) => (page === 1 ? data.results : [...prev, ...data.results]));
          setHasMore(data.hasNextPage);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [category, page, hasMore, settings.anilistApiUrl, anime.length, animeState.page, animeState.category]);

  const observer = useRef();
  const lastAnimeRef = React.useCallback((node) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore) {
        setPage((prev) => prev + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const categories = [
    { id: 'popular', name: settings.language === 'tr' ? 'Populer' : 'Popular' },
    { id: 'top_rated', name: settings.language === 'tr' ? 'En Cok Oy Alanlar' : 'Top Rated' },
    { id: 'trending', name: settings.language === 'tr' ? 'Trend' : 'Trending' },
    { id: 'action', name: settings.language === 'tr' ? 'Aksiyon' : 'Action' },
    { id: 'comedy', name: settings.language === 'tr' ? 'Komedi' : 'Comedy' },
    { id: 'drama', name: settings.language === 'tr' ? 'Dram' : 'Drama' },
    { id: 'fantasy', name: settings.language === 'tr' ? 'Fantastik' : 'Fantasy' },
    { id: 'romance', name: settings.language === 'tr' ? 'Romantik' : 'Romance' },
    { id: 'sci_fi', name: settings.language === 'tr' ? 'Bilim Kurgu' : 'Sci-Fi' },
    { id: 'horror', name: settings.language === 'tr' ? 'Korku' : 'Horror' },
    { id: 'mystery', name: settings.language === 'tr' ? 'Gizem' : 'Mystery' },
  ];

  const currentCategoryName = categories.find((item) => item.id === category)?.name;
  const emptyMessage = settings.language === 'tr'
    ? 'Bu kategori icin anime bulunamadi.'
    : 'No anime titles were found for this category.';

  const getItemStatus = (item) => {
    const key = buildWatchStatusKey(item, 'anime');
    return key ? (watchStatusMap?.[key] || '') : '';
  };

  const openStatusMenu = (event, item) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setStatusMenu({
      open: true,
      x: rect.right - 220,
      y: rect.bottom + 8,
      item,
      status: getItemStatus(item),
    });
  };

  const closeStatusMenu = () => setStatusMenu({ open: false, x: 0, y: 0, item: null, status: '' });

  const applyStatus = (status) => {
    if (!statusMenu.item) return;
    onSetWatchStatus(statusMenu.item, status, 'anime');
    closeStatusMenu();
  };

  return (
    <div className="list-view">
      <div className="list-header">
        <h1>{settings.language === 'tr' ? 'Anime' : 'Anime'}</h1>

        <div className="list-filters">
          <div className="custom-dropdown">
            <button
              className="dropdown-trigger"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <Filter size={18} />
              <span>{currentCategoryName || (settings.language === 'tr' ? 'Kategori Sec' : 'Select Category')}</span>
              <ChevronDown size={18} className={isDropdownOpen ? 'rotate' : ''} />
            </button>

            {isDropdownOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-section-title">{settings.language === 'tr' ? 'Kategoriler' : 'Categories'}</div>
                {categories.map((item) => (
                  <div
                    key={item.id}
                    className={`dropdown-item ${category === item.id ? 'active' : ''}`}
                    onClick={() => { setCategory(item.id); setIsDropdownOpen(false); }}
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="list-grid">
        {anime.map((item, index) => {
          const isLast = anime.length === index + 1;
          const placeholder = 'https://via.placeholder.com/500x750?text=No+Poster';
          const posterUrl = item.poster_path || placeholder;

          return (
            <div
              key={`${item.id}-${index}`}
              className="movie-item"
              onClick={() => navigate(`/detail/anime/${encodeURIComponent(item.id)}`, { state: { fallbackItem: item } })}
              ref={isLast ? lastAnimeRef : null}
            >
              <div className="movie-card">
                <div className="card-rating">
                  <Star size={12} fill="var(--accent)" />
                  {typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : '--'}
                </div>
                <div
                  className={`card-add ${myList.some((listItem) => listItem.id === item.id) ? 'active' : ''}`}
                  onClick={(event) => openStatusMenu(event, item)}
                >
                  <Plus size={18} />
                </div>
                <img
                  src={posterUrl}
                  alt={item.title}
                  onError={(event) => {
                    event.target.onerror = null;
                    event.target.src = placeholder;
                  }}
                />
                <PosterStatusBadge status={getItemStatus(item)} language={settings.language} />
                <div className="card-overlay" />
              </div>
              <span className="movie-title-below">
                {item.title} {item.release_date ? `(${new Date(item.release_date).getFullYear()})` : ''}
              </span>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="loading-more">
          {anime.length === 0 ? (settings.language === 'tr' ? 'Yukleniyor...' : 'Loading...') : (settings.language === 'tr' ? 'Daha fazla yukleniyor...' : 'Loading more...')}
        </div>
      )}
      {!loading && anime.length === 0 && (
        <div className="no-results">{emptyMessage}</div>
      )}
      <PosterStatusMenu state={statusMenu} language={settings.language} onClose={closeStatusMenu} onSelect={applyStatus} />
    </div>
  );
};

export default AnimeView;
