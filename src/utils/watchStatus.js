export const WATCH_STATUS_STORAGE_KEY = 'cinesoftWatchStatusV1';

export const buildWatchStatusKey = (item = {}, fallbackType = '') => {
  const mediaType = item.media_type || fallbackType || (item.title ? 'movie' : 'tv');
  const rawId = item.anilistId || item.id;
  if (!rawId) return '';
  return `${String(mediaType)}:${String(rawId)}`;
};
