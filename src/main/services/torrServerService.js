const axios = require('axios');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PORT = 8090;
const DEFAULT_READY_TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS = 2000;
const DEBUG_TORRSERVER_STREAM = String(process.env.DEBUG_TORRSERVER_STREAM || '').toLowerCase() === 'true';

let torrServerProcess = null;
let startedByCineSoft = false;

const maskSensitiveUrl = (value = '') => {
  const raw = String(value || '');
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    const sensitiveKeys = ['apikey', 'api_key', 'token', 'key', 'pass', 'password'];
    for (const key of sensitiveKeys) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return raw.replace(/(apikey|api_key|token|key|pass|password)=([^&]+)/gi, '$1=***');
  }
};

const previewText = (value = '', max = 120) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
};
const debugLog = (...args) => {
  if (!DEBUG_TORRSERVER_STREAM) return;
  console.log(...args);
};

const listKeys = (value) => (value && typeof value === 'object' ? Object.keys(value) : []);

const ensureDir = (dirPath = '') => {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
};

const toInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const normalizeTorrServerSettings = (settings = {}, userDataPath = '') => {
  const port = toInt(settings.port, DEFAULT_PORT);
  const baseUrl = String(settings.baseUrl || `http://127.0.0.1:${port}`).trim() || `http://127.0.0.1:${port}`;
  const rootCacheDir = userDataPath ? path.join(userDataPath, 'cache', 'torrserver') : '';
  const dataDir = String(settings.dataDir || (rootCacheDir ? path.join(rootCacheDir, 'data') : '')).trim();
  const cacheDir = String(settings.cacheDir || (rootCacheDir ? path.join(rootCacheDir, 'files') : '')).trim();
  const normalized = {
    enabled: settings.enabled === true,
    exePath: String(settings.exePath || '').trim(),
    port,
    baseUrl,
    autoStartOnStream: settings.autoStartOnStream !== false,
    stopWhenPlaybackEnds: settings.stopWhenPlaybackEnds !== false,
    dataDir,
    cacheDir,
    cacheSize: Number.isFinite(Number(settings.cacheSize)) ? Number(settings.cacheSize) : null,
  };
  return normalized;
};

const isMagnetLink = (value = '') => /^magnet:\?/i.test(String(value || '').trim());

