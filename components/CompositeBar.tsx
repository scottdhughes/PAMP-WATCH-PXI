'use client';

interface Props {
  value: number;
}

const segments = [
  { label: 'Stress', color: 'bg-pampRed', range: [0, 30] },
  { label: 'Caution', color: 'bg-pampAmber', range: [30, 50] },
  { label: 'Stable', color: 'bg-pampGreen', range: [50, 75] },
  { label: 'PAMP', color: 'bg-violet', range: [75, 100] },
];

export default function CompositeBar({ value }: Props) {
  return (
    <div className="rounded-3xl bg-card p-4 shadow-xl">
      <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Composite Position</p>
      <div className="mt-4 h-4 w-full rounded-full bg-slate-800">
        <div className="flex h-full w-full overflow-hidden rounded-full">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={`${segment.color} h-full`}
              style={{ flex: segment.range[1] - segment.range[0] }}
            />
          ))}
        </div>
        <div className="relative -top-1 flex justify-center">
          <div className="relative" style={{ left: `${value}%` }}>
            <div className="h-6 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-card text-center text-xs font-semibold text-white">
              {value.toFixed(0)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
