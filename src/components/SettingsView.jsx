import React, { useEffect, useState } from 'react';
import { FolderOpen, Globe, Key, Radar, Play, RefreshCcw, Save, Square, Search, Trash2, Shield, X } from 'lucide-react';
import { DEFAULT_PROWLARR_CONFIG, normalizeProwlarrConfig } from '../sources/index.mjs';
import '../styles/SettingsView.css';

const SettingsView = ({ settings, setSettings }) => {
  const [formData, setFormData] = useState({
    ...settings,
    prowlarr: normalizeProwlarrConfig(settings.prowlarr || DEFAULT_PROWLARR_CONFIG),
    torrentio: settings.torrentio || {
      baseUrl: 'https://torrentio.strem.fun',
      maxResults: 80,
      excludeKeywords: 'cam,ts,tc',
    },
  });
  const [saveState, setSaveState] = useState('');
  const [prowlarrStatus, setProwlarrStatus] = useState('');
  const [managedStatus, setManagedStatus] = useState('');
  const [indexers, setIndexers] = useState([]);
  const [indexerStatus, setIndexerStatus] = useState('');
  const [schemas, setSchemas] = useState([]);
  const [schemaQuery, setSchemaQuery] = useState('');
  const [indexerDraft, setIndexerDraft] = useState(null);
  const [addState, setAddState] = useState('');
  const [schemaVisibleCount, setSchemaVisibleCount] = useState(80);

  useEffect(() => {
    refreshIndexers();
  }, []);

  useEffect(() => {
    if (!formData.prowlarr.enabled) return;
    if (indexers.length > 0 || indexerStatus === 'loading') return;

    const retryTimer = setTimeout(() => {
      refreshIndexers();
    }, 1200);

    return () => clearTimeout(retryTimer);
  }, [formData.prowlarr.enabled, formData.prowlarr.baseUrl, formData.prowlarr.apiKey, indexers.length, indexerStatus]);

  const updateRoot = (changes) => {
    setFormData((current) => {
      const next = { ...current, ...changes };
      if ('torrentioEnabled' in changes || 'useQbittorrent' in changes || 'qbittorrent' in changes || 'torrentio' in changes) {
        window.electronAPI?.saveSettings?.(next).then(() => setSettings(next));
      }
      return next;
    });
  };

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
    setManagedStatus('stopped');
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
  const starredNames = ['yts', 'the pirate bay', 'nyaa.si'];

  const filteredSchemas = schemas.filter((schema) => {
    const sName = `${schema.name || ''} ${schema.implementationName || ''} ${schema.definitionName || ''}`.toLowerCase();
    if (sName.includes('sukebei')) return false;
    return sName.includes(schemaQuery.toLowerCase());
  }).sort((a, b) => {
    const aName = (a.name || a.definitionName || '').toLowerCase();
    const bName = (b.name || b.definitionName || '').toLowerCase();

    // Check if exact match
    const isAStarred = starredNames.includes(aName);
    const isBStarred = starredNames.includes(bName);

    if (isAStarred && !isBStarred) return -1;
    if (!isAStarred && isBStarred) return 1;
    return 0;
  });

  const visibleSchemas = filteredSchemas.slice(0, schemaVisibleCount);

  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button className="settings-save-btn" onClick={handleSave} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? <RefreshCcw className="spin" size={18} /> : <Save size={18} />}
          {saveState === 'saved' ? t.saved : t.save}
        </button>
      </div>

      <div className="settings-grid">
        <section className="settings-card settings-card-wide content-card">
          <header className="settings-card-header">
            <Globe size={18} />
            <div>
              <h2>{t.language}</h2>
              <p>{t.languageHint}</p>
            </div>
          </header>
          <div className="segmented-control">
            <button className={formData.language === 'tr' ? 'active' : ''} onClick={() => updateRoot({ language: 'tr' })}>Turkce</button>
            <button className={formData.language === 'en' ? 'active' : ''} onClick={() => updateRoot({ language: 'en' })}>English</button>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <Key size={18} />
            <div>
              <h2>{t.tmdb}</h2>
              <p>{t.tmdbHint}</p>
            </div>
          </header>
          <input
            className="settings-input"
            value={formData.apiKey}
            onChange={(event) => updateRoot({ apiKey: event.target.value })}
            placeholder={t.tmdb}
          />
        </section>

        <section className="settings-card settings-card-full">
          <header className="settings-card-header">
            <Globe size={18} />
            <div>
              <h2>{t.downloadEngine}</h2>
              <p>{t.downloadEngineHint}</p>
            </div>
          </header>

          <div className="panel-grid">
            <label className="toggle-field">
              <span>{t.embeddedTorrent}</span>
              <Toggle
                checked={!formData.useQbittorrent}
                onChange={(checked) => {
                  updateRoot({ useQbittorrent: !checked });
                }}
              />
            </label>

            <label className="toggle-field">
              <span>{t.qbittorrent}</span>
              <Toggle
                checked={Boolean(formData.useQbittorrent)}
                onChange={(checked) => {
                  updateRoot({ useQbittorrent: checked });
                }}
              />
            </label>

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
          <p className="settings-helper" style={{ marginTop: '0.75rem' }}>{t.qbNote}</p>
        </section>

        <section className="settings-card settings-card-full">
          <header className="settings-card-header">
            <Globe size={18} />
            <div>
              <h2>{settings.language === 'tr' ? 'Torrentio (Stremio)' : 'Torrentio (Stremio)'}</h2>
              <p>{settings.language === 'tr' ? 'Torrentio eklentisini kaynak olarak kullan.' : 'Use Torrentio addon as source.'}</p>
            </div>
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
          </header>
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
          </div>
          <p className="settings-helper" style={{ marginTop: '0.75rem' }}>{t.torrentioHint}</p>
        </section>

        <section className="settings-card settings-card-full prowlarr-card-shell">
          <header className="settings-card-header">
            <Radar size={18} />
            <div>
              <h2>{t.prowlarr}</h2>
              <p>{t.prowlarrHint}</p>
              <p style={{ color: 'var(--accent)', marginTop: '0.4rem', fontSize: '0.85rem', fontWeight: 500 }}>
                {t.prowlarrAnimeHint}
              </p>
            </div>
          </header>

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
                  <button className="action-btn start" onClick={handleStartProwlarr} disabled={managedStatus === 'starting'}>
                    {managedStatus === 'starting' ? <RefreshCcw className="spin" size={16} /> : <Play size={16} />}
                    {t.start}
                  </button>
                  <button className="action-btn stop" onClick={handleStopProwlarr}>
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
                    updateProwlarr({ enabled: checked });
                    if (checked) {
                      updateRoot({ torrentioEnabled: false });
                      if (!formData.prowlarr.managed || managedStatus !== 'running') {
                        updateProwlarr({ managed: true });
                        await handleStartProwlarr({ ...formData.prowlarr, enabled: true, managed: true });
                      }
                      await refreshIndexers();
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
        </section>
      </div>
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
    return (
      <label className="stacked-field">
        <span>{field.label || field.name}</span>
        <select className="settings-input" value={value || ''} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value ?? option.name ?? option} value={option.value ?? option.name ?? option}>
              {option.name ?? option.label ?? option.value ?? option}
            </option>
          ))}
        </select>
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

