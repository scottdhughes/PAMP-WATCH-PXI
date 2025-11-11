import GaugeChart from 'react-gauge-chart';

interface PXIGaugeProps {
  value: number;
}

export default function PXIGauge({ value }: PXIGaugeProps) {
  // Normalize PXI value to a 0-1 range for gauge display
  // Assuming PXI typically ranges from -10 to +10, we map it to 0-1
  const percent = Math.min(Math.abs(value || 0) / 10, 1);

  return (
    <div className="rounded-2xl bg-slate-800 p-6 shadow-lg text-center">
      <h2 className="text-xl font-semibold text-white mb-4">Composite PXI</h2>
      <GaugeChart
        id="pxi-gauge"
        percent={percent}
        arcsLength={[0.4, 0.3, 0.2, 0.1]}
        colors={['#00FF85', '#FFBF00', '#FF6B00', '#FF0033']}
        textColor="#fff"
        animate={false}
        needleColor="#fff"
        needleBaseColor="#fff"
      />
      <p className="mt-4 text-2xl font-bold text-slate-100">
        {value.toFixed(2)}
      </p>
      <p className="text-sm text-slate-400 mt-1">
        Current PXI Value
      </p>
    </div>
  );
}
