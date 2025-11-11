import clsx from 'clsx';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info';
  message: string;
  details?: string;
  timestamp: string;
}

interface AlertsPanelProps {
  alerts: Alert[] | null;
}

export default function AlertsPanel({ alerts }: AlertsPanelProps) {
  if (!alerts) {
    return (
      <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-white mb-4">Active Alerts</h2>
        <p className="text-slate-400">Loading alerts...</p>
      </div>
    );
  }

  const getAlertIcon = (type: Alert['type']) => {
    switch (type) {
      case 'error':
        return '🔴';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '•';
    }
  };

  const getAlertColor = (type: Alert['type']) => {
    return clsx('border-l-4 p-3 rounded-r', {
      'bg-red-500/10 border-red-500': type === 'error',
      'bg-yellow-500/10 border-yellow-500': type === 'warning',
      'bg-blue-500/10 border-blue-500': type === 'info',
    });
  };

  return (
    <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-white mb-4">
        Active Alerts
        {alerts.length > 0 && (
          <span className="ml-2 text-sm font-normal text-slate-400">
            ({alerts.length})
          </span>
        )}
      </h2>

      {alerts.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-slate-500 text-sm">✓ No active alerts</p>
          <p className="text-slate-600 text-xs mt-1">All systems operational</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <li key={alert.id} className={getAlertColor(alert.type)}>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none">{getAlertIcon(alert.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-white text-sm font-semibold uppercase">
                      {alert.type}
                    </strong>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-300 text-sm mt-1">
                    {alert.message || alert.details}
                  </p>
                  {alert.details && alert.message && (
                    <p className="text-slate-500 text-xs mt-1">{alert.details}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