const renderAddStatus = (state, t) => {
  if (!state) return '';
  return t[state] || '';
};

const getCopy = (language) => ({
  tr: {
    title: 'Ayarlar',
    subtitle: 'Hesap, metadata ve Prowlarr kontrolu tek yerden yonetiliyor.',
    save: 'Kaydet',
    saved: 'Kaydedildi',
    language: 'Dil',
    languageHint: 'Arayuz dilini aninda degistir.',
    tmdb: 'TMDB API Anahtari',
    tmdbHint: 'Metadata ve afis aramalari burada calisir.',
    prowlarr: 'Prowlarr',
    downloadEngine: 'Indirme Motoru',
    downloadEngineHint: 'Gomulu torrent veya qBittorrent sec.',
    embeddedTorrent: 'Gomulu Torrent',
    qbittorrent: 'qBittorrent',
    qbBaseUrl: 'qBittorrent Web UI URL',
    qbUsername: 'qBittorrent Kullanici Adi',
    qbPassword: 'qBittorrent Sifre',
    qbNote: 'qBittorrent > Tools > Options > Web UI: Web User Interface secenegini ac, adres/port ayarla (or: http://127.0.0.1:8080) ve kullanici adi/sifre bilgilerini buraya gir.',
    torrentioBaseUrl: 'Torrentio URL',
    torrentioMaxResults: 'Maksimum sonuc',
    torrentioExcludeKeywords: 'Engellenecek kelimeler',
    torrentioHint: 'Virgulle ayrilan kelimeleri iceren sonuclar gizlenir. Ornek: cam,ts,tc',
    prowlarrHint: 'Motor baslatma, baglanti ve indexer yonetimi.',
    prowlarrAnimeHint: 'Animelerde ve Dizilerde daha iyi sonuçlar almak için Prowlarr kullanın.',
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
    subtitle: 'Account, metadata and Prowlarr control live in one place.',
    save: 'Save',
    saved: 'Saved',
    language: 'Language',
    languageHint: 'Switch the interface language instantly.',
    tmdb: 'TMDB API Key',
    tmdbHint: 'Metadata and artwork lookups run here.',
    prowlarr: 'Prowlarr',
    downloadEngine: 'Download Engine',
    downloadEngineHint: 'Choose embedded torrent or qBittorrent.',
    embeddedTorrent: 'Embedded Torrent',
    qbittorrent: 'qBittorrent',
    qbBaseUrl: 'qBittorrent Web UI URL',
    qbUsername: 'qBittorrent Username',
    qbPassword: 'qBittorrent Password',
    qbNote: 'In qBittorrent go to Tools > Options > Web UI, enable Web User Interface, set host/port (for example http://127.0.0.1:8080), then enter the same username and password here.',
    torrentioBaseUrl: 'Torrentio URL',
    torrentioMaxResults: 'Maximum results',
    torrentioExcludeKeywords: 'Blocked keywords',
    torrentioHint: 'Hide results that include comma-separated keywords. Example: cam,ts,tc',
    prowlarrHint: 'Engine start, connection, and indexer management.',
    prowlarrAnimeHint: 'Use Prowlarr for better results in anime and TV shows.',
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
