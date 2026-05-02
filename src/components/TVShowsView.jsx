import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTVShows, fetchGenres, fetchByGenre, fetchByKeyword } from '../utils/tmdb';
import { Plus, Star, Check, ChevronDown, Filter } from 'lucide-react';
import '../styles/ListView.css';

const TVShowsView = ({ settings, myList, onToggleMyList, tvState, setTvState }) => {
  const navigate = useNavigate();
  const [shows, setShows] = useState(tvState.shows);
  const [category, setCategory] = useState(tvState.category);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [page, setPage] = useState(tvState.page);
  const [hasMore, setHasMore] = useState(tvState.hasMore);

  useEffect(() => {
    const loadGenres = async () => {
      if (settings.apiKey) {
        const data = await fetchGenres(settings.apiKey, settings.language, 'tv');
        setGenres(data);
      }
    };
    loadGenres();
  }, [settings.apiKey, settings.language]);

  // Restore scroll
  useEffect(() => {
    if (shows.length > 0 && tvState.scrollY > 0) {
      const timer = setTimeout(() => {
        const container = document.querySelector('.main-content');
        if (container) {
          container.scrollTo({ top: tvState.scrollY, behavior: 'instant' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [shows.length]);

  // Save state on change
  useEffect(() => {
    setTvState(prev => ({ ...prev, shows, page, category, hasMore }));
  }, [shows, page, category, hasMore]);

  // Handle scroll saving
  useEffect(() => {
    const container = document.querySelector('.main-content');
    const handleScroll = () => {
      if (container) {
        setTvState(prev => ({ ...prev, scrollY: container.scrollTop }));
      }
    };
    
    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (container) container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (category !== tvState.category) {
      setShows([]);
      setPage(1);
      setHasMore(true);
    }
  }, [category]);

  useEffect(() => {
    const load = async () => {
      if (!settings.apiKey || !hasMore || (page === tvState.page && shows.length > 0 && category === tvState.category)) {
        return;
      }
      try {
        setLoading(true);
        let data;
        if (category === 'zombie') {
          data = await fetchByKeyword(settings.apiKey, 'en', 'tv', 12377, page);
        } else if (!isNaN(category)) {
          data = await fetchByGenre(settings.apiKey, 'en', 'tv', category, page);
        } else {
          data = await fetchTVShows(settings.apiKey, 'en', category, page);
        }

        if (data.length === 0) {
          setHasMore(false);
        } else {
          setShows(prev => page === 1 ? data : [...prev, ...data]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [category, settings.apiKey, page]);

  const observer = React.useRef();
  const lastShowRef = React.useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prev => prev + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const handleInspect = (show) => {
    if (show.externalCatalog) {
      navigate(`/detail/tv/${encodeURIComponent(show.id)}`, {
        state: { fallbackItem: show },
      });
      return;
    }
    navigate(`/detail/tv/${show.id}`);
  };

  const categories = [
    { id: 'popular', name: settings.language === 'tr' ? 'Popüler' : 'Popular' },
    { id: 'top_rated', name: settings.language === 'tr' ? 'En Çok Oy Alanlar' : 'Top Rated' },
    { id: 'on_the_air', name: settings.language === 'tr' ? 'Yayında' : 'On The Air' },
    { id: 'zombie', name: settings.language === 'tr' ? 'Zombi' : 'Zombie' },
  ];

  const currentCategoryName = categories.find(c => c.id === category)?.name || 
                        genres.find(g => String(g.id) === category)?.name || '';
  const emptyMessage = settings.language === 'tr' ? 'Bu kategori icin sonuc bulunamadi.' : 'No titles were found for this category.';

  return (
    <div className="list-view">
      <div className="list-header">
        <h1>{settings.language === 'tr' ? 'Diziler' : 'TV Shows'}</h1>
        
        <div className="list-filters">
          <div className="custom-dropdown">
            <button 
              className="dropdown-trigger"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <Filter size={18} />
              <span>{currentCategoryName || (settings.language === 'tr' ? 'Kategori Seç' : 'Select Category')}</span>
              <ChevronDown size={18} className={isDropdownOpen ? 'rotate' : ''} />
            </button>
            
            {isDropdownOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-section-title">{settings.language === 'tr' ? 'Kategoriler' : 'Categories'}</div>
                {categories.map(cat => (
                  <div 
                    key={cat.id} 
                    className={`dropdown-item ${category === cat.id ? 'active' : ''}`}
                    onClick={() => { setCategory(cat.id); setIsDropdownOpen(false); }}
                  >
                    {cat.name}
                  </div>
                ))}
                <div className="dropdown-divider"></div>
                <div className="dropdown-section-title">{settings.language === 'tr' ? 'Türler' : 'Genres'}</div>
                {genres.map(genre => (
                  <div 
                    key={genre.id} 
                    className={`dropdown-item ${category === String(genre.id) ? 'active' : ''}`}
                    onClick={() => { setCategory(String(genre.id)); setIsDropdownOpen(false); }}
                  >
                    {genre.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="list-grid">
        {shows.map((show, index) => {
          const isLast = shows.length === index + 1;
          const placeholder = 'https://via.placeholder.com/500x750?text=No+Poster';
          const posterUrl = show.poster_path 
            ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
            : placeholder;

          return (
            <div 
              key={`${show.id}-${index}`} 
              className="movie-item" 
              onClick={() => handleInspect(show)}
              ref={isLast ? lastShowRef : null}
            >
              <div className="movie-card">
                <div className="card-rating">
                  <Star size={12} fill="var(--accent)" />
                  {typeof show.vote_average === 'number' ? show.vote_average.toFixed(1) : '--'}
                </div>
                <div 
                  className={`card-add ${myList.some(i => i.id === show.id) ? 'active' : ''}`} 
                  onClick={(e) => { e.stopPropagation(); onToggleMyList(show); }}
                >
                  {myList.some(i => i.id === show.id) ? <Check size={18} /> : <Plus size={18} />}
                </div>
                <img 
                  src={posterUrl} 
                  alt={show.name} 
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = placeholder;
                  }}
                />
                <div className="card-overlay">
                </div>
              </div>
              <span className="movie-title-below">
                {show.name} {show.first_air_date ? `(${new Date(show.first_air_date).getFullYear()})` : ''}
              </span>
            </div>
          );
        })}
      </div>
      {loading && (
        <div className="loading-more">
          {shows.length === 0 ? (settings.language === 'tr' ? 'Yukleniyor...' : 'Loading...') : (settings.language === 'tr' ? 'Daha fazla yukleniyor...' : 'Loading more...')}
        </div>
      )}
      {!loading && shows.length === 0 && (
        <div className="no-results">
          {emptyMessage}
        </div>
      )}
    </div>
  );
};

export default TVShowsView;
