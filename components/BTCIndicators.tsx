import GaugeChart from 'react-gauge-chart';

interface BTCIndicatorsProps {
  rsi: number | null;
  macdValue: number | null;
  macdSignal: number | null;
  signalMultiplier: number;
}

export default function BTCIndicators({
  rsi,
  macdValue,
  macdSignal,
  signalMultiplier,
}: BTCIndicatorsProps) {
  // RSI: 0-100 scale, normalize to 0-1
  const rsiPercent = (rsi || 50) / 100;

  return (
    <div className="rounded-2xl bg-slate-800 p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-white mb-4">BTC Indicators</h2>

      <div className="grid grid-cols-2 gap-6">
        {/* RSI Gauge */}
        <div className="text-center">
          <p className="text-sm text-slate-400 mb-2">RSI (14-day)</p>
          <GaugeChart
            id="btc-rsi"
            percent={rsiPercent}
            arcsLength={[0.4, 0.3, 0.3]}
            colors={['#00FF85', '#FFBF00', '#FF0033']}
            animate={false}
            textColor="#fff"
            needleColor="#fff"
            needleBaseColor="#fff"
          />
          <p className="text-xl font-bold text-slate-100 mt-2">
            {rsi !== null ? rsi.toFixed(2) : 'N/A'}
          </p>
          <p className="text-xs text-slate-500">
            {rsi !== null && rsi < 30 ? 'Oversold' : rsi !== null && rsi > 70 ? 'Overbought' : 'Neutral'}
          </p>
        </div>

        {/* MACD Display */}
        <div className="text-center">
          <p className="text-sm text-slate-400 mb-2">MACD (12,26,9)</p>
          <div className="flex flex-col items-center justify-center h-32">
            <p className="text-3xl font-bold text-slate-100">
              {macdValue !== null ? macdValue.toFixed(2) : 'N/A'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Signal: {macdSignal !== null ? macdSignal.toFixed(2) : 'N/A'}
            </p>
          </div>
          <div className="mt-4">
            <p className="text-xs text-slate-500 mb-1">Signal Multiplier</p>
            <p className="text-xl font-bold text-blue-400">
              {signalMultiplier.toFixed(2)}x
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
