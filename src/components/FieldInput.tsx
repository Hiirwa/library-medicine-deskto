import type { Variable } from '../lib/types';

interface Props {
  v: Variable;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  masked?: boolean;
  fileSlot?: React.ReactNode;
}

const opts = (v: Variable) => v.config?.options ?? [];

/** One question, rendered for its variable type. Values are stored the way the server expects them. */
export function FieldInput({ v, value, onChange, disabled, masked, fileSlot }: Props) {
  const id = `f_${v.name}`;
  const str = value === null || value === undefined ? '' : String(value);
  if (masked) {
    return <input id={id} className="field" value="•••••• (personal data hidden for your role)" disabled readOnly />;
  }
  switch (v.type) {
    case 'textarea':
      return <textarea id={id} className="field min-h-24" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'integer':
    case 'decimal':
    case 'number':
    case 'rating':
    case 'slider':
      return (
        <input id={id} className="field" type="number" inputMode="decimal" step={v.type === 'integer' ? 1 : 'any'} min={v.config?.min as number | undefined} max={v.config?.max as number | undefined}
          value={str} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      );
    case 'date':
      return <input id={id} className="field" type="date" value={str.slice(0, 10)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <input id={id} className="field" type="datetime-local" value={str.replace(' ', 'T').slice(0, 16)} disabled={disabled} onChange={(e) => onChange(e.target.value ? e.target.value.replace('T', ' ') + ':00' : null)} />;
    case 'time':
      return <input id={id} className="field" type="time" value={str.slice(0, 5)} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} />;
    case 'email':
      return <input id={id} className="field" type="email" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input id={id} className="field" type="tel" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return (
        <div className="flex gap-2" role="radiogroup" aria-labelledby={`${id}_l`}>
          {[['1', 'Yes'], ['0', 'No']].map(([val, l]) => (
            <button type="button" key={val} disabled={disabled} onClick={() => onChange(str === val ? null : val)}
              className={`btn ${str === val ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} aria-pressed={str === val}>{l}</button>
          ))}
        </div>
      );
    case 'radio':
      return (
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {opts(v).map((o) => (
            <button type="button" key={o.value} disabled={disabled} onClick={() => onChange(str === o.value ? null : o.value)}
              className={`btn ${str === o.value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`} aria-pressed={str === o.value}>{o.label}</button>
          ))}
        </div>
      );
    case 'dropdown':
      return (
        <select id={id} className="field" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {opts(v).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'checkbox': {
      const cur = Array.isArray(value) ? (value as string[]) : str ? str.split(';') : [];
      return (
        <div className="flex flex-wrap gap-2">
          {opts(v).map((o) => {
            const on = cur.includes(o.value);
            return (
              <button type="button" key={o.value} disabled={disabled} aria-pressed={on}
                onClick={() => onChange(on ? cur.filter((x) => x !== o.value) : [...cur, o.value])}
                className={`btn ${on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{on ? '✓ ' : ''}{o.label}</button>
            );
          })}
        </div>
      );
    }
    case 'calculated':
      return <input id={id} className="field bg-slate-50 text-slate-500" value={str || 'Calculated by the server after sync'} readOnly disabled />;
    case 'file':
      return <>{fileSlot}</>;
    case 'gps': {
      const g = (value ?? {}) as { lat?: number; lng?: number };
      return (
        <div className="flex gap-2">
          <input className="field" type="number" step="any" placeholder="Latitude" value={g.lat ?? ''} disabled={disabled} onChange={(e) => onChange({ ...g, lat: e.target.value === '' ? undefined : Number(e.target.value) })} />
          <input className="field" type="number" step="any" placeholder="Longitude" value={g.lng ?? ''} disabled={disabled} onChange={(e) => onChange({ ...g, lng: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </div>
      );
    }
    default:
      return <input id={id} className="field" value={str} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}
