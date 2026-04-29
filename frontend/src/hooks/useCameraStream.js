import { useCallback, useEffect, useRef, useState } from 'react';

const HEALTH_INTERVAL_MS = 3000;
const HEALTH_TIMEOUT_MS  = 2000;
const CAPTURE_TIMEOUT_MS = 10000;

const FRAME_STREAM  = 0x01;
const FRAME_CAPTURE  = 0x02;

function cleanIp(ip) {
  return (ip || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function baseUrl(ip) { const c = cleanIp(ip); return c ? `http://${c}` : null; }

export function useCameraStream(imgRef, settings) {
  const { mode, cameraIp, wsUrl } = settings;

  const [cameraOnline, setCameraOnline] = useState(false);
  const [wsStatus, setWsStatus]         = useState('disconnected');
  const [fps, setFps]                    = useState(0);
  const [lastError, setLastError]       = useState(null);

  const fpsRef           = useRef(0);
  const wsRef            = useRef(null);
  const captureResolve   = useRef(null);
  const currentBlobUrl   = useRef(null);
  const healthTimerRef   = useRef(null);

  // ── FPS counter ──────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setFps(fpsRef.current);
      fpsRef.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ══════════════════════════════════════════════
  //  Cloud mode: WebSocket
  // ══════════════════════════════════════════════
  useEffect(() => {
    if (mode !== 'cloud') {
      setCameraOnline(false);
      setWsStatus('disconnected');
      return;
    }
    if (!wsUrl) {
      console.log('[CAM] Cloud mode but no wsUrl — mode:', mode, 'wsUrl:', wsUrl);
      setCameraOnline(false);
      setWsStatus('disconnected');
      return;
    }

    console.log('[CAM] Connecting WebSocket:', wsUrl);
    setWsStatus('connecting');
    setLastError(null);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CAM] WebSocket connected');
      setWsStatus('connected');
      setLastError(null);
    };

    ws.onclose = (event) => {
      console.log('[CAM] WebSocket closed:', event.code, event.reason);
      setWsStatus('disconnected');
      setCameraOnline(false);
      if (event.code !== 1000) {
        setLastError(`انقطع الاتصال (${event.code})`);
      }
    };

    ws.onerror = (event) => {
      console.error('[CAM] WebSocket error:', event);
      setLastError('فشل اتصال WebSocket — تأكد من عنوان السيرفر');
      setWsStatus('disconnected');
    };

    ws.onmessage = (event) => {
      // ── Binary: stream or capture frame ──
      if (event.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(event.data);
        if (buf.length < 2) return;

        const frameType = buf[0];
        const jpegData  = buf.slice(1);

        if (frameType === FRAME_STREAM) {
          fpsRef.current++;
          if (currentBlobUrl.current) {
            URL.revokeObjectURL(currentBlobUrl.current);
          }
          const blob = new Blob([jpegData], { type: 'image/jpeg' });
          const url  = URL.createObjectURL(blob);
          currentBlobUrl.current = url;
          if (imgRef?.current) {
            imgRef.current.src = url;
            imgRef.current.style.display = 'block';
          }
        } else if (frameType === FRAME_CAPTURE) {
          const blob = new Blob([jpegData], { type: 'image/jpeg' });
          const reader = new FileReader();
          reader.onload = () => {
            if (captureResolve.current) {
              captureResolve.current.resolve(reader.result);
              captureResolve.current = null;
            }
          };
          reader.readAsDataURL(blob);
        }
        return;
      }

      // ── Text: status messages ──
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'camera_status') {
            setCameraOnline(!!msg.online);
          }
        } catch {}
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current);
        currentBlobUrl.current = null;
      }
      if (imgRef?.current) {
        imgRef.current.removeAttribute('src');
      }
    };
  }, [mode, wsUrl, imgRef]);

  // ══════════════════════════════════════════════
  //  Local mode: MJPEG stream + HTTP health
  // ══════════════════════════════════════════════
  useEffect(() => {
    if (mode !== 'local' || !cameraIp) {
      if (imgRef?.current) imgRef.current.removeAttribute('src');
      setCameraOnline(false);
      return;
    }

    function streamUrl(ip) {
      const c = cleanIp(ip);
      return c ? `http://${c}:81/stream` : null;
    }

    const img = imgRef?.current;
    if (!img) return;

    const url = streamUrl(cameraIp);
    if (!url) { img.removeAttribute('src'); return; }

    img.src = `${url}?t=${Date.now()}`;

    const onLoad  = () => { fpsRef.current++; };
    const onError = () => {
      setCameraOnline(false);
      setLastError('تعذر الاتصال بالبث');
    };

    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);

    return () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
      img.removeAttribute('src');
    };
  }, [mode, cameraIp, imgRef]);

  // ── Local health check ──────────────────────
  useEffect(() => {
    if (mode !== 'local' || !cameraIp) {
      setCameraOnline(false);
      return;
    }

    const base = baseUrl(cameraIp);
    if (!base) return;

    let cancelled = false;

    async function check() {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
        const res = await fetch(`${base}/?t=${Date.now()}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        });
        clearTimeout(to);
        if (cancelled) return;
        if (res.ok) {
          setCameraOnline(true);
          setLastError(null);
        } else {
          setCameraOnline(false);
          setLastError(`HTTP ${res.status}`);
        }
      } catch (err) {
        if (cancelled) return;
        setCameraOnline(false);
        setLastError(err.name === 'AbortError' ? 'مهلة الاتصال' : 'تعذر الوصول للكاميرا');
      }
    }

    check();
    healthTimerRef.current = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(healthTimerRef.current);
    };
  }, [mode, cameraIp]);

  // ══════════════════════════════════════════════
  //  Shared commands
  // ══════════════════════════════════════════════
  const sendGet = useCallback(async (path) => {
    const base = baseUrl(cameraIp);
    if (!base) return false;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${base}${path}`, { signal: ctrl.signal });
      clearTimeout(to);
      return res.ok;
    } catch { return false; }
  }, [cameraIp]);

  const setFlash = useCallback((b) => {
    const val = Math.max(0, Math.min(255, b | 0));
    if (mode === 'cloud') {
      wsRef.current?.send(JSON.stringify({ cmd: 'flash', value: val }));
    } else {
      sendGet(`/flash?v=${val}`);
    }
  }, [mode, sendGet]);

  const setQuality = useCallback((q) => {
    const val = Math.max(4, Math.min(40, q | 0));
    if (mode === 'cloud') {
      wsRef.current?.send(JSON.stringify({ cmd: 'quality', value: val }));
    } else {
      sendGet(`/quality?v=${val}`);
    }
  }, [mode, sendGet]);

  const captureSnapshot = useCallback(async () => {
    if (mode === 'cloud') {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket غير متصل');
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (captureResolve.current) {
            captureResolve.current = null;
            reject(new Error('انتهت مهلة الالتقاط'));
          }
        }, CAPTURE_TIMEOUT_MS);

        captureResolve.current = {
          resolve: (dataUrl) => {
            clearTimeout(timeout);
            resolve(dataUrl);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        };

        wsRef.current.send(JSON.stringify({ cmd: 'capture' }));
      });
    } else {
      const base = baseUrl(cameraIp);
      if (!base) throw new Error('لم يتم ضبط IP الكاميرا');
      const res = await fetch(`${base}/capture?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`فشل الالتقاط: ${res.status}`);
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    }
  }, [mode, cameraIp]);

  return {
    cameraOnline,
    wsStatus,
    fps,
    lastError,
    setFlash,
    setQuality,
    captureSnapshot,
  };
}