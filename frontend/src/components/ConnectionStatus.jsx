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
    <div className="flex items-center gap-4 text-sm">
      <span className="flex items-center gap-1.5">
        <span className={`w-2.5 h-2.5 rounded-full inline-block ${wsColor}`} />
        <span className="text-gray-300">{wsLabel}</span>
      </span>

      <span className="flex items-center gap-1.5">
        <span
          className={`w-2.5 h-2.5 rounded-full inline-block ${
            cameraOnline ? 'bg-cyan-400 animate-pulse2' : 'bg-gray-600'
          }`}
        />
        <span className="text-gray-300">
          {cameraOnline ? 'الكاميرا مباشرة' : 'الكاميرا غير متصلة'}
        </span>
      </span>

      {cameraOnline && (
        <span className="text-gray-500 font-mono text-xs">
          {fps} fps
        </span>
      )}
    </div>
  );
}