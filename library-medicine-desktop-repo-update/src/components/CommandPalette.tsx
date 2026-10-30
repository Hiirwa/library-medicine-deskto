import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './ui';
import { useProjects } from './Shell';
import * as store from '../lib/db';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';

interface Item { id: string; icon: string; label: string; hint?: string; run: () => void }

/** Ctrl+K: jump to any project, page or record, or run an action. */
export function CommandPalette() {
  const { palette, setPalette, go, route, openEditor, dark, setTheme } = useUi();
  const { sync, online } = useSession();
  const projects = useProjects();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (palette) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 10); } }, [palette]);
  const recs = useQuery({ queryKey: ['psearch', q], queryFn: () => store.searchRecords(q, 8), enabled: palette && q.trim().length >= 2 });

  const items = useMemo<Item[]>(() => {
    const close = (f: () => void) => () => { setPalette(false); f(); };
    const cur = route.page === 'project' ? projects.data?.find((p) => p.uuid === route.project) : null;
    const base: Item[] = [
      ...(cur?.can.add && cur.status === 'active' ? [{ id: 'new', icon: 'plus-lg', label: `New record in ${cur.title}`, hint: 'Ctrl N', run: close(() => openEditor({ project: cur.uuid, record: null, form: null })) }] : []),
      { id: 'sync', icon: 'arrow-repeat', label: online ? 'Sync now' : 'Sync now (offline)', hint: 'F5', run: close(() => { if (online) sync(); }) },
      { id: 'home', icon: 'grid-1x2', label: 'My projects', run: close(() => go({ page: 'home' })) },
      { id: 'synccentre', icon: 'activity', label: 'Sync centre', run: close(() => go({ page: 'sync' })) },
      { id: 'settings', icon: 'gear', label: 'Settings', hint: 'Ctrl ,', run: close(() => go({ page: 'settings' })) },
      { id: 'help', icon: 'book', label: 'Help & documentation', run: close(() => go({ page: 'help' })) },
      { id: 'theme', icon: dark ? 'sun' : 'moon-stars', label: dark ? 'Switch to light theme' : 'Switch to dark theme', run: close(() => setTheme(dark ? 'light' : 'dark')) },
    ];
    for (const p of projects.data ?? []) {
      base.push({ id: `p-${p.uuid}`, icon: 'folder2-open', label: p.title, hint: 'Project', run: close(() => go({ page: 'project', project: p.uuid, tab: 'overview' })) });
      base.push({ id: `d-${p.uuid}`, icon: 'table', label: `${p.title} — Data`, hint: `${p.records} records`, run: close(() => go({ page: 'project', project: p.uuid, tab: 'data' })) });
      for (const [tab, icon, name] of [['statistics', 'calculator', 'Statistics'], ['workbench', 'bezier2', 'Workbench'], ['dashboard', 'pie-chart', 'Dashboard'], ['reports', 'file-earmark-bar-graph', 'Reports'], ['import', 'cloud-upload', 'Import'], ['export', 'box-arrow-down', 'Export']] as const) {
        base.push({ id: `${tab}-${p.uuid}`, icon, label: `${p.title} — ${name}`, hint: 'Project', run: close(() => go({ page: 'project', project: p.uuid, tab })) });
      }
    }
    const t = q.trim().toLowerCase();
    const found = t ? base.filter((i) => i.label.toLowerCase().includes(t)) : base.slice(0, 9);
    for (const r of recs.data ?? []) {
      let preview = '';
      try { preview = Object.values(JSON.parse(r.data) as Record<string, unknown>).filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 3).join(' · '); } catch { /* none */ }
      found.push({ id: `r-${r.uuid}`, icon: 'file-earmark-text', label: `${r.uuid.slice(0, 8)} · ${preview || 'record'}`, hint: r.project_title, run: close(() => openEditor({ project: r.project, record: r.uuid, form: r.form })) });
    }
    return found;
  }, [q, projects.data, recs.data, route, online, dark, go, openEditor, setPalette, setTheme, sync]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);
  if (!palette) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setPalette(false); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPalette(false); }}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="relative">
          <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-lg muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Search projects, pages, records…" aria-label="Search" />
        </div>
        <div className="p-list">
          {items.map((it, i) => (
            <button key={it.id} className={`p-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
              <Icon name={it.icon} /><span className="min-w-0 flex-1 truncate">{it.label}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
          {!items.length && <p className="muted p-6 text-center">Nothing found{q.trim().length < 2 ? '' : ` for “${q}”`}.</p>}
        </div>
        <div className="flex gap-4 px-4 py-2 text-xs muted" style={{ boxShadow: '0 -1px 0 color-mix(in srgb, var(--rh-muted) 14%, transparent)' }}>
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
