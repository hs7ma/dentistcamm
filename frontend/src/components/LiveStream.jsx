/**
 * LiveStream — يعرض الفيديو عبر <img> ref مباشر
 * src يُحدَّث خارج React لتجنب re-renders
 */
import { useRef, useImperativeHandle, forwardRef } from "react";

const LiveStream = forwardRef(function LiveStream({ cameraOnline, imgRef }, _ref) {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden border border-gray-700 shadow-2xl">

      {/* عنصر الصورة — src يُحدَّث مباشرة من الـ hook */}
      <img
        ref={imgRef}
        alt="بث مباشر"
        className="w-full h-full object-contain"
        style={{ display: cameraOnline ? "block" : "none" }}
        draggable={false}
      />

      {/* شاشة لا إشارة */}
      {!cameraOnline && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
          <svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M4 8h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z"
            />
          </svg>
          <p className="text-sm">الكاميرا غير متصلة</p>
        </div>
      )}

      {/* شارة LIVE */}
      {cameraOnline && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-600/90 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse inline-block" />
          LIVE
        </div>
      )}
    </div>
  );
});

export default LiveStream;
