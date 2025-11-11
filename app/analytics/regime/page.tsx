'use client';

import React from 'react';
import { useQuery } from 'react-query';
import { fetcher } from '@/utils/fetcher';
import { ScatterChart, Scatter, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend, Cell } from 'recharts';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8787';

// Regime color mapping
const REGIME_COLORS: Record<string, string> = {
  'Calm': '#22c55e',
  'Normal': '#3b82f6',
  'Stress': '#ef4444',
};

export default function RegimeAnalyticsPage() {
  // Fetch regime history
  const { data: regimeData, isLoading } = useQuery(
    'regime-analytics',
    () => fetcher<any>(`${API_BASE}/v1/pxi/regime/history?days=90`),
    { refetchInterval: 60000 }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-slate-500 font-light tracking-wide">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const regimes = regimeData?.regimes || [];

  // Calculate centroids by regime
  const centroidsByRegime = React.useMemo(() => {
    const grouped: Record<string, any[]> = {};

    regimes.forEach((r: any) => {
      if (!grouped[r.regime]) {
        grouped[r.regime] = [];
      }
      grouped[r.regime].push(r);
    });

    // Calculate mean centroid for each regime
    const centroids: Record<string, any> = {};
    Object.entries(grouped).forEach(([regime, items]) => {
      const features: Record<string, number[]> = {};

      items.forEach((item) => {
        Object.entries(item.centroid).forEach(([key, value]: [string, any]) => {
          if (!features[key]) features[key] = [];
          features[key].push(value);
        });
      });

      centroids[regime] = {};
      Object.entries(features).forEach(([key, values]) => {
        centroids[regime][key] = values.reduce((sum, v) => sum + v, 0) / values.length;
      });
    });

    return centroids;
  }, [regimes]);

  // Prepare scatter plot data
  const scatterData = React.useMemo(() => {
    return regimes.map((r: any) => ({
      regime: r.regime,
      vix: r.probabilities?.rawMetrics?.vix?.value || 0,
      hyOas: (r.probabilities?.rawMetrics?.hyOas?.value || 0) * 100, // Convert to percentage
      pxi: r.probabilities?.pxiValue || 0,
      date: r.date,
    }));
  }, [regimes]);

  // Calculate drift metrics (30-day mean vs current centroid)
  const driftMetrics = React.useMemo(() => {
    if (regimes.length === 0) return {};

    const last30Days = regimes.slice(0, Math.min(30, regimes.length));
    const grouped: Record<string, any[]> = {};

    last30Days.forEach((r: any) => {
      if (!grouped[r.regime]) {
        grouped[r.regime] = [];
      }
      grouped[r.regime].push(r);
    });

    const drift: Record<string, any> = {};
    Object.entries(grouped).forEach(([regime, items]) => {
      if (items.length === 0) return;

      const latest = items[0];
      const features: Record<string, number[]> = {};

      items.forEach((item) => {
        Object.entries(item.centroid).forEach(([key, value]: [string, any]) => {
          if (!features[key]) features[key] = [];
          features[key].push(value);
        });
      });

      // Calculate mean and drift from latest
      const means: Record<string, number> = {};
      const drifts: Record<string, number> = {};

      Object.entries(features).forEach(([key, values]) => {
        means[key] = values.reduce((sum, v) => sum + v, 0) / values.length;
        drifts[key] = latest.centroid[key] - means[key];
      });

      drift[regime] = { means, drifts, count: items.length };
    });

    return drift;
  }, [regimes]);

  // Extract feature names from centroids
  const featureNames = Object.keys(centroidsByRegime['Calm'] || centroidsByRegime['Normal'] || centroidsByRegime['Stress'] || {});
  const mainFeatures = featureNames.filter(f => f.endsWith('_zscore'));

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Regime Analytics</h1>
          <p className="text-slate-500 text-sm">K-Means Clustering Analysis (k=3, seed=42)</p>
        </div>

        {/* Centroid Table */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">Cluster Centroids</h2>
          <div className="bg-slate-950 rounded-lg border border-slate-900 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left p-4 text-slate-400 font-medium">Feature</th>
                  {['Calm', 'Normal', 'Stress'].map((regime) => (
                    <th
                      key={regime}
                      className="text-right p-4 font-medium"
                      style={{ color: REGIME_COLORS[regime] }}
                    >
                      {regime}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mainFeatures.map((feature, idx) => (
                  <tr key={feature} className={idx % 2 === 0 ? 'bg-slate-900/30' : ''}>
                    <td className="p-4 text-slate-400 font-mono text-xs">
                      {feature.replace('_zscore', '').toUpperCase()}
                    </td>
                    {['Calm', 'Normal', 'Stress'].map((regime) => {
                      const value = centroidsByRegime[regime]?.[feature];
                      return (
                        <td key={regime} className="p-4 text-right font-mono text-xs">
                          {value !== undefined ? value.toFixed(3) : 'N/A'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Scatter Plot */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">VIX vs HY OAS by Regime</h2>
          <div className="bg-slate-950 rounded-lg border border-slate-900 p-4 md:p-6">
            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="vix"
                  name="VIX"
                  stroke="#64748b"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  label={{ value: 'VIX', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 12 }}
                />
                <YAxis
                  dataKey="hyOas"
                  name="HY OAS"
                  stroke="#64748b"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  label={{ value: 'HY OAS (%)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  formatter={(value: any, name: string) => {
                    if (name === 'VIX') return [value.toFixed(1), 'VIX'];
                    if (name === 'HY OAS') return [`${value.toFixed(2)}%`, 'HY OAS'];
                    if (name === 'PXI') return [value.toFixed(3), 'PXI'];
                    return [value, name];
                  }}
                  labelFormatter={(label) => `Date: ${new Date(label).toLocaleDateString()}`}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                  formatter={(value) => <span style={{ color: REGIME_COLORS[value] || '#94a3b8' }}>{value}</span>}
                />
                {['Calm', 'Normal', 'Stress'].map((regime) => (
                  <Scatter
                    key={regime}
                    name={regime}
                    data={scatterData.filter((d: any) => d.regime === regime)}
                    fill={REGIME_COLORS[regime]}
                    fillOpacity={0.6}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Drift Metrics */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">30-Day Drift Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['Calm', 'Normal', 'Stress'].map((regime) => {
              const drift = driftMetrics[regime];
              if (!drift) return null;

              const maxDriftFeature = mainFeatures.reduce((max, feature) => {
                const absDrift = Math.abs(drift.drifts[feature] || 0);
                const maxAbsDrift = Math.abs(drift.drifts[max] || 0);
                return absDrift > maxAbsDrift ? feature : max;
              }, mainFeatures[0]);

              const maxDriftValue = drift.drifts[maxDriftFeature] || 0;

              return (
                <div
                  key={regime}
                  className="bg-slate-950 rounded-lg border border-slate-900 p-4"
                >
                  <h3
                    className="text-lg font-semibold mb-3"
                    style={{ color: REGIME_COLORS[regime] }}
                  >
                    {regime}
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Observations:</span>
                      <span className="text-slate-200 font-mono">{drift.count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Max Drift:</span>
                      <span className="text-slate-200 font-mono text-xs">
                        {maxDriftFeature.replace('_zscore', '').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Δ Value:</span>
                      <span className={`font-mono ${maxDriftValue >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {maxDriftValue >= 0 ? '+' : ''}{maxDriftValue.toFixed(3)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-slate-600 text-xs">
          <p>Data based on last 90 days of regime classifications</p>
        </div>
      </div>
    </div>
  );
}
