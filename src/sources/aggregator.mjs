import { createStreamSource, isValidStreamSource } from './models.mjs';

const QUALITY_WEIGHT = {
  remux: 600,
  '2160p': 500,
  '4k': 500,
  uhd: 500,
  '1080p': 400,
  '720p': 300,
  '480p': 200,
  unknown: 0,
};

const getQualityWeight = (quality = '') => {
  const normalized = String(quality).toLowerCase();
  const match = Object.keys(QUALITY_WEIGHT).find((key) => normalized.includes(key));
  return match ? QUALITY_WEIGHT[match] : QUALITY_WEIGHT.unknown;
};

const getDuplicateKey = (source) => {
  if (source.infoHash) return `hash:${source.infoHash}`;
  if (source.magnet) return `magnet:${source.magnet}`;
  if (source.torrentUrl) return `url:${source.torrentUrl}`;
  return `fallback:${source.provider}:${source.title}:${source.size || 0}`;
};

export const dedupeStreamSources = (sources) => {
  const byKey = new Map();
  sources.forEach((source) => {
    const key = getDuplicateKey(source);
    const existing = byKey.get(key);
    if (!existing || compareStreamSources(source, existing) < 0) {
      byKey.set(key, source);
    }
  });
  return Array.from(byKey.values());
};

export const compareStreamSources = (a, b) => {
  const qualityDiff = getQualityWeight(b.quality) - getQualityWeight(a.quality);
  if (qualityDiff !== 0) return qualityDiff;

  const seedDiff = (b.seeders || 0) - (a.seeders || 0);
  if (seedDiff !== 0) return seedDiff;

  const priorityDiff = (a.metadata?.providerPriority ?? 100) - (b.metadata?.providerPriority ?? 100);
  if (priorityDiff !== 0) return priorityDiff;

  return (a.size || 0) - (b.size || 0);
};

export const aggregateProviderResults = (providerResponses = []) => {
  const normalized = providerResponses.flatMap((response) => {
    const provider = response?.provider || 'unknown';
    return (response?.results || []).map((source) => createStreamSource({
      ...source,
      provider: source.provider || provider,
    }));
  });

  return dedupeStreamSources(normalized.filter(isValidStreamSource))
    .sort(compareStreamSources);
};

export const searchMovieSources = async (registry, params) => {
  const providerResponses = await registry.searchMovie(params);
  return aggregateProviderResults(providerResponses);
};

export const searchEpisodeSources = async (registry, params) => {
  const providerResponses = await registry.searchEpisode(params);
  return aggregateProviderResults(providerResponses);
};
