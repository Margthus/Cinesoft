import { SourceProvider } from '../provider.mjs';
import { createStreamSource, PROVIDER_TYPES, SOURCE_TYPES } from '../models.mjs';
import { normalizeProwlarrConfig } from '../config.mjs';

const QUALITY_PATTERNS = [
  ['2160p', /\b(2160p|4k|uhd)\b/i],
  ['1080p', /\b1080p\b/i],
  ['720p', /\b720p\b/i],
  ['480p', /\b480p\b/i],
  ['remux', /\bremux\b/i],
];

export class ProwlarrProvider extends SourceProvider {
  constructor(config = {}) {
    const normalized = normalizeProwlarrConfig(config);
    super({
      name: 'Prowlarr',
      type: PROVIDER_TYPES.PROWLARR,
      enabled: normalized.enabled,
      ...normalized,
    });
  }

  async searchMovie({ title, year } = {}) {
    const query = [title, year].filter(Boolean).join(' ');
    return this.search({
      query,
      categories: this.config.movieCategories,
      indexerIds: this.config.selectedIndexerIds,
      mediaType: 'movie',
    });
  }

  async searchEpisode({ title, season, episode, episodeTitle, episodeName } = {}) {
    const queries = buildEpisodeSearchQueries({
      title,
      season,
      episode,
      episodeTitle: episodeTitle || episodeName,
    });
    const all = [];
    for (const query of queries) {
      const batch = await this.search({
        query,
        categories: this.config.tvCategories,
        indexerIds: this.config.selectedIndexerIds,
        mediaType: 'episode',
        season,
        episode,
      });
      all.push(...batch);
      if (batch.length >= 8) break;
    }
    return all;
  }

  async search({ query, categories, indexerIds, mediaType, season, episode }) {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.apiKey || !query) {
      return [];
    }

    const url = this.buildSearchUrl(query, categories, indexerIds);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': this.config.apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Prowlarr search failed with ${response.status}`);
      }

      const releases = await response.json();
      if (!Array.isArray(releases)) {
        return [];
      }

      return releases.map((release) => this.normalizeRelease(release, { mediaType, season, episode }));
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection() {
    if (!this.config.baseUrl || !this.config.apiKey) {
      return {
        ok: false,
        message: 'Prowlarr URL and API key are required',
      };
    }

    const [status, indexers] = await Promise.all([
      this.requestJson('/api/v1/system/status'),
      this.requestJson('/api/v1/indexer'),
    ]);

    return {
      ok: true,
      version: status?.version || null,
      indexerCount: Array.isArray(indexers) ? indexers.length : 0,
    };
  }

  async getIndexers() {
    if (!this.config.baseUrl || !this.config.apiKey) {
      return [];
    }

    const indexers = await this.requestJson('/api/v1/indexer');
    if (!Array.isArray(indexers)) {
      return [];
    }

    return indexers.map((indexer) => ({
      id: indexer.id,
      name: indexer.name,
      protocol: indexer.protocol,
      implementation: indexer.implementation,
      enabled: indexer.enable !== false,
      priority: indexer.priority,
      tags: indexer.tags || [],
    }));
  }

  async getIndexerSchemas() {
    const schemas = await this.requestJson('/api/v1/indexer/schema');
    if (!Array.isArray(schemas)) {
      return [];
    }

    return schemas.map((schema, index) => ({
      ...schema,
      schemaId: schema.definitionName || schema.implementation || schema.name || `schema-${index}`,
      fields: Array.isArray(schema.fields) ? schema.fields : [],
    }));
  }

  async testIndexer(indexerResource) {
    await this.requestJson('/api/v1/indexer/test', {
      method: 'POST',
      body: normalizeIndexerResource(indexerResource),
    });
    return { ok: true };
  }

  async addIndexer(indexerResource) {
    const created = await this.requestJson('/api/v1/indexer', {
      method: 'POST',
      body: normalizeIndexerResource(indexerResource),
    });
    return {
      ok: true,
      indexer: created,
    };
  }

  async deleteIndexer(indexerId) {
    await this.requestJson(`/api/v1/indexer/${indexerId}`, {
      method: 'DELETE',
    });
    return { ok: true };
  }

  async requestJson(pathname, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          'X-Api-Key': this.config.apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Prowlarr request failed with ${response.status}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  buildSearchUrl(query, categories, indexerIds = []) {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const url = new URL(`${baseUrl}/api/v1/search`);
    url.searchParams.set('query', query);
    url.searchParams.set('type', 'search');

    const categoryList = parseCategoryList(categories);
    categoryList.forEach((category) => url.searchParams.append('categories', category));

    const selectedIndexerIds = Array.isArray(indexerIds)
      ? indexerIds.map((id) => Number(id)).filter(Number.isFinite)
      : [];
    selectedIndexerIds.forEach((id) => url.searchParams.append('indexerIds', String(id)));

    return url;
  }

  normalizeRelease(release, context = {}) {
    const title = release.title || release.name || release.guid || 'Prowlarr Result';
    const infoHash = release.infoHash || extractInfoHash(release.magnetUrl || release.magnet);
    const magnet = release.magnetUrl || release.magnet || null;
    const torrentUrl = release.downloadUrl || release.guid || release.link || null;
    const indexer = release.indexer || release.indexerName || 'Prowlarr';

    return createStreamSource({
      id: `prowlarr:${infoHash || release.guid || release.downloadUrl || title}`,
      title,
      provider: indexer,
      quality: detectQuality(title),
      size: Number.isFinite(Number(release.size)) ? Number(release.size) : null,
      seeders: release.seeders ?? release.seedCount ?? 0,
      peers: release.peers ?? release.leechers ?? release.peerCount ?? 0,
      magnet,
      infoHash,
      torrentUrl,
      languages: detectLanguages(title),
      sourceType: release.protocol === 'usenet' ? SOURCE_TYPES.USENET : SOURCE_TYPES.TORRENT,
      metadata: {
        prowlarr: true,
        indexer,
        protocol: release.protocol,
        publishDate: release.publishDate,
        categories: release.categories || [],
        mediaType: context.mediaType,
        season: context.season,
        episode: context.episode,
      },
    });
  }
}

