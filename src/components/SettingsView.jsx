import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Film,
  FolderOpen,
  Globe,
  Home,
  Key,
  Library,
  Play,
  Radar,
  RefreshCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import { DEFAULT_PROWLARR_CONFIG, normalizeProwlarrConfig } from '../sources/index.mjs';
import { TORRENTIO_SITE_OPTIONS, normalizeTorrentioConfig } from '../utils/torrentio';
import '../styles/SettingsView.css';

const DEFAULT_EMBEDDED_TORRENT_SETTINGS = {
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
  globalConnectionLimit: 500,
  perTorrentConnectionLimit: 100,
  uploadSlots: 8,
  diskCacheSize: 'auto',
};

const SettingsView = ({ settings, setSettings }) => {
  const [formData, setFormData] = useState({
    ...settings,
    prowlarr: normalizeProwlarrConfig(settings.prowlarr || DEFAULT_PROWLARR_CONFIG),
    torrentio: normalizeTorrentioConfig(settings.torrentio || {}),
  });
  const [saveState, setSaveState] = useState('');
  const [qbRadarrState, setQbRadarrState] = useState('');
  const [embeddedDownloadDir, setEmbeddedDownloadDir] = useState('');
  const [prowlarrStatus, setProwlarrStatus] = useState('');
  const [managedStatus, setManagedStatus] = useState('');
  const [indexers, setIndexers] = useState([]);
  const [indexerStatus, setIndexerStatus] = useState('');
  const [schemas, setSchemas] = useState([]);
  const [schemaQuery, setSchemaQuery] = useState('');
  const [indexerDraft, setIndexerDraft] = useState(null);
  const [addState, setAddState] = useState('');
  const [schemaVisibleCount, setSchemaVisibleCount] = useState(80);
  const [downloadEngineConfigOpen, setDownloadEngineConfigOpen] = useState(true);
  const [torrentioConfigOpen] = useState(true);
  const [prowlarrConfigOpen] = useState(true);
  const [radarrConfigOpen] = useState(true);
  const [tmdbApiKeyVisible, setTmdbApiKeyVisible] = useState(false);
  const [radarrApiKeyVisible, setRadarrApiKeyVisible] = useState(false);
  const [radarrManagedStatus, setRadarrManagedStatus] = useState('');
  const [radarrStatus, setRadarrStatus] = useState('');
  const [radarrRootFolders, setRadarrRootFolders] = useState([]);
  const [radarrQualityProfiles, setRadarrQualityProfiles] = useState([]);
  const [radarrProwlarrSyncStatus, setRadarrProwlarrSyncStatus] = useState({
    prowlarr: 'disconnected',
    radarr: 'disconnected',
    sync: 'notConfigured',
    message: '',
  });
  const [radarrProwlarrSyncBusy, setRadarrProwlarrSyncBusy] = useState(false);
  const [activeSection, setActiveSection] = useState('general');
  const [embeddedTorrentSettings, setEmbeddedTorrentSettings] = useState(DEFAULT_EMBEDDED_TORRENT_SETTINGS);
  const [embeddedAdvancedOpen, setEmbeddedAdvancedOpen] = useState(false);
  const [navGroupsOpen, setNavGroupsOpen] = useState({
    general: true,
    account: true,
    download: true,
    sources: true,
  });

  useEffect(() => {
    setFormData({
      ...settings,
      prowlarr: normalizeProwlarrConfig(settings.prowlarr || DEFAULT_PROWLARR_CONFIG),
      torrentio: normalizeTorrentioConfig(settings.torrentio || {}),
    });
  }, [settings]);

  useEffect(() => {
    refreshIndexers();
    window.electronAPI?.getDownloadDir?.().then((dir) => {
      if (typeof dir === 'string' && dir.trim()) {
        setEmbeddedDownloadDir(dir);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.electronAPI?.torrentGetSettings?.().then((result) => {
      if (result?.settings) {
        setEmbeddedTorrentSettings({ ...DEFAULT_EMBEDDED_TORRENT_SETTINGS, ...result.settings });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!formData.prowlarr.enabled) return;
    if (indexers.length > 0 || indexerStatus === 'loading') return;

    const retryTimer = setTimeout(() => {
      refreshIndexers();
    }, 1200);

    return () => clearTimeout(retryTimer);
  }, [formData.prowlarr.enabled, formData.prowlarr.baseUrl, formData.prowlarr.apiKey, indexers.length, indexerStatus]);

  useEffect(() => {
    if (!formData.radarrEnabled) return;
    if (!formData.radarrBaseUrl || !formData.radarrApiKey) return;
    loadRadarrLists().catch(() => {});
  }, [formData.radarrEnabled, formData.radarrBaseUrl, formData.radarrApiKey]);

  useEffect(() => {
    if (!radarrConfigOpen) return;
    if (!formData.radarrEnabled) return;
    if (!formData.radarrBaseUrl || !formData.radarrApiKey) return;
    if (!formData.prowlarr?.baseUrl || !formData.prowlarr?.apiKey) return;
    if (radarrProwlarrSyncBusy) return;
    if (radarrProwlarrSyncStatus.sync === 'configured') return;
    handleSyncRadarrNow();
  }, [
    radarrConfigOpen,
    formData.radarrEnabled,
    formData.radarrBaseUrl,
    formData.radarrApiKey,
    formData.prowlarr?.baseUrl,
    formData.prowlarr?.apiKey,
  ]);

  useEffect(() => {
    if (!radarrConfigOpen) return undefined;
    if (!formData.radarrEnabled) return undefined;
    if (!formData.radarrBaseUrl || !formData.radarrApiKey) return undefined;

    const refresh = () => {
      loadRadarrLists().catch(() => {});
    };

    const interval = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    const handleVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [radarrConfigOpen, formData.radarrEnabled, formData.radarrBaseUrl, formData.radarrApiKey]);

  const updateRoot = (changes) => {
    setFormData((current) => {
      const next = { ...current, ...changes };
      if ('torrentioEnabled' in changes
        || 'embeddedTorrentEnabled' in changes
        || 'qbittorrentEnabled' in changes
        || 'qbittorrent' in changes
        || 'torrentio' in changes
        || 'radarrEnabled' in changes
        || 'radarrManaged' in changes
        || 'radarrBaseUrl' in changes
        || 'radarrApiKey' in changes
        || 'radarrExecutablePath' in changes
        || 'radarrPort' in changes
        || 'radarrTimeout' in changes
        || 'radarrDefaultRootFolder' in changes
        || 'radarrDefaultQualityProfileId' in changes
        || 'radarrSearchAfterAdd' in changes) {
        window.electronAPI?.saveSettings?.(next).then(() => setSettings(next));
      }
      return next;
    });
  };

  const getRadarrSettings = (override = {}) => ({
    radarrEnabled: formData.radarrEnabled === true,
    radarrManaged: formData.radarrManaged === true,
    radarrBaseUrl: String(formData.radarrBaseUrl || ''),
    radarrApiKey: String(formData.radarrApiKey || ''),
    radarrExecutablePath: String(formData.radarrExecutablePath || ''),
    radarrPort: Number(formData.radarrPort || 7878),
    radarrTimeout: Number(formData.radarrTimeout || 10000),
    radarrDefaultRootFolder: String(formData.radarrDefaultRootFolder || ''),
    radarrDefaultQualityProfileId: formData.radarrDefaultQualityProfileId ?? '',
    radarrSearchAfterAdd: formData.radarrSearchAfterAdd !== false,
    ...override,
  });

  const updateProwlarr = (changes) => {
    setFormData((current) => {
      const next = {
        ...current,
        prowlarr: {
          ...current.prowlarr,
          ...changes,
        },
      };
      if ('enabled' in changes || 'managed' in changes) {
        window.electronAPI?.saveSettings?.(next).then(() => setSettings(next));
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaveState('saving');
    const success = await window.electronAPI?.saveSettings?.(formData);
    if (success) {
      setSettings(formData);
      setSaveState('saved');
      setTimeout(() => setSaveState(''), 2500);
    }
  };

  const handleSelectExecutable = async () => {
    const executablePath = await window.electronAPI?.selectProwlarrExecutable?.();
    if (executablePath) {
      updateProwlarr({ executablePath });
    }
  };

  const handleOpenProwlarrDownload = async () => {
    await window.electronAPI?.openProwlarrDownloadPage?.();
  };

  const handleOpenProwlarrWebUI = async () => {
    const result = await window.electronAPI?.openProwlarrWebUI?.(formData.prowlarr || {});
    if (!result?.ok) {
      alert(result?.error || 'Prowlarr URL could not be opened');
    }
  };

  const handleOpenRadarrDownload = async () => {
    await window.electronAPI?.openRadarrDownloadPage?.();
  };

  const handleOpenRadarrWebUI = async () => {
    const result = await window.electronAPI?.openRadarrWebUI?.(getRadarrSettings());
    if (!result?.ok) {
      alert(result?.error || 'Radarr URL could not be opened');
    }
  };

  const handleSelectRadarrExecutable = async () => {
    const executablePath = await window.electronAPI?.selectRadarrExecutable?.();
    if (executablePath) {
      updateRoot({ radarrExecutablePath: executablePath });
    }
  };

  const handleStartRadarr = async (configOverride) => {
    setRadarrManagedStatus('starting');
    const configToStart = configOverride || getRadarrSettings();
    const result = await window.electronAPI?.startManagedRadarr?.(configToStart);
    if (result?.ok) {
      updateRoot({
        radarrManaged: true,
        radarrEnabled: true,
        radarrBaseUrl: result.radarrBaseUrl || configToStart.radarrBaseUrl,
        radarrApiKey: result.radarrApiKey || configToStart.radarrApiKey,
        radarrExecutablePath: result.radarrExecutablePath || configToStart.radarrExecutablePath,
        radarrPort: Number(result.radarrPort || configToStart.radarrPort || 7878),
      });
      setRadarrManagedStatus(result.externalProcessStopped ? 'restarted' : 'running');
      return;
    }
    setRadarrManagedStatus('missing');
  };

  const handleStopRadarr = async () => {
    await window.electronAPI?.stopManagedRadarr?.();
    updateRoot({ radarrEnabled: false });
    setRadarrManagedStatus('stopped');
  };

  const loadRadarrLists = async (custom = null) => {
    const radarrSettings = custom || getRadarrSettings();
    if (!radarrSettings.radarrBaseUrl || !radarrSettings.radarrApiKey) return;
    const [rootRes, qualityRes] = await Promise.all([
      window.electronAPI?.radarrGetRootFolders?.(radarrSettings),
      window.electronAPI?.radarrGetQualityProfiles?.(radarrSettings),
    ]);
    if (rootRes?.ok) {
      const items = Array.isArray(rootRes.items) ? rootRes.items : [];
      setRadarrRootFolders(items);
      if (!radarrSettings.radarrDefaultRootFolder && items[0]?.path) {
        updateRoot({ radarrDefaultRootFolder: items[0].path });
      }
    }
    if (qualityRes?.ok) {
      const items = Array.isArray(qualityRes.items) ? qualityRes.items : [];
      setRadarrQualityProfiles(items);
      if ((radarrSettings.radarrDefaultQualityProfileId === '' || radarrSettings.radarrDefaultQualityProfileId === null) && items[0]?.id != null) {
        updateRoot({ radarrDefaultQualityProfileId: items[0].id });
      }
    }
  };

  const handleTestRadarr = async () => {
    setRadarrStatus('testing');
    try {
      const current = getRadarrSettings();
      if (!current.radarrEnabled) {
        setRadarrStatus('disabled');
        return;
      }
      if (!current.radarrBaseUrl || !current.radarrApiKey) {
        setRadarrStatus('missing');
        return;
      }
      const result = await window.electronAPI?.radarrTestConnection?.(current);
      if (!result?.ok) {
        setRadarrStatus(`failed:${result?.error || ''}`);
        return;
      }
      await loadRadarrLists(current);
      setRadarrStatus(`ok:${result.version || ''}`);
    } catch (err) {
      setRadarrStatus(`failed:${err?.message || ''}`);
    }
  };

  const handleConnectRadarrToProwlarr = async () => {
    setRadarrProwlarrSyncBusy(true);
    try {
      const result = await window.electronAPI?.prowlarrConnectRadarr?.();
      setRadarrProwlarrSyncStatus({
        prowlarr: result?.prowlarr || (result?.ok ? 'connected' : 'disconnected'),
        radarr: result?.radarr || (result?.ok ? 'connected' : 'disconnected'),
        sync: result?.sync || (result?.ok ? 'configured' : 'notConfigured'),
        message: result?.ok ? (result?.message || t.syncConfigured) : (result?.error || t.syncFailed),
      });
    } catch (err) {
      setRadarrProwlarrSyncStatus({
        prowlarr: 'disconnected',
        radarr: 'disconnected',
        sync: 'notConfigured',
        message: err?.message || t.syncFailed,
      });
    } finally {
      setRadarrProwlarrSyncBusy(false);
    }
  };

  const handleSyncRadarrNow = async () => {
    setRadarrProwlarrSyncBusy(true);
    try {
      const result = await window.electronAPI?.prowlarrSyncRadarr?.();
      setRadarrProwlarrSyncStatus({
        prowlarr: result?.prowlarr || (result?.ok ? 'connected' : 'disconnected'),
        radarr: result?.radarr || (result?.ok ? 'connected' : 'disconnected'),
        sync: result?.sync || (result?.ok ? 'configured' : 'notConfigured'),
        message: result?.ok ? (result?.message || t.syncConfigured) : (result?.error || t.syncFailed),
      });
    } catch (err) {
      setRadarrProwlarrSyncStatus({
        prowlarr: 'disconnected',
        radarr: 'disconnected',
        sync: 'notConfigured',
        message: err?.message || t.syncFailed,
      });
    } finally {
      setRadarrProwlarrSyncBusy(false);
    }
  };

  const handleStartProwlarr = async (configOverride) => {
    setManagedStatus('starting');
    const configToStart = configOverride || formData.prowlarr;
    const result = await window.electronAPI?.startManagedProwlarr?.(configToStart);
    if (result?.ok) {
      const nextProwlarr = {
        ...formData.prowlarr,
        ...result,
        enabled: true,
      };
      setFormData((current) => ({ ...current, prowlarr: nextProwlarr, torrentioEnabled: false }));
      setSettings((current) => ({ ...current, prowlarr: nextProwlarr, torrentioEnabled: false }));
      setManagedStatus(result.externalProcessStopped ? 'restarted' : 'running');
      await refreshIndexers();
      return;
    }
    setManagedStatus('missing');
  };

  const handleStopProwlarr = async () => {
    await window.electronAPI?.stopManagedProwlarr?.();
    updateProwlarr({ enabled: false });
    setManagedStatus('stopped');
  };

  const updateEmbeddedTorrentSetting = (changes) => {
    setEmbeddedTorrentSettings((current) => {
      const next = { ...current, ...changes };
      window.electronAPI?.torrentSaveSettings?.(next).then((result) => {
        if (result?.settings) {
          setEmbeddedTorrentSettings({ ...DEFAULT_EMBEDDED_TORRENT_SETTINGS, ...result.settings });
        }
      }).catch(() => {});
      return next;
    });
  };

  const handleEnableProwlarrConnection = async () => {
    updateProwlarr({ enabled: true });
    updateRoot({ torrentioEnabled: false });
    if (!formData.prowlarr.managed || managedStatus !== 'running') {
      updateProwlarr({ managed: true });
      await handleStartProwlarr({ ...formData.prowlarr, enabled: true, managed: true });
    }
    await refreshIndexers();
  };

  const handleDisableProwlarrConnection = async () => {
    updateProwlarr({ enabled: false });
    if (formData.prowlarr.managed) {
      await handleStopProwlarr();
    }
  };

  const handleTestProwlarr = async () => {
    setProwlarrStatus('testing');
    try {
      const result = await window.electronAPI?.testProwlarrConnection?.(formData.prowlarr);
      if (result?.ok) {
        setProwlarrStatus(`ok:${result.version || '-'}:${result.indexerCount ?? 0}`);
      } else {
        setProwlarrStatus('failed');
      }
    } catch {
      setProwlarrStatus('failed');
    }
  };

  const refreshIndexers = async () => {
    setIndexerStatus('loading');
    try {
      const result = await window.electronAPI?.getProwlarrIndexers?.(formData.prowlarr);
      setIndexers(Array.isArray(result) ? result : []);
      setIndexerStatus(Array.isArray(result) && result.length > 0 ? 'loaded' : 'empty');
    } catch {
      setIndexerStatus('failed');
    }
  };

  const toggleIndexerSelection = (id) => {
    const selected = formData.prowlarr.selectedIndexerIds || [];
    updateProwlarr({
      selectedIndexerIds: selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    });
  };

  const handleDeleteIndexer = async (id) => {
    setIndexerStatus('loading');
    try {
      await window.electronAPI?.deleteProwlarrIndexer?.(formData.prowlarr, id);
      await refreshIndexers();
    } catch {
      setIndexerStatus('failed');
    }
  };

  const loadSchemas = async () => {
    if (schemas.length > 0) {
      return;
    }
    setAddState('loadingSchemas');
    try {
      const result = await window.electronAPI?.getProwlarrIndexerSchemas?.(formData.prowlarr);
      setSchemas(Array.isArray(result) ? result : []);
      setAddState('');
    } catch {
      setAddState('schemaFailed');
    }
  };

  const handleSelectSchema = (schemaId) => {
    const schema = schemas.find((item) => item.schemaId === schemaId);
    if (!schema) {
      setIndexerDraft(null);
      return;
    }
    setIndexerDraft({
      ...schema,
      id: 0,
      name: schema.name || schema.implementationName || schema.definitionName || schema.implementation,
      enable: true,
      priority: Number(schema.priority || 25),
      appProfileId: Number(schema.appProfileId || 1),
      downloadClientId: Number(schema.downloadClientId || 0),
      tags: [],
      fields: (schema.fields || []).map((field) => ({ ...field })),
    });
    setAddState('');
  };

  const closeIndexerDraft = () => {
    setIndexerDraft(null);
    setAddState('');
  };

  const updateDraftField = (name, value) => {
    setIndexerDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => (
        field.name === name ? { ...field, value } : field
      )),
    }));
  };

  const updateDraft = (changes) => {
    setIndexerDraft((current) => ({ ...current, ...changes }));
  };

  const handleTestIndexer = async () => {
    if (!indexerDraft) return;
    setAddState('testingIndexer');
    try {
      await window.electronAPI?.testProwlarrIndexer?.(formData.prowlarr, indexerDraft);
      setAddState('indexerTestOk');
    } catch {
      setAddState('indexerTestFailed');
    }
  };

  const handleAddIndexer = async () => {
    if (!indexerDraft) return;
    setAddState('addingIndexer');
    try {
      await window.electronAPI?.addProwlarrIndexer?.(formData.prowlarr, indexerDraft);
      setAddState('indexerAdded');
      setIndexerDraft(null);
      setSchemaQuery('');
      await refreshIndexers();
    } catch {
      setAddState('indexerAddFailed');
    }
  };

  const t = getCopy(formData.language);
  const defaultPageOptions = useMemo(() => ([
    { value: 'home', label: t.pageHome, icon: Home },
    { value: 'movies', label: t.pageMovies, icon: Film },
    { value: 'tv', label: t.pageTv, icon: Tv },
    { value: 'anime', label: t.pageAnime, icon: Sparkles },
    { value: 'library', label: t.pageLibrary, icon: Library },
    { value: 'mylist', label: t.pageMyList, icon: Bookmark },
    { value: 'downloads', label: t.pageDownloads, icon: Download },
    { value: 'search', label: t.pageSearch, icon: Search },
    { value: 'radarr', label: 'Radarr', icon: Radar },
    { value: 'settings', label: t.pageSettings, icon: SettingsIcon },
  ]), [t]);
  const starredNames = ['yts', 'the pirate bay', 'nyaa.si'];

  const filteredSchemas = schemas.filter((schema) => {
    const sName = `${schema.name || ''} ${schema.implementationName || ''} ${schema.definitionName || ''}`.toLowerCase();
    if (sName.includes('sukebei')) return false;
    return sName.includes(schemaQuery.toLowerCase());
  }).sort((a, b) => {
    const aName = (a.name || a.definitionName || '').toLowerCase();
    const bName = (b.name || b.definitionName || '').toLowerCase();
    const isAStarred = starredNames.includes(aName);
    const isBStarred = starredNames.includes(bName);

    if (isAStarred && !isBStarred) return -1;
    if (!isAStarred && isBStarred) return 1;
    return 0;
  });

  const visibleSchemas = filteredSchemas.slice(0, schemaVisibleCount);

  const toggleTorrentioSite = (siteKey) => {
    const normalized = normalizeTorrentioConfig(formData.torrentio || {});
    const current = { ...(normalized.enabledSites || {}) };
    const allSiteKeys = TORRENTIO_SITE_OPTIONS.map((site) => site.key).filter((key) => key !== 'all');

    if (siteKey === 'all') {
      const allSelected = allSiteKeys.every((key) => current[key] !== false);
      const nextValue = !allSelected;
      const nextEnabledSites = { ...current, all: nextValue };
      allSiteKeys.forEach((key) => {
        nextEnabledSites[key] = nextValue;
      });
      updateRoot({
        torrentio: normalizeTorrentioConfig({
          ...(formData.torrentio || {}),
          enabledSites: nextEnabledSites,
        }),
      });
      return;
    }

    const nextEnabledSites = {
      ...current,
      [siteKey]: !(current[siteKey] !== false),
    };
    nextEnabledSites.all = allSiteKeys.every((key) => nextEnabledSites[key] !== false);
    updateRoot({
      torrentio: normalizeTorrentioConfig({
        ...(formData.torrentio || {}),
        enabledSites: nextEnabledSites,
      }),
    });
  };

  const navGroups = useMemo(() => ([
    {
      id: 'general',
      label: t.navGeneral,
      items: [
        { id: 'general', label: t.generalSettings, icon: Globe },
      ],
    },
    {
      id: 'account',
      label: t.navAccount,
      items: [
        { id: 'tmdb', label: t.tmdbNav, icon: Key },
      ],
    },
    {
      id: 'download',
      label: t.navDownload,
      items: [
        { id: 'downloadEmbedded', label: t.embeddedTorrent, icon: Save },
        { id: 'downloadQbittorrent', label: t.qbittorrent, icon: Save },
      ],
    },
    {
      id: 'sources',
      label: t.navSources,
      items: [
        { id: 'torrentio', label: 'Torrentio', icon: Globe },
        { id: 'prowlarr', label: t.prowlarr, icon: Radar },
        { id: 'radarr', label: t.radarr, icon: Film },
      ],
    },
  ]), [t]);

  const statusTone = saveState === 'saved' ? 'saved' : saveState === 'saving' ? 'saving' : 'idle';
  const statusLabel = saveState === 'saved' ? t.allChangesSaved : saveState === 'saving' ? t.savingNow : t.unsavedChanges;

  const renderGeneralSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Globe size={18} />
          <div>
            <h2>{t.generalSettings}</h2>
            <p>{t.generalSettingsHint}</p>
          </div>
        </div>
      </header>

      <div className="settings-row-list">
        <div className="settings-row-card">
          <div className="settings-row-copy">
            <strong>{t.language}</strong>
            <span>{t.languageHint}</span>
          </div>
          <div className="settings-row-control">
            <CustomSelect
              value={formData.language || 'tr'}
              onSelect={(value) => updateRoot({ language: value })}
              options={[
                { value: 'tr', label: 'Turkce' },
                { value: 'en', label: 'English' },
              ]}
            />
          </div>
        </div>

        <div className="settings-row-card">
          <div className="settings-row-copy">
            <strong>{t.defaultPage}</strong>
            <span>{t.defaultPageHint}</span>
          </div>
          <div className="settings-row-control">
            <div className="settings-icon-select-wrap">
              <CustomSelect
                options={defaultPageOptions}
                value={formData.defaultPage || 'home'}
                withIcons
                onSelect={(value) => updateRoot({ defaultPage: value })}
              />
            </div>
          </div>
        </div>

        <div className="settings-row-card">
          <div className="settings-row-copy">
            <strong>{t.notifications}</strong>
            <span>{t.notificationsHint}</span>
          </div>
          <div className="settings-row-control">
            <Toggle
              checked={formData.notificationsEnabled !== false}
              onChange={(checked) => updateRoot({ notificationsEnabled: checked })}
            />
          </div>
        </div>

      </div>
    </section>
  );

  const renderTmdbSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Key size={18} />
          <div>
            <h2>{t.tmdb}</h2>
            <p>{t.tmdbHint}</p>
          </div>
        </div>
      </header>

      <div className="settings-row-list">
        <div className="settings-row-card settings-row-card--stacked-mobile">
          <div className="settings-row-copy">
            <strong>{t.tmdbKeyLabel}</strong>
            <span>{t.tmdbKeyDesc}</span>
          </div>
          <div className="settings-row-control settings-row-control--wide">
            <div className="input-action-row">
              <input
                className="settings-input"
                type={tmdbApiKeyVisible ? 'text' : 'password'}
                value={formData.apiKey}
                onChange={(event) => updateRoot({ apiKey: event.target.value })}
                placeholder={t.tmdb}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTmdbApiKeyVisible((current) => !current)}
                aria-label={tmdbApiKeyVisible ? 'Hide TMDB API key' : 'Show TMDB API key'}
                title={tmdbApiKeyVisible ? 'Hide' : 'Show'}
              >
                {tmdbApiKeyVisible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderEmbeddedTorrentSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Save size={18} />
          <div>
            <h2>{t.embeddedTorrent}</h2>
            <p>{t.embeddedTorrentDesc}</p>
          </div>
        </div>
      </header>

      <div className="settings-row-list">
        <div className="settings-row-card">
          <div className="settings-row-copy">
            <strong>{t.embeddedTorrent}</strong>
            <span>{t.embeddedTorrentDesc}</span>
          </div>
          <Toggle
            checked={formData.embeddedTorrentEnabled !== false}
            onChange={(checked) => {
              updateRoot({ embeddedTorrentEnabled: checked });
            }}
          />
        </div>
      </div>

      <div className="settings-form-card">
        <label className="stacked-field">
          <span>{t.defaultDownloadFolder}</span>
          <div className="input-action-row">
            <input
              className="settings-input"
              value={embeddedDownloadDir}
              readOnly
            />
            <button
              type="button"
              className="icon-btn"
              onClick={async () => {
                const selected = await window.electronAPI?.selectDownloadDir?.();
                if (typeof selected === 'string' && selected.trim()) {
                  setEmbeddedDownloadDir(selected);
                }
              }}
              aria-label={t.selectFolder}
              title={t.selectFolder}
            >
              <FolderOpen size={18} />
            </button>
          </div>
        </label>
        <p className="settings-helper">{t.completedToFolderHint}</p>
      </div>

      <div className="settings-form-card">
        <div className="settings-panel-header">
          <div className="settings-panel-title">
            <div>
              <h2>{t.advancedTorrentSettings}</h2>
              <p>{t.advancedTorrentSettingsHint}</p>
            </div>
          </div>
          <button type="button" className="settings-collapse-btn" onClick={() => setEmbeddedAdvancedOpen((current) => !current)}>
            {embeddedAdvancedOpen ? t.hideConfig : t.showConfig}
          </button>
        </div>

        {embeddedAdvancedOpen && (
          <div className="settings-row-list">
            <div className="settings-row-card">
              <div className="settings-row-copy">
                <strong>DHT</strong>
                <span>{t.dhtDesc}</span>
              </div>
              <Toggle checked={embeddedTorrentSettings.dhtEnabled !== false} onChange={(checked) => updateEmbeddedTorrentSetting({ dhtEnabled: checked })} />
            </div>
            <div className="settings-row-card">
              <div className="settings-row-copy">
                <strong>LSD</strong>
                <span>{t.lsdDesc}</span>
              </div>
              <Toggle checked={embeddedTorrentSettings.lsdEnabled !== false} onChange={(checked) => updateEmbeddedTorrentSetting({ lsdEnabled: checked })} />
            </div>
            <div className="settings-row-card">
              <div className="settings-row-copy">
                <strong>UPnP / NAT-PMP</strong>
                <span>{t.portMapDesc}</span>
              </div>
              <Toggle
                checked={embeddedTorrentSettings.upnpEnabled !== false && embeddedTorrentSettings.natPmpEnabled !== false}
                onChange={(checked) => updateEmbeddedTorrentSetting({ upnpEnabled: checked, natPmpEnabled: checked })}
              />
            </div>
            <div className="settings-row-card">
              <div className="settings-row-copy">
                <strong>{t.announceAllTrackers}</strong>
                <span>{t.announceAllTrackersDesc}</span>
              </div>
              <Toggle checked={embeddedTorrentSettings.announceToAllTrackers !== false} onChange={(checked) => updateEmbeddedTorrentSetting({ announceToAllTrackers: checked })} />
            </div>
            <div className="settings-row-card settings-row-card--stacked-mobile">
              <div className="settings-row-copy">
                <strong>{t.lowSpeedAlert}</strong>
                <span>{t.lowSpeedAlertDesc}</span>
              </div>
              <div className="panel-grid">
                <label className="stacked-field compact">
                  <span>{t.lowSpeedThreshold}</span>
                  <input
                    className="settings-input"
                    type="number"
                    min="1"
                    max="100000"
                    value={embeddedTorrentSettings.lowSpeedThresholdKbps ?? 100}
                    onChange={(event) => updateEmbeddedTorrentSetting({ lowSpeedThresholdKbps: Math.max(1, Number(event.target.value) || 100) })}
                  />
                </label>
                <label className="stacked-field compact">
                  <span>{t.lowSpeedDuration}</span>
                  <input
                    className="settings-input"
                    type="number"
                    min="1"
                    max="1440"
                    value={embeddedTorrentSettings.lowSpeedDurationMinutes ?? 10}
                    onChange={(event) => updateEmbeddedTorrentSetting({ lowSpeedDurationMinutes: Math.max(1, Number(event.target.value) || 10) })}
                  />
                </label>
              </div>
            </div>
            <div className="settings-row-card settings-row-card--stacked-mobile">
              <div className="settings-row-copy">
                <strong>{t.globalConnectionLimit}</strong>
                <span>{t.globalConnectionLimitDesc}</span>
              </div>
              <input
                className="settings-input"
                type="number"
                min="1"
                max="5000"
                value={embeddedTorrentSettings.globalConnectionLimit ?? 500}
                onChange={(event) => updateEmbeddedTorrentSetting({ globalConnectionLimit: Math.max(1, Number(event.target.value) || 500) })}
              />
            </div>
            <div className="settings-row-card settings-row-card--stacked-mobile">
              <div className="settings-row-copy">
                <strong>{t.perTorrentConnectionLimit}</strong>
                <span>{t.perTorrentConnectionLimitDesc}</span>
              </div>
              <input
                className="settings-input"
                type="number"
                min="1"
                max="1000"
                value={embeddedTorrentSettings.perTorrentConnectionLimit ?? 100}
                onChange={(event) => updateEmbeddedTorrentSetting({ perTorrentConnectionLimit: Math.max(1, Number(event.target.value) || 100) })}
              />
            </div>
            <div className="settings-row-card settings-row-card--stacked-mobile">
              <div className="settings-row-copy">
                <strong>{t.uploadSlots}</strong>
                <span>{t.uploadSlotsDesc}</span>
              </div>
              <input
                className="settings-input"
                type="number"
                min="1"
                max="128"
                value={embeddedTorrentSettings.uploadSlots ?? 8}
                onChange={(event) => updateEmbeddedTorrentSetting({ uploadSlots: Math.max(1, Number(event.target.value) || 8) })}
              />
            </div>
            <div className="settings-row-card settings-row-card--stacked-mobile">
              <div className="settings-row-copy">
                <strong>{t.diskCacheSize}</strong>
                <span>{t.diskCacheSizeDesc}</span>
              </div>
              <CustomSelect
                value={embeddedTorrentSettings.diskCacheSize || 'auto'}
                onSelect={(value) => updateEmbeddedTorrentSetting({ diskCacheSize: value })}
                options={[
                  { value: 'auto', label: t.cacheAuto },
                  { value: '64', label: '64 MB' },
                  { value: '128', label: '128 MB' },
                  { value: '256', label: '256 MB' },
                  { value: '512', label: '512 MB' },
                ]}
              />
            </div>
            <p className="settings-helper">{t.diskCacheWarning}</p>
          </div>
        )}
      </div>
    </section>
  );

  const renderQbittorrentSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Save size={18} />
          <div>
            <h2>{t.qbittorrent}</h2>
            <p>{t.qbittorrentDesc}</p>
          </div>
        </div>
      </header>

      <div className="settings-row-list">
        <div className="settings-row-card">
          <div className="settings-row-copy">
            <strong>{t.qbittorrent}</strong>
            <span>{t.qbittorrentDesc}</span>
          </div>
          <Toggle
            checked={formData.qbittorrentEnabled !== false}
            onChange={(checked) => {
              updateRoot({ qbittorrentEnabled: checked });
            }}
          />
        </div>
      </div>

      <div className="settings-form-card">
        <div className="panel-grid">
          <label className="stacked-field">
            <span>{t.qbBaseUrl}</span>
            <input
              className="settings-input"
              value={formData.qbittorrent?.baseUrl || 'http://127.0.0.1:8080'}
              onChange={(event) => updateRoot({
                qbittorrent: {
                  ...(formData.qbittorrent || {}),
                  baseUrl: event.target.value,
                },
              })}
            />
          </label>
          <label className="stacked-field">
            <span>{t.qbUsername}</span>
            <input
              className="settings-input"
              value={formData.qbittorrent?.username || 'admin'}
              onChange={(event) => updateRoot({
                qbittorrent: {
                  ...(formData.qbittorrent || {}),
                  username: event.target.value,
                },
              })}
            />
          </label>
          <label className="stacked-field">
            <span>{t.qbPassword}</span>
            <input
              className="settings-input"
              type="password"
              value={formData.qbittorrent?.password || 'adminadmin'}
              onChange={(event) => updateRoot({
                qbittorrent: {
                  ...(formData.qbittorrent || {}),
                  password: event.target.value,
                },
              })}
            />
          </label>
        </div>
        <p className="settings-helper">{t.qbNote}</p>
        <div className="draft-actions">
          <button
            type="button"
            className="action-btn primary"
            onClick={async () => {
              if (formData.qbittorrentEnabled === false) {
                setQbRadarrState(`failed:${formData.language === 'tr' ? 'qBittorrent kapali.' : 'qBittorrent is disabled.'}`);
                return;
              }
              setQbRadarrState('saving');
              const payload = {
                settings: {
                  radarrBaseUrl: formData.radarrBaseUrl,
                  radarrApiKey: formData.radarrApiKey,
                  radarrTimeout: formData.radarrTimeout || 10000,
                },
                qbittorrent: {
                  baseUrl: formData.qbittorrent?.baseUrl || 'http://127.0.0.1:8080',
                  username: formData.qbittorrent?.username || '',
                  password: formData.qbittorrent?.password || '',
                },
              };
              const result = await window.electronAPI?.radarrUpsertQbittorrentClient?.(payload);
              if (result?.ok) {
                setQbRadarrState('saved');
                return;
              }
              setQbRadarrState(`failed:${result?.error || ''}`);
            }}
          >
            <Save size={16} />
            {t.addQbToRadarr}
          </button>
          <span className="status-line">{renderQbRadarrState(qbRadarrState, t)}</span>
        </div>
      </div>
    </section>
  );

  const renderTorrentioSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Globe size={18} />
          <div>
            <h2>Torrentio</h2>
            <p>{formData.language === 'tr' ? 'Torrentio eklentisini kaynak olarak kullan.' : 'Use Torrentio addon as source.'}</p>
          </div>
        </div>
        <div className="settings-card-actions">
          <Toggle
            checked={formData.torrentioEnabled || false}
            onChange={async (checked) => {
              updateRoot({ torrentioEnabled: checked });
              if (checked) {
                updateProwlarr({ enabled: false, managed: false });
                await handleStopProwlarr();
              }
            }}
          />
        </div>
      </header>

      <div id="torrentio-config-panel" className="settings-collapsible open">
        <div className="settings-form-card">
          <div className="panel-grid">
            <label className="stacked-field">
              <span>{t.torrentioBaseUrl}</span>
              <input
                className="settings-input"
                value={formData.torrentio?.baseUrl || 'https://torrentio.strem.fun'}
                onChange={(event) => updateRoot({
                  torrentio: {
                    ...(formData.torrentio || {}),
                    baseUrl: event.target.value,
                  },
                })}
              />
            </label>
            <label className="stacked-field">
              <span>{t.torrentioMaxResults}</span>
              <input
                className="settings-input"
                type="number"
                min="10"
                max="250"
                value={formData.torrentio?.maxResults || 80}
                onChange={(event) => updateRoot({
                  torrentio: {
                    ...(formData.torrentio || {}),
                    maxResults: Math.max(10, Number(event.target.value) || 80),
                  },
                })}
              />
            </label>
            <label className="stacked-field">
              <span>{t.torrentioExcludeKeywords}</span>
              <input
                className="settings-input"
                value={formData.torrentio?.excludeKeywords || ''}
                onChange={(event) => updateRoot({
                  torrentio: {
                    ...(formData.torrentio || {}),
                    excludeKeywords: event.target.value,
                  },
                })}
              />
            </label>
            <label className="stacked-field">
              <span>{t.torrentioSortBy}</span>
              <CustomSelect
                value={formData.torrentio?.sortBy || 'seeders'}
                onSelect={(value) => updateRoot({
                  torrentio: normalizeTorrentioConfig({
                    ...(formData.torrentio || {}),
                    sortBy: value,
                  }),
                })}
                options={[
                  { value: 'seeders', label: t.seeders },
                  { value: 'size', label: t.size },
                  { value: 'name', label: t.name },
                ]}
              />
            </label>
          </div>

          <div className="stacked-field settings-site-block">
            <span>{t.torrentioSites}</span>
            <div className="torrentio-site-grid">
              {TORRENTIO_SITE_OPTIONS.map((site) => {
                const enabled = site.key === 'all'
                  ? TORRENTIO_SITE_OPTIONS
                    .filter((option) => option.key !== 'all')
                    .every((option) => formData.torrentio?.enabledSites?.[option.key] !== false)
                  : formData.torrentio?.enabledSites?.[site.key] !== false;
                const siteLabel = site.key === 'all'
                  ? (formData.language === 'tr' ? 'Hepsi' : 'All')
                  : site.label;
                return (
                  <button
                    key={site.key}
                    type="button"
                    className={`torrentio-site-btn ${enabled ? 'active' : ''}`}
                    onClick={() => toggleTorrentioSite(site.key)}
                  >
                    {siteLabel}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="settings-helper">{t.torrentioHint}</p>
        </div>
      </div>
    </section>
  );

  const renderRadarrSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Film size={18} />
          <div>
            <h2>{t.radarr}</h2>
            <p>{t.radarrHint}</p>
          </div>
        </div>
        <div className="settings-card-actions settings-card-actions--wrap">
          <button type="button" className="settings-collapse-btn" onClick={handleOpenRadarrDownload}>
            <span>{t.downloadRadarr}</span>
          </button>
          <button type="button" className="settings-collapse-btn" onClick={handleOpenRadarrWebUI}>
            <span>{t.openRadarrWebUI}</span>
          </button>
        </div>
      </header>

      <div id="radarr-config-panel" className="settings-collapsible open">
        <div className="prowlarr-layout">
          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.engine}</h3>
              <Toggle
                checked={formData.radarrManaged === true}
                onChange={async (checked) => {
                  updateRoot({ radarrManaged: checked });
                  if (checked) {
                    await handleStartRadarr({ ...getRadarrSettings(), radarrManaged: true });
                  } else {
                    await handleStopRadarr();
                  }
                }}
              />
            </div>
            <p className="settings-helper">{t.radarrEngineHint}</p>

            <div className="input-action-row">
              <input
                className="settings-input"
                value={formData.radarrExecutablePath || ''}
                onChange={(event) => updateRoot({ radarrExecutablePath: event.target.value })}
                placeholder={t.radarrExecutable}
              />
              <button className="icon-btn" onClick={handleSelectRadarrExecutable}><FolderOpen size={18} /></button>
            </div>

            <div className="inline-fields">
              <label className="stacked-field compact">
                <span>{t.port}</span>
                <input
                  className="settings-input"
                  type="number"
                  value={formData.radarrPort || 7878}
                  onChange={(event) => updateRoot({ radarrPort: Number(event.target.value) || 7878 })}
                />
              </label>
              <div className="action-cluster">
                <button className="action-btn start" onClick={handleStartRadarr} disabled={radarrManagedStatus === 'starting'}>
                  {radarrManagedStatus === 'starting' ? <RefreshCcw className="spin" size={16} /> : <Play size={16} />}
                  {t.start}
                </button>
                <button className="action-btn stop" onClick={handleStopRadarr}>
                  <Square size={16} />
                  {t.stop}
                </button>
              </div>
            </div>
            <div className="status-line">{renderRadarrManagedStatus(radarrManagedStatus, t)}</div>
          </div>

          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.connection}</h3>
              <Toggle
                checked={formData.radarrEnabled === true}
                onChange={async (checked) => {
                  updateRoot({ radarrEnabled: checked });
                  if (checked && (!formData.radarrManaged || radarrManagedStatus !== 'running')) {
                    updateRoot({ radarrManaged: true });
                    await handleStartRadarr({ ...getRadarrSettings(), radarrEnabled: true, radarrManaged: true });
                  }
                }}
              />
            </div>
            <div className="panel-grid">
              <label className="stacked-field">
                <span>{t.radarrBaseUrl}</span>
                <input
                  className="settings-input"
                  value={formData.radarrBaseUrl || ''}
                  onChange={(event) => updateRoot({ radarrBaseUrl: event.target.value })}
                  placeholder="http://127.0.0.1:7878"
                />
              </label>
              <label className="stacked-field">
                <span>{t.radarrApiKey}</span>
                <div className="input-action-row">
                  <input
                    className="settings-input"
                    type={radarrApiKeyVisible ? 'text' : 'password'}
                    value={formData.radarrApiKey || ''}
                    onChange={(event) => updateRoot({ radarrApiKey: event.target.value })}
                  />
                  <button type="button" className="icon-btn" onClick={() => setRadarrApiKeyVisible((current) => !current)}>
                    {radarrApiKeyVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              <label className="stacked-field">
                <span>{t.timeout}</span>
                <input
                  className="settings-input"
                  type="number"
                  min="1000"
                  step="500"
                  value={formData.radarrTimeout || 10000}
                  onChange={(event) => updateRoot({ radarrTimeout: Number(event.target.value || 10000) })}
                />
              </label>
              <button className="action-btn subtle full-height" onClick={handleTestRadarr} disabled={radarrStatus === 'testing'}>
                {radarrStatus === 'testing' ? <RefreshCcw className="spin" size={16} /> : <Shield size={16} />}
                {t.test}
              </button>
            </div>
            <div className="status-line">{renderRadarrStatus(radarrStatus, t)}</div>
          </div>

          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.radarrDefaults}</h3>
            </div>
            <div className="panel-grid">
              <label className="stacked-field">
                <span>{t.radarrRootFolder}</span>
                <CustomSelect
                  value={formData.radarrDefaultRootFolder || ''}
                  onSelect={(value) => updateRoot({ radarrDefaultRootFolder: value })}
                  options={[
                    { value: '', label: t.selectRootFolder },
                    ...radarrRootFolders.map((folder) => ({
                      value: folder.path,
                      label: folder.path,
                    })),
                  ]}
                />
              </label>
              {!radarrRootFolders.length && (
                <div className="radarr-warning-box" role="status">
                  <strong>{t.radarrNoRootFoldersTitle}</strong>
                  <span>{t.radarrNoRootFoldersHint}</span>
                </div>
              )}
              <label className="stacked-field">
                <span>{t.radarrQualityProfile}</span>
                <CustomSelect
                  value={String(formData.radarrDefaultQualityProfileId ?? '')}
                  onSelect={(value) => updateRoot({ radarrDefaultQualityProfileId: value })}
                  options={[
                    { value: '', label: t.selectQualityProfile },
                    ...radarrQualityProfiles.map((profile) => ({
                      value: String(profile.id),
                      label: profile.name,
                    })),
                  ]}
                />
              </label>
              <label className="toggle-field">
                <span>{t.radarrSearchAfterAdd}</span>
                <Toggle checked={formData.radarrSearchAfterAdd !== false} onChange={(checked) => updateRoot({ radarrSearchAfterAdd: checked })} />
              </label>
            </div>
          </div>

          <div className="prowlarr-panel prowlarr-panel-wide">
            <div className="prowlarr-panel-header">
              <h3>{t.prowlarrSync}</h3>
            </div>
            <p className="settings-helper">{t.prowlarrSyncHint}</p>
            <div className="sync-status-grid">
              <div className="sync-status-item">
                <span>{t.prowlarrLabel}</span>
                <strong className={`sync-badge ${radarrProwlarrSyncStatus.prowlarr === 'connected' ? 'ok' : 'off'}`}>
                  {radarrProwlarrSyncStatus.prowlarr === 'connected' ? t.connected : t.disconnected}
                </strong>
              </div>
              <div className="sync-status-item">
                <span>{t.radarrLabel}</span>
                <strong className={`sync-badge ${radarrProwlarrSyncStatus.radarr === 'connected' ? 'ok' : 'off'}`}>
                  {radarrProwlarrSyncStatus.radarr === 'connected' ? t.connected : t.disconnected}
                </strong>
              </div>
              <div className="sync-status-item">
                <span>{t.syncStatusLabel}</span>
                <strong className={`sync-badge ${
                  radarrProwlarrSyncStatus.sync === 'configured'
                    ? 'ok'
                    : (radarrProwlarrSyncStatus.sync === 'partial' ? 'warn' : 'off')
                }`}>
                  {radarrProwlarrSyncStatus.sync === 'configured'
                    ? t.syncConfiguredShort
                    : (radarrProwlarrSyncStatus.sync === 'partial' ? t.syncPartial : t.notConfigured)}
                </strong>
              </div>
            </div>
            {radarrProwlarrSyncStatus.message ? (
              <div className="status-line sync-message">{radarrProwlarrSyncStatus.message}</div>
            ) : null}
            <div className="draft-actions">
              <button
                type="button"
                className="action-btn subtle"
                onClick={handleConnectRadarrToProwlarr}
                disabled={radarrProwlarrSyncBusy}
              >
                {t.connectRadarrToProwlarr}
              </button>
              <button
                type="button"
                className="action-btn subtle"
                onClick={handleSyncRadarrNow}
                disabled={radarrProwlarrSyncBusy}
              >
                {t.syncNow}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderProwlarrSection = () => (
    <section className="settings-section-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-title">
          <Radar size={18} />
          <div>
            <h2>{t.prowlarr}</h2>
            <p>{t.prowlarrHint}</p>
          </div>
        </div>
        <div className="settings-card-actions settings-card-actions--wrap">
          <button type="button" className="settings-collapse-btn" onClick={handleOpenProwlarrDownload}>
            <span>{t.downloadProwlarr}</span>
          </button>
          <button type="button" className="settings-collapse-btn" onClick={handleOpenProwlarrWebUI}>
            <span>{t.openProwlarrWebUI}</span>
          </button>
        </div>
      </header>

      <div id="prowlarr-config-panel" className="settings-collapsible open">
        <div className="prowlarr-layout">
          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.engine}</h3>
              <Toggle
                checked={formData.prowlarr.managed}
                onChange={async (checked) => {
                  updateProwlarr({ managed: checked });
                  if (checked) {
                    updateRoot({ torrentioEnabled: false });
                    await handleStartProwlarr({ ...formData.prowlarr, managed: true });
                  } else {
                    await handleStopProwlarr();
                  }
                }}
              />
            </div>
            <p className="settings-helper">{t.managed}</p>

            <div className="input-action-row">
              <input
                className="settings-input"
                value={formData.prowlarr.executablePath || ''}
                onChange={(event) => updateProwlarr({ executablePath: event.target.value })}
                placeholder={t.executable}
              />
              <button className="icon-btn" onClick={handleSelectExecutable}><FolderOpen size={18} /></button>
            </div>

            <div className="inline-fields">
              <label className="stacked-field compact">
                <span>{t.port}</span>
                <input
                  className="settings-input"
                  type="number"
                  value={formData.prowlarr.port}
                  onChange={(event) => updateProwlarr({ port: Number(event.target.value) || 9696 })}
                />
              </label>
              <div className="action-cluster">
                <button className="action-btn start" onClick={handleEnableProwlarrConnection} disabled={managedStatus === 'starting'}>
                  {managedStatus === 'starting' ? <RefreshCcw className="spin" size={16} /> : <Play size={16} />}
                  {t.start}
                </button>
                <button className="action-btn stop" onClick={handleDisableProwlarrConnection}>
                  <Square size={16} />
                  {t.stop}
                </button>
              </div>
            </div>

            <div className="status-line">{renderManagedStatus(managedStatus, t)}</div>
          </div>

          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.connection}</h3>
              <Toggle
                checked={formData.prowlarr.enabled}
                onChange={async (checked) => {
                  if (checked) {
                    await handleEnableProwlarrConnection();
                  } else {
                    await handleDisableProwlarrConnection();
                  }
                }}
              />
            </div>
            <div className="panel-grid">
              <label className="stacked-field">
                <span>{t.baseUrl}</span>
                <input className="settings-input" value={formData.prowlarr.baseUrl} onChange={(event) => updateProwlarr({ baseUrl: event.target.value })} />
              </label>
              <label className="stacked-field">
                <span>{t.prowlarrApiKey}</span>
                <input className="settings-input" type="password" value={formData.prowlarr.apiKey} onChange={(event) => updateProwlarr({ apiKey: event.target.value })} />
              </label>
              <label className="stacked-field">
                <span>{t.timeout}</span>
                <input className="settings-input" type="number" value={formData.prowlarr.timeout} onChange={(event) => updateProwlarr({ timeout: Number(event.target.value) || 10000 })} />
              </label>
              <button className="action-btn subtle full-height" onClick={handleTestProwlarr} disabled={prowlarrStatus === 'testing'}>
                {prowlarrStatus === 'testing' ? <RefreshCcw className="spin" size={16} /> : <Shield size={16} />}
                {t.test}
              </button>
            </div>
            <div className="status-line">{renderConnectionStatus(prowlarrStatus, t)}</div>
          </div>

          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.filters}</h3>
            </div>
            <div className="panel-grid single-column">
              <label className="stacked-field">
                <span>{t.movieCategories}</span>
                <input className="settings-input" value={formData.prowlarr.movieCategories} onChange={(event) => updateProwlarr({ movieCategories: event.target.value })} />
              </label>
              <label className="stacked-field">
                <span>{t.tvCategories}</span>
                <input className="settings-input" value={formData.prowlarr.tvCategories} onChange={(event) => updateProwlarr({ tvCategories: event.target.value })} />
              </label>
            </div>
          </div>

          <div className="prowlarr-panel">
            <div className="prowlarr-panel-header">
              <h3>{t.indexers}</h3>
              <button className="icon-btn" onClick={refreshIndexers}><RefreshCcw className={indexerStatus === 'loading' ? 'spin' : ''} size={16} /></button>
            </div>
            <p className="settings-helper">{t.allIndexers}</p>
            <div className="indexer-grid">
              {indexers.map((indexer) => (
                <article key={indexer.id} className={`indexer-card ${(formData.prowlarr.selectedIndexerIds || []).includes(indexer.id) ? 'active' : ''}`} onClick={() => toggleIndexerSelection(indexer.id)}>
                  <div>
                    <strong>{indexer.name}</strong>
                    <span>{indexer.protocol}</span>
                  </div>
                  <button className="icon-btn danger" onClick={(event) => { event.stopPropagation(); handleDeleteIndexer(indexer.id); }}>
                    <Trash2 size={14} />
                  </button>
                </article>
              ))}
            </div>
            {!indexers.length && <div className="empty-box">{indexerStatus === 'failed' ? t.indexerFailed : t.noIndexers}</div>}
          </div>

          <div className="prowlarr-panel prowlarr-panel-wide">
            <div className="prowlarr-panel-header">
              <h3>{t.addIndexer}</h3>
            </div>

            <div className="schema-search-row single-flow">
              <div className="search-shell">
                <Search size={16} />
                <input
                  value={schemaQuery}
                  onFocus={loadSchemas}
                  onChange={(event) => {
                    setSchemaQuery(event.target.value);
                    setSchemaVisibleCount(80);
                  }}
                  placeholder={t.searchIndexer}
                />
              </div>
            </div>

            {filteredSchemas.length > 0 && !indexerDraft && (
              <div className="schema-result-list">
                {visibleSchemas.map((schema) => {
                  const schemaName = schema.name || schema.implementationName || schema.definitionName;
                  const schemaNameLower = (schemaName || '').toLowerCase();
                  const isStarred = starredNames.includes(schemaNameLower);

                  return (
                    <button
                      key={schema.schemaId}
                      className="schema-result-item"
                      onClick={() => handleSelectSchema(schema.schemaId)}
                    >
                      <strong className="schema-title-line">
                        {schemaName}
                        {isStarred && <span className="schema-star">★</span>}
                      </strong>
                      <span className="schema-subtitle">{schema.implementation || schema.definitionName || schema.schemaId}</span>
                    </button>
                  );
                })}
                {visibleSchemas.length < filteredSchemas.length && (
                  <button
                    className="schema-load-more"
                    onClick={() => setSchemaVisibleCount((current) => current + 80)}
                  >
                    {t.loadMore}
                  </button>
                )}
              </div>
            )}

            {indexerDraft && (
              <div className="draft-card">
                <div className="draft-card-header">
                  <h4>{t.indexerConfig}</h4>
                  <button className="icon-btn" onClick={closeIndexerDraft} aria-label={t.closeIndexerConfig}>
                    <X size={16} />
                  </button>
                </div>
                <div className="panel-grid">
                  <label className="stacked-field">
                    <span>{t.indexerName}</span>
                    <input className="settings-input" value={indexerDraft.name || ''} onChange={(event) => updateDraft({ name: event.target.value })} />
                  </label>
                  <label className="stacked-field compact">
                    <span>{t.priority}</span>
                    <input className="settings-input" type="number" value={indexerDraft.priority || 25} onChange={(event) => updateDraft({ priority: Number(event.target.value) || 25 })} />
                  </label>
                </div>

                <div className="dynamic-grid">
                  {(indexerDraft.fields || [])
                    .filter((field) => !field.hidden && field.type !== 'info')
                    .map((field) => (
                      <DynamicField key={field.name} field={field} onChange={(value) => updateDraftField(field.name, value)} />
                    ))}
                </div>

                <div className="draft-actions">
                  <button className="action-btn subtle" onClick={handleTestIndexer} disabled={addState === 'testingIndexer'}>
                    {addState === 'testingIndexer' ? <RefreshCcw className="spin" size={16} /> : <Shield size={16} />}
                    {t.testIndexer}
                  </button>
                  <button className="action-btn primary" onClick={handleAddIndexer} disabled={addState === 'addingIndexer'}>
                    {addState === 'addingIndexer' ? <RefreshCcw className="spin" size={16} /> : <Save size={16} />}
                    {t.saveIndexer}
                  </button>
                </div>
              </div>
            )}

            <div className="status-line">{renderAddStatus(addState, t)}</div>
          </div>
        </div>
      </div>
    </section>
  );

  const renderActiveSection = () => {
    if (activeSection === 'general') return renderGeneralSection();
    if (activeSection === 'tmdb') return renderTmdbSection();
    if (activeSection === 'downloadEmbedded') return renderEmbeddedTorrentSection();
    if (activeSection === 'downloadQbittorrent') return renderQbittorrentSection();
    if (activeSection === 'torrentio') return renderTorrentioSection();
    if (activeSection === 'radarr') return renderRadarrSection();
    if (activeSection === 'prowlarr') return renderProwlarrSection();
    return renderGeneralSection();
  };

  return (
    <div className="settings-view settings-view-redesign">
      <div className="settings-topbar">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="settings-topbar-actions">
          <div className={`settings-status-pill settings-status-pill--${statusTone}`}>
            <span className="settings-status-dot" />
            <span>{statusLabel}</span>
          </div>
          <button className="settings-save-btn" onClick={handleSave} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? <RefreshCcw className="spin" size={18} /> : <Save size={18} />}
            {saveState === 'saved' ? t.saved : t.save}
          </button>
        </div>
      </div>

      <div className="settings-layout">
        <aside className="settings-sidebar">
          {navGroups.map((group) => {
            const isOpen = navGroupsOpen[group.id];
            return (
              <div key={group.id} className="settings-nav-group">
                <button
                  type="button"
                  className="settings-nav-group-toggle"
                  onClick={() => setNavGroupsOpen((current) => ({ ...current, [group.id]: !current[group.id] }))}
                >
                  <span>{group.label}</span>
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {isOpen && (
                  <div className="settings-nav-items">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`settings-nav-item ${activeSection === item.id ? 'active' : ''}`}
                          onClick={() => setActiveSection(item.id)}
                        >
                          <Icon size={16} />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <div className="settings-content-panel">
          {renderActiveSection()}
        </div>
      </div>
    </div>
  );
};

const CustomSelect = ({
  options = [],
  value,
  onSelect,
  withIcons = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  const SelectedIcon = selected?.icon;

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!selectRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={selectRef} className={`settings-icon-select ${isOpen ? 'open' : ''} ${className}`.trim()}>
      <button type="button" className="settings-icon-select-trigger" onClick={() => setIsOpen((current) => !current)} aria-expanded={isOpen}>
        <span className="settings-icon-select-value">
          {withIcons && SelectedIcon ? <SelectedIcon size={16} /> : null}
          <span>{selected?.label || ''}</span>
        </span>
        <ChevronDown size={16} />
      </button>
      {isOpen && (
        <div className="settings-icon-select-menu">
          {options.map((option) => {
            const OptionIcon = option.icon;
            const isActive = String(option.value) === String(selected?.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`settings-icon-select-option ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                }}
              >
                <span className="settings-icon-select-value">
                  {withIcons && OptionIcon ? <OptionIcon size={16} /> : null}
                  <span>{option.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Toggle = ({ checked, onChange }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span />
  </label>
);

const DynamicField = ({ field, onChange }) => {
  const lowerType = String(field.type || '').toLowerCase();
  const value = field.value ?? '';
  const options = field.selectOptions || field.options || [];
  const isPassword = lowerType.includes('password') || String(field.name || '').toLowerCase().includes('key');

  if (lowerType.includes('checkbox') || typeof value === 'boolean') {
    return (
      <label className="toggle-field">
        <span>{field.label || field.name}</span>
        <Toggle checked={Boolean(value)} onChange={onChange} />
      </label>
    );
  }

  if (Array.isArray(options) && options.length > 0) {
    const mappedOptions = options.map((option) => ({
      value: option.value ?? option.name ?? option,
      label: option.name ?? option.label ?? option.value ?? option,
    }));
    return (
      <label className="stacked-field">
        <span>{field.label || field.name}</span>
        <CustomSelect value={value || ''} onSelect={onChange} options={mappedOptions} />
      </label>
    );
  }

  return (
    <label className="stacked-field">
      <span>{field.label || field.name}</span>
      <input className="settings-input" type={isPassword ? 'password' : 'text'} value={value || ''} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
};

const renderManagedStatus = (state, t) => {
  if (!state) return '';
  if (state === 'running') return t.running;
  if (state === 'restarted') return t.restarted;
  if (state === 'starting') return t.starting;
  if (state === 'stopped') return t.stopped;
  if (state === 'missing') return t.missing;
  return '';
};

const renderRadarrManagedStatus = (state, t) => {
  if (!state) return '';
  if (state === 'running') return t.radarrRunning;
  if (state === 'restarted') return t.radarrRestarted;
  if (state === 'starting') return t.radarrStarting;
  if (state === 'stopped') return t.radarrStopped;
  if (state === 'missing') return t.radarrProcessMissing;
  return '';
};

const renderConnectionStatus = (state, t) => {
  if (!state) return '';
  if (state === 'testing') return t.testing;
  if (state === 'failed') return t.testFailed;
  if (state.startsWith('ok:')) {
    const [, version, count] = state.split(':');
    return `${t.testOk} / v${version} / ${count} indexer`;
  }
  return '';
};

const renderRadarrStatus = (state, t) => {
  if (!state) return '';
  if (state === 'testing') return t.testing;
  if (state === 'disabled') return t.radarrDisabled;
  if (state === 'missing') return t.radarrMissing;
  if (state.startsWith('ok:')) {
    const [, version] = state.split(':');
    return `${t.testOk}${version ? ` (${version})` : ''}`;
  }
  if (state.startsWith('failed:')) {
    const [, message] = state.split(':');
    return message || t.testFailed;
  }
  return t.testFailed;
};

const renderAddStatus = (state, t) => {
  if (!state) return '';
  return t[state] || '';
};

const renderQbRadarrState = (state, t) => {
  if (!state) return '';
  if (state === 'saving') return t.qbToRadarrSaving;
  if (state === 'saved') return t.qbToRadarrSaved;
  if (state.startsWith('failed:')) return `${t.qbToRadarrFailed} ${state.slice(7)}`.trim();
  return '';
};

const getCopy = (language) => ({
  tr: {
    title: 'Ayarlar',
    subtitle: 'Hesap, kaynaklar ve indirme ayarlarini yonet.',
    save: 'Kaydet',
    saved: 'Kaydedildi',
    savingNow: 'Degisiklikler kaydediliyor',
    allChangesSaved: 'Tum degisiklikler kaydedildi',
    unsavedChanges: 'Degisiklikler hazir',
    navGeneral: 'GENEL',
    navAccount: 'HESAP & API',
    navDownload: 'INDIRME',
    navSources: 'KAYNAKLAR',
    generalSettings: 'Genel Ayarlar',
    generalSettingsHint: 'Uygulamanin temel ayarlarini yapilandirin.',
    language: 'Dil',
    languageHint: 'Arayuz dilini aninda degistir.',
    defaultPage: 'Varsayilan Sayfa',
    defaultPageHint: 'Uygulama acildiginda gosterilecek sayfa.',
    notifications: 'Bildirimler',
    notificationsHint: 'Uygulama ici bildirimleri etkinlestir.',
    pageHome: 'Ana Sayfa',
    pageMovies: 'Filmler',
    pageTv: 'Diziler',
    pageAnime: 'Anime',
    pageLibrary: 'Kutuphanem',
    pageMyList: 'Listem',
    pageDownloads: 'Indirilenler',
    pageSearch: 'Arama',
    pageSettings: 'Ayarlar',
    tmdb: 'TMDB API Anahtari',
    tmdbNav: 'API',
    tmdbHint: 'Metadata ve afis aramalari burada calisir.',
    tmdbKeyLabel: 'API anahtari',
    tmdbKeyDesc: 'TMDB uzerinden veri cekmek icin kullanilir.',
    prowlarr: 'Prowlarr',
    radarr: 'Radarr',
    downloadEngine: 'Indirme Motoru',
    downloadEngineHint: 'Gomulu torrent veya qBittorrent sec.',
    embeddedTorrent: 'Gomulu Torrent',
    embeddedTorrentDesc: 'Uygulama icindeki torrent motorunu kullan.',
    qbittorrent: 'qBittorrent',
    qbittorrentDesc: 'Harici qBittorrent istemcisine gecis yap.',
    qbBaseUrl: 'qBittorrent Web UI URL',
    qbUsername: 'qBittorrent Kullanici Adi',
    qbPassword: 'qBittorrent Sifre',
    qbNote: 'qBittorrent > Tools > Options > Web UI: Web User Interface secenegini ac, adres/port ayarla (or: http://127.0.0.1:8080) ve kullanici adi/sifre bilgilerini buraya gir.',
    addQbToRadarr: "qBittorrent'i Radarr'a Ekle",
    qbToRadarrSaving: "Radarr'a ekleniyor...",
    qbToRadarrSaved: "qBittorrent Radarr'a eklendi.",
    qbToRadarrFailed: "qBittorrent Radarr'a eklenemedi.",
    defaultDownloadFolder: 'Varsayilan indirme klasoru',
    selectFolder: 'Klasor sec',
    completedToFolderHint: 'Tamamlanan indirmeler bu klasore kaydedilir.',
    advancedTorrentSettings: 'Gelismis',
    advancedTorrentSettingsHint: 'Ag ve libtorrent ayarlari.',
    dhtDesc: 'Tracker disi es kesfi icin DHT kullan.',
    lsdDesc: 'Yerel agdaki esleri bul.',
    portMapDesc: 'Otomatik port yonlendirme dene.',
    announceAllTrackers: 'Tum trackerlara duyur',
    announceAllTrackersDesc: 'Es kesfini iyilestirmek icin tum tracker katmanlarini kullan.',
    lowSpeedAlert: 'Dusuk hiz uyarisi',
    lowSpeedAlertDesc: 'Hiz bu degerin altina duserse ve belirtilen sure boyunca kalirsa uyar.',
    lowSpeedThreshold: 'Esik (KB/s)',
    lowSpeedDuration: 'Sure (dakika)',
    globalConnectionLimit: 'Maksimum baglanti sayisi',
    globalConnectionLimitDesc: 'Global baglanti limiti.',
    perTorrentConnectionLimit: 'Torrent basina baglanti',
    perTorrentConnectionLimitDesc: 'Her torrent icin baglanti limiti.',
    uploadSlots: 'Yukleme slotu',
    uploadSlotsDesc: 'Upload slot sayisi.',
    diskCacheSize: 'Disk cache boyutu',
    diskCacheSizeDesc: 'Cache ayari.',
    cacheAuto: 'Otomatik',
    diskCacheWarning: 'Ozellikle HDD kullaniminda faydali olabilir, yanlis ayarda RAM tuketimi artar.',
    torrentioBaseUrl: 'Torrentio URL',
    torrentioMaxResults: 'Maksimum sonuc',
    torrentioExcludeKeywords: 'Engellenecek kelimeler',
    torrentioSortBy: 'Siralama',
    torrentioSites: 'Torrent siteleri',
    torrentioHint: 'Virgulle ayrilan kelimeleri iceren sonuclar gizlenir. Ornek: cam,ts,tc',
    showConfig: 'Goster',
    hideConfig: 'Gizle',
    seeders: 'Seedera gore',
    size: 'Boyuta gore',
    name: 'Isme gore',
    prowlarrHint: 'Motor baslatma, baglanti ve indexer yonetimi.',
    radarrHint: 'Film ekleme ve varsayilan Radarr ayarlari.',
    radarrEngineHint: 'CineSoft, Radarr surecini devralir ve kendi ayarlariyla yeniden baslatir.',
    radarrExecutable: 'Radarr.exe yolu',
    downloadRadarr: 'Download Radarr',
    openRadarrWebUI: 'Open Radarr Web UI',
    radarrBaseUrl: 'Radarr Base URL',
    radarrApiKey: 'Radarr API Key',
    radarrDefaults: 'Varsayilanlar',
    radarrRootFolder: 'Default Root Folder',
    radarrQualityProfile: 'Default Quality Profile',
    radarrSearchAfterAdd: 'Search After Add',
    prowlarrSync: 'Prowlarr Sync',
    prowlarrSyncHint: "Use Prowlarr as Radarr's indexer source.",
    prowlarrLabel: 'Prowlarr',
    radarrLabel: 'Radarr',
    syncStatusLabel: 'Sync status',
    connectRadarrToProwlarr: 'Connect Radarr to Prowlarr',
    syncNow: 'Sync Now',
    connected: 'Connected',
    disconnected: 'Disconnected',
    notConfigured: 'Not configured',
    syncPartial: 'Partially configured',
    syncConfiguredShort: 'Configured',
    syncConfigured: 'Sync configured.',
    syncFailed: 'Sync failed.',
    radarrNoRootFoldersTitle: 'No root folders found in Radarr.',
    radarrNoRootFoldersHint: 'Open Radarr Web UI and add a root folder first.',
    selectRootFolder: 'Root folder sec',
    selectQualityProfile: 'Kalite profili sec',
    radarrDisabled: 'Radarr devre disi.',
    radarrMissing: 'Radarr Base URL ve API key gerekli.',
    radarrStarting: 'Radarr baslatiliyor...',
    radarrRunning: 'Radarr CineSoft kontrolunde calisiyor.',
    radarrRestarted: 'Sistemde acik Radarr kapatildi ve CineSoft ayarlariyla yeniden baslatildi.',
    radarrStopped: 'Radarr durduruldu.',
    radarrProcessMissing: 'Radarr binary bulunamadi.',
    downloadProwlarr: 'Download Prowlarr',
    openProwlarrWebUI: 'Open Prowlarr Web UI',
    engine: 'Motor Kontrolu',
    connection: 'Baglanti',
    filters: 'Arama Filtreleri',
    managed: 'CineSoft, Prowlarr surecini devralir ve kendi ayarlariyla yeniden baslatir.',
    executable: 'Prowlarr.exe yolu',
    port: 'Port',
    start: 'Baslat',
    stop: 'Durdur',
    starting: 'Prowlarr baslatiliyor...',
    running: 'Prowlarr CineSoft kontrolunde calisiyor.',
    restarted: 'Sistemde acik Prowlarr kapatildi ve CineSoft ayarlariyla yeniden baslatildi.',
    stopped: 'Prowlarr durduruldu.',
    missing: 'Prowlarr binary bulunamadi.',
    enabled: 'Etkin',
    baseUrl: 'Prowlarr URL',
    prowlarrApiKey: 'Prowlarr API key',
    timeout: 'Timeout',
    test: 'Baglantiyi Test Et',
    testing: 'Test ediliyor...',
    testFailed: 'Baglanti basarisiz.',
    testOk: 'Baglanti hazir',
    movieCategories: 'Film kategorileri',
    tvCategories: 'Dizi kategorileri',
    indexers: 'Indexerlar',
    allIndexers: 'Secim yapmazsan tum etkin indexerlar kullanilir.',
    noIndexers: 'Henuz indexer eklenmemis.',
    indexerFailed: 'Indexer listesi alinamadi.',
    addIndexer: 'Indexer Ekle',
    searchIndexer: 'Indexer ara',
    loadMore: 'Daha Fazla Yukle',
    indexerConfig: 'Indexer Ayarlari',
    closeIndexerConfig: 'Kapat',
    indexerName: 'Indexer adi',
    priority: 'Oncelik',
    testIndexer: 'Indexer test et',
    saveIndexer: 'Indexer kaydet',
    loadingSchemas: 'Katalog yukleniyor...',
    schemaFailed: 'Indexer katalogu alinamadi.',
    testingIndexer: 'Indexer test ediliyor...',
    indexerTestOk: 'Indexer testi basarili.',
    indexerTestFailed: 'Indexer testi basarisiz.',
    addingIndexer: 'Indexer kaydediliyor...',
    indexerAdded: 'Indexer eklendi.',
    indexerAddFailed: 'Indexer eklenemedi.',
  },
  en: {
    title: 'Settings',
    subtitle: 'Manage account, sources, and download settings.',
    save: 'Save',
    saved: 'Saved',
    savingNow: 'Saving changes',
    allChangesSaved: 'All changes saved',
    unsavedChanges: 'Changes ready',
    navGeneral: 'GENERAL',
    navAccount: 'ACCOUNT & API',
    navDownload: 'DOWNLOAD',
    navSources: 'SOURCES',
    generalSettings: 'General Settings',
    generalSettingsHint: 'Configure the app basics.',
    language: 'Language',
    languageHint: 'Switch the interface language instantly.',
    defaultPage: 'Default Page',
    defaultPageHint: 'Page shown when the app opens.',
    notifications: 'Notifications',
    notificationsHint: 'Enable in-app notifications.',
    pageHome: 'Home',
    pageMovies: 'Movies',
    pageTv: 'TV Shows',
    pageAnime: 'Anime',
    pageLibrary: 'Library',
    pageMyList: 'My List',
    pageDownloads: 'Downloads',
    pageSearch: 'Search',
    pageSettings: 'Settings',
    tmdb: 'TMDB API Key',
    tmdbNav: 'API',
    tmdbHint: 'Metadata and artwork lookups run here.',
    tmdbKeyLabel: 'API key',
    tmdbKeyDesc: 'Used for fetching TMDB data.',
    prowlarr: 'Prowlarr',
    radarr: 'Radarr',
    downloadEngine: 'Download Engine',
    downloadEngineHint: 'Choose embedded torrent or qBittorrent.',
    embeddedTorrent: 'Embedded Torrent',
    embeddedTorrentDesc: 'Use the built-in torrent engine.',
    qbittorrent: 'qBittorrent',
    qbittorrentDesc: 'Switch to an external qBittorrent client.',
    qbBaseUrl: 'qBittorrent Web UI URL',
    qbUsername: 'qBittorrent Username',
    qbPassword: 'qBittorrent Password',
    qbNote: 'In qBittorrent go to Tools > Options > Web UI, enable Web User Interface, set host/port (for example http://127.0.0.1:8080), then enter the same username and password here.',
    addQbToRadarr: 'Add qBittorrent to Radarr',
    qbToRadarrSaving: 'Adding to Radarr...',
    qbToRadarrSaved: 'qBittorrent added to Radarr.',
    qbToRadarrFailed: 'Could not add qBittorrent to Radarr.',
    defaultDownloadFolder: 'Default download folder',
    selectFolder: 'Select folder',
    completedToFolderHint: 'Completed downloads are saved to this folder.',
    advancedTorrentSettings: 'Advanced',
    advancedTorrentSettingsHint: 'Network and libtorrent settings.',
    dhtDesc: 'Use DHT for peer discovery without trackers.',
    lsdDesc: 'Find peers on the local network.',
    portMapDesc: 'Try automatic router port mapping.',
    announceAllTrackers: 'Announce to all trackers',
    announceAllTrackersDesc: 'Use every tracker tier to improve peer discovery.',
    lowSpeedAlert: 'Low speed alert',
    lowSpeedAlertDesc: 'Warn when speed stays below this threshold for the selected duration.',
    lowSpeedThreshold: 'Threshold (KB/s)',
    lowSpeedDuration: 'Duration (minutes)',
    globalConnectionLimit: 'Maximum connections',
    globalConnectionLimitDesc: 'Global connection limit.',
    perTorrentConnectionLimit: 'Connections per torrent',
    perTorrentConnectionLimitDesc: 'Per-torrent connection limit.',
    uploadSlots: 'Upload slots',
    uploadSlotsDesc: 'Upload slot count.',
    diskCacheSize: 'Disk cache size',
    diskCacheSizeDesc: 'Cache option.',
    cacheAuto: 'Automatic',
    diskCacheWarning: 'Useful on HDD setups, but wrong values can increase RAM usage.',
    torrentioBaseUrl: 'Torrentio URL',
    torrentioMaxResults: 'Maximum results',
    torrentioExcludeKeywords: 'Blocked keywords',
    torrentioSortBy: 'Sorting',
    torrentioSites: 'Torrent sites',
    torrentioHint: 'Hide results that include comma-separated keywords. Example: cam,ts,tc',
    showConfig: 'Show',
    hideConfig: 'Hide',
    seeders: 'By seeders',
    size: 'By size',
    name: 'By name',
    prowlarrHint: 'Engine start, connection, and indexer management.',
    radarrHint: 'Movie add flow and default Radarr settings.',
    radarrEngineHint: 'CineSoft takes over the Radarr process and restarts it with its own settings.',
    radarrExecutable: 'Radarr executable path',
    downloadRadarr: 'Download Radarr',
    openRadarrWebUI: 'Open Radarr Web UI',
    radarrBaseUrl: 'Radarr Base URL',
    radarrApiKey: 'Radarr API Key',
    radarrDefaults: 'Defaults',
    radarrRootFolder: 'Default Root Folder',
    radarrQualityProfile: 'Default Quality Profile',
    radarrSearchAfterAdd: 'Search After Add',
    prowlarrSync: 'Prowlarr Sync',
    prowlarrSyncHint: "Use Prowlarr as Radarr's indexer source.",
    prowlarrLabel: 'Prowlarr',
    radarrLabel: 'Radarr',
    syncStatusLabel: 'Sync status',
    connectRadarrToProwlarr: 'Connect Radarr to Prowlarr',
    syncNow: 'Sync Now',
    connected: 'Connected',
    disconnected: 'Disconnected',
    notConfigured: 'Not configured',
    syncPartial: 'Partially configured',
    syncConfiguredShort: 'Configured',
    syncConfigured: 'Sync configured.',
    syncFailed: 'Sync failed.',
    radarrNoRootFoldersTitle: 'No root folders found in Radarr.',
    radarrNoRootFoldersHint: 'Open Radarr Web UI and add a root folder first.',
    selectRootFolder: 'Select root folder',
    selectQualityProfile: 'Select quality profile',
    radarrDisabled: 'Radarr is disabled.',
    radarrMissing: 'Radarr Base URL and API key are required.',
    radarrStarting: 'Starting Radarr...',
    radarrRunning: 'Radarr is running under CineSoft control.',
    radarrRestarted: 'A running Radarr instance was stopped and restarted with CineSoft settings.',
    radarrStopped: 'Radarr stopped.',
    radarrProcessMissing: 'Radarr binary was not found.',
    downloadProwlarr: 'Download Prowlarr',
    openProwlarrWebUI: 'Open Prowlarr Web UI',
    engine: 'Engine Control',
    connection: 'Connection',
    filters: 'Search Filters',
    managed: 'CineSoft takes over the Prowlarr process and restarts it with its own settings.',
    executable: 'Prowlarr executable path',
    port: 'Port',
    start: 'Start',
    stop: 'Stop',
    starting: 'Starting Prowlarr...',
    running: 'Prowlarr is running under CineSoft control.',
    restarted: 'A running Prowlarr instance was stopped and restarted with CineSoft settings.',
    stopped: 'Prowlarr stopped.',
    missing: 'Prowlarr binary was not found.',
    enabled: 'Enabled',
    baseUrl: 'Prowlarr URL',
    prowlarrApiKey: 'Prowlarr API key',
    timeout: 'Timeout',
    test: 'Test Connection',
    testing: 'Testing...',
    testFailed: 'Connection failed.',
    testOk: 'Connection ready',
    movieCategories: 'Movie categories',
    tvCategories: 'TV categories',
    indexers: 'Indexers',
    allIndexers: 'If none are selected, all enabled indexers are used.',
    noIndexers: 'No indexers have been added yet.',
    indexerFailed: 'Could not load indexers.',
    addIndexer: 'Add Indexer',
    searchIndexer: 'Search indexer',
    loadMore: 'Load More',
    indexerConfig: 'Indexer Settings',
    closeIndexerConfig: 'Close',
    indexerName: 'Indexer name',
    priority: 'Priority',
    testIndexer: 'Test indexer',
    saveIndexer: 'Save indexer',
    loadingSchemas: 'Loading catalog...',
    schemaFailed: 'Could not load indexer catalog.',
    testingIndexer: 'Testing indexer...',
    indexerTestOk: 'Indexer test passed.',
    indexerTestFailed: 'Indexer test failed.',
    addingIndexer: 'Saving indexer...',
    indexerAdded: 'Indexer added.',
    indexerAddFailed: 'Could not add indexer.',
  },
}[language || 'tr']);

export default SettingsView;
