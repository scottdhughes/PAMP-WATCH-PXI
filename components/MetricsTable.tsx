'use client';

import type { MetricRow } from '../lib/types';

interface Props {
  metrics: MetricRow[];
}

const badgeClass = (breach: MetricRow['breach']): string => {
  switch (breach) {
    case 'Stress':
      return 'bg-pampRed/20 text-pampRed';
    case 'PAMP':
      return 'bg-violet/20 text-violet';
    case 'Caution':
      return 'bg-pampAmber/20 text-pampAmber';
    default:
      return 'bg-pampGreen/20 text-pampGreen';
  }
};

export default function MetricsTable({ metrics }: Props) {
  return (
    <div className="overflow-hidden rounded-3xl bg-card shadow-2xl">
      <div className="hidden md:grid md:grid-cols-8 md:px-6 md:py-4 text-xs uppercase tracking-widest text-slate-400">
        <span>Metric</span>
        <span>Value</span>
        <span>Δ 1m</span>
        <span>Lower</span>
        <span>Upper</span>
        <span>z-score</span>
        <span>Contribution</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-slate-800">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className="grid grid-cols-2 gap-2 px-4 py-4 text-sm text-slate-100 md:grid-cols-8 md:px-6"
          >
            <span className="font-semibold">{metric.label}</span>
            <span>{metric.value.toFixed(3)}</span>
            <span className={metric.delta >= 0 ? 'text-pampGreen' : 'text-pampRed'}>
              {metric.delta >= 0 ? '+' : ''}
              {metric.delta.toFixed(3)}
            </span>
            <span>{metric.lower}</span>
            <span>{metric.upper}</span>
            <span>{metric.zScore.toFixed(2)}</span>
            <span>{metric.contribution.toFixed(2)}</span>
            <span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass(metric.breach)}`}>
                {metric.breach}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