export const parseCategoryList = (value) => String(value || '')
  .split(',')
  .map((category) => category.trim())
  .filter(Boolean);

export const buildEpisodeSearchQuery = ({ title, season, episode, episodeTitle } = {}) => {
  let episodeCode = '';
  if (season && episode) {
    episodeCode = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  } else if (season) {
    episodeCode = `S${String(season).padStart(2, '0')}`;
  }

  return [title, episodeCode, episodeTitle]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
};

export const buildEpisodeSearchQueries = ({ title, season, episode, episodeTitle } = {}) => {
  const normalize = (v) => String(v || '').trim();
  const baseTitle = normalize(title);
  const enTitle = transliterateTr(baseTitle);
  const epTitle = normalize(episodeTitle);
  const epTitleEn = transliterateTr(epTitle);
  const episodeCode = season && episode
    ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    : season ? `S${String(season).padStart(2, '0')}` : '';

  const chain = [
    [enTitle, episodeCode, epTitleEn].filter(Boolean).join(' '),
    [baseTitle, episodeCode, epTitle].filter(Boolean).join(' '),
    [enTitle, episodeCode].filter(Boolean).join(' '),
    [baseTitle, episodeCode].filter(Boolean).join(' '),
    [enTitle, epTitleEn].filter(Boolean).join(' '),
  ];
  return Array.from(new Set(chain.map((q) => q.trim()).filter(Boolean)));
};

const transliterateTr = (input = '') => String(input)
  .replace(/ç/g, 'c')
  .replace(/Ç/g, 'C')
  .replace(/ğ/g, 'g')
  .replace(/Ğ/g, 'G')
  .replace(/ı/g, 'i')
  .replace(/İ/g, 'I')
  .replace(/ö/g, 'o')
  .replace(/Ö/g, 'O')
  .replace(/ş/g, 's')
  .replace(/Ş/g, 'S')
  .replace(/ü/g, 'u')
  .replace(/Ü/g, 'U');

export const detectQuality = (title = '') => {
  const match = QUALITY_PATTERNS.find(([, pattern]) => pattern.test(title));
  return match ? match[0] : 'unknown';
};

export const detectLanguages = (title = '') => {
  const languages = [];
  if (/\b(tr|turkish|turkce|türkçe)\b/i.test(title)) languages.push('tr');
  if (/\b(en|english)\b/i.test(title)) languages.push('en');
  if (/\bmulti\b/i.test(title)) languages.push('multi');
  return languages;
};

export const extractInfoHash = (magnet = '') => {
  const match = String(magnet).match(/btih:([a-zA-Z0-9]+)/);
  return match ? match[1].toLowerCase() : null;
};

export const normalizeIndexerResource = (resource = {}) => ({
  ...resource,
  id: resource.id || 0,
  name: resource.name || resource.implementationName || resource.definitionName || resource.implementation || 'Indexer',
  enable: resource.enable !== false,
  redirect: resource.redirect === true,
  priority: Number.isFinite(Number(resource.priority)) ? Number(resource.priority) : 25,
  appProfileId: Number.isFinite(Number(resource.appProfileId)) ? Number(resource.appProfileId) : 1,
  downloadClientId: Number.isFinite(Number(resource.downloadClientId)) ? Number(resource.downloadClientId) : 0,
  tags: Array.isArray(resource.tags) ? resource.tags : [],
  fields: Array.isArray(resource.fields) ? resource.fields : [],
});
