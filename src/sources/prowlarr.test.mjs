import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from './registry.mjs';
import { searchMovieSources } from './aggregator.mjs';
import {
  ProwlarrProvider,
  buildEpisodeSearchQuery,
  detectLanguages,
  detectQuality,
  extractInfoHash,
  parseCategoryList,
} from './providers/prowlarrProvider.mjs';
import { normalizeProwlarrConfig } from './config.mjs';

const createProvider = (config = {}) => new ProwlarrProvider({
  enabled: true,
  baseUrl: 'http://localhost:9696',
  apiKey: 'secret',
  timeout: 1000,
  ...config,
});

test('normalizes prowlarr defaults', () => {
  const config = normalizeProwlarrConfig({ enabled: true, timeout: '3000' });

  assert.equal(config.enabled, true);
  assert.equal(config.baseUrl, 'http://localhost:9696');
  assert.equal(config.timeout, 3000);
});

test('parses category lists', () => {
  assert.deepEqual(parseCategoryList('2000, 2040,, 2045'), ['2000', '2040', '2045']);
});

test('builds episode search query with show title, episode code, and episode title', () => {
  assert.equal(
    buildEpisodeSearchQuery({
      title: 'Example Show',
      season: 1,
      episode: 2,
      episodeTitle: 'Pilot',
    }),
    'Example Show S01E02 Pilot',
  );
});

test('detects quality, language, and magnet info hash', () => {
  assert.equal(detectQuality('Example 2160p WEB-DL'), '2160p');
  assert.deepEqual(detectLanguages('Example TR EN MULTI 1080p'), ['tr', 'en', 'multi']);
  assert.equal(extractInfoHash('magnet:?xt=urn:btih:ABC123&dn=Example'), 'abc123');
});

test('builds prowlarr search url without exposing api key in query params', () => {
  const provider = createProvider({ movieCategories: '2000,2040' });
  const url = provider.buildSearchUrl('Example 2024', provider.config.movieCategories, [3, 7]);

  assert.equal(url.origin, 'http://localhost:9696');
  assert.equal(url.pathname, '/api/v1/search');
  assert.equal(url.searchParams.get('query'), 'Example 2024');
  assert.equal(url.searchParams.get('type'), 'search');
  assert.deepEqual(url.searchParams.getAll('categories'), ['2000', '2040']);
  assert.deepEqual(url.searchParams.getAll('indexerIds'), ['3', '7']);
  assert.equal(url.search.includes('secret'), false);
});

test('searchMovie calls prowlarr and normalizes torrent releases', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers['X-Api-Key'], 'secret');
    assert.equal(url.searchParams.get('query'), 'Example 2024');

    return {
      ok: true,
      json: async () => [
        {
          title: 'Example 2024 1080p TR',
          indexer: 'Indexer A',
          size: 2147483648,
          seeders: 25,
          leechers: 4,
          magnetUrl: 'magnet:?xt=urn:btih:ABC123&dn=Example',
          protocol: 'torrent',
          publishDate: '2026-01-01T00:00:00Z',
        },
      ],
    };
  };

  try {
    const provider = createProvider();
    const results = await provider.searchMovie({ title: 'Example', year: 2024 });

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'Indexer A');
    assert.equal(results[0].quality, '1080p');
    assert.equal(results[0].infoHash, 'abc123');
    assert.deepEqual(results[0].languages, ['tr']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchEpisode calls prowlarr with full episode context', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers['X-Api-Key'], 'secret');
    assert.equal(url.searchParams.get('query'), 'Example Show S01E02 Pilot');

    return {
      ok: true,
      json: async () => [],
    };
  };

  try {
    const provider = createProvider();
    await provider.searchEpisode({
      title: 'Example Show',
      season: 1,
      episode: 2,
      episodeTitle: 'Pilot',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disabled prowlarr is not searched', async () => {
  const provider = createProvider({ enabled: false });

  assert.deepEqual(await provider.searchMovie({ title: 'Example' }), []);
});

test('prowlarr errors are isolated by registry aggregation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });

  try {
    const registry = new ProviderRegistry([createProvider()]);
    const results = await searchMovieSources(registry, { title: 'Example' });

    assert.deepEqual(results, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testConnection checks system status and indexers', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url, options) => {
    requested.push(url);
    assert.equal(options.headers['X-Api-Key'], 'secret');

    if (String(url).endsWith('/api/v1/system/status')) {
      return { ok: true, json: async () => ({ version: '2.3.5.5327' }) };
    }

    return { ok: true, json: async () => [{ id: 1 }, { id: 2 }] };
  };

  try {
    const provider = createProvider();
    const result = await provider.testConnection();

    assert.equal(result.ok, true);
    assert.equal(result.version, '2.3.5.5327');
    assert.equal(result.indexerCount, 2);
    assert.equal(requested.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getIndexers returns configured indexers for selection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url).endsWith('/api/v1/indexer'), true);
    assert.equal(options.headers['X-Api-Key'], 'secret');

    return {
      ok: true,
      json: async () => [
        {
          id: 12,
          name: 'Indexer A',
          protocol: 'torrent',
          implementation: 'Cardigann',
          enable: true,
          priority: 25,
        },
      ],
    };
  };

  try {
    const provider = createProvider();
    const indexers = await provider.getIndexers();

    assert.deepEqual(indexers, [
      {
        id: 12,
        name: 'Indexer A',
        protocol: 'torrent',
        implementation: 'Cardigann',
        enabled: true,
        priority: 25,
        tags: [],
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getIndexerSchemas returns schema fields for CineSoft forms', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url).endsWith('/api/v1/indexer/schema'), true);
    return {
      ok: true,
      json: async () => [
        {
          name: 'Example Indexer',
          implementation: 'Cardigann',
          definitionName: 'example',
          fields: [{ name: 'baseUrl', label: 'Base URL', value: 'https://example.test' }],
        },
      ],
    };
  };

  try {
    const provider = createProvider();
    const schemas = await provider.getIndexerSchemas();

    assert.equal(schemas[0].schemaId, 'example');
    assert.equal(schemas[0].fields[0].name, 'baseUrl');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testIndexer and addIndexer post normalized resources', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['X-Api-Key'], 'secret');

    return {
      ok: true,
      json: async () => ({ id: 99, name: 'Example Indexer' }),
    };
  };

  try {
    const provider = createProvider();
    const resource = {
      name: 'Example Indexer',
      implementation: 'Cardigann',
      configContract: 'CardigannSettings',
      fields: [{ name: 'baseUrl', value: 'https://example.test' }],
    };

    assert.deepEqual(await provider.testIndexer(resource), { ok: true });
    const added = await provider.addIndexer(resource);

    assert.equal(added.ok, true);
    assert.equal(added.indexer.id, 99);
    assert.equal(calls[0].url.endsWith('/api/v1/indexer/test'), true);
    assert.equal(calls[1].url.endsWith('/api/v1/indexer'), true);
    assert.equal(calls[1].body.enable, true);
    assert.equal(calls[1].body.appProfileId, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
