import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Star, Check, Trash2 } from 'lucide-react';
import '../styles/ListView.css';

const MyListView = ({ settings, myList, onToggleMyList }) => {
  const navigate = useNavigate();

  const handleInspect = (item) => {
    const type = item.media_type || (item.title ? 'movie' : 'tv');
    if (item.externalCatalog) {
      navigate(`/detail/${type}/${encodeURIComponent(item.id)}`, {
        state: { fallbackItem: item },
      });
      return;
    }
    navigate(`/detail/${type}/${item.id}`);
  };

  const animes = myList.filter(item => item.media_type === 'anime');
  const movies = myList.filter(item => item.media_type === 'movie' || (!item.media_type && item.title));
  const tvShows = myList.filter(item => item.media_type === 'tv' || (!item.media_type && item.name && !item.title));

  const MovieGrid = ({ items, title }) => (
    <div className="list-section" style={{ marginBottom: '4rem' }}>
      <h2 style={{ marginBottom: '2rem', fontSize: '1.8rem' }}>{title}</h2>
      <div className="list-grid">
        {items.map(item => {
          const posterUrl = item.poster_path 
            ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w500${item.poster_path}`)
            : 'https://via.placeholder.com/500x750?text=No+Poster';

          return (
          <div key={item.id} className="movie-item" onClick={() => handleInspect(item)}>
            <div className="movie-card">
              <div className="card-rating">
                <Star size={12} fill="var(--accent)" />
                {typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : '--'}
              </div>
              <div className="card-add active" onClick={(e) => { e.stopPropagation(); onToggleMyList(item); }}>
                <Trash2 size={18} />
              </div>
              <img src={posterUrl} alt={item.title || item.name} />
              <div className="card-overlay"></div>
            </div>
            <span className="movie-title-below">
              {item.title || item.name} {(item.release_date || item.first_air_date) ? `(${new Date(item.release_date || item.first_air_date).getFullYear()})` : ''}
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="list-view">
      <div className="list-header">
        <h1>{settings.language === 'tr' ? 'Listem' : 'My List'}</h1>
      </div>

      {myList.length === 0 ? (
        <div className="no-results">
          <p>{settings.language === 'tr' ? 'Listeniz henüz boş.' : 'Your list is empty.'}</p>
        </div>
      ) : (
        <>
          {movies.length > 0 && (
            <MovieGrid 
              items={movies} 
              title={settings.language === 'tr' ? 'Filmler' : 'Movies'} 
            />
          )}
          {tvShows.length > 0 && (
            <MovieGrid 
              items={tvShows} 
              title={settings.language === 'tr' ? 'Diziler' : 'TV Shows'} 
            />
          )}
          {animes.length > 0 && (
            <MovieGrid 
              items={animes} 
              title={settings.language === 'tr' ? 'Animeler' : 'Anime'} 
            />
          )}
        </>
      )}
    </div>
  );
};

export default MyListView;
