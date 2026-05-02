import React, { useEffect, useState, useCallback } from 'react';
import { PlayCircle, Library, HardDrive } from 'lucide-react';
import { searchContent } from '../utils/tmdb';
import '../styles/LibraryView.css';

const LibraryView = ({ settings }) => {
  const [items, setItems] = useState([]);
  const [rootDir, setRootDir] = useState('');

  const load = useCallback(async () => {
    const [scanResult, torrentResult] = await Promise.all([
      window.electronAPI?.scanLibrary?.(),
      window.electronAPI?.torrentGetAll?.(),
    ]);
    if (!scanResult?.ok) return;
    const scanned = Array.isArray(scanResult.items) ? scanResult.items : [];
    const torrents = Array.isArray(torrentResult?.torrents) ? torrentResult.torrents : [];
    const pathMap = new Map();
    torrents.forEach((torrent) => {
      const savePath = String(torrent.savePath || '');
      const relPath = String(torrent.videoFile?.path || '');
      if (!savePath || !relPath) return;
      const fullPath = `${savePath}\\${relPath}`.replace(/\//g, '\\').toLowerCase();
      pathMap.set(fullPath, torrent.mediaInfo?.poster || '');
    });
    const baseItems = scanned.map((item) => {
      const normalizedPath = String(item.fullPath || '').replace(/\//g, '\\').toLowerCase();
      return {
        ...item,
        poster: pathMap.get(normalizedPath) || '',
      };
    });

    const cached = await window.electronAPI?.getLibraryMetadata?.(baseItems.map((item) => item.fullPath));
    const cacheMap = new Map((cached?.items || []).map((row) => [String(row.filePath || '').toLowerCase(), row]));
    setItems((current) => {
      const currentMap = new Map(current.map((entry) => [String(entry.id), entry.poster || '']));
      return baseItems.map((item) => {
        const normalizedPath = String(item.fullPath || '').replace(/\//g, '\\').toLowerCase();
        const cachedItem = cacheMap.get(normalizedPath);
        return {
          ...item,
          poster: item.poster || cachedItem?.posterUrl || currentMap.get(String(item.id)) || '',
        };
      });
    });
    setRootDir(scanResult.rootDir || '');
  }, []);

  useEffect(() => {
    const fillMissingPosters = async () => {
      if (!settings?.apiKey || !items.length) return;
      const missing = items.filter((item) => !item.poster).slice(0, 40);
      if (!missing.length) return;

      const updates = await Promise.all(missing.map(async (item) => {
        const parsed = parseLibraryTitle(item.title || item.fileName || '');
        if (!parsed.query) return { id: item.id, poster: '' };

        const candidates = Array.from(new Set([
          parsed.query,
          parsed.query.replace(/\b(complete|season|seasons|episode|episodes)\b/gi, '').replace(/\s+/g, ' ').trim(),
          parsed.query.split(' ').slice(0, 3).join(' ').trim(),
        ].filter(Boolean)));

        let poster = '';
        for (const q of candidates) {
          const results = await queryTmdbCandidates(settings.apiKey, q, parsed.year);
          const picked = pickBestResult(results, parsed.year);
          if (picked?.poster_path) {
            poster = `https://image.tmdb.org/t/p/w500${picked.poster_path}`;
            break;
          }
        }

        return { id: item.id, poster };
      }));

      setItems((current) => current.map((item) => {
        const match = updates.find((u) => u.id === item.id);
        if (!match || !match.poster) return item;
        window.electronAPI?.upsertLibraryMetadata?.({
          filePath: item.fullPath,
          fileHash: item.fileHash || '',
          title: item.title || '',
          year: parseLibraryTitle(item.title || item.fileName || '').year || null,
          posterUrl: match.poster,
          tmdbId: null,
          mediaType: '',
        });
        return { ...item, poster: match.poster };
      }));
    };
    fillMissingPosters();
  }, [items, settings?.apiKey]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  const openVideo = async (item) => {
    await window.electronAPI?.openLibraryVideo?.({ fullPath: item.fullPath });
  };

  const isTr = settings.language === 'tr';
  return (
    <div className="library-view">
      <header className="library-header">
        <h1>{isTr ? 'Kutuphanem' : 'Library'}</h1>
        <p>{isTr ? 'Secili indirme dizini taranarak video dosyalari listelenir.' : 'Video files are listed by scanning the selected download directory.'}</p>
        {!!rootDir && <span className="library-root">{rootDir}</span>}
      </header>

      {!items.length && (
        <div className="library-empty">
          <Library size={56} />
          <strong>{isTr ? 'Henuz kutuphane icerigi yok' : 'No library items yet'}</strong>
        </div>
      )}

      <div className="library-grid">
        {items.map((item) => (
          <button key={item.id} className="library-card" onClick={() => openVideo(item)}>
            <div className="library-poster">
              {item.poster ? (
                <img src={item.poster} alt={item.title} />
              ) : (
                <div className="library-poster-fallback"><HardDrive size={24} /></div>
              )}
              <div className="library-play-overlay"><PlayCircle size={34} /></div>
            </div>
            <div className="library-meta">
              <strong>{item.title}</strong>
              <span>{item.fileName}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const normalizeLibraryTitle = (value) => {
  const raw = String(value || '');
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|bluray|webrip|web-dl|dvdrip|hdrip|brrip|yify|yts|rarbg)\b/gi, ' ')
    .replace(/\b(S\d{1,2}E\d{1,2}|S\d{1,2}|E\d{1,2})\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseLibraryTitle = (value) => {
  const original = String(value || '');
  const yearMatch = original.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const query = normalizeLibraryTitle(
    original
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, (chunk) => (/\b(19|20)\d{2}\b/.test(chunk) ? chunk : ' '))
      .replace(/-/g, ' ')
  );
  return { query, year };
};

const pickBestResult = (results, year) => {
  const usable = (results || []).filter((r) => r.poster_path && (r.media_type === 'movie' || r.media_type === 'tv' || !r.media_type));
  if (!usable.length) return null;
  if (!year) return usable[0];

  const scored = usable.map((item) => {
    const dateRaw = item.release_date || item.first_air_date || '';
    const itemYear = Number(String(dateRaw).slice(0, 4)) || 0;
    const yearPenalty = itemYear ? Math.abs(itemYear - year) : 5;
    return { item, score: yearPenalty };
  }).sort((a, b) => a.score - b.score);
  return scored[0]?.item || usable[0];
};

const queryTmdbCandidates = async (apiKey, query, year) => {
  const multi = await searchContent(apiKey, 'en', query, 1);
  const base = Array.isArray(multi) ? multi : [];
  if (base.length > 0) return base;

  const endpoints = ['movie', 'tv'];
  const results = [];
  for (const type of endpoints) {
    const url = new URL(`https://api.themoviedb.org/3/search/${type}`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('language', 'en-US');
    if (year && type === 'movie') url.searchParams.set('year', String(year));
    if (year && type === 'tv') url.searchParams.set('first_air_date_year', String(year));
    try {
      const response = await fetch(url.toString());
      const data = await response.json();
      const mapped = Array.isArray(data?.results) ? data.results.map((item) => ({ ...item, media_type: type })) : [];
      results.push(...mapped);
    } catch {
      // ignore and continue
    }
  }
  return results;
};

export default LibraryView;
