'use client';

import { useMemo } from 'react';
import type { PXIResponse } from '../lib/types';
import ThemeToggle from './ThemeToggle';

interface Props {
  data: PXIResponse;
}

const labelColor = (status: string): string => {
  if (status.includes('Stress')) return 'text-pampRed';
  if (status.includes('Caution')) return 'text-pampAmber';
  if (status.includes('PAMP')) return 'text-violet';
  return 'text-pampGreen';
};

export default function Hero({ data }: Props) {
  const timestamp = useMemo(() => new Date(data.calculatedAt).toLocaleString(), [data.calculatedAt]);

  return (
    <header className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-slate-900 to-black p-6 shadow-2xl lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">PXI (PAMP Index)</p>
        <div className="mt-2 flex items-end gap-4">
          <span className="text-6xl font-semibold text-white">{data.pxi.toFixed(1)}</span>
          <span className={`text-lg font-medium ${labelColor(data.statusLabel)}`}>{data.statusLabel}</span>
        </div>
        <p className="mt-2 text-sm text-slate-400">Last update · {timestamp}</p>
      </div>
      <ThemeToggle />
    </header>
  );
}
