import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchDetails } from '../utils/tmdb';
import { getAniListApiUrl } from '../utils/anilist';
import { X, Plus, Star, Calendar, Clock, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import SourceSearchPanel from './SourceSearchPanel';
import '../styles/DetailView.css';

const DetailView = ({ settings, myList, onToggleMyList, setSearchState }) => {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState(null);

  const castScrollRef = useRef(null);
  const imageScrollRef = useRef(null);

  useEffect(() => {
    const loadDetails = async () => {
      const fallbackItem = location.state?.fallbackItem;

      // For anime, always fetch from AniList
      if (type === 'anime') {
        let hasResolvedData = false;
        try {
          setLoading(true);
          if (fallbackItem?.externalCatalog) {
            setData(fallbackItem);
            hasResolvedData = true;
          }

          const parsedRouteId = Number.parseInt(String(id), 10);
          const parsedFallbackId = Number.parseInt(String(fallbackItem?.anilistId || fallbackItem?.id || ''), 10);
          const animeId = Number.isFinite(parsedRouteId) ? parsedRouteId : parsedFallbackId;

          if (!Number.isFinite(animeId)) {
            if (!hasResolvedData) {
              setData(null);
            }
            return;
          }

          const query = `
            query MediaDetail($id: Int!) {
              Media(id: $id, type: ANIME) {
              id
              title { romaji english native }
              description(asHtml: false)
              coverImage { extraLarge large }
              bannerImage
              averageScore
              popularity
              startDate { year month day }
              endDate { year month day }
              episodes
              duration
              status
              genres
              studios { nodes { name isAnimationStudio } }
              characters(sort: ROLE, perPage: 12) {
                nodes {
                  id
                  name { full }
                  image { medium }
                  gender
                }
              }
              trailer { id site }
            }
            }
          `;
          const res = await fetch(getAniListApiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables: { id: animeId } }),
          });
          if (!res.ok) {
            throw new Error(`AniList request failed (${res.status})`);
          }
          const json = await res.json();
          if (Array.isArray(json?.errors) && json.errors.length > 0) {
            throw new Error(json.errors[0]?.message || 'AniList returned an error');
          }
          const m = json?.data?.Media;
          if (!m) throw new Error('No data');

          const startYear = m.startDate?.year;
          const endYear = m.endDate?.year;

          setData({
            id: m.id,
            anilistId: m.id,
            name: m.title.english || m.title.romaji,
            original_name: m.title.romaji,
            overview: (m.description || '').replace(/<[^>]+>/g, ''),
            poster_path: null,
            poster_url: m.coverImage?.extraLarge || m.coverImage?.large,
            backdrop_path: null,
            backdrop_url: m.bannerImage,
            vote_average: m.averageScore ? m.averageScore / 10 : 0,
            first_air_date: startYear ? `${startYear}-${String(m.startDate.month || 1).padStart(2, '0')}-${String(m.startDate.day || 1).padStart(2, '0')}` : null,
            last_air_date: endYear ? `${endYear}-${String(m.endDate.month || 1).padStart(2, '0')}-${String(m.endDate.day || 1).padStart(2, '0')}` : null,
            episodes: m.episodes,
            episode_run_time: m.duration ? [m.duration] : [],
            genres: (m.genres || []).map((g, i) => ({ id: i, name: g })),
            status: m.status,
            credits: {
              cast: (m.characters?.nodes || []).map(c => ({
                id: c.id,
                name: c.name?.full,
                character: '',
                profile_path: null,
                profile_url: c.image?.medium,
              }))
            },
            videos: m.trailer?.site === 'youtube' ? { results: [{ key: m.trailer.id, site: 'YouTube', type: 'Trailer' }] } : { results: [] },
            images: { posters: [], backdrops: [] },
            seasons: [{ season_number: 1, name: 'Season 1', episode_count: m.episodes || 0 }],
            studios: m.studios?.nodes?.filter(s => s.isAnimationStudio).map(s => s.name) || [],
            externalCatalog: 'anilist',
            media_type: 'anime',
          });
          hasResolvedData = true;
        } catch (err) {
          console.error('AniList detail error', err);
          if (!hasResolvedData && fallbackItem?.externalCatalog) {
            setData(fallbackItem);
            hasResolvedData = true;
          }
          if (!hasResolvedData) {
            setData(null);
          }
        } finally {
          setLoading(false);
        }
        return;
      }

      if (fallbackItem?.externalCatalog) {
        setData(fallbackItem);
        setLoading(false);
        return;
      }

      if (!settings.apiKey) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);

        // Always fetch English details for Title and Posters
        const enDetails = await fetchDetails(settings.apiKey, 'en', type, id);
        let finalDetails = enDetails;

        if (settings.language === 'tr') {
          // Fetch Turkish details for Overview and Genres
          const trDetails = await fetchDetails(settings.apiKey, 'tr', type, id);
          if (trDetails) {
            // Merge: Keep English Title/Poster, use Turkish Overview/Genres
            finalDetails = {
              ...enDetails,
              overview: trDetails.overview || enDetails.overview,
              genres: trDetails.genres || enDetails.genres
            };
          }
        }

        // Ensure English posters are used
        if (finalDetails.images && finalDetails.images.posters && finalDetails.images.posters.length > 0) {
          const enPoster = finalDetails.images.posters.find(p => p.iso_639_1 === 'en') || finalDetails.images.posters[0];
          if (enPoster) {
            finalDetails.poster_path = enPoster.file_path;
          }
        }

        // Fallback for videos
        if (settings.language === 'tr' && (!finalDetails.videos || finalDetails.videos.results.length === 0)) {
          const enVideos = await fetchDetails(settings.apiKey, 'en', type, id);
          if (enVideos && enVideos.videos) {
            finalDetails.videos = enVideos.videos;
          }
        }

        setData(finalDetails);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadDetails();
  }, [id, type, settings.apiKey, settings.language, location.state]);

  const scroll = (ref, direction) => {
    if (ref.current) {
      const scrollAmount = direction === 'left' ? -600 : 600;
      ref.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const nextImage = (e) => {
    e.stopPropagation();
    if (selectedImageIndex !== null) {
      const images = (data.images?.backdrops?.length > 0 ? data.images.backdrops : data.images?.posters)?.slice(0, 15);
      setSelectedImageIndex((prev) => (prev + 1) % images.length);
    }
  };

  const prevImage = (e) => {
    e.stopPropagation();
    if (selectedImageIndex !== null) {
      const images = (data.images?.backdrops?.length > 0 ? data.images.backdrops : data.images?.posters)?.slice(0, 15);
      setSelectedImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  const handleActorClick = (actorName) => {
    setSearchState({
      query: actorName,
      inputValue: actorName,
      results: []
    });
    navigate('/search');
  };

  if (loading) return <div className="loading">Loading details...</div>;
  if (!data) return <div className="error">Could not load details.</div>;

  const trailer = data.videos?.results?.find(v => v.type === 'Trailer' || v.type === 'Teaser');
  const filteredCast = data.credits?.cast?.filter(person => person.profile_path).slice(0, 30);
  const images = (data.images?.backdrops?.length > 0 ? data.images.backdrops : data.images?.posters)?.slice(0, 15);
  const title = settings.language === 'tr'
    ? (data.original_title || data.original_name || data.title || data.name)
    : (data.title || data.name || data.original_title || data.original_name);
  const yearValue = data.release_date || data.first_air_date;
  const year = yearValue ? new Date(yearValue).getFullYear() : null;
  const backdropUrl = resolveImageUrl(data.backdrop_path, 'original');
  const heroBackground = data.backdrop_path
    ? `linear-gradient(to top, var(--background) 10%, transparent), linear-gradient(to right, var(--background) 20%, transparent), url(${backdropUrl})`
    : 'linear-gradient(180deg, rgba(0, 255, 204, 0.08), transparent 60%), radial-gradient(circle at top right, rgba(255, 255, 255, 0.08), transparent 30%)';

  return (
    <div className="detail-view">
      <button className="close-btn" onClick={() => navigate(-1)}><X size={24} /></button>

      <div
        className="detail-hero"
        style={{
          backgroundImage: heroBackground,
        }}
      >
        <div className="detail-hero-content">
          <h1 className="detail-title">{title}</h1>
          <div className="detail-meta">
            <span className="rating"><Star size={16} fill="var(--accent)" color="var(--accent)" /> {typeof data.vote_average === 'number' ? data.vote_average.toFixed(1) : '--'}</span>
            {year ? <span className="year"><Calendar size={16} /> {year}</span> : null}
            {data.runtime ? <span className="runtime"><Clock size={16} /> {data.runtime} min</span> : null}
          </div>
          <div className="detail-genres">
            {data.genres?.map(genre => (
              <span key={genre.id} className="genre-badge">{genre.name}</span>
            ))}
          </div>
          <p className="detail-overview">{data.overview}</p>
          <div className="detail-buttons">
            <button
              className={`btn ${myList.some(i => i.id === data.id) ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onToggleMyList(data)}
            >
              {myList.some(i => i.id === data.id) ? (
                <><Check size={20} /> {settings.language === 'tr' ? 'Listemden Çıkar' : 'Remove from List'}</>
              ) : (
                <><Plus size={20} /> {settings.language === 'tr' ? 'Listeme Ekle' : 'Add to List'}</>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="detail-sections">
        <SourceSearchPanel item={data} type={type} settings={settings} />

        {filteredCast?.length > 0 && (
          <section className="detail-section">
            <div className="section-header">
              <h2>{settings.language === 'tr' ? 'Oyuncular' : 'Cast'}</h2>
              <div className="scroll-controls">
                <button onClick={() => scroll(castScrollRef, 'left')}><ChevronLeft size={24} /></button>
                <button onClick={() => scroll(castScrollRef, 'right')}><ChevronRight size={24} /></button>
              </div>
            </div>
            <div className="cast-scroll" ref={castScrollRef}>
              {filteredCast.map(person => (
                <div key={person.id} className="cast-card" onClick={() => handleActorClick(person.name)}>
                  <div className="cast-img">
                    <img src={`https://image.tmdb.org/t/p/w200${person.profile_path}`} alt={person.name} />
                  </div>
                  <span className="person-name">{person.name}</span>
                  <span className="person-character">{person.character}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {images?.length > 0 && (
          <section className="detail-section">
            <div className="section-header">
              <h2>{settings.language === 'tr' ? 'Görüntüler' : 'Images'}</h2>
              <div className="scroll-controls">
                <button onClick={() => scroll(imageScrollRef, 'left')}><ChevronLeft size={24} /></button>
                <button onClick={() => scroll(imageScrollRef, 'right')}><ChevronRight size={24} /></button>
              </div>
            </div>
            <div className="images-scroll" ref={imageScrollRef}>
              {images.map((img, i) => (
                <div key={i} className="image-card" onClick={() => setSelectedImageIndex(i)}>
                  <img src={`https://image.tmdb.org/t/p/w500${img.file_path}`} alt="Backdrop" />
                </div>
              ))}
            </div>
          </section>
        )}

        {trailer && (
          <section className="detail-section">
            <div className="section-header">
              <h2>{settings.language === 'tr' ? 'Fragman' : 'Trailer'}</h2>
            </div>
            <div className="video-container">
              <iframe
                src={`https://www.youtube.com/embed/${trailer.key}`}
                title="Trailer"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          </section>
        )}
      </div>

      {selectedImageIndex !== null && (
        <div className="lightbox" onClick={() => setSelectedImageIndex(null)}>
          <button className="lightbox-close" onClick={() => setSelectedImageIndex(null)}><X size={32} /></button>
          <button className="lightbox-nav prev" onClick={prevImage}><ChevronLeft size={48} /></button>
          <button className="lightbox-nav next" onClick={nextImage}><ChevronRight size={48} /></button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={`https://image.tmdb.org/t/p/original${images[selectedImageIndex].file_path}`}
              alt="Full Size"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const resolveImageUrl = (path, size = 'w500') => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
};

export default DetailView;
