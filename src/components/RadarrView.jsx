import React, { useEffect, useState } from 'react';
import '../styles/RadarrView.css';

const RadarrView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [removingId, setRemovingId] = useState(null);

  const loadMovies = async () => {
    if (!settings?.radarrEnabled || !settings?.radarrBaseUrl || !settings?.radarrApiKey) {
      setStatus('disabled');
      setItems([]);
      return;
    }
    setStatus('loading');
    try {
      const result = await window.electronAPI?.radarrGetMovies?.({
        radarrEnabled: settings.radarrEnabled === true,
        radarrBaseUrl: settings.radarrBaseUrl,
        radarrApiKey: settings.radarrApiKey,
        radarrTimeout: settings.radarrTimeout || 10000,
      });
      if (!result?.ok) {
        setStatus('error');
        setItems([]);
        return;
      }
      setItems(Array.isArray(result.items) ? result.items : []);
      setStatus('ready');
    } catch {
      setStatus('error');
      setItems([]);
    }
  };

  useEffect(() => {
    loadMovies();
  }, [settings?.radarrEnabled, settings?.radarrBaseUrl, settings?.radarrApiKey]);

  const handleRemove = async (movie) => {
    const id = Number(movie?.id || 0);
    if (!id) return;
    const title = movie?.title || 'movie';
    const confirmText = settings?.language === 'tr'
      ? `"${title}" Radarr listesinden kaldırılsın mı?`
      : `Remove "${title}" from Radarr?`;
    if (!window.confirm(confirmText)) return;

    setRemovingId(id);
    try {
      const result = await window.electronAPI?.radarrDeleteMovie?.({
        movieId: id,
        settings: {
          radarrBaseUrl: settings.radarrBaseUrl,
          radarrApiKey: settings.radarrApiKey,
          radarrTimeout: settings.radarrTimeout || 10000,
        },
        options: {
          deleteFiles: false,
          addImportExclusion: true,
        },
      });
      if (result?.ok) {
        setItems((prev) => prev.filter((entry) => Number(entry?.id) !== id));
      } else {
        alert(result?.error || 'Could not remove movie from Radarr.');
      }
    } catch {
      alert(settings?.language === 'tr' ? 'Film Radarr dan kaldırılamadı.' : 'Could not remove movie from Radarr.');
    } finally {
      setRemovingId(null);
    }
  };

  const t = settings?.language === 'tr'
    ? {
        title: 'Radarr',
        subtitle: "Radarr'a eklenen filmler",
        refresh: 'Yenile',
        remove: 'Kaldır',
        removing: 'Kaldırılıyor...',
        disabled: 'Radarr etkin değil veya bağlantı ayarları eksik.',
        error: 'Radarr film listesi alınamadı.',
        empty: 'Radarr içinde henüz film yok.',
        monitored: 'Takipte',
        unmonitored: 'Takipte değil',
      }
    : {
        title: 'Radarr',
        subtitle: 'Movies added to Radarr',
        refresh: 'Refresh',
        remove: 'Remove',
        removing: 'Removing...',
        disabled: 'Radarr is disabled or connection settings are missing.',
        error: 'Could not load Radarr movies.',
        empty: 'No movies found in Radarr.',
        monitored: 'Monitored',
        unmonitored: 'Unmonitored',
      };

  return (
    <div className="radarr-view">
      <header className="radarr-view-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" className="radarr-refresh-btn" onClick={loadMovies}>
          {t.refresh}
        </button>
      </header>

      {status === 'disabled' && <div className="radarr-note">{t.disabled}</div>}
      {status === 'error' && <div className="radarr-note radarr-note-error">{t.error}</div>}
      {status === 'ready' && items.length === 0 && <div className="radarr-note">{t.empty}</div>}

      {status === 'ready' && items.length > 0 && (
        <section className="radarr-grid">
          {items.map((movie) => {
            const title = movie?.title || movie?.sortTitle || 'Unknown';
            const year = movie?.year ? `(${movie.year})` : '';
            const poster = movie?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl || '';
            const monitored = movie?.monitored === true;
            const movieId = Number(movie?.id || 0);
            return (
              <article key={movieId || `${title}-${year}`} className="radarr-card">
                <div className="radarr-poster-wrap">
                  {poster ? <img src={poster} alt={title} className="radarr-poster" /> : <div className="radarr-poster-fallback">{title.slice(0, 1)}</div>}
                </div>
                <div className="radarr-meta">
                  <strong>{title} {year}</strong>
                  <span className={monitored ? 'ok' : 'off'}>{monitored ? t.monitored : t.unmonitored}</span>
                </div>
                <div className="radarr-card-actions">
                  <button
                    type="button"
                    className="radarr-remove-btn"
                    disabled={removingId === movieId}
                    onClick={() => handleRemove(movie)}
                  >
                    {removingId === movieId ? t.removing : t.remove}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};

export default RadarrView;
