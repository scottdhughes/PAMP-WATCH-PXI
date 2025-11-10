'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchPxi } from '../lib/fetcher';
import type { PXIResponse } from '../lib/types';
import Hero from './Hero';
import Gauge from './Gauge';
import CompositeBar from './CompositeBar';
import MetricsTable from './MetricsTable';
import Ticker from './Ticker';

export default function Dashboard() {
  const [data, setData] = useState<PXIResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetchPxi();
      setData(response);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const content = useMemo(() => {
    if (error) {
      return <p className="text-red-400">{error}</p>;
    }
    if (!data) {
      return <p className="text-slate-400">Loading live PXI ...</p>;
    }
    return (
      <div className="flex flex-col gap-6 pb-20">
        <Hero data={data} />
        <Gauge value={data.pxi} />
        <CompositeBar value={data.pxi} />
        <MetricsTable metrics={data.metrics} />
      </div>
    );
  }, [data, error]);

  return (
    <main className="relative min-h-screen bg-gray-100 dark:bg-[#0B0F14] px-4 py-6 text-gray-900 dark:text-white sm:px-8 transition-colors">
      {content}
      <Ticker items={data?.ticker ?? []} />
    </main>
  );
}
