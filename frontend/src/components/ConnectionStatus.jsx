export default function ConnectionStatus({ wsStatus, cameraOnline, fps, mode }) {
  const wsColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-400 animate-pulse',
    disconnected: 'bg-red-500',
  }[wsStatus] ?? 'bg-gray-500';

  const wsLabel = mode === 'cloud'
    ? { connected: 'متصل بالسيرفر', connecting: 'جارٍ الاتصال...', disconnected: 'منقطع' }[wsStatus] ?? wsStatus
    : { connected: 'متصل بالسيرفر', connecting: 'جارٍ الاتصال...', disconnected: 'منقطع' }[wsStatus] ?? wsStatus;

  return (
    <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-4 text-xs sm:text-sm w-full sm:w-auto">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full inline-block shrink-0 ${wsColor}`} />
        <span className="text-gray-300 truncate">{wsLabel}</span>
      </span>

      <span className="flex items-center gap-1.5 min-w-0">
        <span
          className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full inline-block shrink-0 ${
            cameraOnline ? 'bg-cyan-400 animate-pulse2' : 'bg-gray-600'
          }`}
        />
        <span className="text-gray-300 truncate">
          {cameraOnline ? 'الكاميرا مباشرة' : 'الكاميرا غير متصلة'}
        </span>
      </span>

      {cameraOnline && (
        <span className="text-gray-500 font-mono text-[10px] sm:text-xs shrink-0">
          {fps} fps
        </span>
      )}
    </div>
  );
}