const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const axios = require('axios');
const extract = require('extract-zip');
const { pipeline } = require('stream/promises');

const ENGINE_META = {
  Prowlarr: {
    appName: 'Prowlarr',
    repo: 'Prowlarr/Prowlarr',
    exeName: 'Prowlarr.exe',
    folderName: 'Prowlarr',
  },
  Radarr: {
    appName: 'Radarr',
    repo: 'Radarr/Radarr',
    exeName: 'Radarr.exe',
    folderName: 'Radarr',
  },
  Sonarr: {
    appName: 'Sonarr',
    repo: 'Sonarr/Sonarr',
    exeName: 'Sonarr.exe',
    folderName: 'Sonarr',
  },
};

const INSTALL_STAGES = {
  IDLE: 'idle',
  LOOKING_RELEASE: 'looking_release',
  ASSET_SELECTED: 'asset_selected',
  DOWNLOADING: 'downloading',
  EXTRACTING: 'extracting',
  CLEANING_OLD: 'cleaning_old',
  INSTALLING: 'installing',
  VALIDATING_EXE: 'validating_exe',
  COMPLETED: 'completed',
  ERROR: 'error',
};

const normalizeEngineName = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'prowlarr') return 'Prowlarr';
  if (normalized === 'radarr') return 'Radarr';
  if (normalized === 'sonarr') return 'Sonarr';
  return '';
};

const getResourcesRoot = () => path.join(process.cwd(), 'resources');

const pathExists = async (targetPath) => {
  if (!targetPath) return false;
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = async (dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

const recursiveFindFile = async (rootDir, fileName) => {
  if (!rootDir || !fileName) return '';
  if (!(await pathExists(rootDir))) return '';

  const targetName = String(fileName).toLowerCase();
  const stack = [rootDir];
  let visited = 0;

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === targetName) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }

    visited += 1;
    if (visited % 20 === 0) {
      // Large extracted trees can stall renderer if we never yield.
      // Yielding keeps IPC responsive during long scans.
      // eslint-disable-next-line no-await-in-loop
      await yieldToEventLoop();
    }
  }

  return '';
};

const pickWindowsZipAsset = (assets = []) => {
  const rows = Array.isArray(assets) ? assets : [];
  const zipAssets = rows.filter((asset) => String(asset?.name || '').toLowerCase().endsWith('.zip'));
  const primary = zipAssets.find((asset) => {
    const name = String(asset?.name || '').toLowerCase();
    return /(win|windows)/i.test(name) && /(x64|amd64|win64)/i.test(name);
  });
  if (primary) return primary;
  return zipAssets.find((asset) => /(x64|amd64)/i.test(String(asset?.name || '').toLowerCase())) || null;
};

