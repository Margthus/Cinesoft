const axios = require('axios');

const TORR_SERVER_BASE_URL = 'http://127.0.0.1:8090';
const TORR_SERVER_TIMEOUT_MS = 2000;

const resolveSourceLink = (payload = {}) => {
  const candidates = [
    payload?.magnet,
    payload?.torrentUrl,
    payload?.link,
    payload?.source?.magnet,
    payload?.source?.torrentUrl,
    payload?.result?.magnet,
    payload?.result?.torrentUrl,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return found ? found.trim() : '';
};

const getTorrServerStatus = async () => {
  try {
    const response = await axios.get(`${TORR_SERVER_BASE_URL}/echo`, {
      timeout: TORR_SERVER_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300) {
      const version = response?.data?.version || response?.headers?.server || '';
      return {
        running: true,
        baseUrl: TORR_SERVER_BASE_URL,
        version: String(version || ''),
      };
    }
  } catch {}
  return {
    running: false,
    baseUrl: TORR_SERVER_BASE_URL,
    error: 'TorrServer not running',
  };
};

const startTorrServerStream = async (payload = {}) => {
  const sourceLink = resolveSourceLink(payload);
  if (!sourceLink) {
    throw new Error('No magnet or torrentUrl provided for TorrServer stream');
  }

  const status = await getTorrServerStatus();
  if (!status.running) {
    throw new Error('TorrServer not running. Start TorrServer on http://127.0.0.1:8090');
  }

  const streamUrl = `${status.baseUrl}/stream?m3u&link=${encodeURIComponent(sourceLink)}`;
  return {
    engine: 'torrserver',
    streamUrl,
    url: streamUrl,
    sourceLink,
    baseUrl: status.baseUrl,
  };
};

module.exports = {
  getTorrServerStatus,
  startTorrServerStream,
};
