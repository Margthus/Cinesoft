import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Star, Check, Trash2 } from 'lucide-react';
import PosterStatusMenu, { PosterStatusBadge } from './PosterStatusMenu';
import { buildWatchStatusKey } from '../utils/watchStatus';
import '../styles/ListView.css';

const MyListView = ({ settings, myList, onToggleMyList, watchStatusMap, onSetWatchStatus }) => {
  const navigate = useNavigate();
  const [statusMenu, setStatusMenu] = useState({ open: false, x: 0, y: 0, item: null, fallbackType: '', status: '' });

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

  const getItemStatus = (item, fallbackType = '') => {
    const key = buildWatchStatusKey(item, fallbackType);
    return key ? (watchStatusMap?.[key] || '') : '';
  };

  const openStatusMenu = (event, item, fallbackType = '') => {
    event.preventDefault();
    setStatusMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      item,
      fallbackType,
      status: getItemStatus(item, fallbackType),
    });
  };

  const closeStatusMenu = () => setStatusMenu({ open: false, x: 0, y: 0, item: null, fallbackType: '', status: '' });

  const applyStatus = (status) => {
    if (!statusMenu.item) return;
    onSetWatchStatus(statusMenu.item, status, statusMenu.fallbackType);
    closeStatusMenu();
  };

  const MovieGrid = ({ items, title, fallbackType }) => (
    <div className="list-section" style={{ marginBottom: '4rem' }}>
      <h2 style={{ marginBottom: '2rem', fontSize: '1.8rem' }}>{title}</h2>
      <div className="list-grid">
        {items.map(item => {
          const posterUrl = item.poster_path 
            ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w500${item.poster_path}`)
            : 'https://via.placeholder.com/500x750?text=No+Poster';

          return (
          <div key={item.id} className="movie-item" onClick={() => handleInspect(item)} onContextMenu={(event) => openStatusMenu(event, item, fallbackType)}>
            <div className="movie-card">
              <div className="card-rating">
                <Star size={12} fill="var(--accent)" />
                {typeof item.vote_average === 'number' ? item.vote_average.toFixed(1) : '--'}
              </div>
              <div className="card-add active" onClick={(e) => { e.stopPropagation(); onToggleMyList(item); }}>
                <Trash2 size={18} />
              </div>
              <img src={posterUrl} alt={item.title || item.name} />
              <PosterStatusBadge status={getItemStatus(item, fallbackType)} language={settings.language} />
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
              fallbackType="movie"
            />
          )}
          {tvShows.length > 0 && (
            <MovieGrid 
              items={tvShows} 
              title={settings.language === 'tr' ? 'Diziler' : 'TV Shows'} 
              fallbackType="tv"
            />
          )}
          {animes.length > 0 && (
            <MovieGrid 
              items={animes} 
              title={settings.language === 'tr' ? 'Animeler' : 'Anime'} 
              fallbackType="anime"
            />
          )}
        </>
      )}
      <PosterStatusMenu state={statusMenu} language={settings.language} onClose={closeStatusMenu} onSelect={applyStatus} />
    </div>
  );
};

export default MyListView;
