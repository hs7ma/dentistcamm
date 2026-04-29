/**
 * لوحة تقرير التحليل الطبي
 * تعرض نتائج GPT-4o بشكل منظم
 */

const PRIORITY_STYLES = {
  "طبيعي": "border-green-500 text-green-400",
  "يحتاج متابعة": "border-yellow-500 text-yellow-400",
  "يحتاج علاج": "border-orange-500 text-orange-400",
  "يحتاج تدخل عاجل": "border-red-500 text-red-400",
};

export default function AIReport({ report, loading, error }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-gray-400">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-violet-500/30" />
          <div className="absolute inset-0 rounded-full border-t-2 border-violet-400 animate-spin" />
        </div>
        <p className="text-sm">GPT-4o يحلل الصورة السنية...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-900/20 border border-red-700 text-red-300 text-sm">
        <span className="font-bold block mb-1">خطأ في التحليل</span>
        {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-gray-600">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm text-center">
          اضغط <strong className="text-gray-400">تحليل AI</strong> لبدء الفحص
        </p>
      </div>
    );
  }

  // تحديد مستوى الأولوية من النص
  const priority = Object.keys(PRIORITY_STYLES).find((k) =>
    report.analysis.includes(k)
  );
  const priorityStyle = priority ? PRIORITY_STYLES[priority] : "";

  return (
    <div className="fade-in-up space-y-3">
      {/* رأس التقرير */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-violet-300">تقرير التحليل الطبي</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {report.timestamp
              ? new Date(report.timestamp).toLocaleTimeString("ar-SA")
              : ""}
            {" · "}
            <span className="text-violet-500">{report.model}</span>
          </p>
        </div>
        {priority && (
          <span
            className={`text-xs border rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap ${priorityStyle}`}
          >
            {priority}
          </span>
        )}
      </div>

      {/* نص التقرير بتنسيق Markdown بسيط */}
      <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap no-scrollbar overflow-y-auto max-h-80 pr-1">
        <MarkdownLite text={report.analysis} />
      </div>

      {/* تنبيه قانوني */}
      <p className="text-xs text-gray-600 border-t border-gray-700 pt-2">
        هذا التقرير للأغراض المساعدة فقط وليس بديلاً عن التشخيص السريري.
      </p>
    </div>
  );
}

// تحويل Markdown بسيط (bold + headers) إلى JSX
function MarkdownLite({ text }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith("**") && line.endsWith("**") && line.length > 4) {
          return (
            <p key={i} className="font-bold text-white mt-2 mb-0.5">
              {line.slice(2, -2)}
            </p>
          );
        }
        // **bold** inline
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} className="text-white">{p.slice(2, -2)}</strong>
            : p
        );
        return line === "" ? (
          <br key={i} />
        ) : (
          <span key={i} className="block">{rendered}</span>
        );
      })}
    </>
  );
}
