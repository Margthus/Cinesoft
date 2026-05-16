const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
let electronApp = null;
let ElectronBrowserWindow = null;
try {
  ({ app: electronApp, BrowserWindow: ElectronBrowserWindow } = require('electron'));
} catch {
  electronApp = null;
  ElectronBrowserWindow = null;
}

const MPV_STATUSES = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  PLAYING: 'playing',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
  UNAVAILABLE: 'unavailable',
});

const ALLOWED_STATUSES = new Set(Object.values(MPV_STATUSES));
const MPV_PROBE_TIMEOUT_MS = 2500;
const MPV_STOP_TIMEOUT_MS = 2500;
const MPV_AVAILABILITY_CACHE_MS = 15000;
const NATIVE_HOST_QUICK_EXIT_MS = 3000;
const DEFAULT_EMBEDDED_BOUNDS = { x: 260, y: 120, width: 900, height: 500 };
const NATIVE_HOST_BOUNDS = { x: 260, y: 120, width: 900, height: 500 };

const isValidBounds = (bounds = {}) => {
  if (!bounds || typeof bounds !== 'object') return false;
  const { x, y, width, height } = bounds;
  return [x, y, width, height].every((value) => Number.isFinite(Number(value)));
};

const sanitizeBounds = (bounds = {}) => ({
  x: Math.max(0, Number(bounds.x) || 0),
  y: Math.max(0, Number(bounds.y) || 0),
  width: Math.max(0, Number(bounds.width) || 0),
  height: Math.max(0, Number(bounds.height) || 0),
});

const sanitizeStartOptions = (options = {}) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {};
  }
  const safe = {};
  if (typeof options.sourceType === 'string') safe.sourceType = String(options.sourceType).trim().toLowerCase();
  if (typeof options.source === 'string') safe.source = options.source.trim();
  if (typeof options.url === 'string') safe.url = options.url.trim();
  if (typeof options.filePath === 'string') safe.filePath = options.filePath.trim();
  if (typeof options.title === 'string') safe.title = options.title;
  if (typeof options.startPaused === 'boolean') safe.startPaused = options.startPaused;
  if (typeof options.mode === 'string') safe.mode = String(options.mode).trim().toLowerCase();
  if (typeof options.embedded === 'boolean') safe.embedded = options.embedded;
  if (typeof options.renderMode === 'string') safe.renderMode = String(options.renderMode).trim().toLowerCase();
  if (typeof options.isPlayerMode === 'boolean') safe.isPlayerMode = options.isPlayerMode;
  if (options.bounds && typeof options.bounds === 'object' && !Array.isArray(options.bounds)) {
    safe.bounds = sanitizeBounds(options.bounds);
  }
  if (options.viewport && typeof options.viewport === 'object' && !Array.isArray(options.viewport)) {
    safe.viewport = sanitizeBounds(options.viewport);
  }
  return safe;
};

const stripWrappingQuotes = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
};

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());
const isEmbeddedSourceType = (value = '') => ['embedded-stream-url', 'embedded-file'].includes(String(value || '').trim().toLowerCase());

const resolvePlaybackSource = (options = {}) => {
  if (typeof options.source === 'string' && options.source.trim()) {
    return stripWrappingQuotes(options.source);
  }
  const url = stripWrappingQuotes(typeof options.url === 'string' ? options.url : '');
  const filePath = stripWrappingQuotes(typeof options.filePath === 'string' ? options.filePath : '');
  if (!url && !filePath) return '';
  return filePath || url;
};

const execFileAsync = (file, args = [], options = {}) => new Promise((resolve, reject) => {
  execFile(file, args, options, (error, stdout = '', stderr = '') => {
    if (error) {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
      return;
    }
    resolve({ stdout, stderr });
  });
});

