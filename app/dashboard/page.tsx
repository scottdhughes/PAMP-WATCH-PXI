'use client';

import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { fetcher } from '@/utils/fetcher';
import { motion, AnimatePresence } from 'framer-motion';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceArea, AreaChart, Area, Legend } from 'recharts';
import clsx from 'clsx';
import { useDashboardSnapshot } from '@/hooks/useDashboardSnapshot';
import { StaleIndicator } from '@/components/StaleIndicator';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787';

// Regime color mapping
const getRegimeColor = (regime: string) => {
  const colors: Record<string, string> = {
    // K-means regime types
    'Calm': 'text-green-400',
    'Normal': 'text-blue-400',
    'Stress': 'text-red-400',
    // Legacy rule-based regime types
    'Stable': 'text-green-400',
    'Caution': 'text-amber-400',
    'Crisis': 'text-red-500',
    'Strong PAMP': 'text-green-400',
  };
  return colors[regime] || 'text-slate-300';
};

const getRegimeIcon = (regime: string) => {
  // No icons for cleaner look
  return '';
};

// Format metric values based on their type
const formatMetricValue = (metric: any) => {
  const value = metric.value;

  // Percentage values (HY OAS, IG OAS, U-3)
  if (metric.id === 'hyOas' || metric.id === 'igOas' || metric.id === 'u3') {
    return `${(value * 100).toFixed(2)}%`;
  }

  // BTC return (percentage)
  if (metric.id === 'btcReturn') {
    return `${(value * 100).toFixed(2)}%`;
  }

  // VIX (no decimals)
  if (metric.id === 'vix') {
    return value.toFixed(1);
  }

  // USD (2 decimals)
  if (metric.id === 'usd') {
    return value.toFixed(2);
  }

  // NFCI (3 decimals)
  if (metric.id === 'nfci') {
    return value.toFixed(3);
  }

  // Yield Curve Slope (percentage points with sign)
  if (metric.id === 'yc_10y_2y') {
    const formatted = value.toFixed(2);
    return value >= 0 ? `+${formatted}` : formatted;
  }

  // Breakeven Inflation (percentage with 2 decimals)
  if (metric.id === 'breakeven10y') {
    return `${(value * 100).toFixed(2)}%`;
  }

  // Default
  return value.toFixed(3);
};

