'use client';

import type { Regime } from '../lib/types';

interface Props {
  regime: Regime;
}

const regimeStyles = {
  Normal: {
    bg: 'bg-pampGreen/20',
    border: 'border-pampGreen',
    text: 'text-pampGreen',
    icon: '✓',
  },
  'Elevated Stress': {
    bg: 'bg-pampAmber/20',
    border: 'border-pampAmber',
    text: 'text-pampAmber',
    icon: '⚠',
  },
  Crisis: {
    bg: 'bg-pampRed/20',
    border: 'border-pampRed',
    text: 'text-pampRed',
    icon: '⚠⚠',
  },
};

export default function RegimeIndicator({ regime }: Props) {
  const style = regimeStyles[regime.regime as keyof typeof regimeStyles] || regimeStyles.Normal;

  return (
    <div className="rounded-3xl bg-card shadow-2xl p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-400 dark:text-slate-400 light:text-slate-600 mb-2 uppercase tracking-widest">
            Market Regime
          </h2>
          <div className={`inline-flex items-center gap-3 px-6 py-3 rounded-full border-2 ${style.bg} ${style.border}`}>
            <span className="text-2xl">{style.icon}</span>
            <span className={`text-2xl font-bold ${style.text}`}>
              {regime.regime}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400 dark:text-slate-500 light:text-slate-600">
            Last updated: {new Date(regime.timestamp || regime.calculatedAt || Date.now()).toLocaleString()} (k-means refresh is daily; may lag live PXI)
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 text-right">
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider mb-1">
              Composite PXI
            </div>
            <div className={`text-2xl font-bold ${style.text}`}>
              {regime.pxiValue.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider mb-1">
              Total Weight
            </div>
            <div className="text-2xl font-bold text-slate-100 dark:text-slate-100 light:text-slate-900">
              {regime.totalWeight.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider mb-1">
              PAMP Signals
            </div>
            <div className="text-2xl font-bold text-violet">
              {regime.pampCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 dark:text-slate-400 light:text-slate-600 uppercase tracking-wider mb-1">
              Stress Signals
            </div>
            <div className="text-2xl font-bold text-pampRed">
              {regime.stressCount}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 light:text-slate-600">
        Regimes come from daily k-means clustering and can lag the live composite PXI. Use the
        composite value and system alerts to gauge intraday stress moves.
      </p>
    </div>
  );
}