const createEngineInstallerService = ({ stopEngineByName } = {}) => {
  const engineStates = new Map();

  const getState = (appName) => {
    const key = normalizeEngineName(appName);
    if (!key) return null;
    if (!engineStates.has(key)) {
      engineStates.set(key, {
        stage: INSTALL_STAGES.IDLE,
        message: '',
        error: '',
        startPromise: null,
        lastInstalledAt: null,
      });
    }
    return engineStates.get(key);
  };

  const setStage = (appName, stage, message = '', error = '') => {
    const state = getState(appName);
    if (!state) return;
    state.stage = stage;
    state.message = message;
    state.error = error;
    if (stage === INSTALL_STAGES.COMPLETED) {
      state.lastInstalledAt = new Date().toISOString();
    }
  };

  const findEngineExe = async (appName) => {
    const canonical = normalizeEngineName(appName);
    if (!canonical || !ENGINE_META[canonical]) return '';
    const { exeName, folderName } = ENGINE_META[canonical];
    const resourcesRoot = getResourcesRoot();
    const targetDir = path.join(resourcesRoot, folderName);
    const directPath = path.join(targetDir, exeName);
    if (await pathExists(directPath)) return directPath;
    return recursiveFindFile(targetDir, exeName);
  };

  const getEngineStatus = async (appName) => {
    const canonical = normalizeEngineName(appName);
    if (!canonical || !ENGINE_META[canonical]) {
      return { ok: false, error: 'Unsupported engine name.' };
    }
    const meta = ENGINE_META[canonical];
    const state = getState(canonical);
    const stage = state?.stage || INSTALL_STAGES.IDLE;
    const shouldScanForExe = [INSTALL_STAGES.IDLE, INSTALL_STAGES.COMPLETED, INSTALL_STAGES.ERROR].includes(stage);
    const exePath = shouldScanForExe ? await findEngineExe(canonical) : '';
    const targetDir = path.join(getResourcesRoot(), meta.folderName);
    return {
      ok: true,
      appName: canonical,
      stage,
      message: state?.message || '',
      error: state?.error || '',
      installed: Boolean(exePath),
      exePath: exePath || '',
      targetDir,
      exists: await pathExists(targetDir),
      lastInstalledAt: state?.lastInstalledAt || null,
    };
  };

  const installLatestEngine = async (appName) => {
    const canonical = normalizeEngineName(appName);
    if (!canonical || !ENGINE_META[canonical]) {
      return { ok: false, error: 'Unsupported engine name.' };
    }

    const state = getState(canonical);
    if (state?.startPromise) {
      return state.startPromise;
    }

    const runInstall = async () => {
      const meta = ENGINE_META[canonical];
      const resourcesRoot = getResourcesRoot();
      const targetDir = path.join(resourcesRoot, meta.folderName);
      const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `cinesoft-${canonical.toLowerCase()}-`));
      const zipPath = path.join(tempRoot, `${canonical}.zip`);
      const extractDir = path.join(tempRoot, 'extract');

      try {
        await ensureDir(resourcesRoot);
        await ensureDir(extractDir);

        setStage(canonical, INSTALL_STAGES.LOOKING_RELEASE, 'latest release araniyor');
        const releaseUrl = `https://api.github.com/repos/${meta.repo}/releases/latest`;
        let releaseResponse;
        try {
          releaseResponse = await axios.get(releaseUrl, {
            timeout: 30000,
            headers: {
              Accept: 'application/vnd.github+json',
              'User-Agent': 'CineSoft-EngineInstaller',
            },
          });
        } catch (error) {
          throw new Error(`GitHub release bulunamadi: ${error?.message || 'unknown error'}`);
        }

        const release = releaseResponse?.data || {};
        const asset = pickWindowsZipAsset(release.assets || []);
        if (!asset?.browser_download_url) {
          throw new Error('Windows x64 ZIP asset bulunamadi.');
        }

        setStage(canonical, INSTALL_STAGES.ASSET_SELECTED, `asset secildi: ${String(asset.name || '')}`);

        let downloadResponse;
        try {
          setStage(canonical, INSTALL_STAGES.DOWNLOADING, 'indiriliyor');
          downloadResponse = await axios.get(asset.browser_download_url, {
            responseType: 'stream',
            timeout: 120000,
            headers: {
              Accept: 'application/octet-stream',
              'User-Agent': 'CineSoft-EngineInstaller',
            },
          });
        } catch (error) {
          throw new Error(`ZIP indirilemedi: ${error?.message || 'unknown error'}`);
        }
        await pipeline(downloadResponse.data, fs.createWriteStream(zipPath));

        setStage(canonical, INSTALL_STAGES.EXTRACTING, 'extract ediliyor');
        try {
          await extract(zipPath, { dir: extractDir });
        } catch (error) {
          throw new Error(`ZIP cikarilamadi: ${error?.message || 'unknown error'}`);
        }

        setStage(canonical, INSTALL_STAGES.VALIDATING_EXE, 'exe dogrulaniyor');
        const extractedExe = await recursiveFindFile(extractDir, meta.exeName);
        if (!extractedExe) {
          throw new Error(`Indirme tamamlandi ama ${meta.exeName} bulunamadi.`);
        }
        const sourceEngineDir = path.dirname(extractedExe);

        if (typeof stopEngineByName === 'function') {
          try {
            await Promise.resolve(stopEngineByName(canonical));
          } catch {}
        }

        setStage(canonical, INSTALL_STAGES.CLEANING_OLD, 'eski klasor temizleniyor');
        await fsp.rm(targetDir, { recursive: true, force: true });

        setStage(canonical, INSTALL_STAGES.INSTALLING, 'resources icine kuruluyor');
        try {
          await fsp.rename(sourceEngineDir, targetDir);
        } catch (error) {
          await fsp.cp(sourceEngineDir, targetDir, { recursive: true, force: true });
        }

        setStage(canonical, INSTALL_STAGES.VALIDATING_EXE, 'exe dogrulaniyor');
        const finalDirectExe = path.join(targetDir, meta.exeName);
        const finalExe = (await pathExists(finalDirectExe))
          ? finalDirectExe
          : await recursiveFindFile(targetDir, meta.exeName);
        if (!finalExe) {
          throw new Error(`Indirme tamamlandi ama ${meta.exeName} bulunamadi.`);
        }

        setStage(canonical, INSTALL_STAGES.COMPLETED, 'tamamlandi');
        return {
          ok: true,
          appName: canonical,
          exePath: finalExe,
          installDir: targetDir,
          releaseName: String(release?.name || release?.tag_name || ''),
          assetName: String(asset?.name || ''),
        };
      } catch (error) {
        const message = String(error?.message || 'Kurulum basarisiz.');
        setStage(canonical, INSTALL_STAGES.ERROR, message, message);
        return { ok: false, error: message, appName: canonical };
      } finally {
        try {
          await fsp.rm(tempRoot, { recursive: true, force: true });
        } catch {}
      }
    };

    state.startPromise = runInstall().finally(() => {
      state.startPromise = null;
      if (state.stage === INSTALL_STAGES.ERROR) return;
      if (state.stage !== INSTALL_STAGES.COMPLETED) {
        state.stage = INSTALL_STAGES.IDLE;
        state.message = '';
      }
    });

    return state.startPromise;
  };

  return {
    installLatestEngine,
    getEngineStatus,
    findEngineExe,
    normalizeEngineName,
    stages: INSTALL_STAGES,
  };
};

module.exports = {
  createEngineInstallerService,
};
