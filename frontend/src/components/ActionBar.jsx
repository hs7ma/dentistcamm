/**
 * شريط التحكم
 * أزرار: التقاط صورة، تحليل AI، التحكم بالفلاش
 */
import { useState } from "react";

export default function ActionBar({
  cameraOnline,
  onCapture,
  onAnalyze,
  onFlash,
  analyzing,
}) {
  const [flash, setFlash] = useState(0); // 0–255

  function handleFlashChange(e) {
    const val = Number(e.target.value);
    setFlash(val);
    onFlash(val);
  }

  const btnBase =
    "flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-800/60 rounded-xl border border-gray-700">

      {/* التقاط صورة */}
      <button
        onClick={onCapture}
        disabled={!cameraOnline}
        className={`${btnBase} bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30`}
        title="التقاط صورة عالية الجودة"
      >
        <CameraIcon />
        التقاط
      </button>

      {/* تحليل AI */}
      <button
        onClick={onAnalyze}
        disabled={analyzing}
        className={`${btnBase} bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/30`}
        title="إرسال الصورة الحالية لتحليل GPT-4o"
      >
        {analyzing ? <SpinnerIcon /> : <BrainIcon />}
        {analyzing ? "جارٍ التحليل..." : "تحليل AI"}
      </button>

      {/* مساحة */}
      <div className="flex-1" />

      {/* التحكم بالفلاش */}
      <div className="flex items-center gap-3">
        <FlashIcon dim={flash === 0} />
        <input
          type="range"
          min={0}
          max={255}
          step={5}
          value={flash}
          onChange={handleFlashChange}
          disabled={!cameraOnline}
          className="w-28 accent-yellow-400 disabled:opacity-40 cursor-pointer"
          title={`الفلاش: ${Math.round((flash / 255) * 100)}%`}
        />
        <span className="text-xs text-gray-400 w-8 text-left">
          {Math.round((flash / 255) * 100)}%
        </span>
      </div>
    </div>
  );
}

// ── أيقونات SVG بسيطة ──────────────────────

function CameraIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  );
}

function FlashIcon({ dim }) {
  return (
    <svg
      className={`w-4 h-4 transition-colors ${dim ? "text-gray-600" : "text-yellow-400"}`}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M13 2L4.09 12.97H11L10 22L20.91 11.03H14L13 2z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
