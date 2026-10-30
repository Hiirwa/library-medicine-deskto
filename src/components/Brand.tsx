export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-grid place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_8px_20px_-8px_rgba(45,75,216,.8)]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.55} height={size * 0.55} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M5 4v16M9 8h7M9 12h10M9 16h6" />
      </svg>
    </span>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <div className="leading-tight">
        <div className="text-lg font-bold text-slate-900">Library <span className="text-brand-600">Medicine</span></div>
        <div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Desktop · offline data</div>
      </div>
    </div>
  );
}
