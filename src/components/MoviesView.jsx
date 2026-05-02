import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMovies, fetchGenres, fetchByGenre, fetchByKeyword } from '../utils/tmdb';
import { Plus, Star, Check, ChevronDown, Filter } from 'lucide-react';
import '../styles/ListView.css';

const MoviesView = ({ settings, myList, onToggleMyList, movieState, setMovieState }) => {
  const navigate = useNavigate();
  const [movies, setMovies] = useState(movieState.movies);
  const [category, setCategory] = useState(movieState.category);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [page, setPage] = useState(movieState.page);
  const [hasMore, setHasMore] = useState(movieState.hasMore);

  useEffect(() => {
    const loadGenres = async () => {
      if (settings.apiKey) {
        const data = await fetchGenres(settings.apiKey, settings.language, 'movie');
        setGenres(data);
      }
    };
    loadGenres();
  }, [settings.apiKey, settings.language]);

  // Restore scroll
  useEffect(() => {
    if (movies.length > 0 && movieState.scrollY > 0) {
      const timer = setTimeout(() => {
        const container = document.querySelector('.main-content');
        if (container) {
          container.scrollTo({ top: movieState.scrollY, behavior: 'instant' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [movies.length]);

  // Save state on change
  useEffect(() => {
    setMovieState(prev => ({ ...prev, movies, page, category, hasMore }));
  }, [movies, page, category, hasMore]);

  // Handle scroll saving
  useEffect(() => {
    const container = document.querySelector('.main-content');
    const handleScroll = () => {
      if (container) {
        setMovieState(prev => ({ ...prev, scrollY: container.scrollTop }));
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
    if (category !== movieState.category) {
      setMovies([]);
      setPage(1);
      setHasMore(true);
    }
  }, [category]);

  useEffect(() => {
    const load = async () => {
      if (!settings.apiKey || !hasMore || (page === movieState.page && movies.length > 0 && category === movieState.category)) {
        return;
      }
      try {
        setLoading(true);
        let data;
        if (category === 'zombie') {
          data = await fetchByKeyword(settings.apiKey, 'en', 'movie', 12377, page);
        } else if (!isNaN(category)) {
          data = await fetchByGenre(settings.apiKey, 'en', 'movie', category, page);
        } else {
          data = await fetchMovies(settings.apiKey, 'en', category, page);
        }
        
        if (data.length === 0) {
          setHasMore(false);
        } else {
          setMovies(prev => page === 1 ? data : [...prev, ...data]);
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
  const lastMovieRef = React.useCallback(node => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prev => prev + 1);
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const handleInspect = (movie) => {
    if (movie.externalCatalog) {
      navigate(`/detail/movie/${encodeURIComponent(movie.id)}`, {
        state: { fallbackItem: movie },
      });
      return;
    }
    navigate(`/detail/movie/${movie.id}`);
  };

  const categories = [
    { id: 'popular', name: settings.language === 'tr' ? 'Popüler' : 'Popular' },
    { id: 'top_rated', name: settings.language === 'tr' ? 'En Çok Oy Alanlar' : 'Top Rated' },
    { id: 'upcoming', name: settings.language === 'tr' ? 'Yakında' : 'Upcoming' },
    { id: 'zombie', name: settings.language === 'tr' ? 'Zombi' : 'Zombie' },
  ];

  const currentCategoryName = categories.find(c => c.id === category)?.name || 
                        genres.find(g => String(g.id) === category)?.name || '';
  const emptyMessage = settings.language === 'tr' ? 'Bu kategori icin sonuc bulunamadi.' : 'No titles were found for this category.';

  return (
    <div className="list-view">
      <div className="list-header">
        <h1>{settings.language === 'tr' ? 'Filmler' : 'Movies'}</h1>
        
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
        {movies.map((movie, index) => {
          const isLast = movies.length === index + 1;
          const placeholder = 'https://via.placeholder.com/500x750?text=No+Poster';
          const posterUrl = movie.poster_path 
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : placeholder;
            
          return (
            <div 
              key={`${movie.id}-${index}`} 
              className="movie-item" 
              onClick={() => handleInspect(movie)}
              ref={isLast ? lastMovieRef : null}
            >
              <div className="movie-card">
                <div className="card-rating">
                  <Star size={12} fill="var(--accent)" />
                  {typeof movie.vote_average === 'number' ? movie.vote_average.toFixed(1) : '--'}
                </div>
                <div 
                  className={`card-add ${myList.some(i => i.id === movie.id) ? 'active' : ''}`} 
                  onClick={(e) => { e.stopPropagation(); onToggleMyList(movie); }}
                >
                  {myList.some(i => i.id === movie.id) ? <Check size={18} /> : <Plus size={18} />}
                </div>
                <img 
                  src={posterUrl} 
                  alt={movie.title} 
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = placeholder;
                  }}
                />
                <div className="card-overlay">
                </div>
              </div>
              <span className="movie-title-below">
                {movie.title} {movie.release_date ? `(${new Date(movie.release_date).getFullYear()})` : ''}
              </span>
            </div>
          );
        })}
      </div>
      {loading && (
        <div className="loading-more">
          {movies.length === 0 ? (settings.language === 'tr' ? 'Yukleniyor...' : 'Loading...') : (settings.language === 'tr' ? 'Daha fazla yukleniyor...' : 'Loading more...')}
        </div>
      )}
      {!loading && movies.length === 0 && (
        <div className="no-results">
          {emptyMessage}
        </div>
      )}
    </div>
  );
};

export default MoviesView;
