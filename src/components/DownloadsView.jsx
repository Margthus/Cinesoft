import React, { useState, useEffect, useCallback } from 'react';
import {
  Download, Pause, Play, Trash2, FolderOpen, Loader2, CheckCircle2,
  ArrowDown, ArrowUp, Users, Clock, HardDrive, Settings2, X, Save, ListChecks
} from 'lucide-react';
import '../styles/Downloads.css';

const DEFAULT_TORRENT_SETTINGS = {
  seedAfterDownload: true,
  maxActiveDownloads: 3,
  dhtEnabled: true,
  lsdEnabled: true,
  upnpEnabled: true,
  natPmpEnabled: true,
  announceToAllTrackers: true,
};

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

const DownloadsView = ({ settings }) => {
  const isTr = settings.language === 'tr';
  const [torrents, setTorrents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadDir, setDownloadDir] = useState('');
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
    const loadInitialData = async () => {
      const [dir, speed, savedSettings] = await Promise.all([
        window.electronAPI?.getDownloadDir?.(),
        window.electronAPI?.torrentGetSpeedLimit?.(),
        window.electronAPI?.torrentGetSettings?.(),
      ]);
      if (dir) setDownloadDir(dir);
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

  const handleChangeDir = async () => {
    const dir = await window.electronAPI?.selectDownloadDir?.();
    if (dir) setDownloadDir(dir);
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

  const activeTorrents = torrents.filter((torrent) => !torrent.done);
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
        <div className="downloads-dir-info">
          <HardDrive size={16} />
          <span className="dir-label">{t.downloadDir}:</span>
          <span className="dir-path">{downloadDir}</span>
          <button className="dir-change-btn" onClick={handleChangeDir}>
            <FolderOpen size={14} />
            {t.changeDir}
          </button>
        </div>
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
                <TorrentCard key={torrent.id} torrent={torrent} t={t} onPause={handlePause} onResume={handleResume} onRemove={handleRemove} onFiles={openFileModal} />
              ))}
            </TorrentSection>
          )}
          {completedTorrents.length > 0 && (
            <TorrentSection title={t.completed} count={completedTorrents.length} icon={<CheckCircle2 size={18} />}>
              {completedTorrents.map((torrent) => (
                <TorrentCard key={torrent.id} torrent={torrent} t={t} onPause={handlePause} onResume={handleResume} onRemove={handleRemove} onFiles={openFileModal} />
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

              <div className="modal-section-title">{t.network}</div>
              <SettingsRow title="DHT" description={t.dhtDesc}>
                <Toggle checked={torrentSettings.dhtEnabled} onChange={(checked) => updateTorrentSetting({ dhtEnabled: checked })} />
              </SettingsRow>
              <SettingsRow title="LSD" description={t.lsdDesc}>
                <Toggle checked={torrentSettings.lsdEnabled} onChange={(checked) => updateTorrentSetting({ lsdEnabled: checked })} />
              </SettingsRow>
              <SettingsRow title="UPnP / NAT-PMP" description={t.portMapDesc}>
                <Toggle
                  checked={torrentSettings.upnpEnabled && torrentSettings.natPmpEnabled}
                  onChange={(checked) => updateTorrentSetting({ upnpEnabled: checked, natPmpEnabled: checked })}
                />
              </SettingsRow>
              <SettingsRow title={t.announceAllTrackers} description={t.announceAllTrackersDesc}>
                <Toggle checked={torrentSettings.announceToAllTrackers} onChange={(checked) => updateTorrentSetting({ announceToAllTrackers: checked })} />
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

const TorrentCard = ({ torrent, t, onPause, onResume, onRemove, onFiles }) => {
  const posterUrl = torrent.mediaInfo?.poster || '';
  const isDone = torrent.done;
  const isPaused = torrent.paused;
  const statusText = isPaused ? t.paused : isDone ? t.seeding : t.downloading;
  const statusClass = isPaused ? 'status-paused' : isDone ? 'status-completed' : 'status-downloading';

  return (
    <div className={`torrent-card ${isDone ? 'completed' : ''}`}>
      <div className="torrent-poster">
        {posterUrl ? <img src={posterUrl} alt={torrent.title} /> : <div className="torrent-poster-placeholder"><Download size={34} /></div>}
      </div>
      <div className="torrent-info">
        <div className="torrent-title-row">
          <h3 className="torrent-title">{torrent.title}</h3>
          <div className={`torrent-status-chip ${statusClass}`}>{statusText}</div>
        </div>
        <span className="torrent-name">{torrent.name}</span>
        {!isDone && (
          <div className="torrent-progress-container">
            <div className="torrent-progress-bar"><div className="torrent-progress-fill" style={{ width: `${torrent.progress}%` }} /></div>
            <span className="torrent-progress-text">{torrent.progress}%</span>
          </div>
        )}
        <div className="torrent-stats">
          <TorrentStat icon={<ArrowDown size={13} />} text={formatSpeed(torrent.downloadSpeed)} />
          <TorrentStat icon={<ArrowUp size={13} />} text={formatSpeed(torrent.uploadSpeed)} />
          <TorrentStat icon={<Users size={13} />} text={`${torrent.numPeers} ${t.peers}`} />
          {!isDone && <TorrentStat icon={<Clock size={13} />} text={formatETA(torrent.timeRemaining)} />}
          <TorrentStat icon={<HardDrive size={13} />} text={`${formatSize(torrent.downloaded)} / ${formatSize(torrent.totalSize)}`} />
        </div>
        <div className="torrent-actions">
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
  pause: 'Duraklat',
  resume: 'Devam Et',
  downloadDir: 'Indirme Dizini',
  changeDir: 'Degistir',
  speedLimit: 'Hiz Limiti',
  speedUnit: 'KB/s',
  speedLimitSection: 'Hiz',
  speedLimitDesc: 'Indirme hizini sinirlamak icin acip degeri belirle.',
  enable: 'Ac',
  disable: 'Kapat',
  torrentSettings: 'Torrent Ayarlari',
  torrentSettingsHint: 'Kuyruk, seed ve baglanti ayarlarini yonet.',
  seedAfterDownload: 'Indirme bitince seed et',
  seedAfterDownloadDesc: 'Kapaliysa tamamlanan torrent otomatik duraklatilir.',
  maxActiveDownloads: 'Aktif indirme sayisi',
  maxActiveDownloadsDesc: 'Limit asilinca sonraki torrentler siraya alinir.',
  network: 'Baglanti',
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
  pause: 'Pause',
  resume: 'Resume',
  downloadDir: 'Download Directory',
  changeDir: 'Change',
  speedLimit: 'Speed Limit',
  speedUnit: 'KB/s',
  speedLimitSection: 'Speed',
  speedLimitDesc: 'Enable and set a download bandwidth cap.',
  enable: 'Enable',
  disable: 'Disable',
  torrentSettings: 'Torrent Settings',
  torrentSettingsHint: 'Manage queueing, seeding, and network behavior.',
  seedAfterDownload: 'Seed after download completes',
  seedAfterDownloadDesc: 'When disabled, completed torrents are paused automatically.',
  maxActiveDownloads: 'Active download limit',
  maxActiveDownloadsDesc: 'Extra torrents are queued when the limit is reached.',
  network: 'Network',
  dhtDesc: 'Use DHT for peer discovery without trackers.',
  lsdDesc: 'Find peers on the local network.',
  portMapDesc: 'Try automatic router port mapping.',
  announceAllTrackers: 'Announce to all trackers',
  announceAllTrackersDesc: 'Use every tracker tier to improve peer discovery.',
  cancel: 'Cancel',
  save: 'Save',
};

export default DownloadsView;
