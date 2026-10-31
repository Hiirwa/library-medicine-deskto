import type { ReactNode } from 'react';
import { fmt, type Bin } from '../lib/stats';

export const PALETTE = ['var(--rh-brand)', 'var(--rh-teal)', '#d97706', '#7c3aed', '#db2777', '#0369a1', '#15803d', '#64748b', '#0891b2', '#b45309'];

/** Donut chart with a centre label; every slice is hoverable and listed in the legend. */
export function Donut({ data, size = 168, center, sub, onSlice }: { data: { label: string; value: number; color?: string }[]; size?: number; center?: ReactNode; sub?: string; onSlice?: (label: string) => void }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = 15.9155; let acc = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="donut" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" role="img" aria-label={data.map((d) => `${d.label} ${d.value}`).join(', ')}>
          <circle cx="21" cy="21" r={r} fill="none" stroke="var(--rh-surface-3)" strokeWidth="5" />
          {total > 0 && data.map((d, i) => {
            const len = (d.value / total) * 100; const off = 25 - acc; acc += len;
            return len > 0 ? <circle key={d.label} cx="21" cy="21" r={r} fill="none" stroke={d.color ?? PALETTE[i % PALETTE.length]} strokeWidth="5" strokeDasharray={`${Math.max(0, len - 0.6)} ${100 - Math.max(0, len - 0.6)}`} strokeDashoffset={off} className={onSlice ? 'slice' : ''} onClick={onSlice ? () => onSlice(d.label) : undefined}><title>{`${d.label}: ${d.value} (${len.toFixed(1)}%)`}</title></circle> : null;
          })}
        </svg>
        <div className="d-center"><b>{center ?? total.toLocaleString()}</b>{sub && <small>{sub}</small>}</div>
      </div>
      <ul className="legend min-w-0 flex-1">
        {data.map((d, i) => (
          <li key={d.label} className={onSlice ? 'hl' : ''} onClick={onSlice ? () => onSlice(d.label) : undefined}><i style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} /><span className="min-w-0 flex-1 truncate" title={d.label}>{d.label}</span><b className="num">{d.value.toLocaleString()}</b><small className="num">{total ? `${Math.round((d.value / total) * 100)}%` : ''}</small></li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars: label, bar and value. */
export function HBars({ data, unit = '', max }: { data: { label: string; value: number; note?: string }[]; unit?: string; max?: number }) {
  const top = max ?? Math.max(1e-9, ...data.map((d) => d.value));
  return (
    <div className="hbars">
      {data.map((d, i) => (
        <div key={d.label} className="hb" title={`${d.label}: ${fmt(d.value)}${unit}`}>
          <span className="hb-l truncate">{d.label}</span>
          <span className="hb-t"><i style={{ width: `${Math.max(1.5, (Math.abs(d.value) / top) * 100)}%`, background: PALETTE[i % PALETTE.length] }} /></span>
          <b className="num">{fmt(d.value, 1)}{unit}</b>{d.note && <small className="muted num">{d.note}</small>}
        </div>
      ))}
    </div>
  );
}

export function HistogramChart({ bins, height = 150 }: { bins: Bin[]; height?: number }) {
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div>
      <div className="hist" style={{ height }} role="img" aria-label="Histogram">
        {bins.map((b, i) => (
          <div key={i} className="hcol" title={`${fmt(b.from)} – ${fmt(b.to)}: ${b.n} record${b.n === 1 ? '' : 's'}`}>
            <i style={{ height: `${Math.max(2, (b.n / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="hist-axis"><span>{fmt(bins[0]?.from)}</span><span>{fmt(bins[Math.floor(bins.length / 2)]?.from)}</span><span>{fmt(bins[bins.length - 1]?.to)}</span></div>
    </div>
  );
}

/** Area/line chart of one series. */
export function AreaChart({ data, height = 215 }: { data: { day: string; n: number }[]; height?: number }) {
  const W = 900; const H = height; const P = { l: 34, r: 10, t: 12, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.n));
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i: number) => P.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - P.l - P.r));
  const y = (n: number) => P.t + (1 - n / top) * (H - P.t - P.b);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.n).toFixed(1)}`).join(' ');
  const area = data.length ? `${line} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  const ticks = [0, 1, 2, 3, 4].map((t) => (top / 4) * t);
  const step = Math.max(1, Math.ceil(data.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Records per day">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--rh-brand)" stopOpacity=".38" /><stop offset="100%" stopColor="var(--rh-brand)" stopOpacity=".02" /></linearGradient></defs>
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--rh-muted)" strokeOpacity=".16" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="ax">{Math.round(t)}</text></g>)}
      {area && <path d={area} fill="url(#ag)" />}
      {line && <path d={line} fill="none" stroke="var(--rh-brand)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" className="ln" />}
      {data.map((d, i) => (
        <g key={d.day}>
          {i % step === 0 || i === data.length - 1 ? <text x={x(i)} y={H - 6} textAnchor="middle" className="ax">{d.day.slice(8)}</text> : null}
          <circle cx={x(i)} cy={y(d.n)} r={d.n ? 3.4 : 2} fill="var(--rh-surface)" stroke="var(--rh-brand)" strokeWidth="2" className="pt"><title>{`${d.day}: ${d.n} record${d.n === 1 ? '' : 's'}`}</title></circle>
        </g>
      ))}
    </svg>
  );
}

export function Scatter({ points, line, xLabel, yLabel }: { points: { x: number; y: number }[]; line?: { slope: number; intercept: number }; xLabel: string; yLabel: string }) {
  const W = 560; const H = 300; const P = { l: 46, r: 14, t: 12, b: 38 };
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const sx = (v: number) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const sy = (v: number) => H - P.b - ((v - y0) / (y1 - y0 || 1)) * (H - P.t - P.b);
  const tick = (a: number, b: number) => [0, 0.25, 0.5, 0.75, 1].map((t) => a + (b - a) * t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {tick(y0, y1).map((t) => <g key={`y${t}`}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--rh-muted)" strokeOpacity=".14" /><text x={P.l - 6} y={sy(t) + 4} textAnchor="end" className="ax">{fmt(t, 1)}</text></g>)}
      {tick(x0, x1).map((t) => <text key={`x${t}`} x={sx(t)} y={H - P.b + 16} textAnchor="middle" className="ax">{fmt(t, 1)}</text>)}
      <text x={(W + P.l) / 2} y={H - 4} textAnchor="middle" className="ax-t">{xLabel}</text>
      <text transform={`translate(11 ${(H - P.b) / 2}) rotate(-90)`} textAnchor="middle" className="ax-t">{yLabel}</text>
      {points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" fill="var(--rh-brand)" fillOpacity=".55" className="pt"><title>{`${fmt(p.x)}, ${fmt(p.y)}`}</title></circle>)}
      {line && <line x1={sx(x0)} y1={sy(line.intercept + line.slope * x0)} x2={sx(x1)} y2={sy(line.intercept + line.slope * x1)} stroke="var(--rh-teal)" strokeWidth="2.6" strokeLinecap="round" className="ln" />}
    </svg>
  );
}

/** Circular gauge 0–100. */
export function Ring({ value, label, tone = 'var(--rh-brand)', size = 104 }: { value: number; label: string; tone?: string; size?: number }) {
  const v = Math.max(0, Math.min(100, value)); const r = 15.9155;
  return (
    <div className="gauge" style={{ width: size }}>
      <div className="donut" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42"><circle cx="21" cy="21" r={r} fill="none" stroke="var(--rh-surface-3)" strokeWidth="4.5" /><circle cx="21" cy="21" r={r} fill="none" stroke={tone} strokeWidth="4.5" strokeLinecap="round" strokeDasharray={`${v} ${100 - v}`} strokeDashoffset="25" /></svg>
        <div className="d-center"><b>{Math.round(v)}%</b></div>
      </div>
      <small>{label}</small>
    </div>
  );
}
