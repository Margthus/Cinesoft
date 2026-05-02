export const DEFAULT_PROWLARR_CONFIG = {
  enabled: false,
  managed: true,
  baseUrl: 'http://localhost:9696',
  apiKey: '',
  executablePath: '',
  port: 9696,
  timeout: 10000,
  movieCategories: '2000,2010,2020,2030,2040,2045,2050',
  tvCategories: '5000,5010,5020,5030,5040,5045,5050,5060,5070,5080',
  selectedIndexerIds: [],
};

export const normalizeProwlarrConfig = (config = {}) => ({
  ...DEFAULT_PROWLARR_CONFIG,
  ...config,
  enabled: config.enabled === true,
  managed: config.managed !== false,
  baseUrl: config.baseUrl || DEFAULT_PROWLARR_CONFIG.baseUrl,
  apiKey: config.apiKey || '',
  executablePath: config.executablePath || '',
  port: Number.isFinite(Number(config.port)) ? Number(config.port) : DEFAULT_PROWLARR_CONFIG.port,
  timeout: Number.isFinite(Number(config.timeout)) ? Number(config.timeout) : DEFAULT_PROWLARR_CONFIG.timeout,
  movieCategories: config.movieCategories || DEFAULT_PROWLARR_CONFIG.movieCategories,
  tvCategories: config.tvCategories || DEFAULT_PROWLARR_CONFIG.tvCategories,
  selectedIndexerIds: Array.isArray(config.selectedIndexerIds)
    ? config.selectedIndexerIds.map((id) => Number(id)).filter(Number.isFinite)
    : DEFAULT_PROWLARR_CONFIG.selectedIndexerIds,
});

export const toPublicProwlarrConfig = (config) => {
  const normalized = normalizeProwlarrConfig(config);
  return {
    ...normalized,
    apiKey: normalized.apiKey ? '***' : '',
  };
};