export default function Dashboard() {
  // Use snapshot polling hook (replaces all individual queries)
  const snapshot = useDashboardSnapshot();

  // Fetch cache status (still separate - not in snapshot)
  const { data: cacheData, isLoading: isLoadingCache } = useQuery(
    'cache-status',
    () => fetcher<any>(`${API_BASE}/v1/pxi/indicators/cache-status`),
    { refetchInterval: 30000 }
  );

  // Fetch risk metrics (still separate - not in snapshot)
  const { data: riskData, isLoading: isLoadingRisk } = useQuery(
    'risk-metrics',
    () => fetcher<any>(`${API_BASE}/v1/pxi/analytics/risk-metrics`),
    { refetchInterval: 30000 }
  );

  // Fetch k-means regime detection
  const { data: kmeansRegimeData } = useQuery(
    'kmeans-regime',
    () => fetcher<any>(`${API_BASE}/v1/pxi/regime/latest`),
    { refetchInterval: 30000 }
  );

  // Fetch historical PXI data for chart (still separate - not in snapshot)
  const { data: historyData } = useQuery(
    'pxi-history',
    () => fetcher<any>(`${API_BASE}/v1/pxi/history?days=30`),
    { refetchInterval: 60000 }
  );

  // Fetch regime history for chart overlays
  const { data: regimeHistoryData } = useQuery(
    'regime-history',
    () => fetcher<any>(`${API_BASE}/v1/pxi/regime/history?days=30`),
    { refetchInterval: 60000 }
  );

  // Fetch LSTM forecasts
  const { data: forecastData } = useQuery(
    'pxi-forecasts',
    () => fetcher<any>(`${API_BASE}/v1/pxi/forecasts?method=lstm&horizon=7`),
    { refetchInterval: 300000 } // 5 min refresh
  );

  // Expanded state for System Internals
  const [expanded, setExpanded] = useState(false);

  // Toggle state for regime bands
  const [showRegimeBands, setShowRegimeBands] = useState(true);

  // Format history data for chart (MUST be before early return to satisfy Rules of Hooks)
  // Aggregate by day to show cleaner chart (1 point per day)
  const chartData = React.useMemo(() => {
    const rawData = historyData?.history || [];
    if (!rawData.length) return [];

    // Group by date and take the latest value for each day
    const dailyData = new Map<string, { timestamp: number; value: number }>();

    rawData.forEach((item: any) => {
      const date = new Date(item.timestamp);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const timestamp = new Date(dateKey + 'T12:00:00Z').getTime(); // Noon for each day

      // Keep the latest (or average) value for each day
      if (!dailyData.has(dateKey) || item.pxiValue !== undefined) {
        dailyData.set(dateKey, {
          timestamp,
          value: item.pxiValue,
        });
      }
    });

    // Convert to array and sort by timestamp
    return Array.from(dailyData.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [historyData]);

  // Generate smart X-axis ticks (one per unique date)
  const chartTicks = React.useMemo(() => {
    if (!chartData.length) return [];

    const uniqueDates = new Map<string, number>();
    chartData.forEach((point) => {
      const dateStr = new Date(point.timestamp).toLocaleDateString('en-US');
      if (!uniqueDates.has(dateStr)) {
        uniqueDates.set(dateStr, point.timestamp);
      }
    });

    // Return timestamps for unique dates, max 10 ticks
    const ticks = Array.from(uniqueDates.values());
    if (ticks.length <= 10) return ticks;

    // If more than 10 days, sample evenly
    const step = Math.ceil(ticks.length / 10);
    return ticks.filter((_, i) => i % step === 0 || i === ticks.length - 1);
  }, [chartData]);

  // Process regime bands for chart overlay
  const regimeBands = React.useMemo(() => {
    if (!regimeHistoryData?.regimes || !chartData.length) return [];

    const regimes = regimeHistoryData.regimes;
    const bands: Array<{ x1: number; x2: number; regime: string; fill: string }> = [];

    // Sort regimes by date
    const sortedRegimes = [...regimes].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Create bands by grouping consecutive days with same regime
    for (let i = 0; i < sortedRegimes.length; i++) {
      const currentRegime = sortedRegimes[i];
      const currentDate = new Date(currentRegime.date);
      const currentTimestamp = new Date(currentDate.toISOString().split('T')[0] + 'T12:00:00Z').getTime();

      // Find next regime or use end of chart
      let nextTimestamp: number;
      if (i < sortedRegimes.length - 1) {
        const nextDate = new Date(sortedRegimes[i + 1].date);
        nextTimestamp = new Date(nextDate.toISOString().split('T')[0] + 'T12:00:00Z').getTime();
      } else {
        // Use last chart data point + 1 day
        nextTimestamp = chartData[chartData.length - 1].timestamp + 24 * 60 * 60 * 1000;
      }

      // Determine fill color based on regime
      let fill = 'rgba(100, 116, 139, 0.1)'; // default gray
      if (currentRegime.regime === 'Calm') {
        fill = 'rgba(34, 197, 94, 0.1)'; // green
      } else if (currentRegime.regime === 'Normal') {
        fill = 'rgba(59, 130, 246, 0.1)'; // blue
      } else if (currentRegime.regime === 'Stress') {
        fill = 'rgba(239, 68, 68, 0.1)'; // red
      }

      bands.push({
        x1: currentTimestamp,
        x2: nextTimestamp,
        regime: currentRegime.regime,
        fill,
      });
    }

    return bands;
  }, [regimeHistoryData, chartData]);

  // Calculate PXI deltas (7D and 30D) - MUST be before early return to satisfy Rules of Hooks
  const pxiDeltas = React.useMemo(() => {
    const currentPxiValue = snapshot.data?.pxi;
    const rawData = historyData?.history || [];

    if (!rawData.length || !currentPxiValue) {
      return { delta7D: null, delta30D: null };
    }

    // Get current date and find values from 7 and 30 days ago
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Find closest PXI values
    let pxi7D = null;
    let pxi30D = null;

    // Sort by timestamp descending (newest first)
    const sortedData = [...rawData].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Find 7-day value (look for value around 7 days ago, ±1 day tolerance)
    const target7D = sevenDaysAgo.getTime();
    for (const item of sortedData) {
      const itemTime = new Date(item.timestamp).getTime();
      const diff = Math.abs(itemTime - target7D);
      if (diff < 2 * 24 * 60 * 60 * 1000) { // Within 2 days
        pxi7D = item.pxiValue;
        break;
      }
    }

    // Find 30-day value (look for value around 30 days ago, ±2 day tolerance)
    const target30D = thirtyDaysAgo.getTime();
    for (const item of sortedData) {
      const itemTime = new Date(item.timestamp).getTime();
      const diff = Math.abs(itemTime - target30D);
      if (diff < 3 * 24 * 60 * 60 * 1000) { // Within 3 days
        pxi30D = item.pxiValue;
        break;
      }
    }

    return {
      delta7D: pxi7D !== null ? currentPxiValue - pxi7D : null,
      delta30D: pxi30D !== null ? currentPxiValue - pxi30D : null,
    };
  }, [historyData, snapshot.data?.pxi]);

  const isLoading = snapshot.isLoading || isLoadingCache || isLoadingRisk;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-slate-500 font-light tracking-wide">Initializing command system...</p>
        </div>
      </div>
    );
  }

  // Extract data from snapshot
  const snapshotData = snapshot.data;
  const pxiValue = snapshotData?.pxi || 0;

  // Use k-means regime if available, otherwise fall back to rule-based regime
  const kmeansRegime = kmeansRegimeData?.regime;
  const ruleBasedRegime = snapshotData?.regime?.regime;
  const regime = kmeansRegime || ruleBasedRegime || 'Unknown';
  const regimeSource = kmeansRegime ? 'K-Means Clustering' : 'Rule-Based';

  const statusLabel = snapshotData?.statusLabel || 'Unknown';
  const calculatedAt = snapshotData?.calculatedAt ? new Date(snapshotData.calculatedAt) : new Date();
  const metricCount = snapshotData?.metrics?.length || 0;
  const metrics = snapshotData?.metrics || [];
  const alerts = snapshotData?.alerts || [];

  const rsi = cacheData?.indicators?.rsi || null;
  const macd = cacheData?.indicators?.macdValue || null;
  const signalMultiplier = cacheData?.indicators?.signalMultiplier || 1.0;

  const sharpe = riskData?.sharpe || 0;
  const maxDrawdown = riskData?.maxDrawdown?.maxDrawdown || 0; // Use absolute drawdown (z-score units), not percentage
  const volatility = riskData?.volatility || 0;

  const regimeColor = getRegimeColor(regime);
  const regimeIcon = getRegimeIcon(regime);

  // Filter active alerts from snapshot
  const activeAlerts = alerts
    .filter((alert: any) => alert.severity === 'critical' || alert.severity === 'warning')
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-start py-6 md:py-12 px-4 md:px-6 font-sans">

      {/* Header */}
      <header className="text-center mb-8 md:mb-12">
        <div className="border-b border-slate-800 pb-2 mb-4">
          <h1 className="text-2xl md:text-3xl font-light tracking-tight text-slate-200">
            PXI Command
          </h1>
        </div>
        <p className="text-slate-500 text-xs md:text-sm tracking-wide">
          Composite Systemic Stress Index
        </p>
        {/* Stale indicator */}
        <div className="mt-3 flex items-center justify-center">
          <StaleIndicator
            isStale={snapshot.isStale}
            timeSinceUpdate={snapshot.timeSinceUpdate}
            lastUpdate={snapshot.lastUpdate}
            error={snapshot.error}
            retryCount={snapshot.retryCount}
          />
        </div>
      </header>

      {/* Regime Indicator */}
      <div className="mb-6 md:mb-8 flex flex-col items-center gap-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-slate-500">Market Regime:</span>
          <span className={`text-base md:text-lg ${regimeColor} font-medium`}>
            {regime}
          </span>
        </div>
        <span className="text-[10px] text-slate-600 tracking-wide">
          {regimeSource}
        </span>
      </div>

      {/* Main PXI Value */}
      <main className="flex flex-col items-center gap-3 md:gap-4 mb-8 md:mb-12">
        <motion.h2
          key={pxiValue}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className={`text-[4rem] md:text-[6rem] font-semibold ${regimeColor} leading-none tracking-tight`}
        >
          {pxiValue >= 0 ? '+' : ''}{pxiValue.toFixed(2)}
        </motion.h2>
        <p className="text-slate-400 text-sm">
          Composite Systemic Stress Index
        </p>
        {/* Delta display */}
        {(pxiDeltas.delta7D !== null || pxiDeltas.delta30D !== null) && (
          <p className="text-slate-500 text-xs font-mono">
            {pxiDeltas.delta7D !== null && (
              <span className={pxiDeltas.delta7D >= 0 ? 'text-red-400' : 'text-green-400'}>
                Δ7D {pxiDeltas.delta7D > 0 ? `+${pxiDeltas.delta7D.toFixed(2)}` : pxiDeltas.delta7D.toFixed(2)}
              </span>
            )}
            {pxiDeltas.delta7D !== null && pxiDeltas.delta30D !== null && (
              <span className="text-slate-700 mx-2">|</span>
            )}
            {pxiDeltas.delta30D !== null && (
              <span className={pxiDeltas.delta30D >= 0 ? 'text-red-400' : 'text-green-400'}>
                Δ30D {pxiDeltas.delta30D > 0 ? `+${pxiDeltas.delta30D.toFixed(2)}` : pxiDeltas.delta30D.toFixed(2)}
              </span>
            )}
          </p>
        )}
        <p className="text-slate-300 text-base md:text-lg font-light tracking-wide text-center px-4">
          {statusLabel}
        </p>
        <p className="text-slate-600 text-xs md:text-sm mt-2 text-center">
          Updated {calculatedAt.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
          })}
        </p>
        <p className="text-slate-700 text-xs">
          {metricCount} metrics · weighted composite
        </p>
      </main>

      {/* Underlying Metrics Grid */}
      {metrics.length > 0 && (
        <section className="mt-10 max-w-5xl w-full text-center">
          <h3 className="text-slate-400 text-sm mb-4 tracking-wide uppercase">
            Underlying PXI Metrics
          </h3>
          <div className="flex flex-wrap justify-center gap-y-6 gap-x-8 text-sm text-slate-300">
            {metrics.map((m: any) => (
              <div key={m.id} className="flex flex-col items-center w-20">
                <p className="text-slate-500 text-xs mb-1 text-center">{m.label}</p>
                <p className={clsx("font-semibold text-base font-mono", {
                  "text-green-400": Math.abs(m.zScore) < 0.5,
                  "text-yellow-400": Math.abs(m.zScore) >= 0.5 && Math.abs(m.zScore) < 1.0,
                  "text-orange-400": Math.abs(m.zScore) >= 1.0 && Math.abs(m.zScore) < 2.0,
                  "text-red-400": Math.abs(m.zScore) >= 2.0
                })}>
                  {formatMetricValue(m)}
                </p>
                <p className="text-xs text-slate-600">z: {m.zScore?.toFixed(2)}</p>
                {/* Show "Inverted" badge for negative yield curve */}
                {m.id === 'yc_10y_2y' && m.value < 0 && (
                  <span className="mt-1 px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded border border-red-500/30 font-semibold">
                    INVERTED
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-6 text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors"
          >
            {expanded ? 'Hide System Internals ▲' : 'Show System Internals ▼'}
          </button>
        </section>
      )}

      {/* Expandable System Internals Table */}
      <AnimatePresence>
        {expanded && metrics.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="mt-6 w-full max-w-6xl overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/50 p-4"
          >
            <table className="min-w-full text-sm text-left text-slate-300">
              <thead className="text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Δ 7D</th>
                  <th className="px-3 py-2 font-medium">Δ 30D</th>
                  <th className="px-3 py-2 font-medium">Lower</th>
                  <th className="px-3 py-2 font-medium">Upper</th>
                  <th className="px-3 py-2 font-medium">z-Score</th>
                  <th className="px-3 py-2 font-medium">Contribution</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m: any) => (
                  <tr key={m.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                    <td className="px-3 py-3 font-medium">{m.label}</td>
                    <td className="px-3 py-3 font-mono">{formatMetricValue(m)}</td>
                    <td className={clsx("px-3 py-3 font-mono text-sm", {
                      "text-green-400": m.delta7D !== null && m.delta7D > 0,
                      "text-red-400": m.delta7D !== null && m.delta7D < 0,
                      "text-slate-500": m.delta7D === null
                    })}>
                      {m.delta7D !== null && m.delta7D !== undefined ? `${m.delta7D > 0 ? '+' : ''}${m.delta7D.toFixed(2)}%` : 'N/A'}
                    </td>
                    <td className={clsx("px-3 py-3 font-mono text-sm", {
                      "text-green-400": m.delta30D !== null && m.delta30D > 0,
                      "text-red-400": m.delta30D !== null && m.delta30D < 0,
                      "text-slate-500": m.delta30D === null
                    })}>
                      {m.delta30D !== null && m.delta30D !== undefined ? `${m.delta30D > 0 ? '+' : ''}${m.delta30D.toFixed(2)}%` : 'N/A'}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-500">{m.lower?.toFixed(3)}</td>
                    <td className="px-3 py-3 font-mono text-slate-500">{m.upper?.toFixed(3)}</td>
                    <td className={clsx("px-3 py-3 font-semibold font-mono", {
                      "text-green-400": Math.abs(m.zScore) < 0.5,
                      "text-yellow-400": Math.abs(m.zScore) >= 0.5 && Math.abs(m.zScore) < 1.0,
                      "text-orange-400": Math.abs(m.zScore) >= 1.0 && Math.abs(m.zScore) < 2.0,
                      "text-red-400": Math.abs(m.zScore) >= 2.0
                    })}>
                      {m.zScore?.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 font-mono">{m.contribution?.toFixed(3)}</td>
                    <td className={clsx("px-3 py-3 text-xs uppercase", {
                      "text-green-400": m.status === 'Stable',
                      "text-yellow-400": m.status === 'Caution',
                      "text-orange-400": m.status === 'Stress',
                      "text-red-400": m.status === 'Crisis'
                    })}>
                      {m.status}
                    </td>
                    <td className={clsx("px-3 py-3 text-xs font-semibold flex items-center gap-1", {
                      "text-green-400": m.health === 'OK',
                      "text-yellow-400": m.health === 'Stale',
                      "text-orange-400": m.health === 'Outlier',
                      "text-red-400": m.health === 'Invalid' || m.health === 'Flat',
                      "text-slate-500": !m.health
                    })}>
                      <span className="inline-block w-2 h-2 rounded-full" style={{
                        backgroundColor: m.health === 'OK' ? 'rgb(74, 222, 128)' :
                                        m.health === 'Stale' ? 'rgb(250, 204, 21)' :
                                        m.health === 'Outlier' ? 'rgb(251, 146, 60)' :
                                        m.health === 'Invalid' || m.health === 'Flat' ? 'rgb(248, 113, 113)' :
                                        'rgb(100, 116, 139)'
                      }}></span>
                      {m.health || 'Unknown'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Divider */}
      <div className="w-full max-w-5xl border-t border-slate-900 my-8"></div>

      {/* BTC Indicators & Analytics Section */}
      <section className="text-center space-y-4 mb-8 md:mb-12 w-full max-w-4xl px-4">
        <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6 text-xs md:text-sm">
          <span className="text-slate-500">RSI</span>
          <span className="text-blue-400 font-mono text-sm md:text-base">
            {rsi !== null ? rsi.toFixed(2) : 'N/A'}
          </span>
          <span className="text-slate-700">·</span>
          <span className="text-slate-500">MACD</span>
          <span className="text-blue-400 font-mono text-sm md:text-base">
            {macd !== null ? macd.toFixed(0) : 'N/A'}
          </span>
          <span className="text-slate-700">·</span>
          <span className="text-slate-500">Multiplier</span>
          <span className="text-blue-400 font-mono text-sm md:text-base">
            {signalMultiplier.toFixed(2)}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6 text-xs md:text-sm pt-2">
          <span className="text-slate-600">Sharpe</span>
          <span className="text-slate-400 font-mono">{sharpe.toFixed(2)}</span>
          <span className="text-slate-800">·</span>
          <span className="text-slate-600">Drawdown</span>
          <span className="text-slate-400 font-mono">{maxDrawdown.toFixed(2)}σ</span>
          <span className="text-slate-800">·</span>
          <span className="text-slate-600">Volatility</span>
          <span className="text-slate-400 font-mono">{volatility.toFixed(2)}σ</span>
        </div>
      </section>

      {/* Historical Trend Chart */}
      {chartData.length > 0 && (
        <section className="w-full max-w-5xl mb-8 md:mb-12 px-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-500 text-xs md:text-sm text-center flex-1 tracking-wide">
              Historical PXI Movement (30 days)
            </h3>
            <button
              onClick={() => setShowRegimeBands(!showRegimeBands)}
              className={clsx(
                'text-[10px] px-3 py-1 rounded-full border transition-colors',
                showRegimeBands
                  ? 'bg-blue-500/10 border-blue-500/50 text-blue-400'
                  : 'bg-slate-900 border-slate-800 text-slate-500'
              )}
            >
              Regime Bands
            </button>
          </div>
          <div className="bg-slate-950 rounded-lg p-2 md:p-4 border border-slate-900">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData}>
                {/* Regime background bands */}
                {showRegimeBands && regimeBands.map((band, idx) => (
                  <ReferenceArea
                    key={idx}
                    x1={band.x1}
                    x2={band.x2}
                    fill={band.fill}
                    strokeOpacity={0}
                  />
                ))}
                <XAxis
                  dataKey="timestamp"
                  stroke="#334155"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  ticks={chartTicks}
                />
                <YAxis
                  stroke="#334155"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  domain={['dataMin - 1', 'dataMax + 1']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value: any) => [value.toFixed(2), 'PXI']}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#60a5fa', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  animationDuration={800}
                />
              </LineChart>
            </ResponsiveContainer>
            {/* Regime legend */}
            {showRegimeBands && (
              <div className="flex items-center justify-center gap-4 mt-3 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.3)' }}></div>
                  <span className="text-slate-500">Calm</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(59, 130, 246, 0.3)' }}></div>
                  <span className="text-slate-500">Normal</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.3)' }}></div>
                  <span className="text-slate-500">Stress</span>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* LSTM Forecast Section */}
      {forecastData?.forecasts && forecastData.forecasts.length > 0 && (
        <section className="w-full max-w-5xl mb-8 md:mb-12 px-4 mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-500 text-xs md:text-sm text-center flex-1 tracking-wide">
              7-Day LSTM Regime Forecast
            </h3>
            <div className="text-[10px] px-3 py-1 rounded-full border bg-purple-500/10 border-purple-500/50 text-purple-400">
              Deep Learning
            </div>
          </div>
          <div className="bg-slate-950 rounded-lg p-2 md:p-4 border border-slate-900">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={React.useMemo(() => {
                  const forecasts = forecastData.forecasts || [];
                  const lastHistoricalPoint = chartData[chartData.length - 1];

                  // Create forecast data points starting from tomorrow
                  return forecasts.map((f: any, idx: number) => {
                    const forecastDate = new Date();
                    forecastDate.setDate(forecastDate.getDate() + f.day);
                    forecastDate.setHours(12, 0, 0, 0);

                    return {
                      timestamp: forecastDate.getTime(),
                      predicted: f.predictedPxi,
                      ciLower: f.ciLower,
                      ciUpper: f.ciUpper,
                      confidence: f.confidence,
                      regime: f.predictedRegime,
                      day: f.day,
                    };
                  });
                }, [forecastData, chartData])}
              >
                <XAxis
                  dataKey="timestamp"
                  stroke="#334155"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis
                  stroke="#334155"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  labelFormatter={(value) => `Day +${forecastData.forecasts.find((f: any) => {
                    const d = new Date();
                    d.setDate(d.getDate() + f.day);
                    d.setHours(12, 0, 0, 0);
                    return d.getTime() === value;
                  })?.day || ''}`}
                  formatter={(value: any, name: string) => {
                    if (name === 'predicted') return [value.toFixed(3), 'Predicted PXI'];
                    if (name === 'ciLower') return [value.toFixed(3), 'Lower CI'];
                    if (name === 'ciUpper') return [value.toFixed(3), 'Upper CI'];
                    return [value, name];
                  }}
                />
                {/* Confidence interval area */}
                <Area
                  type="monotone"
                  dataKey="ciUpper"
                  stroke="none"
                  fill="#a78bfa"
                  fillOpacity={0.1}
                  activeDot={false}
                />
                <Area
                  type="monotone"
                  dataKey="ciLower"
                  stroke="none"
                  fill="#a78bfa"
                  fillOpacity={0.1}
                  activeDot={false}
                />
                {/* Predicted PXI line */}
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
            {/* Forecast summary */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Avg Predicted PXI:</span>
                <span className="text-purple-400 font-mono">
                  {(forecastData.forecasts.reduce((sum: number, f: any) => sum + f.predictedPxi, 0) / forecastData.forecasts.length).toFixed(3)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Avg Confidence:</span>
                <span className="text-purple-400 font-mono">
                  {(forecastData.forecasts.reduce((sum: number, f: any) => sum + f.confidence, 0) / forecastData.forecasts.length * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Model:</span>
                <span className="text-slate-400 text-[10px]">LSTM (2 layers, 64 units)</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Divider */}
      <div className="w-full max-w-5xl border-t border-slate-900 my-8"></div>

      {/* Cache Status & Alerts */}
      <section className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-8 px-4">
        {/* Cache Status */}
        <div className="text-center bg-slate-950/50 rounded-lg p-4 border border-slate-900">
          <h3 className="text-slate-500 text-xs uppercase tracking-wider mb-3">Cache Status</h3>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">
              Status: <span className={
                cacheData?.status === 'fresh' ? 'text-green-400' :
                cacheData?.status === 'warning' ? 'text-amber-400' :
                'text-red-400'
              }>{cacheData?.status || 'unknown'}</span>
            </p>
            <p className="text-slate-600 text-xs">
              Age: {cacheData?.ageHours?.toFixed(1) || 'N/A'}h · Next: {cacheData?.nextUpdate || 'N/A'}
            </p>
          </div>
        </div>

        {/* Active Alerts */}
        <div className="text-center bg-slate-950/50 rounded-lg p-4 border border-slate-900">
          <h3 className="text-slate-500 text-xs uppercase tracking-wider mb-3">Active Alerts</h3>
          {activeAlerts.length > 0 ? (
            <div className="space-y-2">
              {activeAlerts.map((alert: any, index: number) => (
                <p key={index} className="text-slate-400 text-xs">
                  <span className={alert.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                    {alert.severity === 'critical' ? '🚨' : '⚠'}
                  </span> {alert.message?.slice(0, 50)}...
                </p>
              ))}
            </div>
          ) : (
            <p className="text-slate-600 text-sm">✓ No critical alerts</p>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-8 md:mt-12 text-center text-slate-700 text-xs pb-6">
        <div className="border-t border-slate-900 pt-6">
          <p>Auto-refresh: 60s · Version-based atomic updates · Command interface v1.0</p>
        </div>
      </footer>
    </div>
  );
}