const normalizeTorrServerSource = (payload = {}) => {
  const pick = (path, value) => ({ path, value: String(value || '').trim() });
  const allCandidates = [
    pick('payload.magnet', payload?.magnet),
    pick('payload.magnetUrl', payload?.magnetUrl),
    pick('payload.magnetLink', payload?.magnetLink),
    pick('payload.torrentUrl', payload?.torrentUrl),
    pick('payload.downloadUrl', payload?.downloadUrl),
    pick('payload.url', payload?.url),
    pick('payload.link', payload?.link),
    pick('payload.source.magnet', payload?.source?.magnet),
    pick('payload.source.magnetUrl', payload?.source?.magnetUrl),
    pick('payload.source.magnetLink', payload?.source?.magnetLink),
    pick('payload.source.torrentUrl', payload?.source?.torrentUrl),
    pick('payload.source.downloadUrl', payload?.source?.downloadUrl),
    pick('payload.source.url', payload?.source?.url),
    pick('payload.source.link', payload?.source?.link),
    pick('payload.rawSource.magnet', payload?.rawSource?.magnet),
    pick('payload.rawSource.magnetUrl', payload?.rawSource?.magnetUrl),
    pick('payload.rawSource.magnetLink', payload?.rawSource?.magnetLink),
    pick('payload.rawSource.torrentUrl', payload?.rawSource?.torrentUrl),
    pick('payload.rawSource.downloadUrl', payload?.rawSource?.downloadUrl),
    pick('payload.rawSource.url', payload?.rawSource?.url),
    pick('payload.rawSource.link', payload?.rawSource?.link),
    pick('payload.selectedSource.magnet', payload?.selectedSource?.magnet),
    pick('payload.selectedSource.magnetUrl', payload?.selectedSource?.magnetUrl),
    pick('payload.selectedSource.magnetLink', payload?.selectedSource?.magnetLink),
    pick('payload.selectedSource.torrentUrl', payload?.selectedSource?.torrentUrl),
    pick('payload.selectedSource.downloadUrl', payload?.selectedSource?.downloadUrl),
    pick('payload.selectedSource.url', payload?.selectedSource?.url),
    pick('payload.selectedSource.link', payload?.selectedSource?.link),
    pick('payload.result.magnet', payload?.result?.magnet),
    pick('payload.result.magnetUrl', payload?.result?.magnetUrl),
    pick('payload.result.magnetLink', payload?.result?.magnetLink),
    pick('payload.result.torrentUrl', payload?.result?.torrentUrl),
    pick('payload.result.downloadUrl', payload?.result?.downloadUrl),
    pick('payload.result.url', payload?.result?.url),
    pick('payload.result.link', payload?.result?.link),
    pick('payload.item.magnet', payload?.item?.magnet),
    pick('payload.item.magnetUrl', payload?.item?.magnetUrl),
    pick('payload.item.magnetLink', payload?.item?.magnetLink),
    pick('payload.item.torrentUrl', payload?.item?.torrentUrl),
    pick('payload.item.downloadUrl', payload?.item?.downloadUrl),
    pick('payload.item.url', payload?.item?.url),
    pick('payload.item.link', payload?.item?.link),
  ];
  const magnetCandidates = allCandidates;
  const torrentCandidates = allCandidates;

  debugLog('[TorrServer:SourceCandidates]', {
    magnetCandidates: magnetCandidates.map((c) => ({
      path: c.path,
      present: Boolean(c.value),
      isMagnet: isMagnetLink(c.value),
      preview: previewText(maskSensitiveUrl(c.value), 160),
    })),
    torrentUrlCandidates: torrentCandidates.map((c) => ({
      path: c.path,
      present: Boolean(c.value),
      preview: previewText(maskSensitiveUrl(c.value), 160),
    })),
  });

  const selectedMagnetCandidate = magnetCandidates.find((c) => isMagnetLink(c.value));
  const selectedTorrentCandidate = torrentCandidates.find((c) => c.value && !isMagnetLink(c.value));
  const magnet = selectedMagnetCandidate?.value || '';
  const torrentUrl = selectedTorrentCandidate?.value || '';
  const sourceKind = magnet ? 'magnet' : (torrentUrl ? 'torrentUrl' : 'none');
  const provider = String(
    payload?.provider
    || payload?.source?.provider
    || payload?.result?.provider
    || payload?.item?.provider
    || payload?.rawSource?.provider
    || '',
  ).trim();
  return {
    magnet,
    torrentUrl,
    sourceKind,
    provider,
    selectedPath: selectedMagnetCandidate?.path || selectedTorrentCandidate?.path || '',
  };
};

