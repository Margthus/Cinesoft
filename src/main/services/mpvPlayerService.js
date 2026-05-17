const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let mpvProcess = null;
let onExitCallback = null;
const DEBUG_TORRSERVER_STREAM = String(process.env.DEBUG_TORRSERVER_STREAM || '').toLowerCase() === 'true';

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

const findMpvExecutable = () => {
  const candidates = [
    path.join(process.cwd(), 'resources', 'mpv', 'mpv.exe'),
    path.join(__dirname, '..', '..', '..', 'resources', 'mpv', 'mpv.exe'),
    path.join(process.resourcesPath || '', 'mpv', 'mpv.exe'),
    path.join(process.resourcesPath || '', 'resources', 'mpv', 'mpv.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('MPV executable not found');
};

const resolveMpvLogPath = () => {
  const candidates = [
    path.join(process.cwd(), 'logs'),
    path.join(process.cwd(), 'userData', 'logs'),
    path.join(process.env.APPDATA || '', 'CineSoft', 'logs'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, 'mpv-torrserver.log');
    } catch {}
  }
  return path.join(process.cwd(), 'mpv-torrserver.log');
};

const stopMpv = () => {
  if (!mpvProcess || mpvProcess.killed) return { stopped: false };
  try {
    mpvProcess.kill();
  } catch {}
  mpvProcess = null;
  return { stopped: true };
};

const playWithMpv = async (payload = {}) => {
  const sourceType = String(payload?.sourceType || '').trim().toLowerCase();
  const rawUrl = String(payload?.streamUrl || payload?.url || '').trim();
  const playlistUrl = String(payload?.playlistUrl || '').trim();
  const localPath = String(payload?.path || payload?.filePath || '').trim();
  const target = rawUrl || playlistUrl || localPath;
  if (!target) throw new Error('MPV URL is required');

  if (mpvProcess && !mpvProcess.killed) {
    try {
      mpvProcess.kill();
    } catch {}
    mpvProcess = null;
  }

  const mpvPath = findMpvExecutable();
  const title = String(payload?.title || 'CineSoft Stream').trim() || 'CineSoft Stream';
  const isUrlSource = sourceType === 'url' || /^https?:\/\//i.test(rawUrl);
  const playbackTarget = isUrlSource ? rawUrl : (localPath || rawUrl || playlistUrl);
  const args = [
    '--force-window=yes',
    '--cache=yes',
    '--cache-secs=30',
    '--demuxer-max-bytes=256MiB',
    '--demuxer-max-back-bytes=128MiB',
    `--title=${title}`,
  ];
  const mpvLogPath = resolveMpvLogPath();
  args.push(`--log-file=${mpvLogPath}`);
  if (playlistUrl && !rawUrl) {
    args.push(`--playlist=${playlistUrl}`);
  } else {
    args.push(playbackTarget);
  }
  console.log('[MpvPlayer:Spawn]', {
    exePath: mpvPath,
    args: args.map((arg) => maskSensitiveUrl(arg)),
    sourceType: sourceType || (isUrlSource ? 'url' : 'file'),
    title,
  });

  mpvProcess = spawn(mpvPath, args, {
    cwd: path.dirname(mpvPath),
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let spawnError = null;
  mpvProcess.on('error', (error) => {
    spawnError = error;
    console.error('[MpvPlayer:SpawnError]', {
      message: error?.message || 'unknown spawn error',
      code: error?.code || '',
    });
  });
  mpvProcess.stderr?.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (!msg) return;
    if (DEBUG_TORRSERVER_STREAM) {
      console.error('[MpvPlayer:Stderr]', { message: maskSensitiveUrl(msg) });
    }
  });
  mpvProcess.stdout?.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (!msg) return;
    if (DEBUG_TORRSERVER_STREAM) {
      console.log('[MpvPlayer:Stdout]', { message: maskSensitiveUrl(msg) });
    }
  });
  mpvProcess.on('exit', (code, signal) => {
    console.log('[MpvPlayer:Exit]', { code, signal, logFile: mpvLogPath });
    if (typeof onExitCallback === 'function') {
      try {
        onExitCallback();
      } catch {}
    }
    mpvProcess = null;
  });
  mpvProcess.unref();

  await new Promise((resolve) => setTimeout(resolve, 300));
  if (spawnError) {
    throw new Error(spawnError?.message || 'Failed to launch MPV');
  }
  if (!mpvProcess || mpvProcess.killed) {
    throw new Error('Failed to launch MPV');
  }

  return {
    ok: true,
    player: 'mpv',
    pid: mpvProcess?.pid || null,
    mpvPath,
    logFile: mpvLogPath,
    url: playbackTarget,
  };
};

const setMpvExitHandler = (handler) => {
  onExitCallback = typeof handler === 'function' ? handler : null;
};

const isMpvRunning = () => Boolean(mpvProcess && !mpvProcess.killed);

module.exports = {
  playWithMpv,
  stopMpv,
  setMpvExitHandler,
  isMpvRunning,
};
