import React, { useEffect, useMemo, useRef } from 'react';

const STATUS_OPTIONS = [
  { key: 'later', tr: 'Izlemek istiyorum', en: 'Want to Watch' },
  { key: 'watched', tr: 'Izledim', en: 'Watched' },
  { key: 'dropped', tr: 'Biraktim', en: 'Dropped' },
];

export const PosterStatusBadge = ({ status, language }) => {
  if (!status) return null;
  const option = STATUS_OPTIONS.find((item) => item.key === status);
  if (!option) return null;
  const label = language === 'tr' ? option.tr : option.en;
  return (
    <div className={`poster-status-badge poster-status-badge--${status}`}>
      {label}
    </div>
  );
};

const PosterStatusMenu = ({ state, language, onClose, onSelect }) => {
  const menuRef = useRef(null);
  const isOpen = Boolean(state?.open);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose();
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [isOpen, onClose]);

  const menuStyle = useMemo(() => {
    if (!isOpen) return {};
    const width = 220;
    const height = 220;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: `${Math.min(state.x, maxLeft)}px`,
      top: `${Math.min(state.y, maxTop)}px`,
    };
  }, [isOpen, state]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="poster-status-menu"
      style={menuStyle}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="poster-status-menu-title">
        {language === 'tr' ? 'Durum Sec' : 'Select Status'}
      </div>
      {STATUS_OPTIONS.map((option) => {
        const label = language === 'tr' ? option.tr : option.en;
        return (
          <button
            key={option.key}
            type="button"
            className={`poster-status-menu-item ${state.status === option.key ? 'active' : ''}`}
            onClick={() => onSelect(option.key)}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        className="poster-status-menu-item clear"
        onClick={() => onSelect('')}
      >
        {language === 'tr' ? 'Durumu Kaldir' : 'Clear Status'}
      </button>
    </div>
  );
};

export default PosterStatusMenu;
