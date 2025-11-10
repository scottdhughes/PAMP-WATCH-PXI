'use client';

import { useMemo } from 'react';

interface Props {
  value: number;
}

const bands = [
  { label: 'Stress', min: 0, max: 30, color: 'from-pampRed/80 to-pampRed/40' },
  { label: 'Caution', min: 30, max: 50, color: 'from-pampAmber/80 to-pampAmber/40' },
  { label: 'Stable', min: 50, max: 75, color: 'from-pampGreen/80 to-pampGreen/40' },
  { label: 'PAMP', min: 75, max: 100, color: 'from-violet/80 to-violet/40' },
];

export default function Gauge({ value }: Props) {
  const needlePosition = useMemo(() => Math.min(Math.max(value, 0), 100), [value]);
  return (
    <section className="rounded-3xl bg-card p-6 shadow-xl">
      <h2 className="text-xl font-semibold text-white">Composite Gauge</h2>
      <div className="mt-6">
        <div className="relative h-40 w-full">
          <div className="absolute inset-0 flex overflow-hidden rounded-full border border-slate-700">
            {bands.map((band) => (
              <div
                key={band.label}
                className={`flex-1 bg-gradient-to-b ${band.color} text-center text-xs uppercase tracking-wide text-white/70`}
              >
                <span className="relative top-32 block">{band.label}</span>
              </div>
            ))}
          </div>
          <div
            className="absolute inset-0 flex items-end justify-start"
            style={{ transform: `translateX(${needlePosition}%)` }}
          >
            <div className="h-32 w-0.5 bg-white" />
            <div className="-mb-4 ml-[-8px] h-4 w-4 rounded-full bg-white shadow-lg" />
          </div>
        </div>
        <p className="mt-4 text-center text-lg text-slate-300">{value.toFixed(1)} / 100</p>
      </div>
    </section>
  );
}
