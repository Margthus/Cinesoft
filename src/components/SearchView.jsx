import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchContent, fetchPersonCredits } from '../utils/tmdb';
import { Star, Plus, Check, Search, X } from 'lucide-react';
import '../styles/ListView.css';

const SearchView = ({ settings, myList, onToggleMyList, searchState, setSearchState }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const performSearch = async () => {
      if (!searchState.query || !settings.apiKey) {
        return;
      }
      
      try {
        setLoading(true);
        // Always search in English for titles and posters
        const data = await searchContent(settings.apiKey, 'en', searchState.query, 1);
        
        let allResults = [];
        
        // Fetch full credits for people results in English
        const resultPromises = data.map(async (item) => {
          if (item.media_type === 'person') {
            const credits = await fetchPersonCredits(settings.apiKey, 'en', item.id, 1);
            return credits;
          }
          return [item];
        });

        const resultsArrays = await Promise.all(resultPromises);
        allResults = resultsArrays.flat();

        // Filter: only movies/tv with posters, and remove duplicates by ID
        const uniqueResults = [];
        const seenIds = new Set();
        
        allResults.forEach(item => {
          if (item && (item.media_type === 'movie' || item.media_type === 'tv' || item.title || item.name) && 
              item.poster_path && 
              !seenIds.has(item.id)) {
            uniqueResults.push(item);
            seenIds.add(item.id);
          }
        });

        // Sort by popularity to show most relevant stuff first
        uniqueResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        setSearchState(prev => ({ ...prev, results: uniqueResults }));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    performSearch();
  }, [searchState.query, settings.apiKey, setSearchState]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (searchState.inputValue.trim()) {
      setSearchState(prev => ({ ...prev, query: searchState.inputValue.trim() }));
    }
  };

  const handleInspect = (item) => {
    const type = item.media_type || (item.title ? 'movie' : 'tv');
    navigate(`/detail/${type}/${item.id}`);
  };

  const t = {
    tr: { title: 'Arama', placeholder: 'Film veya dizi ara...', noResults: 'Sonuç bulunamadı.', loading: 'Aranıyor...' },
    en: { title: 'Search', placeholder: 'Search for movies or tv shows...', noResults: 'No results found.', loading: 'Searching...' }
  }[settings.language];

  return (
    <div className="list-view">
      <div className="list-header search-page-header">
        <h1>{t.title}</h1>
        <form className="search-page-form" onSubmit={handleSearchSubmit}>
          <Search size={24} className="search-icon" />
          <input 
            ref={inputRef}
            type="text" 
            placeholder={t.placeholder}
            value={searchState.inputValue}
            onChange={(e) => setSearchState(prev => ({ ...prev, inputValue: e.target.value }))}
          />
          {searchState.inputValue && (
            <button type="button" className="clear-search-btn" onClick={() => setSearchState({ query: '', results: [], inputValue: '' })}>
              <X size={20} />
            </button>
          )}
        </form>
      </div>

      {loading ? (
        <div className="loading">{t.loading}</div>
      ) : searchState.results.length > 0 ? (
        <div className="list-grid">
          {searchState.results.map(item => (
            <div key={item.id} className="movie-item" onClick={() => handleInspect(item)}>
              <div className="movie-card">
                <div className="card-rating">
                  <Star size={12} fill="var(--accent)" />
                  {item.vote_average?.toFixed(1)}
                </div>
                <div 
                  className={`card-add ${myList.some(i => i.id === item.id) ? 'active' : ''}`} 
                  onClick={(e) => { e.stopPropagation(); onToggleMyList(item); }}
                >
                  {myList.some(i => i.id === item.id) ? <Check size={18} /> : <Plus size={18} />}
                </div>
                <img 
                  src={`https://image.tmdb.org/t/p/w500${item.poster_path}`} 
                  alt={item.title || item.name} 
                />
                <div className="card-overlay">
                </div>
              </div>
              <span className="movie-title-below">
                {item.title || item.name} {(item.release_date || item.first_air_date) ? `(${new Date(item.release_date || item.first_air_date).getFullYear()})` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-results">
          {searchState.query ? t.noResults : ''}
        </div>
      )}
    </div>
  );
};

export default SearchView;
