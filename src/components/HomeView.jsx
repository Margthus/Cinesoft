import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchTrending, fetchMovies, fetchTVShows } from '../utils/tmdb';
import { getAniListApiUrl } from '../utils/anilist';
import { Search, Plus, Info, Star, Check } from 'lucide-react';
import '../styles/HomeView.css';

const HomeView = ({ settings, myList, onToggleMyList }) => {
  const navigate = useNavigate();
  const [trending, setTrending] = useState([]);
  const [popularMovies, setPopularMovies] = useState([]);
  const [popularTV, setPopularTV] = useState([]);
  const [popularAnime, setPopularAnime] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      if (settings.apiKey) {
        // Fetch English data for posters and titles
        const enTrending = await fetchTrending(settings.apiKey, 'en', 'all', 1);
        const enPopularMovies = await fetchMovies(settings.apiKey, 'en', 'popular', 1);
        const enPopularTV = await fetchTVShows(settings.apiKey, 'en', 'popular', 1);
        
        let finalTrending = enTrending;
        let finalPopularMovies = enPopularMovies;
        let finalPopularTV = enPopularTV;

        // If Turkish is selected, fetch Turkish data to get overviews
        if (settings.language === 'tr') {
          const trTrending = await fetchTrending(settings.apiKey, 'tr', 'all', 1);
          const trPopularMovies = await fetchMovies(settings.apiKey, 'tr', 'popular', 1);
          const trPopularTV = await fetchTVShows(settings.apiKey, 'tr', 'popular', 1);

          // Merge: Keep EN title/poster, but use TR overview
          finalTrending = enTrending.map(enItem => {
            const trItem = trTrending.find(tr => tr.id === enItem.id);
            return { ...enItem, overview: trItem ? trItem.overview : enItem.overview };
          });

          finalPopularMovies = enPopularMovies.map(enItem => {
            const trItem = trPopularMovies.find(tr => tr.id === enItem.id);
            return { ...enItem, overview: trItem ? trItem.overview : enItem.overview };
          });

          finalPopularTV = enPopularTV.map(enItem => {
            const trItem = trPopularTV.find(tr => tr.id === enItem.id);
            return { ...enItem, overview: trItem ? trItem.overview : enItem.overview };
          });
        }
        
        setTrending(finalTrending);
        setPopularMovies(finalPopularMovies);
        setPopularTV(finalPopularTV);

        // Fetch popular anime from AniList
        try {
          const anilistQuery = `{
            Page(page: 1, perPage: 20) {
              media(sort: POPULARITY_DESC, type: ANIME, status_in: [RELEASING, FINISHED]) {
                id
                title { romaji english }
                coverImage { large }
                averageScore
                startDate { year }
                episodes
                externalCatalog: id
              }
            }
          }`;
          const aniRes = await fetch(getAniListApiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: anilistQuery }),
          });
          const aniData = await aniRes.json();
          const animeList = (aniData?.data?.Page?.media || []).map(a => ({
            id: `anilist-${a.id}`,
            anilistId: a.id,
            name: a.title.english || a.title.romaji,
            poster_path: null,
            poster_url: a.coverImage?.large,
            vote_average: a.averageScore ? a.averageScore / 10 : 0,
            first_air_date: a.startDate?.year ? `${a.startDate.year}-01-01` : null,
            episodes: a.episodes,
            externalCatalog: 'anilist',
            media_type: 'anime',
          }));
          setPopularAnime(animeList);
        } catch (e) {
          console.error('Anime fetch error', e);
        }
      }
    };
    loadData();
  }, [settings.apiKey, settings.language]);

  useEffect(() => {
    if (trending.length > 0) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % Math.min(trending.length, 10));
      }, 7000);
      return () => clearInterval(interval);
    }
  }, [trending]);

  const featured = trending[currentIndex];

  if (!settings.apiKey) {
    return (
      <div className="no-api">
        <h2>Welcome to CineSoft</h2>
        <p>Please enter your TMDB API Key in Settings to get started.</p>
      </div>
    );
  }

  const handleInspect = (item) => {
    if (item.media_type === 'anime' && item.anilistId) {
      navigate(`/detail/anime/${item.anilistId}`, { state: { fallbackItem: item } });
      return;
    }
    const type = item.media_type || (item.title ? 'movie' : 'tv');
    navigate(`/detail/${type}/${item.id}`);
  };

  const t = {
    tr: {
      popularMovies: 'Popüler Filmler',
      popularTV: 'Popüler Diziler',
      popularAnime: 'Popüler Animeler',
      inspect: 'İncele',
      addList: 'Listeme Ekle',
      removeList: 'Listemden Çıkar'
    },
    en: {
      popularMovies: 'Popular Movies',
      popularTV: 'Popular TV Shows',
      popularAnime: 'Popular Anime',
      inspect: 'Inspect',
      addList: 'Add to List',
      removeList: 'Remove from List'
    }
  }[settings.language];

  return (
    <div className="home-view">
      {featured && (
        <div 
          key={featured.id}
          className="hero"
          style={{
            backgroundImage: `linear-gradient(to top, var(--background), transparent), linear-gradient(to right, var(--background) 30%, transparent), url(https://image.tmdb.org/t/p/original${featured.backdrop_path})`
          }}
        >
          <div className="hero-content">
            <span className="hero-badge">{settings.language === 'tr' ? 'TREND' : 'TRENDING'}</span>
            <h1 className="hero-title">
              {featured.title || featured.name} {(featured.release_date || featured.first_air_date) ? `(${new Date(featured.release_date || featured.first_air_date).getFullYear()})` : ''}
            </h1>
            <p className="hero-overview">{featured.overview}</p>
            <div className="hero-buttons">
              <button className="btn btn-primary" onClick={() => handleInspect(featured)}>
                <Search size={20} /> {t.inspect}
              </button>
              <button 
                className={`btn ${myList.some(i => i.id === featured.id) ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onToggleMyList(featured)}
              >
                {myList.some(i => i.id === featured.id) ? (
                  <><Check size={20} /> {t.removeList}</>
                ) : (
                  <><Plus size={20} /> {t.addList}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rows-container">
        <MovieRow 
          title={t.popularMovies} 
          movies={popularMovies} 
          onSelect={handleInspect}
          myList={myList}
          onToggleMyList={onToggleMyList}
        />
        <MovieRow 
          title={t.popularTV} 
          movies={popularTV} 
          onSelect={handleInspect}
          myList={myList}
          onToggleMyList={onToggleMyList}
        />
        <MovieRow 
          title={t.popularAnime} 
          movies={popularAnime} 
          onSelect={handleInspect}
          myList={myList}
          onToggleMyList={onToggleMyList}
          isAnime
        />
      </div>
    </div>
  );
};

const MovieRow = ({ title, movies, onSelect, myList, onToggleMyList, isAnime }) => {
  return (
    <div className="movie-row">
      <h2 className="row-title">{title}</h2>
      <div className="movies-scroll">
        {movies.map(movie => (
          <div key={movie.id} className="movie-item" onClick={() => onSelect(movie)}>
            <div className="movie-card">
              <div className="card-rating">
                <Star size={12} fill="var(--accent)" />
                {movie.vote_average?.toFixed(1)}
              </div>
              <div 
                className={`card-add ${myList.some(i => i.id === movie.id) ? 'active' : ''}`} 
                onClick={(e) => { e.stopPropagation(); onToggleMyList(movie); }}
              >
                {myList.some(i => i.id === movie.id) ? <Check size={18} /> : <Plus size={18} />}
              </div>
              {isAnime && movie.poster_url ? (
                <img src={movie.poster_url} alt={movie.name} loading="lazy" />
              ) : (
                <img 
                  src={`https://image.tmdb.org/t/p/w500${movie.poster_path}`} 
                  alt={movie.title || movie.name} 
                  loading="lazy"
                />
              )}
              <div className="card-overlay">
              </div>
            </div>
            <span className="movie-title-below">
              {movie.title || movie.name} {(movie.release_date || movie.first_air_date) ? `(${new Date(movie.release_date || movie.first_air_date).getFullYear()})` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default HomeView;
