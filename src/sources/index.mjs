import { normalizeProwlarrConfig } from './config.mjs';
import { ProviderRegistry } from './registry.mjs';
import { searchEpisodeSources, searchMovieSources } from './aggregator.mjs';
import { ProwlarrProvider } from './providers/prowlarrProvider.mjs';

export const createSourceRegistry = (prowlarrConfig) => {
  const registry = new ProviderRegistry();
  registry.register(new ProwlarrProvider(normalizeProwlarrConfig(prowlarrConfig)));
  return registry;
};

export const searchStreamSourcesForMovie = async (prowlarrConfig, params) => {
  const registry = createSourceRegistry(prowlarrConfig);
  return searchMovieSources(registry, params);
};

export const searchStreamSourcesForEpisode = async (prowlarrConfig, params) => {
  const registry = createSourceRegistry(prowlarrConfig);
  return searchEpisodeSources(registry, params);
};

export const testProwlarrConnection = async (prowlarrConfig) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.testConnection();
};

export const getProwlarrIndexers = async (prowlarrConfig) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.getIndexers();
};

export const getProwlarrIndexerSchemas = async (prowlarrConfig) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.getIndexerSchemas();
};

export const testProwlarrIndexer = async (prowlarrConfig, indexerResource) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.testIndexer(indexerResource);
};

export const addProwlarrIndexer = async (prowlarrConfig, indexerResource) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.addIndexer(indexerResource);
};

export const deleteProwlarrIndexer = async (prowlarrConfig, indexerId) => {
  const provider = new ProwlarrProvider(normalizeProwlarrConfig({
    ...prowlarrConfig,
    enabled: true,
  }));
  return provider.deleteIndexer(indexerId);
};

export * from './aggregator.mjs';
export * from './config.mjs';
export * from './models.mjs';
export * from './provider.mjs';
export * from './registry.mjs';
export * from './providers/prowlarrProvider.mjs';
