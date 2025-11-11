import clsx from 'clsx';

interface CacheStatusData {
  cached: boolean;
  status: 'fresh' | 'warning' | 'stale';
  date: string;
  updatedAt: string;
  ageHours: number;
  thresholds: {
    warning: number;
    stale: number;
  };
  indicators: {
    rsi: number | null;
    macdValue: number | null;
    macdSignal: number | null;
    signalMultiplier: number;
  };
  nextUpdate: string;
}

interface CacheStatusProps {
  cache: CacheStatusData | null;
}

export default function CacheStatus({ cache }: CacheStatusProps) {
  if (!cache) {
    return (
      <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-white mb-4">Cache Status</h2>
        <p className="text-slate-400">Loading cache status...</p>
      </div>
    );
  }

  const statusClass = clsx(
    'inline-block px-4 py-2 rounded-full text-sm font-semibold uppercase',
    {
      'bg-green-500/20 text-green-400 border border-green-500/50': cache.status === 'fresh',
      'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50': cache.status === 'warning',
      'bg-red-500/20 text-red-400 border border-red-500/50': cache.status === 'stale',
    }
  );

  return (
    <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-white mb-4">Cache Status</h2>

      <div className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Status:</span>
          <span className={statusClass}>{cache.status}</span>
        </div>

        {/* Age */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Cache Age:</span>
          <span className="text-white font-semibold">{cache.ageHours.toFixed(1)}h</span>
        </div>

        {/* Last Updated */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Updated:</span>
          <span className="text-white text-sm">
            {new Date(cache.updatedAt).toLocaleString()}
          </span>
        </div>

        {/* Date */}
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Data Date:</span>
          <span className="text-white font-mono text-sm">{cache.date}</span>
        </div>

        {/* Next Update */}
        <div className="pt-3 border-t border-slate-700">
          <p className="text-xs text-slate-500 mb-1">Next Update</p>
          <p className="text-sm text-slate-300">{cache.nextUpdate}</p>
        </div>

        {/* Thresholds */}
        <div className="pt-3 border-t border-slate-700">
          <p className="text-xs text-slate-500 mb-2">Thresholds</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
              <span className="text-slate-400">Warning: {cache.thresholds.warning}h</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span className="text-slate-400">Stale: {cache.thresholds.stale}h</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