const getBaseUrlFromSettings = (settings = {}) => {
  const port = toInt(settings.port, DEFAULT_PORT);
  return String(settings.baseUrl || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isPortOpen = async (port) => new Promise((resolve) => {
  const socket = new net.Socket();
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    try { socket.destroy(); } catch {}
    resolve(value);
  };
  socket.setTimeout(500);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
  socket.connect(port, '127.0.0.1');
});

const fetchSwaggerDoc = async (baseUrl = '') => {
  const response = await axios.get(`${baseUrl}/swagger/doc.json`, {
    timeout: HEALTH_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Swagger not reachable at ${baseUrl}/swagger/doc.json`);
  }
  return response.data || {};
};

const parseM3uFirstUrl = (content = '') => {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) return '';
  const urlLines = lines.filter((line) => /^https?:\/\//i.test(line));
  if (!urlLines.length) return '';
  const preferredLine = urlLines.find((line) => /\/stream\//i.test(line) || /\.(mp4|mkv|avi|mov|webm|ts|m4v)(\?|$)/i.test(line));
  return preferredLine || urlLines[0] || '';
};

const safePreview = (value = '', max = 500) => {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const waitForPlayableM3UUrl = async (m3uUrl, options = {}) => {
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || 30000);
  const intervalMs = Math.max(250, Number(options?.intervalMs) || 1000);
  const startedAt = Date.now();
  let attempt = 0;
  let lastStatus = 0;
  let lastContentType = '';
  let lastBodyPreview = '';
  let lastBodyLength = 0;

  while ((Date.now() - startedAt) <= timeoutMs) {
    attempt += 1;
    let hasPlayableUrl = false;
    let resolvedUrl = '';
    try {
      const response = await axios.get(m3uUrl, {
        timeout: Math.max(HEALTH_TIMEOUT_MS, 5000),
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
      });
      const body = String(response?.data || '');
      const headers = response?.headers || {};
      lastStatus = Number(response?.status || 0);
      lastContentType = String(headers['content-type'] || '');
      lastBodyLength = body.length;
      lastBodyPreview = maskSensitiveUrl(safePreview(body, 200));
      if (lastStatus >= 200 && lastStatus < 300) {
        resolvedUrl = parseM3uFirstUrl(body);
        hasPlayableUrl = Boolean(resolvedUrl);
      }
    } catch (error) {
      lastStatus = 0;
      lastContentType = '';
      lastBodyLength = 0;
      lastBodyPreview = safePreview(String(error?.message || 'request failed'), 200);
    }

    console.log('[TorrServer:M3UResolveWait]', {
      attempt,
      elapsedMs: Date.now() - startedAt,
      status: lastStatus,
      contentType: lastContentType,
      bodyLength: lastBodyLength,
      hasPlayableUrl,
    });

    if (hasPlayableUrl) {
      return {
        streamUrl: resolvedUrl,
        attempt,
        elapsedMs: Date.now() - startedAt,
        status: lastStatus,
        contentType: lastContentType,
        bodyLength: lastBodyLength,
      };
    }

    if ((Date.now() - startedAt) >= timeoutMs) break;
    await wait(intervalMs);
  }

  return {
    streamUrl: '',
    attempt,
    elapsedMs: Date.now() - startedAt,
    status: lastStatus,
    contentType: lastContentType,
    bodyLength: lastBodyLength,
    bodyPreview: lastBodyPreview,
  };
};

const isLikelyTorrentBytes = (buffer) => {
  if (!buffer || buffer.length < 4) return false;
  const head = Buffer.from(buffer).subarray(0, 64).toString('utf8');
  return /^d\d*:/i.test(head) || head.startsWith('d8:announce');
};

const uploadTorrentBuffer = async (baseUrl, torrentBytes) => {
  const form = new FormData();
  const blob = new Blob([torrentBytes], { type: 'application/x-bittorrent' });
  form.append('file', blob, 'stream.torrent');
  const response = await fetch(`${baseUrl}/torrent/upload`, {
    method: 'POST',
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TorrServer upload failed (${response.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const resolveLinkFromUploadResponse = (uploadResponse) => {
  if (!uploadResponse) return '';
  if (typeof uploadResponse === 'string') {
    const str = uploadResponse.trim();
    if (!str) return '';
    if (isMagnetLink(str)) return str;
    const maybeHash = str.replace(/[^a-f0-9]/gi, '');
    if (maybeHash.length >= 32) return maybeHash;
    return str;
  }
  const candidates = [
    uploadResponse?.hash,
    uploadResponse?.infoHash,
    uploadResponse?.torrHash,
    uploadResponse?.id,
    uploadResponse?.link,
    uploadResponse?.url,
    uploadResponse?.torrent?.hash,
    uploadResponse?.torrent?.infoHash,
  ];
  const found = candidates.find((value) => String(value || '').trim().length > 0);
  return found ? String(found).trim() : '';
};

const validateRequiredEndpoints = (swaggerDoc = {}) => {
  const paths = swaggerDoc?.paths || {};
  const hasEcho = Boolean(paths['/echo']?.get);
  const hasStream = Boolean(paths['/stream']?.get);
  if (!hasEcho || !hasStream) {
    throw new Error('TorrServer API mismatch: /echo or /stream endpoint is missing');
  }
  return true;
};

const getTorrServerStatus = async (settings = {}) => {
  const baseUrl = getBaseUrlFromSettings(settings);
  try {
    const response = await axios.get(`${baseUrl}/echo`, {
      timeout: HEALTH_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300) {
      return {
        running: true,
        baseUrl,
        version: String(response.data || response.headers?.server || ''),
        startedByCineSoft,
        pid: torrServerProcess?.pid || null,
      };
    }
  } catch {}
  debugLog('[TorrServer:Status]', {
    running: false,
    baseUrl: maskSensitiveUrl(baseUrl),
    note: 'health endpoint is offline',
  });
  return {
    running: false,
    baseUrl,
    error: 'TorrServer not running',
    startedByCineSoft: false,
    pid: null,
  };
};

const waitUntilReady = async (settings = {}, timeoutMs = DEFAULT_READY_TIMEOUT_MS) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getTorrServerStatus(settings);
    if (status.running) return status;
    await wait(350);
  }
  throw new Error('TorrServer start timeout');
};

const ensureTorrServerProcess = async (settings = {}) => {
  const normalized = normalizeTorrServerSettings(settings);
  if (!normalized.exePath) {
    throw new Error('TorrServer exe path is not configured');
  }
  if (!fs.existsSync(normalized.exePath)) {
    throw new Error('TorrServer exe path is not configured');
  }
  ensureDir(normalized.dataDir);
  ensureDir(normalized.cacheDir);

  const alive = await getTorrServerStatus(normalized);
  if (alive.running) return { started: false, status: alive };

  const portOpen = await isPortOpen(normalized.port);
  if (portOpen) {
    throw new Error(`Port ${normalized.port} is in use by another service`);
  }

  const args = [
    '--port', String(normalized.port),
    '--path', normalized.dataDir,
    '--torrentsdir', normalized.cacheDir,
  ];

  torrServerProcess = spawn(normalized.exePath, args, {
    cwd: path.dirname(normalized.exePath),
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  startedByCineSoft = true;

  torrServerProcess.once('exit', () => {
    torrServerProcess = null;
    startedByCineSoft = false;
  });
  torrServerProcess.unref();

  const status = await waitUntilReady(normalized);
  return { started: true, status };
};

const startTorrServer = async (settings = {}) => {
  const normalized = normalizeTorrServerSettings(settings);
  const result = await ensureTorrServerProcess(normalized);
  return {
    ok: true,
    ...result.status,
    started: result.started,
  };
};

const stopTorrServer = async (settings = {}, opts = {}) => {
  const normalized = normalizeTorrServerSettings(settings);
  if (opts.onlyIfManaged === true && !startedByCineSoft) {
    return { ok: true, stopped: false, skipped: 'not-managed' };
  }

  const status = await getTorrServerStatus(normalized);
  if (!status.running && (!torrServerProcess || torrServerProcess.killed)) {
    return { ok: true, stopped: false };
  }

  try {
    await axios.get(`${status.baseUrl}/shutdown`, {
      timeout: 1500,
      validateStatus: () => true,
    });
  } catch {}

  if (torrServerProcess && !torrServerProcess.killed) {
    try {
      torrServerProcess.kill();
    } catch {}
  }
  torrServerProcess = null;
  startedByCineSoft = false;
  return { ok: true, stopped: true };
};

const testTorrServerConnection = async (settings = {}) => {
  const normalized = normalizeTorrServerSettings(settings);
  const status = await getTorrServerStatus(normalized);
  if (!status.running) {
    return { ok: false, error: 'TorrServer not running', ...status };
  }
  try {
    const swaggerDoc = await fetchSwaggerDoc(status.baseUrl);
    validateRequiredEndpoints(swaggerDoc);
    return { ok: true, ...status };
  } catch (error) {
    return { ok: false, error: error.message, ...status };
  }
};

const startTorrServerStream = async (payload = {}, settings = {}) => {
  debugLog('[TorrServer:StartStream]', {
    hasMagnet: Boolean(payload?.magnet || payload?.source?.magnet || payload?.result?.magnet),
    hasTorrentUrl: Boolean(payload?.torrentUrl || payload?.source?.torrentUrl || payload?.result?.torrentUrl),
    hasLink: Boolean(payload?.link),
  });
  const normalized = normalizeTorrServerSettings(settings);
  const normalizedSource = normalizeTorrServerSource(payload);
  console.log('[TorrServer:NormalizedSource]', {
    sourceKind: normalizedSource.sourceKind,
    selectedPath: normalizedSource.selectedPath || '',
    hasMagnet: Boolean(normalizedSource.magnet),
    hasTorrentUrl: Boolean(normalizedSource.torrentUrl),
    magnetPreview: previewText(maskSensitiveUrl(normalizedSource.magnet), 80),
    torrentUrlPreview: previewText(maskSensitiveUrl(normalizedSource.torrentUrl), 80),
    provider: normalizedSource.provider,
  });
  const magnetLink = normalizedSource.magnet;
  const torrentUrl = normalizedSource.torrentUrl;
  if (!magnetLink && !torrentUrl) {
    const topLevelKeys = listKeys(payload);
    const sourceKeys = listKeys(payload?.source);
    const provider = String(normalizedSource.provider || '');
    throw new Error(`No magnet or torrentUrl provided (topLevelKeys=${topLevelKeys.join(',')}; sourceKeys=${sourceKeys.join(',')}; provider=${provider})`);
  }

  let status = await getTorrServerStatus(normalized);
  let startedForThisSession = false;

  if (!status.running) {
    debugLog('[TorrServer:StartStream]', {
      step: 'status-check',
      running: false,
      autoStartOnStream: normalized.autoStartOnStream === true,
      baseUrl: maskSensitiveUrl(normalized.baseUrl),
    });
    if (normalized.autoStartOnStream !== true) {
      throw new Error('TorrServer not running');
    }
    const startedResult = await startTorrServer(normalized);
    startedForThisSession = startedResult?.started === true;
    status = await getTorrServerStatus(normalized);
  }

  if (!status.running) {
    throw new Error('TorrServer not running');
  }

  const swaggerDoc = await fetchSwaggerDoc(status.baseUrl);
  validateRequiredEndpoints(swaggerDoc);

  if (!magnetLink) {
    throw new Error('TorrServer streaming currently requires a magnet link');
  }
  const streamSourceLink = magnetLink;
  debugLog('[TorrServer:FinalStreamSource]', {
    sourceKind: 'magnet',
    linkPreview: previewText(maskSensitiveUrl(streamSourceLink), 160),
  });

  const m3uUrl = `${status.baseUrl}/stream?m3u&link=${encodeURIComponent(streamSourceLink)}`;
  debugLog('[TorrServer:M3UFetch]', { m3uUrl: maskSensitiveUrl(m3uUrl) });
  const m3uResolve = await waitForPlayableM3UUrl(m3uUrl, {
    timeoutMs: 30000,
    intervalMs: 1000,
  });
  console.log('[TorrServer:M3UResponse]', {
    status: Number(m3uResolve?.status || 0),
    contentType: String(m3uResolve?.contentType || ''),
    bodyLength: Number(m3uResolve?.bodyLength || 0),
  });
  const streamUrl = String(m3uResolve?.streamUrl || '');
  console.log('[TorrServer:M3UResolvedUrl]', {
    streamUrl: maskSensitiveUrl(streamUrl),
  });
  const finalStreamUrl = streamUrl;
  if (!finalStreamUrl) {
    throw new Error(`TorrServer could not resolve playable video URL. Metadata may still be loading.${m3uResolve?.bodyPreview ? ` Last response: ${m3uResolve.bodyPreview}` : ''}`);
  }
  console.log('[TorrServer:StreamUrl]', {
    streamUrl: maskSensitiveUrl(finalStreamUrl),
    baseUrl: maskSensitiveUrl(status.baseUrl),
  });
  return {
    engine: 'torrserver',
    streamUrl: finalStreamUrl,
    playlistUrl: '',
    m3uUrl,
    directStreamUrl: '',
    url: finalStreamUrl,
    sourceLink: previewText(maskSensitiveUrl(streamSourceLink), 160),
    baseUrl: status.baseUrl,
    startedForThisSession,
    startedByCineSoft,
    activePlaybackKind: 'torrserver-stream',
  };
};

module.exports = {
  DEFAULT_PORT,
  normalizeTorrServerSettings,
  getTorrServerStatus,
  waitUntilReady,
  startTorrServer,
  stopTorrServer,
  testTorrServerConnection,
  startTorrServerStream,
  fetchSwaggerDoc,
};
