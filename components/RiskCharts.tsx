import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface RiskMetrics {
  sharpe: number;
  sortino: number;
  maxDrawdown: {
    maxDrawdownPercent: number;
    peakIndex: number;
    troughIndex: number;
  };
  volatility: number;
  cumulativeReturn: number;
  daysAnalyzed: number;
}

interface RiskChartsProps {
  metrics: RiskMetrics | null;
}

export default function RiskCharts({ metrics }: RiskChartsProps) {
  if (!metrics) {
    return (
      <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-white mb-4">Risk Metrics</h2>
        <p className="text-slate-400">Loading risk metrics...</p>
      </div>
    );
  }

  // Create data for visualization
  const data = [
    {
      name: 'Sharpe',
      value: metrics.sharpe,
      color: '#00FF85',
    },
    {
      name: 'Sortino',
      value: metrics.sortino,
      color: '#00D4FF',
    },
    {
      name: 'Volatility',
      value: metrics.volatility,
      color: '#FF6B00',
    },
  ];

  return (
    <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-white mb-4">Risk Metrics ({metrics.daysAnalyzed} days)</h2>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-4 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-400 mb-1">Sharpe Ratio</p>
          <p className="text-2xl font-bold text-green-400">{metrics.sharpe.toFixed(2)}</p>
        </div>
        <div className="text-center p-4 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-400 mb-1">Max Drawdown</p>
          <p className="text-2xl font-bold text-orange-400">{metrics.maxDrawdown.maxDrawdownPercent.toFixed(2)}%</p>
        </div>
        <div className="text-center p-4 bg-slate-700 rounded-lg">
          <p className="text-sm text-slate-400 mb-1">Volatility</p>
          <p className="text-2xl font-bold text-blue-400">{metrics.volatility.toFixed(2)}%</p>
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="text-center p-3 bg-slate-700/50 rounded">
          <p className="text-xs text-slate-400 mb-1">Sortino Ratio</p>
          <p className="text-lg font-semibold text-cyan-400">{metrics.sortino.toFixed(2)}</p>
        </div>
        <div className="text-center p-3 bg-slate-700/50 rounded">
          <p className="text-xs text-slate-400 mb-1">Cumulative Return</p>
          <p className="text-lg font-semibold text-emerald-400">{metrics.cumulativeReturn.toFixed(2)}%</p>
        </div>
      </div>
    </div>
  );
}
