const { contextBridge, ipcRenderer } = require('electron');
const DEBUG_TORRSERVER_STREAM = String(process.env.DEBUG_TORRSERVER_STREAM || '').toLowerCase() === 'true';

contextBridge.exposeInMainWorld('electronAPI', {
  getAuthState: () => ipcRenderer.invoke('get-auth-state'),
  registerUser: (payload) => ipcRenderer.invoke('register-user', payload),
  loginUser: (payload) => ipcRenderer.invoke('login-user', payload),
  logoutUser: () => ipcRenderer.invoke('logout-user'),
  resetPassword: (payload) => ipcRenderer.invoke('reset-password', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  logEvent: (payload) => ipcRenderer.invoke('app-log', payload),
  searchMovieSources: (params) => ipcRenderer.invoke('search-movie-sources', params),
  searchEpisodeSources: (params) => ipcRenderer.invoke('search-episode-sources', params),
  testProwlarrConnection: (prowlarrConfig) => ipcRenderer.invoke('test-prowlarr-connection', prowlarrConfig),
  getProwlarrIndexers: (prowlarrConfig) => ipcRenderer.invoke('get-prowlarr-indexers', prowlarrConfig),
  getProwlarrIndexerSchemas: (prowlarrConfig) => ipcRenderer.invoke('get-prowlarr-indexer-schemas', prowlarrConfig),
  testProwlarrIndexer: (prowlarrConfig, indexerResource) => ipcRenderer.invoke('test-prowlarr-indexer', prowlarrConfig, indexerResource),
  addProwlarrIndexer: (prowlarrConfig, indexerResource) => ipcRenderer.invoke('add-prowlarr-indexer', prowlarrConfig, indexerResource),
  deleteProwlarrIndexer: (prowlarrConfig, indexerId) => ipcRenderer.invoke('delete-prowlarr-indexer', prowlarrConfig, indexerId),
  selectProwlarrExecutable: () => ipcRenderer.invoke('select-prowlarr-executable'),
  startManagedProwlarr: (prowlarrConfig) => ipcRenderer.invoke('start-managed-prowlarr', prowlarrConfig),
  stopManagedProwlarr: () => ipcRenderer.invoke('stop-managed-prowlarr'),
  getManagedProwlarrStatus: () => ipcRenderer.invoke('get-managed-prowlarr-status'),
  openProwlarrDownloadPage: () => ipcRenderer.invoke('open-prowlarr-download-page'),
  openProwlarrWebUI: (prowlarrConfig) => ipcRenderer.invoke('open-prowlarr-web-ui', prowlarrConfig),
  prowlarrConnectRadarr: () => ipcRenderer.invoke('prowlarr:connectRadarr'),
  prowlarrSyncRadarr: () => ipcRenderer.invoke('prowlarr:syncRadarr'),
  prowlarrConnectSonarr: () => ipcRenderer.invoke('prowlarr:connectSonarr'),
  prowlarrSyncSonarr: () => ipcRenderer.invoke('prowlarr:syncSonarr'),
  selectRadarrExecutable: () => ipcRenderer.invoke('select-radarr-executable'),
  startManagedRadarr: (radarrConfig) => ipcRenderer.invoke('start-managed-radarr', radarrConfig),
  stopManagedRadarr: () => ipcRenderer.invoke('stop-managed-radarr'),
  getManagedRadarrStatus: () => ipcRenderer.invoke('get-managed-radarr-status'),
  radarrTestConnection: (settings) => ipcRenderer.invoke('radarr:testConnection', settings),
  radarrGetRootFolders: (settings) => ipcRenderer.invoke('radarr:getRootFolders', settings),
  radarrGetQualityProfiles: (settings) => ipcRenderer.invoke('radarr:getQualityProfiles', settings),
  radarrGetMovies: (settings) => ipcRenderer.invoke('radarr:getMovies', settings),
  radarrLookupMovieByTmdbId: (payload) => ipcRenderer.invoke('radarr:lookupMovieByTmdbId', payload),
  radarrAddMovie: (payload) => ipcRenderer.invoke('radarr:addMovie', payload),
  radarrDeleteMovie: (payload) => ipcRenderer.invoke('radarr:deleteMovie', payload),
  radarrUpdateMovie: (payload) => ipcRenderer.invoke('radarr:updateMovie', payload),
  radarrSearchMovie: (payload) => ipcRenderer.invoke('radarr:searchMovie', payload),
  radarrRefreshAndScanMovie: (payload) => ipcRenderer.invoke('radarr:refreshAndScanMovie', payload),
  radarrGetMovieReleases: (payload) => ipcRenderer.invoke('radarr:getMovieReleases', payload),
  radarrGrabMovieRelease: (payload) => ipcRenderer.invoke('radarr:grabMovieRelease', payload),
  radarrUpsertQbittorrentClient: (payload) => ipcRenderer.invoke('radarr:upsertQbittorrentClient', payload),
  radarrCheckQbittorrentClient: (payload) => ipcRenderer.invoke('radarr:checkQbittorrentClient', payload),
  openRadarrDownloadPage: () => ipcRenderer.invoke('open-radarr-download-page'),
  openRadarrWebUI: (settings) => ipcRenderer.invoke('open-radarr-web-ui', settings),
  openRadarrMoviePage: (payload) => ipcRenderer.invoke('open-radarr-movie-page', payload),
  selectSonarrExecutable: () => ipcRenderer.invoke('select-sonarr-executable'),
  startManagedSonarr: (sonarrConfig) => ipcRenderer.invoke('start-managed-sonarr', sonarrConfig),
  stopManagedSonarr: () => ipcRenderer.invoke('stop-managed-sonarr'),
  stopManagedEngines: () => ipcRenderer.invoke('engines:stop-managed'),
  getManagedSonarrStatus: () => ipcRenderer.invoke('get-managed-sonarr-status'),
  engineInstallLatest: (appName) => ipcRenderer.invoke('engine:install-latest', appName),
  engineStartInstallLatest: (appName) => ipcRenderer.invoke('engine:start-install-latest', appName),
  engineGetStatus: (appName) => ipcRenderer.invoke('engine:get-status', appName),
  engineFindExe: (appName) => ipcRenderer.invoke('engine:find-exe', appName),
  sonarrTestConnection: (settings) => ipcRenderer.invoke('sonarr:testConnection', settings),
  sonarrGetRootFolders: (settings) => ipcRenderer.invoke('sonarr:getRootFolders', settings),
  sonarrGetQualityProfiles: (settings) => ipcRenderer.invoke('sonarr:getQualityProfiles', settings),
  sonarrGetLanguageProfiles: (settings) => ipcRenderer.invoke('sonarr:getLanguageProfiles', settings),
  sonarrGetSeries: (settings) => ipcRenderer.invoke('sonarr:getSeries', settings),
  sonarrGetEpisodes: (payload) => ipcRenderer.invoke('sonarr:getEpisodes', payload),
  sonarrSetEpisodesMonitored: (payload) => ipcRenderer.invoke('sonarr:setEpisodesMonitored', payload),
  sonarrSearchEpisodes: (payload) => ipcRenderer.invoke('sonarr:searchEpisodes', payload),
  sonarrSearchSeason: (payload) => ipcRenderer.invoke('sonarr:searchSeason', payload),
  sonarrGetEpisodeReleases: (payload) => ipcRenderer.invoke('sonarr:getEpisodeReleases', payload),
  sonarrGrabRelease: (payload) => ipcRenderer.invoke('sonarr:grabRelease', payload),
  sonarrGrabBestSeasonPack: (payload) => ipcRenderer.invoke('sonarr:grabBestSeasonPack', payload),
  sonarrLookupSeriesByTmdbId: (payload) => ipcRenderer.invoke('sonarr:lookupSeriesByTmdbId', payload),
  sonarrAddSeries: (payload) => ipcRenderer.invoke('sonarr:addSeries', payload),
  sonarrDeleteSeries: (payload) => ipcRenderer.invoke('sonarr:deleteSeries', payload),
  sonarrUpdateSeries: (payload) => ipcRenderer.invoke('sonarr:updateSeries', payload),
  sonarrUpsertQbittorrentClient: (payload) => ipcRenderer.invoke('sonarr:upsertQbittorrentClient', payload),
  sonarrCheckQbittorrentClient: (payload) => ipcRenderer.invoke('sonarr:checkQbittorrentClient', payload),
  openSonarrDownloadPage: () => ipcRenderer.invoke('open-sonarr-download-page'),
  openSonarrWebUI: (settings) => ipcRenderer.invoke('open-sonarr-web-ui', settings),
  openSonarrSeriesPage: (payload) => ipcRenderer.invoke('open-sonarr-series-page', payload),

  // Torrent APIs
  torrentAdd: (opts) => ipcRenderer.invoke('torrent-add', opts),
  torrentPrepare: (opts) => ipcRenderer.invoke('torrent-prepare', opts),
  torrentGetFiles: (id) => ipcRenderer.invoke('torrent-get-files', id),
  torrentSelectFiles: (id, fileIndexes, resume, sequentialDownload) => ipcRenderer.invoke('torrent-select-files', id, fileIndexes, resume, sequentialDownload),
  torrentGetStatus: (id) => ipcRenderer.invoke('torrent-get-status', id),
  torrentGetAll: () => ipcRenderer.invoke('torrent-get-all'),
  torrentReorder: (id, direction) => ipcRenderer.invoke('torrent-reorder', id, direction),
  torrentPause: (id) => ipcRenderer.invoke('torrent-pause', id),
  torrentResume: (id) => ipcRenderer.invoke('torrent-resume', id),
  torrentRemove: (id, deleteFiles) => ipcRenderer.invoke('torrent-remove', id, deleteFiles),
  torrentGetSpeedLimit: () => ipcRenderer.invoke('torrent-get-speed-limit'),
  torrentSetSpeedLimit: (kbps) => ipcRenderer.invoke('torrent-set-speed-limit', kbps),
  torrentGetSettings: () => ipcRenderer.invoke('torrent-get-settings'),
  torrentSaveSettings: (settings) => ipcRenderer.invoke('torrent-save-settings', settings),
  openTorrentVideo: (payload) => ipcRenderer.invoke('open-torrent-video', payload),
  selectTorrServerExecutable: () => ipcRenderer.invoke('select-torrserver-executable'),
  getTorrServerSettings: () => ipcRenderer.invoke('torrserver:get-settings'),
  saveTorrServerSettings: (settings) => ipcRenderer.invoke('torrserver:save-settings', settings),
  getTorrServerStatus: () => ipcRenderer.invoke('torrserver:status'),
  startTorrServer: (settings) => ipcRenderer.invoke('torrserver:start', settings),
  stopTorrServer: () => ipcRenderer.invoke('torrserver:stop'),
  testTorrServer: (settings) => ipcRenderer.invoke('torrserver:test', settings),
  startTorrServerStream: async (payload) => {
    const result = await ipcRenderer.invoke('torrserver:start-stream', payload);
    if (DEBUG_TORRSERVER_STREAM) {
      try {
        console.log('[TorrServerUI:StartStreamResult]', {
          ok: Boolean(result),
          streamUrl: result?.streamUrl || '',
          player: result?.player || null,
          error: result?.error || '',
        });
      } catch {}
    }
    return result;
  },
  torrserverDebugEnabled: DEBUG_TORRSERVER_STREAM,
  openTorrServerWeb: (settings) => ipcRenderer.invoke('torrserver:open-web', settings),
  stopNativePlayer: () => ipcRenderer.invoke('player:stop'),
  controlNativePlayer: (payload) => ipcRenderer.invoke('player:command', payload),
  toggleNativePlayerFullscreen: () => ipcRenderer.invoke('player:toggle-fullscreen'),
  onNativePlayerStarted: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('native-player:started', handler);
    return () => ipcRenderer.removeListener('native-player:started', handler);
  },
  onNativePlayerStopped: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    ipcRenderer.on('native-player:stopped', handler);
    return () => ipcRenderer.removeListener('native-player:stopped', handler);
  },
  onNativePlayerState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('native-player:state', handler);
    return () => ipcRenderer.removeListener('native-player:state', handler);
  },
  scanLibrary: () => ipcRenderer.invoke('library-scan'),
  openLibraryVideo: (payload) => ipcRenderer.invoke('open-library-video', payload),
  openLibraryFolder: (payload) => ipcRenderer.invoke('open-library-folder', payload),
  searchLibrarySubtitles: (payload) => ipcRenderer.invoke('library-subtitles-search', payload),
  downloadLibrarySubtitle: (payload) => ipcRenderer.invoke('library-subtitles-download', payload),
  searchPlayerSubtitles: (payload) => ipcRenderer.invoke('player-subtitles-search', payload),
  downloadPlayerSubtitle: (payload) => ipcRenderer.invoke('player-subtitles-download', payload),
  getLibraryMetadata: (filePaths) => ipcRenderer.invoke('library-metadata-get', filePaths),
  upsertLibraryMetadata: (payload) => ipcRenderer.invoke('library-metadata-upsert', payload),
  validateTorrentCandidate: (payload) => ipcRenderer.invoke('torrent-validate-candidate', payload),
  getLogs: () => ipcRenderer.invoke('logs-get'),
  clearLogs: () => ipcRenderer.invoke('logs-clear'),
  qbittorrentAdd: (opts, qbConfig) => ipcRenderer.invoke('qbittorrent-add', opts, qbConfig),
  qbittorrentGetTorrents: (qbConfig) => ipcRenderer.invoke('qbittorrent-get-torrents', qbConfig),
  selectDownloadDir: () => ipcRenderer.invoke('select-download-dir'),
  getDownloadDir: () => ipcRenderer.invoke('get-download-dir'),
  getDownloadDirFreeSpace: () => ipcRenderer.invoke('get-download-dir-free-space'),
  isDev: process.env.NODE_ENV === 'development',
});

contextBridge.exposeInMainWorld('cinesoft', {
  engine: {
    installLatest: (appName) => ipcRenderer.invoke('engine:install-latest', appName),
    startInstallLatest: (appName) => ipcRenderer.invoke('engine:start-install-latest', appName),
    getStatus: (appName) => ipcRenderer.invoke('engine:get-status', appName),
    findExe: (appName) => ipcRenderer.invoke('engine:find-exe', appName),
  },
});
