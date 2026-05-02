import React, { useEffect, useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';

const LogsView = ({ settings }) => {
  const [logs, setLogs] = useState([]);

  const load = useCallback(async () => {
    const result = await window.electronAPI?.getLogs?.();
    setLogs(Array.isArray(result?.logs) ? result.logs : []);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [load]);

  const clear = async () => {
    await window.electronAPI?.clearLogs?.();
    load();
  };

  const isTr = settings.language === 'tr';
  return (
    <div className="downloads-view">
      <div className="downloads-header">
        <h1>{isTr ? 'Sistem Loglari' : 'System Logs'}</h1>
        <button className="torrent-settings-trigger" onClick={clear}>
          <Trash2 size={16} />
          {isTr ? 'Temizle' : 'Clear'}
        </button>
      </div>
      <div className="downloads-list">
        {logs.map((entry) => (
          <div key={entry.id} className="torrent-card">
            <div className="torrent-info">
              <div className="torrent-title-row">
                <h3 className="torrent-title">{entry.source} / {entry.code}</h3>
                <div className="torrent-status-chip status-paused">{new Date(entry.time).toLocaleTimeString()}</div>
              </div>
              <span className="torrent-name">{entry.message}</span>
              {!!entry.details?.error && <span className="torrent-name">{entry.details.error}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogsView;
