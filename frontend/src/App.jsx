import { useCallback, useRef, useState } from "react";
import { useCameraStream } from "./hooks/useCameraStream";
import { useSettings } from "./hooks/useSettings";
import { useAnalysis } from "./hooks/useAnalysis";
import LiveStream from "./components/LiveStream";
import ActionBar from "./components/ActionBar";
import AIReport from "./components/AIReport";
import ConnectionStatus from "./components/ConnectionStatus";
import SettingsModal from "./components/SettingsModal";

export default function App() {
  const imgRef = useRef(null);
  const { settings, setCameraIp, setMode, setServerUrl } = useSettings();

  const {
    cameraOnline,
    wsStatus,
    fps,
    lastError,
    setFlash,
    captureSnapshot,
  } = useCameraStream(imgRef, settings);

  const { report, loading: analyzing, error: analyzeError, analyze } =
    useAnalysis(settings);

  const [settingsOpen, setSettingsOpen] = useState(!settings.cameraIp && settings.mode === 'local');
  const [captureFlash, setCaptureFlash] = useState(false);

  const handleCapture = useCallback(async () => {
    try {
      const dataUrl = await captureSnapshot();
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 200);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `dentistcam_${Date.now()}.jpg`;
      a.click();
    } catch (err) {
      alert(`\u0641\u0634\u0644 \u0627\u0644\u0627\u0644\u062a\u0642\u0627\u0637: ${err.message}`);
    }
  }, [captureSnapshot]);

  const handleAnalyze = useCallback(async () => {
    try {
      const dataUrl = await captureSnapshot();
      await analyze(dataUrl);
    } catch (err) {
      alert(`\u0641\u0634\u0644 \u0627\u0644\u0627\u0644\u062a\u0642\u0627\u0637 \u0644\u0644\u062a\u062d\u0644\u064a\u0644: ${err.message}`);
    }
  }, [captureSnapshot, analyze]);

  const isCloud = settings.mode === 'cloud';
  const needsConfig = settings.mode === 'local' && !settings.cameraIp;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" dir="rtl">

      {/* ── Header ───────────────────────────── */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🦷</span>
          <div>
            <h1 className="text-base font-bold text-white leading-none">DentistCam</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {isCloud
                ? <>متصل سحابياً عبر <span className="font-mono text-gray-400">{settings.serverUrl || window.location.host}</span></>
                : settings.cameraIp
                  ? <>متصل مباشرة بـ <span className="font-mono text-gray-400">{settings.cameraIp}</span></>
                  : "نظام تصوير الأسنان المباشر"}
            </p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isCloud ? 'bg-violet-600/30 text-violet-300' : 'bg-cyan-600/30 text-cyan-300'}`}>
            {isCloud ? 'سحابي' : 'محلي'}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <ConnectionStatus wsStatus={wsStatus} cameraOnline={cameraOnline} fps={fps} mode={settings.mode} />
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
            title="الإعدادات"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543.826 3.31 2.37 2.37a1.724 1.724 0 002.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* ── تنبيه ──────────────────────────── */}
      {needsConfig && (
        <div className="bg-amber-900/30 border-b border-amber-800 text-amber-300 text-sm px-6 py-2.5 text-center">
          لم يتم ضبط عنوان IP للكاميرا.{" "}
          <button onClick={() => setSettingsOpen(true)} className="underline hover:text-amber-200 font-medium">
            فتح الإعدادات
          </button>
        </div>
      )}

      {isCloud && !settings.serverUrl && (
        <div className="bg-amber-900/30 border-b border-amber-800 text-amber-300 text-sm px-6 py-2.5 text-center">
          لم يتم ضبط عنوان السيرفر.{" "}
          <button onClick={() => setSettingsOpen(true)} className="underline hover:text-amber-200 font-medium">
            فتح الإعدادات
          </button>
        </div>
      )}

      {settings.cameraIp && !cameraOnline && lastError && settings.mode === 'local' && (
        <div className="bg-red-900/30 border-b border-red-800 text-red-300 text-xs px-6 py-2 text-center">
          {lastError} — تأكد من تشغيل ESP32 واتصاله بنفس الشبكة
        </div>
      )}

      {/* ── Main Layout ─────────────────────── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 lg:p-6">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="relative">
            <LiveStream imgRef={imgRef} cameraOnline={cameraOnline} />
            {captureFlash && (
              <div className="absolute inset-0 bg-white opacity-70 rounded-xl pointer-events-none" />
            )}
          </div>
          <ActionBar
            cameraOnline={cameraOnline}
            onCapture={handleCapture}
            onAnalyze={handleAnalyze}
            onFlash={setFlash}
            analyzing={analyzing}
          />
        </div>

        <div className="flex flex-col">
          <div className="flex-1 bg-gray-900 rounded-xl border border-gray-700 p-4 overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-700">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              <h2 className="text-sm font-semibold text-gray-200">تقرير التحليل الطبي</h2>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar">
              <AIReport report={report} loading={analyzing} error={analyzeError} />
            </div>
          </div>
        </div>
      </main>

      {/* ── نافذة الإعدادات ────────────────── */}
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSaveIp={setCameraIp}
        onSaveMode={setMode}
        onSaveServerUrl={setServerUrl}
      />
    </div>
  );
}