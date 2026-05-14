import React, { useEffect, useState } from 'react';
import '../styles/RadarrView.css';

const normalizeMediaText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findBestQbTorrentForMovie = (movie, torrents = []) => {
  const title = normalizeMediaText(movie?.title || movie?.sortTitle || '');
  if (!title) return null;
  const year = String(movie?.year || '').trim();
  const titleTokens = title.split(' ').filter((token) => token.length >= 3);

  let best = null;
  let bestScore = 0;
  for (const torrent of torrents) {
    const name = normalizeMediaText(torrent?.name || '');
    if (!name) continue;
    let score = 0;
    if (name.includes(title)) score += 5;
    for (const token of titleTokens) {
      if (name.includes(token)) score += 1;
    }
    if (year && name.includes(year)) score += 2;
    if (String(torrent?.state || '').toLowerCase().includes('dl')) score += 1;
    if (score > bestScore) {
      best = torrent;
      bestScore = score;
    }
  }

  if (!best || bestScore < 4) return null;
  return best;
};

const RadarrView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [removingId, setRemovingId] = useState(null);
  const [editingMovie, setEditingMovie] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [editRootFolder, setEditRootFolder] = useState('');
  const [editQualityProfileId, setEditQualityProfileId] = useState('');
  const [editMonitored, setEditMonitored] = useState(true);
  const [qbProgressByMovie, setQbProgressByMovie] = useState({});

  const getRadarrConnectionSettings = () => ({
    radarrEnabled: settings.radarrEnabled === true,
    radarrBaseUrl: settings.radarrBaseUrl,
    radarrApiKey: settings.radarrApiKey,
    radarrTimeout: settings.radarrTimeout || 10000,
  });

  const loadMovies = async ({ silent = false } = {}) => {
    if (!settings?.radarrEnabled || !settings?.radarrBaseUrl || !settings?.radarrApiKey) {
      setStatus('disabled');
      setItems([]);
      return;
    }
    if (!silent) setStatus('loading');
    try {
      const result = await window.electronAPI?.radarrGetMovies?.(getRadarrConnectionSettings());
      if (!result?.ok) {
        setStatus('error');
        setItems([]);
        return;
      }
      const nextItems = Array.isArray(result.items) ? result.items : [];
      setItems(nextItems);
      setStatus('ready');
      refreshQbProgress(nextItems).catch(() => {});
    } catch {
      setStatus('error');
      setItems([]);
    }
  };

  useEffect(() => {
    loadMovies();
  }, [settings?.radarrEnabled, settings?.radarrBaseUrl, settings?.radarrApiKey]);

  const refreshQbProgress = async (moviesArg) => {
    const movies = Array.isArray(moviesArg) ? moviesArg : items;
    if (!movies.length || settings?.qbittorrentEnabled === false) {
      setQbProgressByMovie({});
      return;
    }
    const qbConfig = settings?.qbittorrent || {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    };
    const result = await window.electronAPI?.qbittorrentGetTorrents?.(qbConfig);
    if (!result?.ok || !Array.isArray(result.items)) {
      setQbProgressByMovie({});
      return;
    }

    const map = {};
    for (const movie of movies) {
      const match = findBestQbTorrentForMovie(movie, result.items);
      if (!match) continue;
      const movieId = Number(movie?.id || 0);
      if (!movieId) continue;
      map[movieId] = {
        progress: Math.max(0, Math.min(100, Number(match.progress || 0))),
      };
    }
    setQbProgressByMovie(map);
  };

  useEffect(() => {
    if (status !== 'ready' || !items.length) return undefined;
    const timer = setInterval(() => {
      refreshQbProgress(items).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [status, items, settings?.qbittorrentEnabled, settings?.qbittorrent?.baseUrl, settings?.qbittorrent?.username, settings?.qbittorrent?.password]);

  useEffect(() => {
    if (!settings?.radarrEnabled || !settings?.radarrBaseUrl || !settings?.radarrApiKey) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadMovies({ silent: true }).catch(() => {});
    }, 7000);
    return () => clearInterval(timer);
  }, [settings?.radarrEnabled, settings?.radarrBaseUrl, settings?.radarrApiKey]);

  const handleRemove = async (movie) => {
    const id = Number(movie?.id || 0);
    if (!id) return;
    const title = movie?.title || 'movie';
    const confirmText = settings?.language === 'tr'
      ? `"${title}" Radarr listesinden kaldirilsin mi?`
      : `Remove "${title}" from Radarr?`;
    if (!window.confirm(confirmText)) return;

    setRemovingId(id);
    try {
      const result = await window.electronAPI?.radarrDeleteMovie?.({
        movieId: id,
        settings: getRadarrConnectionSettings(),
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
      alert(settings?.language === 'tr' ? 'Film Radarrdan kaldirilamadi.' : 'Could not remove movie from Radarr.');
    } finally {
      setRemovingId(null);
    }
  };

  const openEditModal = async (movie) => {
    setEditingMovie(movie || null);
    setEditLoading(true);
    setEditRootFolder(String(movie?.rootFolderPath || ''));
    setEditQualityProfileId(String(movie?.qualityProfileId ?? ''));
    setEditMonitored(movie?.monitored === true);
    try {
      const [rootRes, qualityRes] = await Promise.all([
        window.electronAPI?.radarrGetRootFolders?.(getRadarrConnectionSettings()),
        window.electronAPI?.radarrGetQualityProfiles?.(getRadarrConnectionSettings()),
      ]);
      const roots = Array.isArray(rootRes?.items) ? rootRes.items : [];
      const profiles = Array.isArray(qualityRes?.items) ? qualityRes.items : [];
      setRootFolders(roots);
      setQualityProfiles(profiles);
      if (!String(movie?.rootFolderPath || '') && roots[0]?.path) {
        setEditRootFolder(roots[0].path);
      }
      if ((movie?.qualityProfileId == null || movie?.qualityProfileId === '') && profiles[0]?.id != null) {
        setEditQualityProfileId(String(profiles[0].id));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const closeEditModal = () => {
    setEditingMovie(null);
    setRootFolders([]);
    setQualityProfiles([]);
    setEditRootFolder('');
    setEditQualityProfileId('');
    setEditMonitored(true);
    setEditLoading(false);
  };

  const handleSaveEdit = async () => {
    const movieId = Number(editingMovie?.id || 0);
    if (!movieId || !editRootFolder || !editQualityProfileId) return;
    setEditLoading(true);
    try {
      const result = await window.electronAPI?.radarrUpdateMovie?.({
        movieId,
        settings: getRadarrConnectionSettings(),
        movie: {
          rootFolderPath: String(editRootFolder || ''),
          qualityProfileId: Number(editQualityProfileId),
          monitored: editMonitored === true,
        },
      });
      if (!result?.ok) {
        alert(result?.error || 'Could not update movie in Radarr.');
        return;
      }
      setItems((prev) => prev.map((entry) => (
        Number(entry?.id) === movieId
          ? {
              ...entry,
              rootFolderPath: String(editRootFolder || entry?.rootFolderPath || ''),
              qualityProfileId: Number(editQualityProfileId),
              monitored: editMonitored === true,
            }
          : entry
      )));
      closeEditModal();
    } catch {
      alert(settings?.language === 'tr' ? 'Film ayarlari guncellenemedi.' : 'Could not update movie settings.');
    } finally {
      setEditLoading(false);
    }
  };

  const t = settings?.language === 'tr'
    ? {
        title: 'Radarr',
        subtitle: "Radarra eklenen filmler",
        refresh: 'Yenile',
        remove: 'Kaldir',
        edit: 'Duzenle',
        removing: 'Kaldiriliyor...',
        save: 'Kaydet',
        cancel: 'Iptal',
        rootFolder: 'Root Folder',
        qualityProfile: 'Kalite Profili',
        monitoredEdit: 'Takipte',
        downloadProgress: 'Indirme',
        loading: 'Yukleniyor...',
        selectRoot: 'Root folder sec',
        selectQuality: 'Kalite profili sec',
        disabled: 'Radarr etkin degil veya baglanti ayarlari eksik.',
        error: 'Radarr film listesi alinamadi.',
        empty: 'Radarr icinde henuz film yok.',
        monitored: 'Takipte',
        unmonitored: 'Takipte degil',
      }
    : {
        title: 'Radarr',
        subtitle: 'Movies added to Radarr',
        refresh: 'Refresh',
        remove: 'Remove',
        edit: 'Edit',
        removing: 'Removing...',
        save: 'Save',
        cancel: 'Cancel',
        rootFolder: 'Root Folder',
        qualityProfile: 'Quality Profile',
        monitoredEdit: 'Monitored',
        downloadProgress: 'Download',
        loading: 'Loading...',
        selectRoot: 'Select root folder',
        selectQuality: 'Select quality profile',
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
            const qbProgress = qbProgressByMovie[movieId];
            const hasQbProgress = qbProgress && Number.isFinite(Number(qbProgress.progress));
            return (
              <article key={movieId || `${title}-${year}`} className="radarr-card">
                <div className="radarr-poster-wrap">
                  {poster ? <img src={poster} alt={title} className="radarr-poster" /> : <div className="radarr-poster-fallback">{title.slice(0, 1)}</div>}
                </div>
                {hasQbProgress && (
                  <div className="radarr-progress-wrap" aria-label={`${t.downloadProgress} ${Math.round(qbProgress.progress)}%`}>
                    <div className="radarr-progress-track">
                      <div className="radarr-progress-fill" style={{ width: `${qbProgress.progress}%` }} />
                    </div>
                    <span className="radarr-progress-text">{Math.round(qbProgress.progress)}%</span>
                  </div>
                )}
                <div className="radarr-meta">
                  <strong>{title} {year}</strong>
                  <span className={monitored ? 'ok' : 'off'}>{monitored ? t.monitored : t.unmonitored}</span>
                </div>
                <div className="radarr-card-actions">
                  <button
                    type="button"
                    className="radarr-edit-btn"
                    disabled={removingId === movieId}
                    onClick={() => openEditModal(movie)}
                  >
                    {t.edit}
                  </button>
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

      {editingMovie && (
        <div className="lightbox" onClick={closeEditModal}>
          <div className="radarr-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="radarr-modal-header">
              <h3>{t.edit}</h3>
            </div>
            {editLoading ? (
              <p>{t.loading}</p>
            ) : (
              <div className="radarr-modal-body">
                <label>
                  <span>{t.rootFolder}</span>
                  <select value={editRootFolder} onChange={(event) => setEditRootFolder(event.target.value)}>
                    <option value="">{t.selectRoot}</option>
                    {rootFolders.map((folder) => (
                      <option key={folder.id || folder.path} value={folder.path}>{folder.path}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t.qualityProfile}</span>
                  <select value={String(editQualityProfileId)} onChange={(event) => setEditQualityProfileId(event.target.value)}>
                    <option value="">{t.selectQuality}</option>
                    {qualityProfiles.map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>{profile.name}</option>
                    ))}
                  </select>
                </label>
                <label className="radarr-check">
                  <input type="checkbox" checked={editMonitored} onChange={(event) => setEditMonitored(event.target.checked)} />
                  <span>{t.monitoredEdit}</span>
                </label>
                <div className="radarr-modal-actions">
                  <button className="btn btn-secondary" onClick={closeEditModal}>{t.cancel}</button>
                  <button className="btn btn-primary" onClick={handleSaveEdit} disabled={editLoading}>{t.save}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RadarrView;
