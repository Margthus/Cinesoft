const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let vlcProcess = null;
let onExitCallback = null;

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
  const candidates = [
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Debug', 'net8.0-windows', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Release', 'net8.0-windows', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Debug', 'net8.0-windows', 'publish', 'Cinesoft.VlcHost.exe'),
    path.join(process.cwd(), 'tools', 'vlc-host', 'bin', 'Release', 'net8.0-windows', 'publish', 'Cinesoft.VlcHost.exe'),
    path.join(process.resourcesPath || '', 'vlc-host', 'Cinesoft.VlcHost.exe'),
    path.join(process.resourcesPath || '', 'resources', 'vlc-host', 'Cinesoft.VlcHost.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('VLC host executable not found');
};

const stopVlcPlayback = () => {
  if (!vlcProcess || vlcProcess.killed) return { stopped: false };
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
  });

  vlcProcess = spawn(exePath, args, {
    cwd: path.dirname(exePath),
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  let spawnError = null;
  vlcProcess.on('error', (error) => {
    spawnError = error;
    console.error('[VlcPlayer:SpawnError]', {
      message: String(error?.message || 'unknown spawn error'),
      code: String(error?.code || ''),
    });
  });
  vlcProcess.stdout?.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (!msg) return;
    console.log(maskSensitiveUrl(msg));
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
  vlcProcess.unref();

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

const setVlcExitHandler = (handler) => {
  onExitCallback = typeof handler === 'function' ? handler : null;
};

module.exports = {
  playWithVlc,
  stopVlcPlayback,
  setVlcExitHandler,
};
