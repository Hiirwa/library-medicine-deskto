// Form chooser in the record window: a colourful button showing the current form, opening a list of the project's
// forms as cards (own colour, questions / sections / pages, status), with search, keyboard and a hint that the
// answers typed so far are kept when switching.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Form, Variable } from '../lib/types';
import { Icon } from './ui';

export const ALL_FORMS = 'all';
const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#a855f7', '#22c55e', '#f97316'];
const ICONS = ['ui-checks-grid', 'clipboard2-pulse', 'heart-pulse', 'journal-medical', 'activity', 'file-earmark-medical', 'capsule', 'bandaid'];

interface Option { id: string; title: string; sub: string; icon: string; color: string; questions: number; sections: number; pages: number; status?: string; description?: string | null }

function countLayout(f: Form) {
  let questions = 0, sections = 0, pages = 0;
  for (const p of (f.layout as { pages?: { sections?: { items?: { type?: string }[] }[] }[] })?.pages ?? []) {
    if (!(p.sections ?? []).length) continue;
    pages++;
    for (const s of p.sections ?? []) { sections++; questions += (s.items ?? []).filter((i) => i.type === 'variable' || !i.type).length; }
  }
  return { questions, sections, pages };
}

export function FormPicker({ forms, variables, value, canAll, onChange }: { forms: Form[]; variables: Variable[]; value: string; canAll: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const options = useMemo<Option[]>(() => {
    const list: Option[] = forms.map((f, i) => {
      const c = countLayout(f);
      return { id: f.uuid, title: f.title, icon: ICONS[i % ICONS.length], color: PALETTE[i % PALETTE.length], ...c, status: f.status, description: f.description,
        sub: `${c.questions} question${c.questions === 1 ? '' : 's'} · ${c.sections} section${c.sections === 1 ? '' : 's'}${c.pages > 1 ? ` · ${c.pages} pages` : ''}` };
    });
    if (canAll) {
      const n = variables.filter((v) => v.type !== 'note').length;
      list.unshift({ id: ALL_FORMS, title: 'All variables', icon: 'grid-3x3-gap', color: '#64748b', questions: n, sections: 1, pages: 1, sub: `${n} variables on one page · as on the website's edit page` });
    }
    return list;
  }, [forms, variables, canAll]);
  const shown = options.filter((o) => !q.trim() || o.title.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, shown.findIndex((o) => o.id === value)));
    setTimeout(() => search.current?.focus(), 30);
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: Option) => { setOpen(false); setQ(''); if (o.id !== value) onChange(o.id); };
  const onKey = (e: KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && shown[hi]) { e.preventDefault(); pick(shown[hi]); }
  };
  if (!cur) return null;

  return (
    <div className="fp" ref={box} onKeyDown={onKey}>
      <button type="button" className={`fp-btn ${open ? 'open' : ''}`} style={{ '--fc': cur.color } as CSSProperties} onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox" aria-expanded={open} title={`Form: ${cur.title} — click to switch`}>
        <span className="fp-ic"><Icon name={cur.icon} /></span>
        <span className="fp-tx"><small>Form{options.length > 1 ? ` · ${options.indexOf(cur) + 1} of ${options.length}` : ''}</small><b>{cur.title}</b></span>
        <span className="fp-n" title={cur.sub}>{cur.questions}<small>Q</small></span>
        <Icon name="chevron-down" className="fp-car" />
      </button>
      {open && (
        <div className="fp-pop anim-in" role="listbox" aria-label="Choose a form">
          <div className="fp-pop-hd">
            <span className="fp-pop-t"><Icon name="ui-checks-grid" />Choose a form</span>
            <span className="muted text-xs">{options.length} available</span>
          </div>
          {options.length > 4 && (
            <div className="field-ic mx-3 mb-2"><Icon name="search" /><input ref={search} className="field" placeholder="Search forms…" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} /></div>
          )}
          <div className="fp-list">
            {shown.map((o, i) => {
              const on = o.id === value;
              return (
                <button key={o.id} type="button" role="option" aria-selected={on} className={`fp-opt ${on ? 'on' : ''} ${i === hi ? 'hi' : ''}`} style={{ '--fc': o.color } as CSSProperties}
                  onMouseEnter={() => setHi(i)} onClick={() => pick(o)}>
                  <span className="fp-ic"><Icon name={o.icon} /></span>
                  <span className="fp-tx">
                    <b>{o.title}</b>
                    <small>{o.sub}</small>
                    {o.description && <em>{o.description}</em>}
                  </span>
                  {o.status && o.status !== 'active' && o.status !== 'published' && <span className="chip chip-warn">{o.status}</span>}
                  <span className="fp-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (o.questions / Math.max(1, ...options.map((x) => x.questions))) * 100)}%` }} /></span>
                  {on ? <span className="fp-check"><Icon name="check-lg" /></span> : <Icon name="arrow-right-short" className="fp-go" />}
                </button>
              );
            })}
            {!shown.length && <p className="muted p-4 text-center text-sm">No form matches “{q}”.</p>}
          </div>
          <div className="fp-pop-ft"><Icon name="info-circle" />Switching keeps the answers you have typed. <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to choose</div>
        </div>
      )}
    </div>
  );
}