class MpvPlayerService {
  constructor() {
    this.status = MPV_STATUSES.IDLE;
    this.available = false;
    this.lastError = null;
    this.lastStartOptions = null;
    this.lastViewport = null;
    this.binaryPath = null;
    this.probePath = null;
    this.binaryVersion = null;
    this.mpvProcess = null;
    this.mpvPid = null;
    this.availabilityCacheAt = 0;
    this.availabilityCacheValue = null;
    this.lastProcessOutput = '';
    this.mainWindow = null;
    this.hostWindow = null;
    this.hostHwnd = null;
    this.hostProcess = null;
    this.hostPid = null;
    this.lastHostOutput = '';
    this.hostStartedAt = 0;
    this.lastNativeHostBounds = { ...NATIVE_HOST_BOUNDS };
  }

  setStatus(nextStatus) {
    if (!ALLOWED_STATUSES.has(nextStatus)) return;
    this.status = nextStatus;
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow || null;
  }

  getNativeHostAbsoluteBounds() {
    return { ...this.lastNativeHostBounds };
  }

  getMainWindowHwndString() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null;
    try {
      const handle = this.mainWindow.getNativeWindowHandle();
      if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
      return handle.length >= 8
        ? handle.readBigUInt64LE(0).toString()
        : String(handle.readUInt32LE(0));
    } catch {
      return null;
    }
  }

  sendNativeHostCommand(command = {}) {
    if (!this.hostProcess || !this.hostProcess.stdin || this.hostProcess.killed) return false;
    try {
      this.hostProcess.stdin.write(`${JSON.stringify(command)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  updateNativeHostBounds(bounds = {}) {
    const safe = sanitizeBounds(bounds);
    this.lastNativeHostBounds = {
      x: Math.max(0, safe.x),
      y: Math.max(0, safe.y),
      width: Math.max(100, safe.width),
      height: Math.max(100, safe.height),
    };
    return this.sendNativeHostCommand({
      type: 'bounds',
      x: this.lastNativeHostBounds.x,
      y: this.lastNativeHostBounds.y,
      width: this.lastNativeHostBounds.width,
      height: this.lastNativeHostBounds.height,
    });
  }

  getLastNativeHostBounds() {
    return { ...this.lastNativeHostBounds };
  }

  showNativeHost() {
    return this.sendNativeHostCommand({ type: 'show' });
  }

  hideNativeHost() {
    return this.sendNativeHostCommand({ type: 'hide' });
  }

  createMpvHostWindow(bounds = DEFAULT_EMBEDDED_BOUNDS) {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) return this.hostWindow;
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return null;
    if (!ElectronBrowserWindow) return null;

    const safeBounds = sanitizeBounds(bounds);
    const hostWindow = new ElectronBrowserWindow({
      parent: this.mainWindow,
      frame: false,
      show: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      x: safeBounds.x,
      y: safeBounds.y,
      width: Math.max(100, safeBounds.width),
      height: Math.max(100, safeBounds.height),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const safeHostBounds = {
      x: safeBounds.x,
      y: safeBounds.y,
      width: Math.max(100, safeBounds.width),
      height: Math.max(100, safeBounds.height),
    };
    hostWindow.setBounds(safeHostBounds);
    hostWindow.setBackgroundColor('#000000');
    hostWindow.setAlwaysOnTop(false);
    hostWindow.loadURL('data:text/html,<html><body style="margin:0;background:#000000;"></body></html>').catch(() => {});
    hostWindow.showInactive();
    hostWindow.moveTop();
    console.info('[MpvPlayer] host window created', {
      bounds: safeHostBounds,
      visible: hostWindow.isVisible(),
    });
    this.hostWindow = hostWindow;
    this.hostHwnd = null;
    return hostWindow;
  }

  destroyMpvHostWindow() {
    if (!this.hostWindow) return;
    try {
      if (!this.hostWindow.isDestroyed()) {
        this.hostWindow.destroy();
      }
    } catch {
      // ignore host destroy errors
    }
    this.hostWindow = null;
    this.hostHwnd = null;
  }

  resizeMpvHostWindow(bounds = {}) {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) {
      return { ok: true, status: this.getMpvStatus().status, details: { hostWindow: false } };
    }
    if (!isValidBounds(bounds)) {
      return { ok: false, status: MPV_STATUSES.ERROR, error: 'Invalid viewport bounds.' };
    }
    const safeBounds = sanitizeBounds(bounds);
    this.hostWindow.setBounds({
      x: safeBounds.x,
      y: safeBounds.y,
      width: Math.max(100, safeBounds.width),
      height: Math.max(100, safeBounds.height),
    });
    this.hostWindow.showInactive();
    console.info('[MpvPlayer] host window resized', { bounds: safeBounds, visible: this.hostWindow.isVisible() });
    return { ok: true, status: this.getMpvStatus().status, details: { hostWindow: true, bounds: safeBounds } };
  }

  getMpvHostHwnd() {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) return null;
    try {
      const handle = this.hostWindow.getNativeWindowHandle();
      if (!Buffer.isBuffer(handle) || handle.length < 4) return null;
      this.hostHwnd = handle.length >= 8
        ? handle.readBigUInt64LE(0).toString()
        : String(handle.readUInt32LE(0));
      console.info('[MpvPlayer] host HWND resolved', { hwnd: this.hostHwnd });
      return this.hostHwnd;
    } catch {
      return null;
    }
  }

  resolveMpvExecutablePath() {
    const isPackaged = Boolean(electronApp?.isPackaged);
    const candidates = isPackaged
      ? [path.join(process.resourcesPath, 'mpv', 'mpv.exe')]
      : [path.join(process.cwd(), 'resources', 'mpv', 'mpv.exe')];

    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        if (fs.existsSync(candidate)) {
          console.info('[MpvPlayer:Resolver] Resolved MPV executable:', candidate);
          this.binaryPath = candidate;
          return candidate;
        }
      } catch {
        // ignore and continue trying candidates
      }
    }

    console.warn('[MpvPlayer:Resolver] MPV executable not found in known locations');
    this.binaryPath = null;
    return null;
  }

  resolveMpvProbePath() {
    const isPackaged = Boolean(electronApp?.isPackaged);
    const mpvExePath = this.resolveMpvExecutablePath();
    const preferredProbe = isPackaged
      ? path.join(process.resourcesPath, 'mpv', 'mpv.com')
      : path.join(process.cwd(), 'resources', 'mpv', 'mpv.com');

    if (preferredProbe) {
      try {
        if (fs.existsSync(preferredProbe)) {
          console.info('[MpvPlayer:Resolver] Resolved MPV probe executable:', preferredProbe);
          this.probePath = preferredProbe;
          return preferredProbe;
        }
      } catch {
        // ignore and fallback to mpv.exe
      }
    }

    this.probePath = mpvExePath;
    if (mpvExePath) {
      console.info('[MpvPlayer:Resolver] Using MPV executable as probe path:', mpvExePath);
    } else {
      console.warn('[MpvPlayer:Resolver] MPV probe path could not be resolved');
    }
    return mpvExePath;
  }

  async getMpvBinaryInfo() {
    const mpvPath = this.resolveMpvExecutablePath();
    const mpvProbePath = this.resolveMpvProbePath();
    if (!mpvPath) {
      return {
        ok: true,
        available: false,
        path: null,
        probePath: null,
        version: null,
        error: 'MPV executable not found.',
      };
    }
    if (!mpvProbePath) {
      return {
        ok: true,
        available: false,
        path: mpvPath,
        probePath: null,
        version: null,
        error: 'MPV probe executable not found.',
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(mpvProbePath, ['--version'], {
        shell: false,
        timeout: MPV_PROBE_TIMEOUT_MS,
        windowsHide: true,
      });
      const output = String(stdout || stderr || '').trim();
      const firstLine = output.split(/\r?\n/).find(Boolean) || 'mpv (version info unavailable)';
      console.info('[MpvPlayer:Probe] MPV probe succeeded:', firstLine);
      this.binaryVersion = firstLine;
      return {
        ok: true,
        available: true,
        path: mpvPath,
        probePath: mpvProbePath,
        version: firstLine,
      };
    } catch (error) {
      const probeError = String(error?.message || 'MPV probe failed.');
      console.warn('[MpvPlayer:Probe] MPV probe failed:', probeError);
      this.binaryVersion = null;
      return {
        ok: true,
        available: false,
        path: mpvPath,
        probePath: mpvProbePath,
        version: null,
        error: probeError,
      };
    }
  }

  async checkMpvAvailability() {
    const now = Date.now();
    if (this.availabilityCacheValue && now - this.availabilityCacheAt < MPV_AVAILABILITY_CACHE_MS) {
      return this.availabilityCacheValue;
    }

    const info = await this.getMpvBinaryInfo();
    this.available = Boolean(info.available);
    this.lastError = info.available ? null : (info.error || 'MPV unavailable');
    this.binaryPath = info.path || null;
    this.probePath = info.probePath || null;
    this.binaryVersion = info.version || null;

    if (!this.available) {
      this.setStatus(MPV_STATUSES.UNAVAILABLE);
    } else if (this.status === MPV_STATUSES.UNAVAILABLE) {
      this.setStatus(MPV_STATUSES.IDLE);
    }

    const payload = {
      ok: true,
      available: this.available,
      path: this.binaryPath,
      probePath: this.probePath,
      version: this.binaryVersion,
      status: this.getMpvStatus().status,
      error: this.lastError || undefined,
    };
    this.availabilityCacheValue = payload;
    this.availabilityCacheAt = now;
    return payload;
  }

  isMpvAvailable() {
    return this.available;
  }

  getMpvStatus() {
    const baseStatus = this.available ? this.status : MPV_STATUSES.UNAVAILABLE;
    return {
      status: baseStatus,
      available: this.available,
      lastError: this.lastError,
      details: {
        binaryPath: this.binaryPath,
        probePath: this.probePath,
        binaryVersion: this.binaryVersion,
        pid: this.mpvPid,
        lastProcessOutput: this.lastProcessOutput,
        hostHwnd: this.hostHwnd,
        hasHostWindow: Boolean(this.hostWindow && !this.hostWindow.isDestroyed()),
        hostProcessPid: this.hostPid,
        lastHostOutput: this.lastHostOutput,
        hasLastStartOptions: Boolean(this.lastStartOptions),
        lastViewport: this.lastViewport,
      },
    };
  }

  async startMpvPlayback(options = {}) {
    const safeOptions = sanitizeStartOptions(options);
    const mode = safeOptions.mode === 'native-host' ? 'native-host' : 'external';
    const sourceType = isEmbeddedSourceType(safeOptions.sourceType)
      ? safeOptions.sourceType
      : (isHttpUrl(safeOptions.source || safeOptions.url || '') ? 'embedded-stream-url' : 'embedded-file');
    const source = resolvePlaybackSource(safeOptions);
    const embedded = mode === 'external' && safeOptions.embedded === true;
    const embeddedBounds = safeOptions.bounds && typeof safeOptions.bounds === 'object'
      ? sanitizeBounds(safeOptions.bounds)
      : DEFAULT_EMBEDDED_BOUNDS;
    if (!source) {
      this.setStatus(MPV_STATUSES.ERROR);
      this.lastError = 'A valid url or filePath is required.';
      return {
        ok: false,
        status: this.status,
        error: this.lastError,
      };
    }
    if (sourceType === 'embedded-stream-url') {
      if (!isHttpUrl(source)) {
        this.setStatus(MPV_STATUSES.ERROR);
        this.lastError = 'embedded-stream-url requires an http/https source.';
        return { ok: false, status: this.status, error: this.lastError };
      }
    } else if (sourceType === 'embedded-file') {
      if (!source || isHttpUrl(source) || !fs.existsSync(source)) {
        this.setStatus(MPV_STATUSES.ERROR);
        this.lastError = 'embedded-file source not found.';
        return { ok: false, status: this.status, error: this.lastError };
      }
    } else {
      this.setStatus(MPV_STATUSES.ERROR);
      this.lastError = 'Unsupported source type.';
      return { ok: false, status: this.status, error: this.lastError };
    }

    if (this.mpvProcess || this.hostProcess) {
      const stopResult = await this.stopMpvPlayback();
      if (!stopResult.ok) {
        return {
          ok: false,
          status: stopResult.status || MPV_STATUSES.ERROR,
          error: stopResult.error || 'A running MPV process could not be stopped.',
        };
      }
    }

    if (mode === 'native-host') {
      const hasIncomingBounds = Boolean(safeOptions.bounds && typeof safeOptions.bounds === 'object');
      console.info('[MpvPlayer:NativeHostBounds]', {
        phase: 'start-request',
        bounds: hasIncomingBounds ? sanitizeBounds(safeOptions.bounds) : null,
        fallbackUsed: !hasIncomingBounds,
        isPlayerMode: safeOptions.isPlayerMode === true,
      });
      if (safeOptions.isPlayerMode === true && !hasIncomingBounds) {
        this.setStatus(MPV_STATUSES.ERROR);
        this.lastError = 'Missing fullscreen bounds for player mode.';
        return { ok: false, status: this.status, error: this.lastError };
      }
      // TODO: Embedded libtorrent streaming servisi hazir oldugunda local stream URL burada kullanılacak.
      // startNativeHostPlayback({ sourceType:'embedded-stream-url', source: streamUrl })
      // TODO: Embedded downloader ile inmis video dosyasi bu modelle oynatilacak.
      // startNativeHostPlayback({ sourceType:'embedded-file', source: filePath })
      // TODO: qBittorrent/Arr otomasyon akislari bu player entegrasyonunun disinda kalacak.
      return this.startNativeHostPlayback({
        sourceType,
        source,
        title: safeOptions.title,
        startPaused: safeOptions.startPaused === true,
        bounds: safeOptions.bounds && typeof safeOptions.bounds === 'object'
          ? sanitizeBounds(safeOptions.bounds)
          : DEFAULT_EMBEDDED_BOUNDS,
      });
    }

    const availability = await this.checkMpvAvailability();
    if (!availability.available || !this.binaryPath) {
      this.setStatus(MPV_STATUSES.UNAVAILABLE);
      this.lastError = availability.error || 'MPV is unavailable.';
      console.info('[MpvPlayer] start blocked: unavailable mode');
      return {
        ok: false,
        status: this.status,
        error: this.lastError,
      };
    }

    const args = [
      embedded ? '--force-window=yes' : '--force-window=immediate',
      '--idle=no',
      '--no-config',
      '--terminal=no',
      '--msg-level=all=warn',
    ];
    if (embedded) {
      const hostWindow = this.createMpvHostWindow(embeddedBounds);
      if (!hostWindow) {
        this.setStatus(MPV_STATUSES.ERROR);
        this.lastError = 'Failed to create MPV host window.';
        return { ok: false, status: this.status, error: this.lastError };
      }
      this.resizeMpvHostWindow(embeddedBounds);
      hostWindow.showInactive();
      hostWindow.moveTop();
      const hwnd = this.getMpvHostHwnd();
      if (!hwnd) {
        this.destroyMpvHostWindow();
        this.setStatus(MPV_STATUSES.ERROR);
        this.lastError = 'Failed to resolve MPV host HWND.';
        return { ok: false, status: this.status, error: this.lastError };
      }
      console.info('[MpvPlayer] host pre-spawn state', {
        bounds: hostWindow.getBounds(),
        visible: hostWindow.isVisible(),
        hwnd,
      });
      args.push(`--wid=${hwnd}`);
      if (safeOptions.renderMode === 'd3d11') {
        args.push('--vo=gpu', '--gpu-context=d3d11', '--hwdec=no', '--video-sync=display-resample');
      } else if (safeOptions.renderMode === 'angle') {
        args.push('--vo=gpu', '--gpu-context=angle', '--hwdec=no', '--video-sync=display-resample');
      }
    }
    if (safeOptions.title) args.push(`--title=${safeOptions.title}`);
    if (safeOptions.startPaused === true) args.push('--pause');
    args.push(source);

    this.setStatus(MPV_STATUSES.STARTING);
    this.lastStartOptions = safeOptions;
    this.lastProcessOutput = '';
    const spawnOptions = {
      shell: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    console.info('[MpvPlayer] spawning MPV process', {
      source,
      shell: spawnOptions.shell,
      windowsHide: spawnOptions.windowsHide,
      stdio: 'ignore|pipe|pipe',
      args,
    });

    try {
      const child = spawn(this.binaryPath, args, spawnOptions);

      this.mpvProcess = child;
      this.mpvPid = child.pid || null;

      child.once('spawn', () => {
        this.setStatus(MPV_STATUSES.PLAYING);
        this.lastError = null;
      });

      child.once('error', (error) => {
        console.error('[MpvPlayer] MPV process error:', error);
        this.lastError = String(error?.message || 'MPV process error.');
        this.setStatus(MPV_STATUSES.ERROR);
        this.mpvProcess = null;
        this.mpvPid = null;
        this.destroyMpvHostWindow();
      });

      const captureOutput = (chunk) => {
        const text = String(chunk || '').trim();
        if (!text) return;
        const merged = `${this.lastProcessOutput}\n${text}`.trim();
        const lines = merged.split(/\r?\n/).filter(Boolean);
        this.lastProcessOutput = lines.slice(-5).join(' | ');
      };
      child.stdout?.on('data', captureOutput);
      child.stderr?.on('data', captureOutput);

      child.once('exit', (code, signal) => {
        console.info('[MpvPlayer] MPV process exit', { code, signal });
        if (code === 2 && this.lastProcessOutput) {
          this.lastError = this.lastProcessOutput;
          this.setStatus(MPV_STATUSES.ERROR);
        }
        if (this.status !== MPV_STATUSES.ERROR) {
          this.setStatus(MPV_STATUSES.STOPPED);
        }
        this.mpvProcess = null;
        this.mpvPid = null;
        this.destroyMpvHostWindow();
      });

      child.once('close', () => {
        if (this.mpvProcess === child) {
          this.mpvProcess = null;
          this.mpvPid = null;
        }
        if (this.status !== MPV_STATUSES.ERROR) {
          this.setStatus(MPV_STATUSES.STOPPED);
        }
        this.destroyMpvHostWindow();
      });

      return {
        ok: true,
        status: this.status,
        details: {
          pid: this.mpvPid,
          mode: 'external',
          source,
          embedded,
          hostHwnd: this.hostHwnd,
          args,
        },
      };
    } catch (error) {
      this.lastError = String(error?.message || 'Failed to spawn MPV.');
      this.setStatus(MPV_STATUSES.ERROR);
      this.mpvProcess = null;
      this.mpvPid = null;
      this.destroyMpvHostWindow();
      return {
        ok: false,
        status: this.status,
        error: this.lastError,
      };
    }
  }

  async startNativeHostPlayback({ source, title, startPaused, bounds }) {
    if (electronApp?.isPackaged) {
      this.setStatus(MPV_STATUSES.ERROR);
      this.lastError = 'native-host mode is available only in development.';
      return { ok: false, status: this.status, error: this.lastError };
    }

    const availability = await this.checkMpvAvailability();
    if (!availability.available || !this.binaryPath) {
      this.setStatus(MPV_STATUSES.UNAVAILABLE);
      this.lastError = availability.error || 'MPV is unavailable.';
      return { ok: false, status: this.status, error: this.lastError };
    }

    const hostProjectPath = path.join(process.cwd(), 'tools', 'mpv-host', 'Cinesoft.MpvHost.csproj');
    if (!fs.existsSync(hostProjectPath)) {
      this.setStatus(MPV_STATUSES.ERROR);
      this.lastError = `Native host project not found: ${hostProjectPath}`;
      return { ok: false, status: this.status, error: this.lastError };
    }

    const fallbackUsed = !(bounds && typeof bounds === 'object');
    const launchBounds = bounds && typeof bounds === 'object'
      ? sanitizeBounds(bounds)
      : this.getLastNativeHostBounds();
    this.lastNativeHostBounds = {
      x: Math.max(0, launchBounds.x),
      y: Math.max(0, launchBounds.y),
      width: Math.max(100, launchBounds.width),
      height: Math.max(100, launchBounds.height),
    };

    const sourceType = isHttpUrl(source) ? 'embedded-stream-url' : 'embedded-file';

    const args = [
      'run',
      '--project',
      hostProjectPath,
      '--',
      '--mpv-path',
      this.binaryPath,
      '--source-type',
      sourceType,
      '--url',
      source,
      '--title',
      title || 'CineSoft MPV Host',
      '--x',
      String(this.lastNativeHostBounds.x),
      '--y',
      String(this.lastNativeHostBounds.y),
      '--width',
      String(this.lastNativeHostBounds.width),
      '--height',
      String(this.lastNativeHostBounds.height),
      '--borderless',
      '--no-taskbar',
    ];
    const parentHwnd = this.getMainWindowHwndString();
    if (parentHwnd) {
      args.push('--parent-hwnd', parentHwnd);
    }
    if (startPaused) args.push('--start-paused');
    if (!electronApp?.isPackaged) args.push('--keep-open-on-exit');

    const spawnOptions = {
      shell: false,
      windowsHide: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    this.setStatus(MPV_STATUSES.STARTING);
    this.lastHostOutput = '';
    this.lastProcessOutput = '';
    this.hostStartedAt = Date.now();
    console.info('[MpvPlayer:NativeHostBounds]', {
      phase: 'final-spawn',
      bounds: this.lastNativeHostBounds,
      fallbackUsed,
    });
    console.info('[MpvPlayer] spawning native host process', {
      shell: spawnOptions.shell,
      windowsHide: spawnOptions.windowsHide,
      stdio: 'pipe|pipe|pipe',
      parentHwnd,
      args,
    });

    try {
      const hostChild = spawn('dotnet', args, spawnOptions);
      this.hostProcess = hostChild;
      this.hostPid = hostChild.pid || null;
      this.lastStartOptions = { mode: 'native-host', source, title: title || 'CineSoft MPV Host', startPaused };

      const pushProcessOutputLine = (line) => {
        const text = String(line || '').trim();
        if (!text) return;
        const lines = this.lastProcessOutput
          ? this.lastProcessOutput.split(/\r?\n/).filter(Boolean)
          : [];
        lines.push(text);
        this.lastProcessOutput = lines.slice(-20).join('\n');
      };
      const pushHostOutputLine = (line) => {
        const text = String(line || '').trim();
        if (!text) return;
        const lines = this.lastHostOutput
          ? this.lastHostOutput.split(/\r?\n/).filter(Boolean)
          : [];
        lines.push(text);
        this.lastHostOutput = lines.slice(-20).join('\n');
        pushProcessOutputLine(text);
      };
      const captureHostOutput = (chunk, isError = false) => {
        const text = String(chunk || '');
        if (!text.trim()) return;
        const lines = text.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          if (isError) {
            console.warn('[MpvPlayer:NativeHost:stderr]', line);
          } else {
            console.info('[MpvPlayer:NativeHost:stdout]', line);
          }
          pushHostOutputLine(line);
        }
      };
      hostChild.stdout?.on('data', (chunk) => captureHostOutput(chunk, false));
      hostChild.stderr?.on('data', (chunk) => captureHostOutput(chunk, true));

      hostChild.once('spawn', () => {
        this.setStatus(MPV_STATUSES.PLAYING);
        this.lastError = null;
        this.updateNativeHostBounds(this.lastNativeHostBounds);
        this.showNativeHost();
      });

      hostChild.once('error', (error) => {
        console.error('[MpvPlayer] native host process error:', error);
        this.lastError = String(error?.message || 'Native host process error.');
        this.setStatus(MPV_STATUSES.ERROR);
        this.hostProcess = null;
        this.hostPid = null;
        this.hostStartedAt = 0;
      });

      hostChild.once('exit', (code, signal) => {
        console.info('[MpvPlayer] native host process exit', { code, signal });
        const runtimeMs = this.hostStartedAt > 0 ? (Date.now() - this.hostStartedAt) : null;
        if (runtimeMs !== null && runtimeMs < NATIVE_HOST_QUICK_EXIT_MS) {
          this.lastError = 'Native host exited too quickly';
          this.setStatus(MPV_STATUSES.ERROR);
        } else if (code && code !== 0) {
          this.lastError = this.lastHostOutput || `Native host exited with code ${code}`;
          this.setStatus(MPV_STATUSES.ERROR);
        } else if (this.status !== MPV_STATUSES.ERROR) {
          this.setStatus(MPV_STATUSES.STOPPED);
        }
        this.hostProcess = null;
        this.hostPid = null;
        this.hostStartedAt = 0;
      });

      return {
        ok: true,
        status: this.status,
        details: {
          mode: 'native-host',
          pid: this.hostPid,
          args: ['dotnet', ...args],
        },
      };
    } catch (error) {
      this.lastError = String(error?.message || 'Failed to start native host process.');
      this.setStatus(MPV_STATUSES.ERROR);
      this.hostProcess = null;
      this.hostPid = null;
      this.hostStartedAt = 0;
      return { ok: false, status: this.status, error: this.lastError };
    }
  }

  async stopMpvPlayback() {
    if (!this.mpvProcess && !this.hostProcess) {
      this.destroyMpvHostWindow();
      if (!this.available) {
        this.setStatus(MPV_STATUSES.UNAVAILABLE);
      } else {
        this.setStatus(MPV_STATUSES.STOPPED);
      }
      return {
        ok: true,
        status: this.status,
        details: { stopped: false },
      };
    }

    const child = this.mpvProcess;
    const hostChild = this.hostProcess;
    this.setStatus(MPV_STATUSES.STOPPING);
    console.info('[MpvPlayer] stop requested', { mpvPid: this.mpvPid, hostPid: this.hostPid });
    if (hostChild) {
      this.sendNativeHostCommand({ type: 'close' });
    }

    try {
      const closeProcess = (target) => new Promise((resolve) => {
        if (!target) {
          resolve(true);
          return;
        }
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        target.once('exit', () => finish(true));
        target.once('close', () => finish(true));
        target.once('error', () => finish(false));

        try {
          target.kill();
        } catch {
          finish(false);
          return;
        }

        setTimeout(() => {
          if (settled) return;
          try {
            target.kill('SIGKILL');
          } catch {
            // ignore hard kill failures
          }
          finish(false);
        }, MPV_STOP_TIMEOUT_MS);
      });
      const [mpvClosed, hostClosed] = await Promise.all([closeProcess(child), closeProcess(hostChild)]);

      this.mpvProcess = null;
      this.mpvPid = null;
      this.hostProcess = null;
      this.hostPid = null;
      this.hostStartedAt = 0;
      this.setStatus(MPV_STATUSES.STOPPED);
      this.destroyMpvHostWindow();
      if (!mpvClosed || !hostClosed) {
        this.lastError = 'MPV/native-host process stop timed out.';
      }
      return {
        ok: true,
        status: this.status,
        details: { stopped: true, forceKill: !mpvClosed || !hostClosed, mpvClosed, hostClosed },
      };
    } catch (error) {
      this.lastError = String(error?.message || 'Failed to stop MPV process.');
      this.setStatus(MPV_STATUSES.ERROR);
      return {
        ok: false,
        status: this.status,
        error: this.lastError,
      };
    }
  }

  resizeMpvViewport(bounds = {}) {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      return this.resizeMpvHostWindow(bounds);
    }
    if (!isValidBounds(bounds)) {
      const error = 'Invalid viewport bounds.';
      this.lastError = error;
      this.setStatus(this.available ? MPV_STATUSES.ERROR : MPV_STATUSES.UNAVAILABLE);
      console.warn('[MpvPlayer] resize rejected: invalid bounds');
      return {
        ok: false,
        status: this.getMpvStatus().status,
        error,
      };
    }

    this.lastViewport = sanitizeBounds(bounds);
    console.info('[MpvPlayer] resize requested without host window', this.lastViewport);

    return {
      ok: true,
      status: this.getMpvStatus().status,
      details: {
        mode: 'mock',
        bounds: this.lastViewport,
      },
    };
  }

  async shutdown() {
    await this.stopMpvPlayback();
    this.destroyMpvHostWindow();
  }
}

const mpvPlayerService = new MpvPlayerService();

module.exports = {
  mpvPlayerService,
  MPV_STATUSES,
};

