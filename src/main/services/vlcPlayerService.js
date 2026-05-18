const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

let vlcProcess = null;
let onExitCallback = null;
let onStateCallback = null;

const parseVlcSubtitleLine = (line = '') => {
  const match = String(line || '').match(/^\[VlcHost:Subtitles\]\s+(.+)$/);
  if (!match) return null;
  try {
    const payload = JSON.parse(match[1]);
    return {
      subtitleState: {
        activeKey: String(payload?.activeKey || 'spu:-1'),
        activeId: Number(payload?.activeId ?? -1),
        tracks: Array.isArray(payload?.tracks)
          ? payload.tracks.map((track) => ({
            key: String(track?.key || ''),
            id: Number(track?.id ?? -1),
            label: String(track?.label || ''),
            source: String(track?.source || ''),
          }))
          : [],
      },
    };
  } catch {
    return null;
  }
};

const parseVlcStateLine = (line = '') => {
  const match = String(line || '').match(/^\[VlcHost:State\]\s+(.+)$/);
  if (!match) return null;
  const payload = {};
  for (const part of match[1].split(';')) {
    const [rawKey, rawValue] = String(part || '').split('=').map((item) => String(item || '').trim());
    if (!rawKey) continue;
    payload[rawKey] = rawValue;
  }
  return {
    time: Math.max(0, Number(payload.time) || 0),
    length: Math.max(0, Number(payload.length) || 0),
    volume: Math.max(0, Math.min(100, Number(payload.volume) || 0)),
    playing: payload.playing === '1' || String(payload.playing).toLowerCase() === 'true',
  };
};

const maskSensitiveUrl = (value = '') => {
  const raw = String(value || '');
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    const sensitiveKeys = ['apikey', 'api_key', 'token', 'key', 'pass', 'password'];
    for (const key of sensitiveKeys) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return raw.replace(/(apikey|api_key|token|key|pass|password)=([^&]+)/gi, '$1=***');
  }
};

