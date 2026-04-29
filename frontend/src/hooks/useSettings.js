import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY_IP   = 'dentistcam.cameraIp';
const STORAGE_KEY_MODE = 'dentistcam.mode';
const STORAGE_KEY_URL  = 'dentistcam.serverUrl';

const ENV_IP   = import.meta.env.VITE_CAMERA_IP || '';
const ENV_MODE = import.meta.env.VITE_MODE || 'local';
const ENV_KEY  = import.meta.env.VITE_OPENAI_API_KEY || '';

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? v : fallback; }
  catch { return fallback; }
}

function deriveWsUrl(httpUrl) {
  try {
    const url = new URL(httpUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.searchParams.set('role', 'browser');
    const result = url.toString();
    console.log('[SETTINGS] deriveWsUrl:', httpUrl, '→', result);
    return result;
  } catch (e) {
    console.error('[SETTINGS] deriveWsUrl error:', e);
    return '';
  }
}

export function useSettings() {
  const [cameraIp, setCameraIpState] = useState(() => load(STORAGE_KEY_IP, ENV_IP));
  const [mode, setModeState] = useState(() => load(STORAGE_KEY_MODE, ENV_MODE));
  const [serverUrl, setServerUrlState] = useState(() => load(STORAGE_KEY_URL, ''));

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY_IP, cameraIp); } catch {} }, [cameraIp]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY_MODE, mode); } catch {} }, [mode]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY_URL, serverUrl); } catch {} }, [serverUrl]);

  const setCameraIp = useCallback((ip) => setCameraIpState((ip || '').trim()), []);
  const setMode = useCallback((m) => setModeState(m), []);
  const setServerUrl = useCallback((url) => setServerUrlState((url || '').trim()), []);

const effectiveServerUrl = mode === 'cloud'
    ? (serverUrl || (typeof window !== 'undefined' ? window.location.origin : ''))
    : '';
  const effectiveWsUrl = mode === 'cloud'
    ? deriveWsUrl(effectiveServerUrl)
    : '';

  console.log('[SETTINGS] mode:', mode, 'serverUrl:', serverUrl, 'effectiveServerUrl:', effectiveServerUrl, 'wsUrl:', effectiveWsUrl);

  return {
    settings: {
      mode,
      cameraIp,
      serverUrl: effectiveServerUrl,
      wsUrl: effectiveWsUrl,
      openaiApiKey: ENV_KEY,
    },
    setCameraIp,
    setMode,
    setServerUrl,
  };
}