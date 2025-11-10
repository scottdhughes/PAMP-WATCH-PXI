'use client';

import { useState } from 'react';
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

const metricInfo: Record<string, { description: string; details: string }> = {
  'hyOas': {
    description: 'High Yield Option-Adjusted Spread',
    details: 'Premium investors demand for corporate junk bonds over Treasuries. Higher spreads indicate credit stress.'
  },
  'igOas': {
    description: 'Investment Grade Option-Adjusted Spread',
    details: 'Premium for investment-grade corporate bonds. Widens during market stress.'
  },
  'vix': {
    description: 'CBOE Volatility Index',
    details: '"Fear gauge" measuring expected 30-day volatility. Above 20 signals elevated fear, above 30 signals high fear.'
  },
  'u3': {
    description: 'U-3 Unemployment Rate',
    details: 'Standard unemployment rate. Rising unemployment indicates economic weakness.'
  },
  'usd': {
    description: 'Broad US Dollar Index',
    details: 'Trade-weighted value of USD against major trading partners. Higher = stronger dollar.'
  },
  'nfci': {
    description: 'National Financial Conditions Index',
    details: 'Measures stress in financial markets. Positive values indicate tight/stressed conditions.'
  },
  'btcReturn': {
    description: 'Bitcoin Daily Return',
    details: '24-hour price change as a percentage. Measures cryptocurrency market sentiment and volatility.'
  },
};

export default function MetricsTable({ metrics }: Props) {
  const [hoveredMetric, setHoveredMetric] = useState<string | null>(null);

  return (
    <div className="rounded-3xl bg-card shadow-2xl overflow-x-auto">
      <div className="min-w-[800px]">
        <div className="grid grid-cols-8 px-6 py-4 text-xs uppercase tracking-widest text-slate-400 dark:text-slate-400 light:text-slate-600">
          <span>Metric</span>
          <span>Value</span>
          <span>Δ 1m</span>
          <span>Lower</span>
          <span>Upper</span>
          <span>z-score</span>
          <span>Contribution</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-slate-800 dark:divide-slate-800 light:divide-slate-200">
          {metrics.map((metric) => (
            <div
              key={metric.id}
              className="grid grid-cols-8 gap-2 px-6 py-4 text-sm text-slate-100 dark:text-slate-100 light:text-slate-900 relative"
            >
              <div className="relative">
                <span
                  className="font-semibold cursor-help underline decoration-dotted decoration-slate-500 hover:text-violet transition-colors"
                  onMouseEnter={() => setHoveredMetric(metric.id)}
                  onMouseLeave={() => setHoveredMetric(null)}
                >
                  {metric.label}
                </span>
                {hoveredMetric === metric.id && metricInfo[metric.id] && (
                  <div className="absolute left-0 top-full mt-2 z-50 w-80 p-4 bg-slate-800 dark:bg-slate-800 light:bg-white border border-slate-700 dark:border-slate-700 light:border-slate-300 rounded-lg shadow-2xl">
                    <div className="text-sm font-semibold text-violet mb-2">
                      {metricInfo[metric.id].description}
                    </div>
                    <div className="text-xs text-slate-300 dark:text-slate-300 light:text-slate-600 mb-3">
                      {metricInfo[metric.id].details}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-500 space-y-1">
                      <div><strong>Current:</strong> {metric.value.toFixed(3)}</div>
                      <div><strong>Range:</strong> {metric.lower} - {metric.upper}</div>
                      <div><strong>Z-Score:</strong> {metric.zScore.toFixed(2)}</div>
                      <div><strong>Status:</strong> <span className={`${badgeClass(metric.breach)} px-2 py-0.5 rounded`}>{metric.breach}</span></div>
                    </div>
                  </div>
                )}
              </div>
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
    </div>
  );
}
