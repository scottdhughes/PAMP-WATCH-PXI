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

const metricDescriptions: Record<string, string> = {
  'hyOas': 'High Yield Option-Adjusted Spread: Premium investors demand for corporate junk bonds over Treasuries. Higher spreads indicate credit stress.',
  'igOas': 'Investment Grade Option-Adjusted Spread: Premium for investment-grade corporate bonds. Widens during market stress.',
  'vix': 'CBOE Volatility Index: "Fear gauge" measuring expected 30-day volatility. Above 20 signals elevated fear, above 30 signals high fear.',
  'u3': 'U-3 Unemployment Rate: Standard unemployment rate. Rising unemployment indicates economic weakness.',
  'usd': 'Broad US Dollar Index: Trade-weighted value of USD against major trading partners. Higher = stronger dollar.',
  'nfci': 'National Financial Conditions Index: Measures stress in financial markets. Positive values indicate tight/stressed conditions.',
  'btcReturn': 'Bitcoin Daily Return: 24-hour price change as a percentage. Measures cryptocurrency market sentiment and volatility.',
};

export default function MetricsTable({ metrics }: Props) {
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
              className="grid grid-cols-8 gap-2 px-6 py-4 text-sm text-slate-100 dark:text-slate-100 light:text-slate-900"
            >
              <span
                className="font-semibold cursor-help underline decoration-dotted decoration-slate-500"
                title={metricDescriptions[metric.id] || metric.label}
              >
                {metric.label}
              </span>
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
