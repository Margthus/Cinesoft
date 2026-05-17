import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, Pause, Play, Trash2, Loader2, CheckCircle2,
  ArrowDown, ArrowUp, Users, Clock, Settings2, X, Save, ListChecks, ChevronUp, ChevronDown, HardDrive
} from 'lucide-react';
import '../styles/Downloads.css';

const DEFAULT_TORRENT_SETTINGS = {
  seedAfterDownload: true,
  shutdownOnComplete: false,
  maxActiveDownloads: 3,
  dhtEnabled: true,
  lsdEnabled: true,
  upnpEnabled: true,
  natPmpEnabled: true,
  announceToAllTrackers: true,
  lowSpeedAlertEnabled: false,
  lowSpeedThresholdKbps: 100,
  lowSpeedDurationMinutes: 10,
};
const NATIVE_STREAM_EVENT = 'cinesoft:native-stream-start';
const NATIVE_LOCAL_PLAY_EVENT = 'cinesoft:native-local-play';

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const formatSpeed = (bps) => {
  if (!bps) return '0 B/s';
  if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
};

const formatETA = (ms) => {
  if (!ms || !isFinite(ms) || ms <= 0) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
};

const cleanReleaseName = (value = '') => {
  const lastSegment = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  return lastSegment
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.[^\s-]+(?:\s*-\s*)?/gi, ' ')
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|io|me|tv|to|cc|xyz)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|dv|x264|x265|h264|h265|hevc|avc|10bit|bluray|brrip|web[- ]?dl|webrip|hdrip|dvdrip|proper|repack|remux|aac|ddp?5?\.?1|atmos|amzn|nf|hulu|yify|yts|rarbg|eztv|tgx|torrentgalaxy|ettv)\b/gi, ' ')
    .replace(/\b(multi|dubbed|dual audio|turkish|english|subs?|complete|season pack)\b/gi, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const formatTorrentTitle = (torrent) => {
  return torrent.title || torrent.name || torrent.mediaInfo?.title || torrent.mediaInfo?.name || 'Torrent';
};

const normalizeTorrentUiState = (torrent = {}) => {
  const paused = Boolean(
    torrent?.paused === true
    || torrent?.isPaused === true
    || String(torrent?.status || '').toLowerCase() === 'paused'
  );
  const errored = Boolean(String(torrent?.status || '').toLowerCase() === 'error');
  const progress = Number(torrent?.progress || 0);
  const done = Boolean(torrent?.done) || progress >= 100;
  const downloadRate = Number(torrent?.downloadSpeed ?? torrent?.downloadRate ?? 0) || 0;
  if (paused) return 'paused';
  if (errored) return 'error';
  if (done) return 'completed';
  if (downloadRate > 0) return 'downloading';
  return 'idle';
};

const joinLocalPath = (basePath = '', relPath = '') => {
  const base = String(basePath || '').trim();
  const rel = String(relPath || '').trim();
  if (!base || !rel) return '';
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\')) return rel;
  const normalizedBase = base.replace(/[\\/]+$/, '');
  const normalizedRel = rel.replace(/^[\\/]+/, '').replace(/\//g, '\\');
  return `${normalizedBase}\\${normalizedRel}`;
};

const resolveCompletedLocalVideoPath = (torrent = {}) => {
  const savePath = String(torrent?.savePath || '').trim();
  const selected = Array.isArray(torrent?.selectedVideoFiles) ? torrent.selectedVideoFiles : [];
  const doneSelected = selected.find((file) => file?.done === true && Number(file?.size || 0) > 0);
  if (doneSelected?.path && savePath) return joinLocalPath(savePath, doneSelected.path);
  const videoPath = String(torrent?.videoFile?.path || '').trim();
  if (videoPath && savePath) return joinLocalPath(savePath, videoPath);
  return '';
};

const DownloadsView = ({ settings }) => {
  const isTr = settings.language === 'tr';
  const nativeStreamEnabled = (window.electronAPI?.isDev === true)
    || String(import.meta.env.VITE_ENABLE_NATIVE_STREAM || '').toLowerCase() === 'true';
  const [torrents, setTorrents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [speedLimitInput, setSpeedLimitInput] = useState('1024');
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState(false);
  const [speedSaving, setSpeedSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [torrentSettings, setTorrentSettings] = useState(DEFAULT_TORRENT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [fileModalTorrent, setFileModalTorrent] = useState(null);
  const [fileModalFiles, setFileModalFiles] = useState([]);
  const [fileModalSelected, setFileModalSelected] = useState([]);
  const [fileModalSaving, setFileModalSaving] = useState(false);

  const t = getCopy(isTr);

  const fetchTorrents = useCallback(async () => {
    try {
      const result = await window.electronAPI?.torrentGetAll?.();
      if (result?.torrents) {
        setTorrents(result.torrents.filter((torrent) => !torrent.pendingSelection));
      }
    } catch (e) {
      console.error('Failed to fetch torrents:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTorrents();
    const interval = setInterval(fetchTorrents, 2000);
    return () => clearInterval(interval);
  }, [fetchTorrents]);

  useEffect(() => {
    const onRefresh = () => fetchTorrents();
    window.addEventListener('cinesoft:torrents-refresh', onRefresh);
    return () => window.removeEventListener('cinesoft:torrents-refresh', onRefresh);
  }, [fetchTorrents]);

  useEffect(() => {
    const loadInitialData = async () => {
      const [speed, savedSettings] = await Promise.all([
        window.electronAPI?.torrentGetSpeedLimit?.(),
        window.electronAPI?.torrentGetSettings?.(),
      ]);
      if (speed?.ok) {
        const limit = Math.max(0, Number(speed.downloadRateLimitKbps) || 0);
        setSpeedLimitEnabled(limit > 0);
        setSpeedLimitInput(String(limit || 1024));
      }
      if (savedSettings?.settings) {
        setTorrentSettings({ ...DEFAULT_TORRENT_SETTINGS, ...savedSettings.settings });
      }
    };
    loadInitialData();
  }, []);

  const handlePause = async (id) => {
    await window.electronAPI?.torrentPause?.(id);
    fetchTorrents();
  };

  const handleResume = async (id) => {
    await window.electronAPI?.torrentResume?.(id);
    fetchTorrents();
  };

  const handleRemove = async (id, deleteFiles = false) => {
    await window.electronAPI?.torrentRemove?.(id, deleteFiles);
    setTorrents((prev) => prev.filter((torrent) => torrent.id !== id));
  };

  const handleReorder = async (id, direction) => {
    await window.electronAPI?.torrentReorder?.(id, direction);
    fetchTorrents();
  };

  const handleStream = (torrent) => {
    if (!nativeStreamEnabled || typeof window === 'undefined') return;
    const media = torrent?.mediaInfo || {};
    const source = media.magnet || media.torrentUrl || media.infoHash || '';
    if (!source) return;
    let sourceKind = 'magnet';
    if (media.torrentUrl) sourceKind = 'torrent-url';
    else if (!media.magnet && media.infoHash) sourceKind = 'infohash';
    window.dispatchEvent(new CustomEvent(NATIVE_STREAM_EVENT, {
      detail: {
        source: String(source),
        sourceKind,
        title: String(formatTorrentTitle(torrent)),
      },
    }));
  };

  const handlePlayLocal = (torrent) => {
    if (typeof window === 'undefined') return;
    const localFilePath = resolveCompletedLocalVideoPath(torrent);
    if (!localFilePath) return;
    window.dispatchEvent(new CustomEvent(NATIVE_LOCAL_PLAY_EVENT, {
      detail: {
        localFilePath,
        title: String(formatTorrentTitle(torrent)),
      },
    }));
  };

  const applySpeedLimit = async (nextValue, enabled) => {
    const safeValue = Math.max(0, Number(nextValue) || 0);
    setSpeedSaving(true);
    try {
      await window.electronAPI?.torrentSetSpeedLimit?.(enabled ? safeValue : 0);
      setSpeedLimitEnabled(enabled);
    } finally {
      setSpeedSaving(false);
    }
  };

  const handleSpeedLimitInputChange = (event) => {
    setSpeedLimitInput(event.target.value.replace(/[^\d]/g, ''));
  };

  const handleSpeedLimitCommit = async () => {
    const value = String(speedLimitInput || '').trim();
    if (!value) {
      setSpeedLimitInput('1024');
      return;
    }
    if (speedLimitEnabled) await applySpeedLimit(value, true);
  };

  const handleSpeedLimitKeyDown = async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await handleSpeedLimitCommit();
  };

  const updateTorrentSetting = (changes) => {
    setTorrentSettings((current) => ({ ...current, ...changes }));
  };

  const handleSaveTorrentSettings = async () => {
    setSettingsSaving(true);
    try {
      const speedValue = Math.max(0, Number(speedLimitInput) || 0);
      await window.electronAPI?.torrentSetSpeedLimit?.(speedLimitEnabled ? speedValue : 0);
      const result = await window.electronAPI?.torrentSaveSettings?.(torrentSettings);
      if (result?.settings) setTorrentSettings({ ...DEFAULT_TORRENT_SETTINGS, ...result.settings });
      setSettingsOpen(false);
      fetchTorrents();
    } finally {
      setSettingsSaving(false);
    }
  };

  const openFileModal = async (torrent) => {
    setFileModalTorrent(torrent);
    setFileModalOpen(true);
    setFileModalFiles([]);
    setFileModalSelected([]);
    const result = await window.electronAPI?.torrentGetFiles?.(torrent.id);
    if (result?.ok) {
      setFileModalFiles(Array.isArray(result.files) ? result.files : []);
      const selected = Array.isArray(result.selectedFileIndexes) && result.selectedFileIndexes.length
        ? result.selectedFileIndexes
        : (result.files || []).map((file) => file.index);
      setFileModalSelected(selected);
    }
  };

  const toggleFileSelection = (index) => {
    setFileModalSelected((current) => (
      current.includes(index)
        ? current.filter((item) => item !== index)
        : [...current, index]
    ));
  };

  const saveFileSelection = async () => {
    if (!fileModalTorrent?.id || !fileModalSelected.length) return;
    setFileModalSaving(true);
    try {
      await window.electronAPI?.torrentSelectFiles?.(fileModalTorrent.id, fileModalSelected, false);
      setFileModalOpen(false);
    } finally {
      setFileModalSaving(false);
    }
  };

  const activeTorrents = torrents
    .filter((torrent) => !torrent.done)
    .sort((a, b) => {
      const orderA = Number(a.queueOrder) || Number.MAX_SAFE_INTEGER;
      const orderB = Number(b.queueOrder) || Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return Number(a.addedAt || 0) - Number(b.addedAt || 0);
    });
  const completedTorrents = torrents.filter((torrent) => torrent.done);

  if (loading) {
    return (
      <div className="downloads-view">
        <div className="downloads-header"><h1>{t.title}</h1></div>
        <div className="downloads-loading"><Loader2 size={32} className="downloads-spinner" /></div>
      </div>
    );
  }

  return (
    <div className="downloads-view">
      <div className="downloads-header">
        <h1>{t.title}</h1>
      </div>

      {torrents.length === 0 ? (
        <div className="downloads-empty">
          <div className="downloads-empty-icon"><Download size={56} /></div>
          <p className="downloads-empty-title">{t.empty}</p>
          <span className="downloads-empty-desc">{t.emptyDesc}</span>
        </div>
      ) : (
        <div className="downloads-list">
          {activeTorrents.length > 0 && (
            <TorrentSection title={t.active} count={activeTorrents.length} icon={<ArrowDown size={18} />}>
              {activeTorrents.map((torrent) => (
                <TorrentCard
                  key={torrent.id}
                  torrent={torrent}
                  t={t}
                  canStream={nativeStreamEnabled}
                  onStream={handleStream}
                  onPlayLocal={handlePlayLocal}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemove={handleRemove}
                  onFiles={openFileModal}
                  onReorder={handleReorder}
                  canMoveUp={activeTorrents.length > 1 && activeTorrents[0].id !== torrent.id}
                  canMoveDown={activeTorrents.length > 1 && activeTorrents[activeTorrents.length - 1].id !== torrent.id}
                />
              ))}
            </TorrentSection>
          )}
          {completedTorrents.length > 0 && (
            <TorrentSection title={t.completed} count={completedTorrents.length} icon={<CheckCircle2 size={18} />}>
              {completedTorrents.map((torrent) => (
                <TorrentCard
                  key={torrent.id}
                  torrent={torrent}
                  t={t}
                  canStream={nativeStreamEnabled}
                  onStream={handleStream}
                  onPlayLocal={handlePlayLocal}
                  onPause={handlePause}
                  onResume={handleResume}
                  onRemove={handleRemove}
                  onFiles={openFileModal}
                />
              ))}
            </TorrentSection>
          )}
        </div>
      )}

      <div className="downloads-bottom-tools">
        <button className="torrent-settings-trigger" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={17} />
          {t.torrentSettings}
        </button>
      </div>

      {settingsOpen && (
        <div className="torrent-settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="torrent-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="torrent-settings-header">
              <div>
                <h2>{t.torrentSettings}</h2>
                <p>{t.torrentSettingsHint}</p>
              </div>
              <button className="modal-icon-btn" onClick={() => setSettingsOpen(false)}><X size={18} /></button>
            </div>

            <div className="torrent-settings-content">
              <div className="modal-section-title">{t.speedLimitSection}</div>
              <label className="settings-number-row">
                <div>
                  <strong>{t.speedLimit}</strong>
                  <span>{t.speedLimitDesc}</span>
                </div>
                <div className="inline-speed-setting">
                  <button
                    className={`speed-switch ${speedLimitEnabled ? 'enabled' : ''}`}
                    onClick={() => applySpeedLimit(speedLimitInput, !speedLimitEnabled)}
                    disabled={speedSaving}
                    type="button"
                    aria-label={speedLimitEnabled ? t.disable : t.enable}
                  >
                    <span />
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={speedLimitInput}
                    onChange={handleSpeedLimitInputChange}
                    onBlur={handleSpeedLimitCommit}
                    onKeyDown={handleSpeedLimitKeyDown}
                    disabled={speedSaving}
                  />
                  <span className="inline-speed-unit">{t.speedUnit}</span>
                </div>
              </label>

              <label className="settings-number-row">
                <div>
                  <strong>{t.lowSpeedAlert}</strong>
                  <span>{t.lowSpeedAlertDesc}</span>
                </div>
                <div className="inline-speed-setting">
                  <button
                    className={`speed-switch ${torrentSettings.lowSpeedAlertEnabled ? 'enabled' : ''}`}
                    onClick={() => updateTorrentSetting({ lowSpeedAlertEnabled: !torrentSettings.lowSpeedAlertEnabled })}
                    type="button"
                    aria-label={torrentSettings.lowSpeedAlertEnabled ? t.disable : t.enable}
                  >
                    <span />
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    value={torrentSettings.lowSpeedThresholdKbps ?? 100}
                    onChange={(event) => updateTorrentSetting({ lowSpeedThresholdKbps: Math.max(1, Number(event.target.value) || 100) })}
                    disabled={!torrentSettings.lowSpeedAlertEnabled}
                  />
                  <span className="inline-speed-unit">{t.speedUnit}</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={torrentSettings.lowSpeedDurationMinutes ?? 10}
                    onChange={(event) => updateTorrentSetting({ lowSpeedDurationMinutes: Math.max(1, Number(event.target.value) || 10) })}
                    disabled={!torrentSettings.lowSpeedAlertEnabled}
                  />
                  <span className="inline-speed-unit">{t.minutes}</span>
                </div>
              </label>

              <SettingsRow title={t.seedAfterDownload} description={t.seedAfterDownloadDesc}>
                <Toggle checked={torrentSettings.seedAfterDownload} onChange={(checked) => updateTorrentSetting({ seedAfterDownload: checked })} />
              </SettingsRow>

              <label className="settings-number-row">
                <div>
                  <strong>{t.maxActiveDownloads}</strong>
                  <span>{t.maxActiveDownloadsDesc}</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={torrentSettings.maxActiveDownloads}
                  onChange={(event) => updateTorrentSetting({ maxActiveDownloads: Math.max(1, Number(event.target.value) || 1) })}
                />
              </label>

              <div className="modal-section-title">{t.automation}</div>
              <SettingsRow title={t.shutdownOnComplete} description={t.shutdownOnCompleteDesc}>
                <Toggle checked={torrentSettings.shutdownOnComplete} onChange={(checked) => updateTorrentSetting({ shutdownOnComplete: checked })} />
              </SettingsRow>
            </div>

            <div className="torrent-settings-footer">
              <button className="modal-secondary-btn" onClick={() => setSettingsOpen(false)}>{t.cancel}</button>
              <button className="modal-save-btn" onClick={handleSaveTorrentSettings} disabled={settingsSaving}>
                {settingsSaving ? <Loader2 size={16} className="downloads-spinner" /> : <Save size={16} />}
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {fileModalOpen && (
        <div className="torrent-settings-overlay" onClick={() => setFileModalOpen(false)}>
          <div className="torrent-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="torrent-settings-header">
              <div>
                <h2>{isTr ? 'Torrent Dosyalari' : 'Torrent Files'}</h2>
                <p>{fileModalTorrent?.title || fileModalTorrent?.name}</p>
              </div>
              <button className="modal-icon-btn" onClick={() => setFileModalOpen(false)}><X size={18} /></button>
            </div>
            <div className="torrent-settings-content">
              {(fileModalFiles || []).map((file) => (
                <label key={file.index} className="torrent-file-picker-row">
                  <input type="checkbox" checked={fileModalSelected.includes(file.index)} onChange={() => toggleFileSelection(file.index)} />
                  <span className="torrent-file-picker-name">{file.path || file.name}</span>
                  <span className="torrent-file-picker-size">{formatSize(file.size)}</span>
                </label>
              ))}
            </div>
            <div className="torrent-settings-footer">
              <button className="modal-secondary-btn" onClick={() => setFileModalOpen(false)}>{t.cancel}</button>
              <button className="modal-save-btn" onClick={saveFileSelection} disabled={!fileModalSelected.length || fileModalSaving}>
                {fileModalSaving ? <Loader2 size={16} className="downloads-spinner" /> : <Save size={16} />}
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TorrentSection = ({ title, count, icon, children }) => (
  <div className="downloads-section">
    <h2 className="downloads-section-title">
      {icon}
      {title}
      <span className="downloads-section-count">{count}</span>
    </h2>
    <div className="downloads-grid">{children}</div>
  </div>
);

const TorrentCard = ({ torrent, t, onPause, onResume, onRemove, onFiles, onReorder, canMoveUp, canMoveDown, canStream, onStream, onPlayLocal }) => {
  const [showFileProgress, setShowFileProgress] = useState(false);
  const posterUrl = torrent.mediaInfo?.poster || '';
  const uiState = normalizeTorrentUiState(torrent);
  const isDone = uiState === 'completed';
  const isPaused = uiState === 'paused';
  const statusText = isPaused
    ? t.paused
    : isDone
      ? t.seeding
      : uiState === 'error'
        ? 'Error'
        : uiState === 'idle'
          ? 'Idle'
          : t.downloading;
  const statusClass = isPaused
    ? 'status-paused'
    : isDone
      ? 'status-completed'
      : uiState === 'error'
        ? 'status-error'
        : 'status-downloading';
  const displayDownloadSpeed = isPaused ? 0 : (Number(torrent.downloadSpeed || 0) || 0);
  const displayUploadSpeed = isPaused ? 0 : (Number(torrent.uploadSpeed || 0) || 0);
  const selectedVideoFiles = Array.isArray(torrent.selectedVideoFiles) ? torrent.selectedVideoFiles : [];
  const streamable = canStream && Boolean(
    torrent?.mediaInfo?.magnet
    || torrent?.mediaInfo?.torrentUrl
    || torrent?.mediaInfo?.infoHash
  );
  const localPlayablePath = isDone ? resolveCompletedLocalVideoPath(torrent) : '';
  const localPlayable = Boolean(localPlayablePath);
  const displayTitle = formatTorrentTitle(torrent);
  const displaySubtitle = torrent.name || torrent.title || '';

  return (
    <div className={`torrent-card ${isDone ? 'completed' : ''}`}>
      {!isDone && (canMoveUp || canMoveDown) && (
        <div className="torrent-queue-controls">
          <button className="queue-btn" onClick={() => onReorder(torrent.id, 'up')} disabled={!canMoveUp} aria-label="Move up">
            <ChevronUp size={14} />
          </button>
          <button className="queue-btn" onClick={() => onReorder(torrent.id, 'down')} disabled={!canMoveDown} aria-label="Move down">
            <ChevronDown size={14} />
          </button>
        </div>
      )}
      <div className="torrent-poster">
        {posterUrl ? <img src={posterUrl} alt={displayTitle} /> : <div className="torrent-poster-placeholder"><Download size={34} /></div>}
      </div>
      <div className="torrent-info">
        <div className="torrent-title-row">
          <h3 className="torrent-title">{displayTitle}</h3>
          <div className={`torrent-status-chip ${statusClass}`}>{statusText}</div>
        </div>
        <span className="torrent-name">{displaySubtitle}</span>
        {!isDone && (
          <div className="torrent-progress-container">
            <div className="torrent-progress-bar"><div className="torrent-progress-fill" style={{ width: `${torrent.progress}%` }} /></div>
            <span className="torrent-progress-text">{torrent.progress}%</span>
          </div>
        )}
        <div className="torrent-stats">
          <TorrentStat icon={<ArrowDown size={13} />} text={formatSpeed(displayDownloadSpeed)} />
          <TorrentStat icon={<ArrowUp size={13} />} text={formatSpeed(displayUploadSpeed)} />
          <TorrentStat icon={<Users size={13} />} text={`${torrent.numPeers} ${t.peers}`} />
          {!isDone && <TorrentStat icon={<Clock size={13} />} text={formatETA(torrent.timeRemaining)} />}
          <TorrentStat icon={<HardDrive size={13} />} text={`${formatSize(torrent.downloaded)} / ${formatSize(torrent.totalSize)}`} />
        </div>
        {selectedVideoFiles.length > 1 && (
          <div className="torrent-file-progress-panel">
            <button
              className="torrent-file-progress-toggle"
              onClick={() => setShowFileProgress((current) => !current)}
              aria-expanded={showFileProgress}
              type="button"
            >
              <span>{t.files} ({selectedVideoFiles.length})</span>
              {showFileProgress ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showFileProgress && (
              <div className="torrent-file-progress-list">
                {selectedVideoFiles.map((file) => {
                  const fileProgress = Math.max(0, Math.min(100, Number(file.progress || 0)));
                  return (
                    <div className="torrent-file-progress-row" key={`${torrent.id}-${file.index}`}>
                      <div className="torrent-file-progress-main">
                        <span className="torrent-file-progress-name">{file.path || file.name}</span>
                        <span className={file.done ? 'torrent-file-progress-state done' : 'torrent-file-progress-state'}>
                          {file.done ? t.fileReady : `${t.fileDownloading} ${fileProgress.toFixed(fileProgress >= 10 ? 0 : 1)}%`}
                        </span>
                      </div>
                      <div className="torrent-file-progress-track">
                        <div className="torrent-file-progress-fill" style={{ width: `${fileProgress}%` }} />
                      </div>
                      <span className="torrent-file-progress-size">{formatSize(file.downloaded)} / {formatSize(file.size)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div className="torrent-actions">
          {!isDone && streamable && (
            <button className="torrent-action-btn" onClick={() => onStream(torrent)}>
              <Play size={15} />
              <span>{t.stream}</span>
            </button>
          )}
          {isDone && localPlayable && (
            <button className="torrent-action-btn" onClick={() => onPlayLocal?.(torrent)}>
              <Play size={15} />
              <span>Play</span>
            </button>
          )}
          <button className="torrent-action-btn" onClick={() => onFiles(torrent)}>
            <ListChecks size={15} />
            <span>{t.files}</span>
          </button>
          {!isDone && (
            <button className="torrent-action-btn" onClick={() => (isPaused ? onResume(torrent.id) : onPause(torrent.id))}>
              {isPaused ? <Play size={15} /> : <Pause size={15} />}
              <span>{isPaused ? t.resume : t.pause}</span>
            </button>
          )}
          <button className="torrent-action-btn danger" onClick={() => onRemove(torrent.id, false)}>
            <Trash2 size={15} />
            <span>{t.remove}</span>
          </button>
          <button className="torrent-action-btn danger-alt" onClick={() => onRemove(torrent.id, true)}>
            <Trash2 size={15} />
            <span>{t.removeWithFiles}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const TorrentStat = ({ icon, text }) => (
  <div className="torrent-stat">
    {icon}
    <span>{text}</span>
  </div>
);

const SettingsRow = ({ title, description, children }) => (
  <div className="settings-option-row">
    <div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
    {children}
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <label className="modal-toggle">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span />
  </label>
);

const getCopy = (isTr) => isTr ? {
  title: 'Indirilenler',
  empty: 'Henuz indirilen bir icerik bulunmuyor.',
  emptyDesc: 'Indirdiginiz dizi ve filmler burada gorunecektir.',
  active: 'Aktif Indirmeler',
  completed: 'Tamamlananlar',
  downloading: 'Indiriliyor',
  seeding: 'Seed ediliyor',
  paused: 'Duraklatildi',
  peers: 'es',
  remove: 'Kaldir',
  removeWithFiles: 'Dosyalarla Kaldir',
  files: 'Dosyalar',
  fileDownloading: 'Iniyor',
  fileReady: 'Hazir',
  stream: 'Stream',
  pause: 'Duraklat',
  resume: 'Devam Et',
  speedLimit: 'Hiz Limiti',
  speedUnit: 'KB/s',
  speedLimitSection: 'Hiz',
  speedLimitDesc: 'Indirme hizini sinirlamak icin acip degeri belirle.',
  lowSpeedAlert: 'Dusuk hiz uyarisi',
  lowSpeedAlertDesc: 'Hiz bu degerin altina duserse ve belirtilen sure boyunca kalirsa uyar.',
  enable: 'Ac',
  disable: 'Kapat',
  minutes: 'dakika',
  torrentSettings: 'Torrent Ayarlari',
  torrentSettingsHint: 'Kuyruk, seed ve baglanti ayarlarini yonet.',
  seedAfterDownload: 'Indirme bitince seed et',
  seedAfterDownloadDesc: 'Kapaliysa tamamlanan torrent otomatik duraklatilir.',
  shutdownOnComplete: 'Tum torrentler bitince bilgisayari kapat',
  shutdownOnCompleteDesc: 'Tumu tamamlandiginda sistem kapanisi planlanir.',
  maxActiveDownloads: 'Aktif indirme sayisi',
  maxActiveDownloadsDesc: 'Limit asilinca sonraki torrentler siraya alinir.',
  network: 'Baglanti',
  automation: 'Otomasyon',
  dhtDesc: 'Tracker disi es kesfi icin DHT kullan.',
  lsdDesc: 'Yerel agdaki esleri bul.',
  portMapDesc: 'Router port yonlendirmesini otomatik dene.',
  announceAllTrackers: 'Tum trackerlara duyur',
  announceAllTrackersDesc: 'Daha fazla es bulmak icin tum tracker katmanlarini kullan.',
  cancel: 'Iptal',
  save: 'Kaydet',
} : {
  title: 'Downloads',
  empty: 'You have no downloads yet.',
  emptyDesc: 'Movies and TV shows you download will appear here.',
  active: 'Active Downloads',
  completed: 'Completed',
  downloading: 'Downloading',
  seeding: 'Seeding',
  paused: 'Paused',
  peers: 'peers',
  remove: 'Remove',
  removeWithFiles: 'Remove with Files',
  files: 'Files',
  fileDownloading: 'Downloading',
  fileReady: 'Ready',
  stream: 'Stream',
  pause: 'Pause',
  resume: 'Resume',
  speedLimit: 'Speed Limit',
  speedUnit: 'KB/s',
  speedLimitSection: 'Speed',
  speedLimitDesc: 'Enable and set a download bandwidth cap.',
  lowSpeedAlert: 'Low speed alert',
  lowSpeedAlertDesc: 'Warn when speed stays below this threshold for the selected duration.',
  enable: 'Enable',
  disable: 'Disable',
  minutes: 'minutes',
  torrentSettings: 'Torrent Settings',
  torrentSettingsHint: 'Manage queueing and seeding behavior.',
  seedAfterDownload: 'Seed after download completes',
  seedAfterDownloadDesc: 'When disabled, completed torrents are paused automatically.',
  shutdownOnComplete: 'Shut down computer when all torrents complete',
  shutdownOnCompleteDesc: 'Schedules a system shutdown once every torrent is completed.',
  maxActiveDownloads: 'Active download limit',
  maxActiveDownloadsDesc: 'Extra torrents are queued when the limit is reached.',
  network: 'Network',
  automation: 'Automation',
  dhtDesc: 'Use DHT for peer discovery without trackers.',
  lsdDesc: 'Find peers on the local network.',
  portMapDesc: 'Try automatic router port mapping.',
  announceAllTrackers: 'Announce to all trackers',
  announceAllTrackersDesc: 'Use every tracker tier to improve peer discovery.',
  cancel: 'Cancel',
  save: 'Save',
};

export default DownloadsView;
