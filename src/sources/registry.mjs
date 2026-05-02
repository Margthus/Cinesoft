export class ProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map();
    providers.forEach((provider) => this.register(provider));
  }

  register(provider) {
    if (!provider?.name || !provider?.type) {
      throw new Error('Provider must include name and type');
    }
    this.providers.set(provider.name, provider);
    return provider;
  }

  unregister(name) {
    return this.providers.delete(name);
  }

  setEnabled(name, enabled) {
    const provider = this.providers.get(name);
    if (!provider) return false;
    provider.enabled = Boolean(enabled);
    return true;
  }

  getActiveProviders() {
    return Array.from(this.providers.values())
      .filter((provider) => provider.enabled !== false)
      .sort((a, b) => (a.config?.priority ?? 100) - (b.config?.priority ?? 100));
  }

  async searchMovie(params) {
    return this.searchAll('searchMovie', params);
  }

  async searchEpisode(params) {
    return this.searchAll('searchEpisode', params);
  }

  async searchAll(method, params) {
    const activeProviders = this.getActiveProviders().filter(
      (provider) => typeof provider[method] === 'function',
    );

    const searches = activeProviders.map(async (provider) => {
      try {
        const results = await provider[method](params);
        return {
          provider: provider.name,
          results: Array.isArray(results) ? results : [],
          error: null,
        };
      } catch (error) {
        return {
          provider: provider.name,
          results: [],
          error: error instanceof Error ? error.message : 'Provider search failed',
        };
      }
    });

    return Promise.all(searches);
  }
}
