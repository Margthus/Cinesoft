export const PROVIDER_TYPES = Object.freeze({
  PROWLARR: 'prowlarr',
});

export const SOURCE_TYPES = Object.freeze({
  TORRENT: 'torrent',
  STREAM: 'stream',
  DEBRID: 'debrid',
  USENET: 'usenet',
});

export const createStreamSource = ({
  id,
  title,
  provider,
  quality = 'unknown',
  size = null,
  seeders = 0,
  peers = 0,
  magnet = null,
  infoHash = null,
  torrentUrl = null,
  languages = [],
  sourceType = SOURCE_TYPES.TORRENT,
  metadata = {},
}) => ({
  id: String(id || `${provider}:${title}`),
  title: String(title || '').trim(),
  provider: String(provider || '').trim(),
  quality: String(quality || 'unknown').toLowerCase(),
  size: typeof size === 'number' ? size : null,
  seeders: Number.isFinite(Number(seeders)) ? Number(seeders) : 0,
  peers: Number.isFinite(Number(peers)) ? Number(peers) : 0,
  magnet,
  infoHash: infoHash ? String(infoHash).toLowerCase() : null,
  torrentUrl,
  languages: Array.isArray(languages) ? languages.filter(Boolean) : [],
  sourceType,
  metadata: metadata && typeof metadata === 'object' ? metadata : {},
});

export const isValidStreamSource = (source) => {
  if (!source || typeof source !== 'object') return false;
  if (!source.title || !source.provider) return false;
  return Boolean(source.magnet || source.infoHash || source.torrentUrl);
};
