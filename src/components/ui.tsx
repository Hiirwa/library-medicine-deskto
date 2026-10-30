import { useEffect, useRef, useState, type ReactNode } from 'react';

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

export function Stat({ icon, value, label, tone = 'k-brand', active, onClick, title }: { icon: string; value: ReactNode; label: string; tone?: string; active?: boolean; onClick?: () => void; title?: string }) {
  const inner = (<><span className="ic"><Icon name={icon} /></span><span className="min-w-0"><b>{value}</b><small>{label}</small></span></>);
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
  const ref = useRef<HTMLDivElement>(null);
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
      {open && <div className="menu" style={style ?? { [align]: 0, top: 'calc(100% + .4rem)', width }}>{children(() => setOpen(false))}</div>}
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