const findVlcHostExecutable = () => {
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : '';
  const candidates = [
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Debug', 'net8.0-windows', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Release', 'net8.0-windows', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Debug', 'net8.0-windows', 'publish', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Release', 'net8.0-windows', 'publish', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'resources', 'vlc-host', 'Cinesoft.VlcHost.exe'),
    path.join(process.resourcesPath || '', 'vlc-host', 'Cinesoft.VlcHost.exe'),
    path.join(process.resourcesPath || '', 'resources', 'vlc-host', 'Cinesoft.VlcHost.exe'),
    path.join(appPath || '', 'resources', 'vlc-host', 'Cinesoft.VlcHost.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('VLC host executable not found');
};

const stopVlcPlayback = () => {
  if (!vlcProcess || vlcProcess.killed) return { stopped: false };
  try {
    vlcProcess.stdin?.write('stop\n');
  } catch {}
  try {
    vlcProcess.kill();
  } catch {}
  vlcProcess = null;
  return { stopped: true };
};

const playWithVlc = async (payload = {}) => {
  const url = String(payload?.url || payload?.streamUrl || '').trim();
  if (!url) throw new Error('VLC Player URL is required');

  if (vlcProcess && !vlcProcess.killed) {
    try {
      vlcProcess.kill();
    } catch {}
    vlcProcess = null;
  }

  const exePath = findVlcHostExecutable();
  const title = String(payload?.title || 'CineSoft Stream').trim() || 'CineSoft Stream';
  const networkCachingMs = Math.max(0, Number(payload?.networkCachingMs || 1000) || 1000);
  const args = [
    '--url', url,
    '--title', title,
    '--network-caching-ms', String(networkCachingMs),
  ];
  const parentHwnd = Number(payload?.parentHwnd || 0);
  if (Number.isFinite(parentHwnd) && parentHwnd > 0) {
    args.push('--parent-hwnd', String(parentHwnd));
  }
  const insetTop = Number(payload?.insetTop);
  if (Number.isFinite(insetTop) && insetTop >= 0) {
    args.push('--inset-top', String(Math.round(insetTop)));
  }
  const insetLeft = Number(payload?.insetLeft);
  if (Number.isFinite(insetLeft) && insetLeft >= 0) {
    args.push('--inset-left', String(Math.round(insetLeft)));
  }
  const insetRight = Number(payload?.insetRight);
  if (Number.isFinite(insetRight) && insetRight >= 0) {
    args.push('--inset-right', String(Math.round(insetRight)));
  }
  const insetBottom = Number(payload?.insetBottom);
  if (Number.isFinite(insetBottom) && insetBottom >= 0) {
    args.push('--inset-bottom', String(Math.round(insetBottom)));
  }
  if (payload?.fullscreen === true) args.push('--fullscreen');
  if (payload?.quiet === true) args.push('--quiet');
  if (payload?.verbose === true) args.push('--verbose');

  console.log('[VlcPlayer:Spawn]', {
    exePath,
    args: args.map((arg) => maskSensitiveUrl(arg)),
    title,
  });
  console.log('[VlcPlayer:SpawnOptions]', {
    windowsHide: false,
    detached: false,
    cwd: path.dirname(exePath),
    shell: false,
  });

  vlcProcess = spawn(exePath, args, {
    cwd: path.dirname(exePath),
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: false,
    shell: false,
  });

  let spawnError = null;
  vlcProcess.on('error', (error) => {
    spawnError = error;
    console.error('[VlcPlayer:SpawnError]', {
      message: String(error?.message || 'unknown spawn error'),
      code: String(error?.code || ''),
    });
  });
  let stdoutBuffer = '';
  vlcProcess.stdout?.on('data', (chunk) => {
    stdoutBuffer += String(chunk || '');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const msg = String(rawLine || '').trim();
      if (!msg) continue;
      console.log(maskSensitiveUrl(msg));
      const state = parseVlcStateLine(msg);
      if (state && typeof onStateCallback === 'function') {
        try {
          onStateCallback(state);
        } catch {}
      }
      const subtitleState = parseVlcSubtitleLine(msg);
      if (subtitleState && typeof onStateCallback === 'function') {
        try {
          onStateCallback(subtitleState);
        } catch {}
      }
    }
  });
  vlcProcess.stderr?.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (!msg) return;
    console.error(maskSensitiveUrl(msg));
  });
  vlcProcess.on('exit', (code, signal) => {
    console.log('[VlcPlayer:Exit]', { code, signal });
    if (typeof onExitCallback === 'function') {
      try {
        onExitCallback();
      } catch {}
    }
    vlcProcess = null;
  });

  await new Promise((resolve) => setTimeout(resolve, 400));
  if (spawnError) {
    throw new Error(spawnError?.message || 'Failed to launch VLC Player');
  }
  if (!vlcProcess || vlcProcess.killed) {
    throw new Error('Failed to launch VLC Player');
  }

  return {
    ok: true,
    player: 'vlc',
    pid: vlcProcess?.pid || null,
    exePath,
    url,
  };
};

const sendVlcCommand = (payload = {}) => {
  if (!vlcProcess || vlcProcess.killed || !vlcProcess.stdin?.writable) {
    return { ok: false, error: 'VLC player is not running' };
  }

  const command = String(payload?.command || '').trim();
  if (!command) return { ok: false, error: 'Missing VLC player command' };

  const allowedCommands = new Set(['toggle-play', 'play-pause', 'play', 'pause', 'seek-percent', 'seek', 'volume', 'set-volume', 'fullscreen', 'set-insets', 'set-subtitle', 'stop']);
  if (!allowedCommands.has(command)) {
    return { ok: false, error: `Unsupported VLC player command: ${command}` };
  }

  const rawValue = payload?.value;
  const value = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
  const line = value ? `${command} ${value}\n` : `${command}\n`;
  try {
    vlcProcess.stdin.write(line);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || 'Failed to send VLC player command') };
  }
};

const setVlcExitHandler = (handler) => {
  onExitCallback = typeof handler === 'function' ? handler : null;
};

const setVlcStateHandler = (handler) => {
  onStateCallback = typeof handler === 'function' ? handler : null;
};

module.exports = {
  playWithVlc,
  stopVlcPlayback,
  sendVlcCommand,
  setVlcExitHandler,
  setVlcStateHandler,
};
