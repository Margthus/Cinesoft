export class SourceProvider {
  constructor(config = {}) {
    this.name = config.name;
    this.type = config.type;
    this.enabled = config.enabled !== false;
    this.config = config;
  }

  async searchMovie() {
    throw new Error(`${this.name} does not implement searchMovie`);
  }

  async searchEpisode() {
    throw new Error(`${this.name} does not implement searchEpisode`);
  }
}
