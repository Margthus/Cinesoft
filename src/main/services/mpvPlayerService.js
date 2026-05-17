const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let mpvProcess = null;

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
  throw new Error('mpv.exe not found under resources/mpv');
};

const stopMpv = () => {
  if (!mpvProcess || mpvProcess.killed) return { stopped: false };
  try {
    mpvProcess.kill();
  } catch {}
  mpvProcess = null;
  return { stopped: true };
};

const playWithMpv = (payload = {}) => {
  const url = String(payload?.streamUrl || payload?.url || '').trim();
  if (!url) throw new Error('MPV URL is required');

  if (mpvProcess && !mpvProcess.killed) {
    try {
      mpvProcess.kill();
    } catch {}
    mpvProcess = null;
  }

  const mpvPath = findMpvExecutable();
  const title = String(payload?.title || 'CineSoft Stream').trim() || 'CineSoft Stream';
  const args = [
    '--force-window=yes',
    '--cache=yes',
    '--cache-secs=30',
    '--demuxer-max-bytes=256MiB',
    '--demuxer-max-back-bytes=128MiB',
    `--title=${title}`,
    url,
  ];

  mpvProcess = spawn(mpvPath, args, {
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  mpvProcess.on('exit', () => {
    mpvProcess = null;
  });
  mpvProcess.unref();

  return {
    ok: true,
    player: 'mpv',
    pid: mpvProcess?.pid || null,
    mpvPath,
    url,
  };
};

module.exports = {
  playWithMpv,
  stopMpv,
};
