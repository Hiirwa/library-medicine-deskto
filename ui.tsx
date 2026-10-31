import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const Icon = ({ name, className = '' }: { name: string; className?: string }) => <i className={`bi bi-${name} ${className}`} aria-hidden="true" />;

export function PageHead({ icon, tone, title, sub, children }: { icon: string; tone?: 'teal' | 'amber'; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head anim-in">
      <span className={`ph-ic ${tone ?? ''}`}><Icon name={icon} /></span>
      <div className="min-w-0">
        <h1 className="truncate">{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function CardTitle({ icon, title, sub, tone, children }: { icon: string; title: ReactNode; sub?: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className="card-title">
      <span className={`ic ${tone ?? ''}`}><Icon name={icon} /></span>
      <div className="min-w-0 flex-1"><h2>{title}</h2>{sub && <small>{sub}</small>}</div>
      {children}
    </div>
  );
}

/** A number that counts up to its value (skipped for people who prefer reduced motion). */
export function CountUp({ value }: { value: ReactNode }) {
  const m = typeof value === 'number' ? [String(value), String(value), ''] : typeof value === 'string' ? /^(\d[\d,]*(?:\.\d+)?)(%?)$/.exec(value) : null;
  const target = m ? Number(String(m[1]).replace(/,/g, '')) : NaN;
  const suffix = m ? (typeof value === 'string' ? m[2] : '') : '';
  const [n, setN] = useState(Number.isFinite(target) ? 0 : NaN);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || target === 0) { setN(target); return; }
    let raf = 0; const t0 = performance.now(); const dur = 650;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur); setN(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  if (!Number.isFinite(target)) return <>{value}</>;
  const shown = Number.isInteger(target) ? Math.round(n) : Math.round(n * 10) / 10;
  return <>{shown.toLocaleString()}{suffix}</>;
}

export function Stat({ icon, value, label, tone = 'k-brand', active, onClick, title }: { icon: string; value: ReactNode; label: string; tone?: string; active?: boolean; onClick?: () => void; title?: string }) {
  const inner = (<><span className="ic"><Icon name={icon} /></span><span className="min-w-0"><b><CountUp value={value} /></b><small>{label}</small></span></>);
  return onClick
    ? <button type="button" className={`stat ${tone} ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active} title={title}>{inner}</button>
    : <div className={`stat ${tone}`} title={title}>{inner}</div>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="e-ic"><Icon name={icon} /></span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export function BarChart({ data, teal, labels = 'date', height }: { data: { day: string; n: number }[]; teal?: boolean; labels?: 'date' | 'weekday'; height?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className={`chart ${teal ? 'teal' : ''}`} style={height ? ({ '--chart-h': height } as React.CSSProperties) : undefined} role="img" aria-label={`Records per day: ${data.map((d) => `${d.day} ${d.n}`).join(', ')}`}>
      {data.map((d, i) => {
        const dt = new Date(`${d.day}T12:00:00`);
        return (
          <div key={d.day} className={`col ${i === data.length - 1 ? 'today' : ''}`} title={`${dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.n} record${d.n === 1 ? '' : 's'}`}>
            <i style={{ height: `${Math.max(2, (d.n / max) * 100)}%` }} />
            {(data.length <= 16 || i % Math.ceil(data.length / 15) === 0 || i === data.length - 1) && <span>{labels === 'weekday' ? DAY[dt.getDay()] : dt.getDate()}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Small dropdown anchored to its button; closes on outside click and Escape. */
export function Dropdown({ button, children, align = 'right', width, style }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // keep the whole menu inside the window: limit its height to the free space, and open upwards when there is more room above
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPlace(null); return; }
    const r = ref.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 60; const above = r.top - 70;
    const up = below < 220 && above > below;
    setPlace({ up, maxHeight: Math.max(150, Math.min(up ? above : below, 460)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {button(open, () => setOpen((o) => !o))}
      {open && <div className="menu" style={{ ...(style ?? { [align]: 0, top: 'calc(100% + .4rem)', width }), ...(place?.up ? { top: 'auto', bottom: 'calc(100% + .4rem)' } : {}), ...(place ? { maxHeight: place.maxHeight, overflowY: 'auto' as const } : {}) }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function SyncChip({ dirty, error }: { dirty: number | boolean; error: string | null }) {
  if (error) return <span className="chip chip-danger" title={error}><Icon name="exclamation-octagon" />Refused</span>;
  if (dirty) return <span className="chip chip-warn"><Icon name="hourglass-split" />To send</span>;
  return <span className="chip chip-ok"><Icon name="check2" />Synced</span>;
}

export function StatusChip({ status }: { status: string }) {
  const cls = status === 'complete' ? 'chip-teal' : status === 'flagged' ? 'chip-warn' : status === 'draft' ? '' : 'chip-brand';
  const ic = status === 'complete' ? 'check2-circle' : status === 'flagged' ? 'flag' : status === 'draft' ? 'pencil' : 'circle';
  return <span className={`chip ${cls}`}><Icon name={ic} />{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

export function Skeleton({ h = '1rem', w = '100%', r = '.6rem', className = '' }: { h?: string; w?: string; r?: string; className?: string }) {
  return <span className={`skel ${className}`} style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

/** Placeholder shaped like a typical page (header, stat tiles, two cards) shown while data loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="page-head" style={{ gap: '1rem' }}><Skeleton h="3.25rem" w="3.25rem" r="1rem" /><div className="flex-1 space-y-2"><Skeleton h="1.5rem" w="14rem" /><Skeleton h=".9rem" w="22rem" /></div><Skeleton h="2.4rem" w="8rem" r=".7rem" /></div>
      <div className="stats">{Array.from({ length: 5 }, (_, i) => <div key={i} className="stat"><Skeleton h="2.45rem" w="2.45rem" r=".8rem" /><span className="flex-1 space-y-1.5"><Skeleton h="1.1rem" w="55%" /><Skeleton h=".7rem" w="80%" /></span></div>)}</div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <div className="card space-y-3 p-5"><Skeleton h="1.2rem" w="9rem" /><Skeleton h="11rem" r="1rem" /></div>
        <div className="card space-y-3 p-5"><Skeleton h="1.2rem" w="7rem" />{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h=".9rem" />)}</div>
      </div>
    </div>
  );
}
