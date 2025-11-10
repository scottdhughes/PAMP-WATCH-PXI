'use client';

import type { Alert } from '../lib/types';

interface Props {
  alerts: Alert[];
}

const severityStyles = {
  critical: 'bg-pampRed/20 border-pampRed/40 text-pampRed',
  warning: 'bg-pampAmber/20 border-pampAmber/40 text-pampAmber',
  info: 'bg-blue-500/20 border-blue-500/40 text-blue-400',
};

const severityIcons = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
};

export default function Alerts({ alerts }: Props) {
  if (!alerts || alerts.length === 0) {
    return null;
  }

  return (
    <div className="rounded-3xl bg-card shadow-2xl p-6">
      <h2 className="text-lg font-bold mb-4 text-slate-100 dark:text-slate-100 light:text-slate-900">
        Active Alerts ({alerts.length})
      </h2>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`rounded-xl border-2 p-4 ${severityStyles[alert.severity]}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{severityIcons[alert.severity]}</span>
              <div className="flex-1">
                <div className="font-semibold text-sm uppercase tracking-wide mb-1">
                  {alert.severity.toUpperCase()}
                </div>
                <div className="text-sm mb-2">{alert.message}</div>
                <div className="flex gap-4 text-xs opacity-75">
                  <span>Type: {alert.alertType}</span>
                  {alert.indicatorId && <span>Indicator: {alert.indicatorId}</span>}
                  {alert.zScore !== null && (
                    <span>z-score: {alert.zScore.toFixed(2)}</span>
                  )}
                  <span>{new Date(alert.timestamp).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
