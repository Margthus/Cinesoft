import React, { useEffect, useState } from 'react';
import '../styles/RadarrView.css';

const normalizeMediaText = (value = '') => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findBestQbTorrentForSeries = (series, torrents = []) => {
  const title = normalizeMediaText(series?.title || series?.sortTitle || '');
  if (!title) return null;
  const year = String(series?.year || '').trim();
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

const SonarrView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [removingId, setRemovingId] = useState(null);
  const [editingSeries, setEditingSeries] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [rootFolders, setRootFolders] = useState([]);
  const [qualityProfiles, setQualityProfiles] = useState([]);
  const [editRootFolder, setEditRootFolder] = useState('');
  const [editQualityProfileId, setEditQualityProfileId] = useState('');
  const [editMonitored, setEditMonitored] = useState(true);
  const [qbProgressBySeries, setQbProgressBySeries] = useState({});
  const [expandedSeriesId, setExpandedSeriesId] = useState(null);
  const [episodesBySeries, setEpisodesBySeries] = useState({});
  const [episodesLoadingBySeries, setEpisodesLoadingBySeries] = useState({});
  const [selectedSeasonBySeries, setSelectedSeasonBySeries] = useState({});
  const [selectedEpisodeIdsBySeries, setSelectedEpisodeIdsBySeries] = useState({});

  const getSonarrConnectionSettings = () => ({
    sonarrEnabled: settings.sonarrEnabled === true,
    sonarrBaseUrl: settings.sonarrBaseUrl,
    sonarrApiKey: settings.sonarrApiKey,
    sonarrTimeout: settings.sonarrTimeout || 10000,
  });

  const loadSeries = async ({ silent = false } = {}) => {
    if (!settings?.sonarrEnabled || !settings?.sonarrBaseUrl || !settings?.sonarrApiKey) {
      setStatus('disabled');
      setItems([]);
      return;
    }
    if (!silent) setStatus('loading');
    try {
      const result = await window.electronAPI?.sonarrGetSeries?.(getSonarrConnectionSettings());
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
    loadSeries();
  }, [settings?.sonarrEnabled, settings?.sonarrBaseUrl, settings?.sonarrApiKey]);

  const refreshQbProgress = async (seriesArg) => {
    const seriesList = Array.isArray(seriesArg) ? seriesArg : items;
    if (!seriesList.length || settings?.qbittorrentEnabled === false) {
      setQbProgressBySeries({});
      return;
    }
    const qbConfig = settings?.qbittorrent || {
      baseUrl: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'adminadmin',
    };
    const result = await window.electronAPI?.qbittorrentGetTorrents?.(qbConfig);
    if (!result?.ok || !Array.isArray(result.items)) {
      setQbProgressBySeries({});
      return;
    }

    const map = {};
    for (const series of seriesList) {
      const match = findBestQbTorrentForSeries(series, result.items);
      if (!match) continue;
      const seriesId = Number(series?.id || 0);
      if (!seriesId) continue;
      map[seriesId] = {
        progress: Math.max(0, Math.min(100, Number(match.progress || 0))),
      };
    }
    setQbProgressBySeries(map);
  };

  useEffect(() => {
    if (status !== 'ready' || !items.length) return undefined;
    const timer = setInterval(() => {
      refreshQbProgress(items).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [status, items, settings?.qbittorrentEnabled, settings?.qbittorrent?.baseUrl, settings?.qbittorrent?.username, settings?.qbittorrent?.password]);

  useEffect(() => {
    if (!settings?.sonarrEnabled || !settings?.sonarrBaseUrl || !settings?.sonarrApiKey) return undefined;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadSeries({ silent: true }).catch(() => {});
    }, 7000);
    return () => clearInterval(timer);
  }, [settings?.sonarrEnabled, settings?.sonarrBaseUrl, settings?.sonarrApiKey]);

  const handleRemove = async (series) => {
    const id = Number(series?.id || 0);
    if (!id) return;
    const title = series?.title || 'series';
    const confirmText = settings?.language === 'tr'
      ? `"${title}" Sonarr listesinden kaldirilsin mi?`
      : `Remove "${title}" from Sonarr?`;
    if (!window.confirm(confirmText)) return;

    setRemovingId(id);
    try {
      const result = await window.electronAPI?.sonarrDeleteSeries?.({
        seriesId: id,
        settings: getSonarrConnectionSettings(),
        options: {
          deleteFiles: false,
          addImportListExclusion: true,
        },
      });
      if (result?.ok) {
        setItems((prev) => prev.filter((entry) => Number(entry?.id) !== id));
      } else {
        alert(result?.error || 'Could not remove series from Sonarr.');
      }
    } catch {
      alert(settings?.language === 'tr' ? 'Dizi Sonarrdan kaldirilamadi.' : 'Could not remove series from Sonarr.');
    } finally {
      setRemovingId(null);
    }
  };

  const openEditModal = async (series) => {
    setEditingSeries(series || null);
    setEditLoading(true);
    setEditRootFolder(String(series?.rootFolderPath || ''));
    setEditQualityProfileId(String(series?.qualityProfileId ?? ''));
    setEditMonitored(series?.monitored === true);
    try {
      const [rootRes, qualityRes] = await Promise.all([
        window.electronAPI?.sonarrGetRootFolders?.(getSonarrConnectionSettings()),
        window.electronAPI?.sonarrGetQualityProfiles?.(getSonarrConnectionSettings()),
      ]);
      const roots = Array.isArray(rootRes?.items) ? rootRes.items : [];
      const profiles = Array.isArray(qualityRes?.items) ? qualityRes.items : [];
      setRootFolders(roots);
      setQualityProfiles(profiles);
      if (!String(series?.rootFolderPath || '') && roots[0]?.path) {
        setEditRootFolder(roots[0].path);
      }
      if ((series?.qualityProfileId == null || series?.qualityProfileId === '') && profiles[0]?.id != null) {
        setEditQualityProfileId(String(profiles[0].id));
      }
    } finally {
      setEditLoading(false);
    }
  };

  const closeEditModal = () => {
    setEditingSeries(null);
    setRootFolders([]);
    setQualityProfiles([]);
    setEditRootFolder('');
    setEditQualityProfileId('');
    setEditMonitored(true);
    setEditLoading(false);
  };

  const handleSaveEdit = async () => {
    const seriesId = Number(editingSeries?.id || 0);
    if (!seriesId || !editRootFolder || !editQualityProfileId) return;
    setEditLoading(true);
    try {
      const result = await window.electronAPI?.sonarrUpdateSeries?.({
        seriesId,
        settings: getSonarrConnectionSettings(),
        series: {
          rootFolderPath: String(editRootFolder || ''),
          qualityProfileId: Number(editQualityProfileId),
          monitored: editMonitored === true,
        },
      });
      if (!result?.ok) {
        alert(result?.error || 'Could not update series in Sonarr.');
        return;
      }
      setItems((prev) => prev.map((entry) => (
        Number(entry?.id) === seriesId
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
      alert(settings?.language === 'tr' ? 'Dizi ayarlari guncellenemedi.' : 'Could not update series settings.');
    } finally {
      setEditLoading(false);
    }
  };

  const loadEpisodes = async (seriesId) => {
    const id = Number(seriesId || 0);
    if (!id) return;
    if (episodesLoadingBySeries[id]) return;
    setEpisodesLoadingBySeries((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await window.electronAPI?.sonarrGetEpisodes?.({
        seriesId: id,
        settings: getSonarrConnectionSettings(),
      });
      const itemsList = Array.isArray(result?.items) ? result.items : [];
      const sorted = itemsList
        .slice()
        .sort((a, b) => {
          const sa = Number(a?.seasonNumber || 0);
          const sb = Number(b?.seasonNumber || 0);
          if (sa !== sb) return sa - sb;
          return Number(a?.episodeNumber || 0) - Number(b?.episodeNumber || 0);
        });
      setEpisodesBySeries((prev) => ({ ...prev, [id]: sorted }));
      const firstSeason = sorted.find((ep) => Number(ep?.seasonNumber || 0) > 0)?.seasonNumber;
      if (firstSeason != null) {
        setSelectedSeasonBySeries((prev) => {
          if (prev[id] != null) return prev;
          return { ...prev, [id]: Number(firstSeason) };
        });
      }
    } catch {
      setEpisodesBySeries((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setEpisodesLoadingBySeries((prev) => ({ ...prev, [id]: false }));
    }
  };

  const toggleSeriesExpand = async (seriesId) => {
    const id = Number(seriesId || 0);
    if (!id) return;
    if (expandedSeriesId === id) {
      setExpandedSeriesId(null);
      return;
    }
    setExpandedSeriesId(id);
    if (!Array.isArray(episodesBySeries[id])) {
      await loadEpisodes(id);
    }
  };

  const toggleEpisodeSelection = (seriesId, episodeId) => {
    const sId = Number(seriesId || 0);
    const eId = Number(episodeId || 0);
    if (!sId || !eId) return;
    setSelectedEpisodeIdsBySeries((prev) => {
      const current = Array.isArray(prev[sId]) ? prev[sId] : [];
      const exists = current.includes(eId);
      return {
        ...prev,
        [sId]: exists ? current.filter((id) => id !== eId) : [...current, eId],
      };
    });
  };

  const t = settings?.language === 'tr'
    ? {
        title: 'Sonarr',
        subtitle: "Sonarr'a eklenen diziler",
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
        seasons: 'Sezonlar',
        episodes: 'Bolumler',
        episodeListLoading: 'Bolumler yukleniyor...',
        noEpisodes: 'Bu dizi icin bolum listesi bulunamadi.',
        selectSeason: 'Sezon sec',
        selectedCount: 'secili',
        fileReady: 'Dosya var',
        fileMissing: 'Eksik',
        loading: 'Yukleniyor...',
        selectRoot: 'Root folder sec',
        selectQuality: 'Kalite profili sec',
        disabled: 'Sonarr etkin degil veya baglanti ayarlari eksik.',
        error: 'Sonarr dizi listesi alinamadi.',
        empty: 'Sonarr icinde henuz dizi yok.',
        monitored: 'Takipte',
        unmonitored: 'Takipte degil',
      }
    : {
        title: 'Sonarr',
        subtitle: 'Series added to Sonarr',
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
        seasons: 'Seasons',
        episodes: 'Episodes',
        episodeListLoading: 'Loading episodes...',
        noEpisodes: 'No episodes found for this series.',
        selectSeason: 'Select season',
        selectedCount: 'selected',
        fileReady: 'File',
        fileMissing: 'Missing',
        loading: 'Loading...',
        selectRoot: 'Select root folder',
        selectQuality: 'Select quality profile',
        disabled: 'Sonarr is disabled or connection settings are missing.',
        error: 'Could not load Sonarr series.',
        empty: 'No series found in Sonarr.',
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
        <button type="button" className="radarr-refresh-btn" onClick={loadSeries}>
          {t.refresh}
        </button>
      </header>

      {status === 'disabled' && <div className="radarr-note">{t.disabled}</div>}
      {status === 'error' && <div className="radarr-note radarr-note-error">{t.error}</div>}
      {status === 'ready' && items.length === 0 && <div className="radarr-note">{t.empty}</div>}

      {status === 'ready' && items.length > 0 && (
        <section className="radarr-grid">
          {items.map((series) => {
            const title = series?.title || series?.sortTitle || 'Unknown';
            const year = series?.year ? `(${series.year})` : '';
            const poster = series?.images?.find?.((img) => img.coverType === 'poster')?.remoteUrl || '';
            const monitored = series?.monitored === true;
            const seriesId = Number(series?.id || 0);
            const qbProgress = qbProgressBySeries[seriesId];
            const hasQbProgress = qbProgress && Number.isFinite(Number(qbProgress.progress));
            const isExpanded = expandedSeriesId === seriesId;
            const allEpisodes = Array.isArray(episodesBySeries[seriesId]) ? episodesBySeries[seriesId] : [];
            const seasons = [...new Set(allEpisodes.map((ep) => Number(ep?.seasonNumber || 0)).filter((n) => n > 0))].sort((a, b) => a - b);
            const selectedSeason = Number(selectedSeasonBySeries[seriesId] || seasons[0] || 0);
            const seasonEpisodes = allEpisodes.filter((ep) => Number(ep?.seasonNumber || 0) === selectedSeason);
            const selectedIds = Array.isArray(selectedEpisodeIdsBySeries[seriesId]) ? selectedEpisodeIdsBySeries[seriesId] : [];
            return (
              <article
                key={seriesId || `${title}-${year}`}
                className={`radarr-card sonarr-card ${isExpanded ? 'expanded' : ''}`}
                onClick={() => toggleSeriesExpand(seriesId)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleSeriesExpand(seriesId);
                  }
                }}
              >
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
                <div className="radarr-card-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="radarr-edit-btn"
                    disabled={removingId === seriesId}
                    onClick={() => openEditModal(series)}
                  >
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    className="radarr-remove-btn"
                    disabled={removingId === seriesId}
                    onClick={() => handleRemove(series)}
                  >
                    {removingId === seriesId ? t.removing : t.remove}
                  </button>
                </div>

                {isExpanded && (
                  <div className="sonarr-episodes-panel" onClick={(event) => event.stopPropagation()}>
                    {episodesLoadingBySeries[seriesId] ? (
                      <div className="sonarr-episodes-loading">{t.episodeListLoading}</div>
                    ) : (
                      <>
                        {seasons.length > 0 ? (
                          <>
                            <div className="sonarr-season-bar">
                              <span>{t.seasons}</span>
                              <div className="sonarr-season-chips">
                                {seasons.map((seasonNo) => (
                                  <button
                                    key={`${seriesId}-s-${seasonNo}`}
                                    type="button"
                                    className={`sonarr-season-chip ${selectedSeason === seasonNo ? 'active' : ''}`}
                                    onClick={() => setSelectedSeasonBySeries((prev) => ({ ...prev, [seriesId]: seasonNo }))}
                                  >
                                    S{seasonNo}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="sonarr-episode-list">
                              {seasonEpisodes.map((ep) => {
                                const epId = Number(ep?.id || 0);
                                const epNo = Number(ep?.episodeNumber || 0);
                                const epTitle = ep?.title || `Episode ${epNo}`;
                                const isSelected = selectedIds.includes(epId);
                                return (
                                  <label key={epId || `${seriesId}-${selectedSeason}-${epNo}`} className="sonarr-episode-row">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleEpisodeSelection(seriesId, epId)}
                                    />
                                    <span className="code">E{String(epNo).padStart(2, '0')}</span>
                                    <span className="title">{epTitle}</span>
                                    <span className={`state ${ep?.hasFile ? 'ok' : 'off'}`}>{ep?.hasFile ? t.fileReady : t.fileMissing}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="sonarr-episode-footer">
                              <span>{selectedIds.length} {t.selectedCount}</span>
                            </div>
                          </>
                        ) : (
                          <div className="sonarr-episodes-empty">{t.noEpisodes}</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {editingSeries && (
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

export default SonarrView;
