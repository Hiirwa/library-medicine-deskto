import type { ReactNode } from 'react';
import type { Variable } from '../lib/types';
import { Icon } from './ui';

interface Props {
  v: Variable;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  masked?: boolean;
  fileSlot?: ReactNode;
}

const opts = (v: Variable) => v.config?.options ?? [];

function Pill({ on, onClick, disabled, square, children }: { on: boolean; onClick: () => void; disabled?: boolean; square?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`opt ${square ? 'sq' : ''} ${on ? 'on' : ''}`} disabled={disabled} onClick={onClick} aria-pressed={on}>
      <span className="dot">{on && <Icon name={square ? 'check-lg' : 'circle-fill'} />}</span>{children}
    </button>
  );
}

/** One question, rendered for its variable type. Values are stored the way the server expects them. */
export function FieldInput({ v, value, onChange, disabled, masked, fileSlot }: Props) {
  const id = `f_${v.name}`;
  const str = value === null || value === undefined ? '' : String(value);
  if (masked) {
    return <div className="field-ic"><Icon name="shield-lock" /><input id={id} className="field" value="Personal data hidden for your role" disabled readOnly /></div>;
  }
  switch (v.type) {
    case 'textarea':
      return <textarea id={id} className="field" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'integer':
    case 'decimal':
    case 'number':
    case 'slider': {
      const min = v.config?.min as number | undefined;
      const max = v.config?.max as number | undefined;
      const n = value === null || value === undefined || value === '' ? null : Number(value);
      const out = n !== null && ((min !== undefined && n < min) || (max !== undefined && n > max));
      return (
        <div>
          <input id={id} className="field max-w-xs" type="number" inputMode="decimal" step={v.type === 'integer' ? 1 : 'any'} min={min} max={max}
            value={str} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} aria-invalid={out} />
          {(min !== undefined || max !== undefined) && <p className="help mt-1" style={out ? { color: 'var(--rh-danger)' } : undefined}>{out ? 'Outside the allowed range: ' : 'Allowed: '}{min ?? '…'} to {max ?? '…'}</p>}
        </div>
      );
    }
    case 'rating': {
      const max = Number(v.config?.max ?? 5) || 5;
      const n = Number(value ?? 0);
      return (
        <div className="flex gap-1" role="radiogroup">
          {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
            <button key={i} type="button" disabled={disabled} className="btn btn-icon btn-ghost" style={{ fontSize: '1.5rem', color: i <= n ? '#f59e0b' : 'var(--rh-muted)' }} onClick={() => onChange(n === i ? null : i)} aria-label={`${i} of ${max}`}>
              <Icon name={i <= n ? 'star-fill' : 'star'} />
            </button>
          ))}
        </div>
      );
    }
    case 'date':
      return <input id={id} className="field max-w-xs" type="date" value={str.slice(0, 10)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <input id={id} className="field max-w-xs" type="datetime-local" value={str.replace(' ', 'T').slice(0, 16)} disabled={disabled} onChange={(e) => onChange(e.target.value ? e.target.value.replace('T', ' ') + ':00' : null)} />;
    case 'time':
      return <input id={id} className="field max-w-[12rem]" type="time" value={str.slice(0, 5)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case 'email':
      return <div className="field-ic max-w-lg"><Icon name="envelope" /><input id={id} className="field" type="email" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></div>;
    case 'phone':
      return <div className="field-ic max-w-sm"><Icon name="telephone" /><input id={id} className="field" type="tel" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></div>;
    case 'boolean':
      return (
        <div className="flex gap-2" role="radiogroup" aria-labelledby={`${id}_l`}>
          {[['1', 'Yes'], ['0', 'No']].map(([val, l]) => <Pill key={val} on={str === val} disabled={disabled} onClick={() => onChange(str === val ? null : val)}>{l}</Pill>)}
        </div>
      );
    case 'radio':
      return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${id}_l`}>
          {opts(v).map((o) => <Pill key={o.value} on={str === o.value} disabled={disabled} onClick={() => onChange(str === o.value ? null : o.value)}>{o.label}</Pill>)}
        </div>
      );
    case 'dropdown':
      return (
        <select id={id} className="field max-w-lg" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {opts(v).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'checkbox': {
      const cur = Array.isArray(value) ? (value as string[]).map(String) : str ? str.split(';') : [];
      return (
        <div className="flex flex-wrap gap-2" aria-labelledby={`${id}_l`}>
          {opts(v).map((o) => {
            const on = cur.includes(o.value);
            return <Pill key={o.value} square on={on} disabled={disabled} onClick={() => onChange(on ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{o.label}</Pill>;
          })}
        </div>
      );
    }
    case 'calculated':
      return <div className="field-ic max-w-lg"><Icon name="calculator" /><input id={id} className="field" value={str || 'Calculated by the server after sync'} readOnly disabled /></div>;
    case 'file':
      return <>{fileSlot}</>;
    case 'gps': {
      const g = (value ?? {}) as { lat?: number; lng?: number };
      const locate = () => navigator.geolocation?.getCurrentPosition((p) => onChange({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), () => {}, { timeout: 10000 });
      return (
        <div className="flex max-w-xl gap-2">
          <input className="field" type="number" step="any" placeholder="Latitude" aria-label="Latitude" value={g.lat ?? ''} disabled={disabled} onChange={(e) => onChange({ ...g, lat: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <input className="field" type="number" step="any" placeholder="Longitude" aria-label="Longitude" value={g.lng ?? ''} disabled={disabled} onChange={(e) => onChange({ ...g, lng: e.target.value === '' ? undefined : Number(e.target.value) })} />
          {!disabled && <button type="button" className="btn shrink-0" onClick={locate} title="Use this computer’s location"><Icon name="crosshair" /></button>}
        </div>
      );
    }
    default:
      return <input id={id} className="field max-w-2xl" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}
