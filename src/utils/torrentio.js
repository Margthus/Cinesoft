export const TORRENTIO_SITE_OPTIONS = [
  { key: 'yts', label: 'YTS' },
  { key: 'thepiratebay', label: 'The Pirate Bay' },
  { key: '1337x', label: '1337x' },
  { key: 'nyaa', label: 'NyaaSi' },
  { key: 'eztv', label: 'EZTV' },
  { key: 'torrentgalaxy', label: 'TorrentGalaxy' },
  { key: 'kickass', label: 'KickassTorrents' },
  { key: 'rarbg', label: 'RARBG' },
  { key: 'horriblesubs', label: 'HorribleSubs' },
  { key: 'tokyotosho', label: 'TokyoTosho' },
  { key: 'anidex', label: 'AniDex' },
  { key: 'nekobt', label: 'nekoBT' },
  { key: 'rutracker', label: 'RuTracker' },
  { key: 'rutor', label: 'Rutor' },
  { key: 'comando', label: 'Comando' },
  { key: 'bludv', label: 'BluDV' },
  { key: 'micoleaodublado', label: 'MicoLeaoDublado' },
  { key: 'torrent9', label: 'Torrent9' },
  { key: 'ilcorsaronero', label: 'ilCorSaRoNeRo' },
  { key: 'mejortorrent', label: 'MejorTorrent' },
  { key: 'wolfmax4k', label: 'Wolfmax4k' },
  { key: 'cinecalidad', label: 'Cinecalidad' },
  { key: 'besttorrents', label: 'BestTorrents' },
  { key: 'zooqle', label: 'Zooqle' },
  { key: 'magnetdl', label: 'MagnetDL' },
  { key: 'torrentdownloads', label: 'TorrentDownloads' },
  { key: 'glodls', label: 'GloDLS' },
  { key: 'limetorrents', label: 'LimeTorrents' },
  { key: 'solidtorrents', label: 'SolidTorrents' },
  { key: 'torlock', label: 'Torlock' },
  { key: 'bitsearch', label: 'BitSearch' },
  { key: 'btdigg', label: 'BTDigg' },
  { key: 'ibit', label: 'iBit' },
  { key: 'all', label: 'Hepsi' },
];

export const DEFAULT_TORRENTIO_ENABLED_SITES = TORRENTIO_SITE_OPTIONS.reduce((acc, site) => {
  acc[site.key] = true;
  return acc;
}, {});

export const DEFAULT_TORRENTIO_CONFIG = {
  baseUrl: 'https://torrentio.strem.fun',
  maxResults: 80,
  excludeKeywords: 'cam,ts,tc',
  sortBy: 'seeders',
  enabledSites: { ...DEFAULT_TORRENTIO_ENABLED_SITES },
};

export const normalizeTorrentioConfig = (config = {}) => ({
  ...DEFAULT_TORRENTIO_CONFIG,
  ...config,
  maxResults: Math.max(10, Number(config.maxResults) || DEFAULT_TORRENTIO_CONFIG.maxResults),
  sortBy: ['seeders', 'size', 'name'].includes(config.sortBy) ? config.sortBy : DEFAULT_TORRENTIO_CONFIG.sortBy,
  enabledSites: {
    ...DEFAULT_TORRENTIO_ENABLED_SITES,
    ...(config.enabledSites?.unknown !== undefined && config.enabledSites?.all === undefined
      ? { all: config.enabledSites.unknown }
      : {}),
    ...(config.enabledSites || {}),
  },
});

export const detectTorrentioSite = (provider = '', title = '') => {
  const hay = `${provider} ${title}`.toLowerCase();
  if (hay.includes('yts')) return 'yts';
  if (hay.includes('the pirate bay') || hay.includes('thepiratebay') || /\btpb\b/.test(hay)) return 'thepiratebay';
  if (hay.includes('1337x')) return '1337x';
  if (hay.includes('nyaasi') || hay.includes('nyaa')) return 'nyaa';
  if (hay.includes('eztv')) return 'eztv';
  if (hay.includes('torrentgalaxy') || /\btgx\b/.test(hay)) return 'torrentgalaxy';
  if (hay.includes('kickass') || hay.includes('kickasstorrents') || /\bkat\b/.test(hay)) return 'kickass';
  if (hay.includes('rarbg')) return 'rarbg';
  if (hay.includes('horriblesubs')) return 'horriblesubs';
  if (hay.includes('tokyotosho')) return 'tokyotosho';
  if (hay.includes('anidex')) return 'anidex';
  if (hay.includes('nekobt')) return 'nekobt';
  if (hay.includes('rutor')) return 'rutor';
  if (hay.includes('comando')) return 'comando';
  if (hay.includes('bludv')) return 'bludv';
  if (hay.includes('micoleaodublado')) return 'micoleaodublado';
  if (hay.includes('torrent9')) return 'torrent9';
  if (hay.includes('ilcorsaronero')) return 'ilcorsaronero';
  if (hay.includes('mejortorrent')) return 'mejortorrent';
  if (hay.includes('wolfmax4k')) return 'wolfmax4k';
  if (hay.includes('cinecalidad')) return 'cinecalidad';
  if (hay.includes('besttorrents')) return 'besttorrents';
  if (hay.includes('zooqle')) return 'zooqle';
  if (hay.includes('rutracker')) return 'rutracker';
  if (hay.includes('magnetdl')) return 'magnetdl';
  if (hay.includes('torrentdownloads')) return 'torrentdownloads';
  if (hay.includes('glodls')) return 'glodls';
  if (hay.includes('limetorrents')) return 'limetorrents';
  if (hay.includes('solidtorrents')) return 'solidtorrents';
  if (hay.includes('torlock')) return 'torlock';
  if (hay.includes('bitsearch')) return 'bitsearch';
  if (hay.includes('btdigg')) return 'btdigg';
  if (hay.includes('ibit')) return 'ibit';
  return 'unknown';
};
