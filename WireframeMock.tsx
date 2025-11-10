export default function WireframeMock() {
  return (
    <main className="space-y-6 bg-[#0B0F14] p-8 text-white">
      <section className="rounded-3xl border border-violet/40 p-6">
        <h1 className="text-4xl font-bold">PXI (PAMP Index)</h1>
        <p className="text-sm text-slate-400">Header hero with live value + status</p>
      </section>
      <section className="rounded-3xl border border-slate-700 p-6">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Gauge</p>
        <div className="mt-4 h-48 w-full rounded-full bg-gradient-to-r from-pampRed via-pampGreen to-violet" />
      </section>
      <section className="rounded-3xl border border-slate-700 p-4">
        <div className="h-4 w-full rounded-full bg-slate-800">
          <div className="h-full w-1/2 rounded-full bg-violet" />
        </div>
        <p className="mt-2 text-sm text-slate-400">Composite bar</p>
      </section>
      <section className="rounded-3xl border border-slate-700 p-4">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Metrics Grid</p>
        <div className="mt-4 space-y-3">
          {[...Array(3)].map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <span>Metric Name</span>
                <span className="rounded-full bg-pampAmber/20 px-3 py-1 text-xs text-pampAmber">Caution</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-400">
                <span>Value</span>
                <span>Delta</span>
                <span>Bounds</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <footer className="rounded-full border border-slate-700 px-6 py-3 text-sm">
        Active Breaches: HY OAS – Stress · NFCI – Stress
      </footer>
    </main>
  );
}
