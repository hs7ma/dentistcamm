import { useEffect, useState } from 'react';

const IP_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export default function SettingsModal({ open, settings, onClose, onSaveIp, onSaveMode, onSaveServerUrl }) {
  const [mode, setMode] = useState(settings.mode || 'local');
  const [ip, setIp] = useState(settings.cameraIp || '');
  const [serverUrl, setServerUrl] = useState(settings.serverUrl || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (open) {
      setMode(settings.mode || 'local');
      setIp(settings.cameraIp || '');
      setServerUrl(settings.serverUrl || '');
      setTestResult(null);
    }
  }, [open, settings.mode, settings.cameraIp, settings.serverUrl]);

  if (!open) return null;

  const trimmed = ip.trim();
  const ipValid = IP_REGEX.test(trimmed);
  const ipDirty = trimmed !== (settings.cameraIp || '');
  const urlDirty = serverUrl.trim() !== (settings.serverUrl || '');

  const maskedKey = settings.openaiApiKey
    ? `${settings.openaiApiKey.slice(0, 7)}\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022${settings.openaiApiKey.slice(-4)}`
    : '\u2014 \u063a\u064a\u0631 \u0645\u0636\u0628\u0648\u0637 \u2014';

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const target = mode === 'local' ? `http://${trimmed}` : serverUrl.trim();
      if (!target) { setTestResult({ ok: false, msg: 'عنوان مطلوب' }); return; }

      if (mode === 'cloud') {
        const res = await fetch(`${target}/api/health`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setTestResult({ ok: true, msg: `متصل · الكاميرا: ${data.camera ? 'نعم' : 'لا'} · متصفحات: ${data.browsers}` });
        } else {
          setTestResult({ ok: false, msg: `HTTP ${res.status}` });
        }
      } else {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${target}/`, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (res.ok) {
          const data = await res.json();
          setTestResult({ ok: true, msg: `متصل · RSSI: ${data.rssi ?? '\u2014'} dBm · PSRAM: ${data.psram ? 'نعم' : 'لا'}` });
        } else {
          setTestResult({ ok: false, msg: `HTTP ${res.status}` });
        }
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err.name === 'AbortError' ? 'انتهت المهلة' : 'تعذر الاتصال' });
    } finally {
      setTesting(false);
    }
  }

  function save() {
    onSaveMode(mode);
    if (mode === 'local' && ipValid && ipDirty) {
      onSaveIp(trimmed);
    }
    if (mode === 'cloud' && urlDirty) {
      onSaveServerUrl(serverUrl.trim());
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()} dir="rtl">

        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <GearIcon /> الإعدادات
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition" title="إغلاق">\u2715</button>
        </div>

        {/* ── صيغة التشغيل ── */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-2">صيغة التشغيل</label>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('local')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${mode === 'local' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              محلي
            </button>
            <button
              onClick={() => setMode('cloud')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${mode === 'cloud' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              سحابي
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            {mode === 'local'
              ? 'اتصال مباشر بكاميرا ESP32 عبر الشبكة المحلية'
              : 'اتصال عبر خادم Railway — الكاميرا تبث للسيرفر ثم للمتصفح'}
          </p>
        </div>

        {/* ── IP الكاميرا (محلي فقط) ── */}
        {mode === 'local' && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">عنوان IP للكاميرا</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="192.168.1.180"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className={`w-full px-3 py-2.5 bg-gray-800 border rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 ${ip && !ipValid ? 'border-red-600' : 'border-gray-700'}`}
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-1">خذ الـ IP من Serial Monitor للـ ESP32</p>
          </div>
        )}

        {/* ── عنوان السيرفر (سحابي فقط) ── */}
        {mode === 'cloud' && (
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">عنوان خادم Railway</label>
            <input
              type="text"
              placeholder="https://your-app.up.railway.app"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              dir="ltr"
            />
            <p className="text-xs text-gray-500 mt-1">اتركه فارغاً للاستخدام التلقائي (عند نشره على نفس السيرفر)</p>
          </div>
        )}

        {/* ── اختبار الاتصال ── */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <button
            onClick={testConnection}
            disabled={(mode === 'local' && !ipValid) || (mode === 'cloud' && !serverUrl.trim()) || testing}
            className="px-3 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {testing ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
          </button>
          {testResult && (
            <span className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
              {testResult.ok ? '\u2713 ' : '\u2717 '}{testResult.msg}
            </span>
          )}
        </div>

        {/* ── مفتاح OpenAI ── */}
        {mode === 'local' && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-gray-300">مفتاح OpenAI API</span>
              <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">من .env</span>
            </div>
            <div className="w-full px-3 py-2.5 bg-gray-800/60 border border-gray-700 rounded-lg text-violet-300 text-sm font-mono truncate" dir="ltr">
              {maskedKey}
            </div>
          </div>
        )}

        {mode === 'cloud' && (
          <div className="mb-5 p-3 bg-violet-900/20 border border-violet-700/40 rounded-lg">
            <p className="text-xs text-violet-300">
              في الوضع السحابي، مفتاح OpenAI يُخزّن على السيرفر فقط ولا يُرسل للمتصفح.
            </p>
          </div>
        )}

        {/* ── أزرار ── */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition">إلغاء</button>
          <button
            onClick={save}
            disabled={(mode === 'local' && (!ipValid || !ipDirty)) && (mode === 'cloud' && !urlDirty) && mode === settings.mode}
            className="px-4 py-2 text-sm rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543.826 3.31 2.37 2.37a1.724 1.724 0 002.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}