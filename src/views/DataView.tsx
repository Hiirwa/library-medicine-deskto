import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAsk } from '../components/Confirm';
import { Dropdown, Empty, Icon, PageHead, Stat, StatusChip, SyncChip } from '../components/ui';
import * as store from '../lib/db';
import { recordsTable, saveCsv } from '../lib/csv';
import { codeValue, displayValue, isAnswered, plural } from '../lib/format';
import { ago, shortDate } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import { useLocal } from '../lib/useLocal';
import { checkAccess } from '../lib/access';
import type { LocalRecord } from '../lib/types';
import type { ProjectCtx } from './ProjectView';

type Filter = 'all' | 'complete' | 'draft' | 'flagged' | 'toSend' | 'refused' | 'today';
type SortKey = { key: string; dir: 1 | -1 };
const PAGE = 50;

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

/** The project's records as a grid: filter tiles, search, column picker, labels/codes, sorting, paging, CSV export. */
export function DataView({ project, vars, forms }: ProjectCtx) {
  const ask = useAsk();
  const { toast, lastSync } = useSession();
  const { openEditor, go } = useUi();
  const [searchRaw, setSearch] = useState('');
  const search = useDeferredValue(searchRaw);
  const [filter, setFilter] = useState<Filter>(() => { const p = ls.get('lm_pending_filter') ?? ''; if (p.startsWith(`${project.uuid}|`)) return (p.split('|')[1] || 'all') as Filter; return 'all'; });
  const [views, setViews] = useLocal<{ name: string; filter: Filter; search: string; sort: SortKey; range: string; labels: boolean; cols: string[] }[]>(`lm_views_${project.uuid}`, []);
  const [viewName, setViewName] = useState('');
  const [labels, setLabels] = useState(true);
  const [compact, setCompact] = useState(() => ls.get('lm_compact') === '1');
  const [sort, setSort] = useState<SortKey>({ key: '_updated', dir: -1 });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<'any' | 'today' | '7' | '30'>('any');
  useEffect(() => { ls.set('lm_pending_filter', ''); }, []); // the filter hand-over from the Overview / Forms pages is used once
  const [formFilter, setFormFilter] = useState<string>(() => { const p = (ls.get('lm_pending_filter') ?? '').split('|'); return p[0] === project.uuid && p[2] ? p[2] : ''; });
  const qc = useQueryClient();
  const hidePii = !project.can.pii;
  const visibleVars = useMemo(() => vars.filter((v) => !['note'].includes(v.type) && !(hidePii && v.is_pii)), [vars, hidePii]);
  const colKey = `lm_cols_${project.uuid}`;
  const [cols, setCols] = useState<string[]>(() => {
    try { const c = JSON.parse(ls.get(colKey) ?? 'null') as string[] | null; if (c?.length) return c; } catch { /* default */ }
    return visibleVars.filter((v) => !['file', 'textarea'].includes(v.type)).slice(0, 6).map((v) => v.name);
  });
  useEffect(() => { ls.set(colKey, JSON.stringify(cols)); }, [cols, colKey]);
  useEffect(() => { setPage(0); }, [search, filter, sort, range, formFilter]);

  const all = useQuery({ queryKey: ['records', project.uuid, ''], queryFn: () => store.listRecords(project.uuid, '') });
  const byName = useMemo(() => new Map(vars.map((v) => [v.name, v])), [vars]);
  const shownCols = cols.map((c) => byName.get(c)).filter((v): v is NonNullable<typeof v> => !!v && !(hidePii && v.is_pii));
  const answerable = vars.filter((v) => !['calculated', 'note'].includes(v.type)).length;
  const startToday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);

  const counts = useMemo(() => {
    const r = all.data ?? [];
    return {
      all: r.length, complete: r.filter((x) => x.status === 'complete').length, draft: r.filter((x) => x.status === 'draft').length,
      flagged: r.filter((x) => x.status === 'flagged').length, toSend: r.filter((x) => x.dirty).length, refused: r.filter((x) => x.sync_error).length,
      today: r.filter((x) => x.created_at >= startToday).length,
    };
  }, [all.data, startToday]);

  const rows = useMemo(() => {
    let r = all.data ?? [];
    if (filter === 'complete' || filter === 'draft' || filter === 'flagged') r = r.filter((x) => x.status === filter);
    if (filter === 'toSend') r = r.filter((x) => x.dirty);
    if (filter === 'refused') r = r.filter((x) => x.sync_error);
    if (filter === 'today') r = r.filter((x) => x.created_at >= startToday);
    if (formFilter) r = r.filter((x) => (formFilter === '__none' ? !x.form : x.form === formFilter));
    if (range !== 'any') { const since = range === 'today' ? startToday : new Date(Date.now() - Number(range) * 86400000).toISOString(); r = r.filter((x) => x.created_at >= since); }
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((x) => x.uuid.toLowerCase().includes(q) || visibleVars.some((v) => {
        const val = x.data[v.name];
        return isAnswered(val) && (codeValue(val).toLowerCase().includes(q) || displayValue(v, val).toLowerCase().includes(q));
      }));
    }
    const val = (x: LocalRecord): string | number => {
      if (sort.key === '_updated') return x.updated_at;
      if (sort.key === '_created') return x.created_at;
      if (sort.key === '_status') return x.status;
      if (sort.key === '_sync') return x.sync_error ? 2 : x.dirty ? 1 : 0;
      if (sort.key === '_answered') return Object.values(x.data).filter(isAnswered).length;
      const v = x.data[sort.key];
      if (typeof v === 'number') return v;
      const s = labels ? displayValue(byName.get(sort.key), v) : codeValue(v);
      const n = Number(s);
      return s !== '' && !Number.isNaN(n) ? n : s.toLowerCase();
    };
    return [...r].sort((a, b) => {
      const A = val(a), B = val(b);
      if (A === B) return 0;
      if (A === '') return 1;
      if (B === '') return -1;
      return (A > B ? 1 : -1) * sort.dir;
    });
  }, [all.data, filter, search, sort, labels, byName, visibleVars, startToday, range, formFilter]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const canAdd = project.can.add && project.status === 'active';

  const toggleOne = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageAll = view.length > 0 && view.every((r) => selected.has(r.uuid));
  const picked = (all.data ?? []).filter((r) => selected.has(r.uuid));
  async function exportSelected() {
    try { const path = await saveCsv(`${project.title} - selected records`, recordsTable(picked, vars, { labels, hidePii })); if (path) toast(`Exported ${plural(picked.length, 'record')} to ${path}`); } catch (e) { toast(`Export failed: ${String(e)}`, 'error'); }
  }
  async function deleteSelected() {
    if (!(await ask(`Delete ${plural(picked.length, 'record')} on this computer? The deletion is sent to the server at the next sync.`, { title: 'Delete records', kind: 'warning', okLabel: 'Delete', cancelLabel: 'Keep' }))) return;
    try { for (const r of picked) await store.deleteLocalRecord(r); setSelected(new Set()); await qc.invalidateQueries(); toast(`Deleted ${plural(picked.length, 'record')}.`); } catch (e) { toast(String(e), 'error'); }
  }

  const th = (key: string, label: string, title?: string) => (
    <th className="sortable" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} title={title ?? `Sort by ${label}`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key && <Icon name={sort.dir === 1 ? 'arrow-up' : 'arrow-down'} />}
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHead icon="table" title="Data view" sub={<>{plural(counts.all, 'record')} · updated {ago(lastSync)}</>}>
        {canAdd && (forms.length > 1 ? (
          <Dropdown button={(_o, t) => <button className="btn btn-primary" onClick={t}><Icon name="plus-lg" />New record<Icon name="chevron-down" /></button>}>
            {(close) => (<>
              <div className="mh">Choose a form</div>
              {forms.map((f) => <button key={f.uuid} onClick={() => { close(); openEditor({ project: project.uuid, record: null, form: f.uuid }); }}><Icon name="ui-checks-grid" />{f.title}</button>)}
              <hr /><button onClick={() => { close(); openEditor({ project: project.uuid, record: null, form: '__all' }); }}><Icon name="list-ul" />All variables (manual entry)</button>
            </>)}
          </Dropdown>
        ) : <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })} title="New record (Ctrl+N)"><Icon name="plus-lg" />New record</button>)}
        {canAdd && <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'import' })}><Icon name="cloud-upload" />Import</button>}
        {checkAccess('export', project).ok && (
          <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'export' })} title="Open Export: choose the format, records and columns">
            <Icon name="box-arrow-down" />Export
          </button>
        )}
      </PageHead>

      {project.status !== 'active' && <div className="notice warn"><Icon name="archive" /><span>This project is archived: records are read-only.</span></div>}

      <div className="stats">
        <Stat icon="collection" value={counts.all} label="All records" active={filter === 'all'} onClick={() => setFilter('all')} />
        <Stat icon="check2-circle" value={counts.complete} label="Complete" tone="k-ok" active={filter === 'complete'} onClick={() => setFilter('complete')} />
        <Stat icon="pencil" value={counts.draft} label="Drafts" tone="k-muted" active={filter === 'draft'} onClick={() => setFilter('draft')} />
        <Stat icon="flag" value={counts.flagged} label="Flagged" tone="k-warn" active={filter === 'flagged'} onClick={() => setFilter('flagged')} />
        <Stat icon="send" value={counts.toSend} label="To send" tone="k-warn" active={filter === 'toSend'} onClick={() => setFilter('toSend')} />
        {counts.refused > 0 && <Stat icon="exclamation-octagon" value={counts.refused} label="Refused" tone="k-danger" active={filter === 'refused'} onClick={() => setFilter('refused')} />}
        <Stat icon="calendar-check" value={counts.today} label="Today" tone="k-teal" active={filter === 'today'} onClick={() => setFilter('today')} />
      </div>

      <div className="toolbar">
        <div className="field-ic min-w-[16rem] flex-1">
          <Icon name="search" />
          <input id="search" className="field" placeholder="Search all columns…" value={searchRaw} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
          <kbd>/</kbd>
        </div>
        <Dropdown width="19rem" button={(_o, t) => <button className="btn" onClick={t}><Icon name="bookmark-star" />Views{views.length > 0 && <span className="count soft">{views.length}</span>}<Icon name="chevron-down" /></button>}>
          {(close) => (<>
            <div className="mh">Saved views</div>
            {views.map((v) => <div key={v.name} className="mi flex items-center gap-2 px-3 py-1.5"><button className="flex-1 truncate text-left" onClick={() => { setFilter(v.filter); setSearch(v.search); setSort(v.sort); setRange(v.range as typeof range); setLabels(v.labels); setCols(v.cols); close(); }}><Icon name="bookmark" /> {v.name}</button><button className="btn btn-icon btn-sm" aria-label={`Delete view ${v.name}`} onClick={() => setViews(views.filter((x) => x.name !== v.name))}><Icon name="x-lg" /></button></div>)}
            {!views.length && <p className="muted px-3 py-2 text-sm">Save the current filters, sort and columns to come back to them in one click.</p>}
            <hr /><form className="flex gap-2 p-2" onSubmit={(e) => { e.preventDefault(); const n = viewName.trim(); if (!n) return; setViews([...views.filter((x) => x.name !== n), { name: n, filter, search: searchRaw, sort, range, labels, cols }]); setViewName(''); toast(`View “${n}” saved.`); }}>
              <input className="field" placeholder="Name this view…" value={viewName} onChange={(e) => setViewName(e.target.value)} /><button className="btn btn-primary" disabled={!viewName.trim()}><Icon name="check2" /></button></form>
          </>)}
        </Dropdown>
        <Dropdown width="20rem" button={(_o, t) => <button className="btn" onClick={t}><Icon name="layout-three-columns" />Columns <span className="count soft">{shownCols.length}</span><Icon name="chevron-down" /></button>}>
          {() => (
            <div className="max-h-[22rem] overflow-y-auto">
              <div className="mh flex items-center justify-between">Show columns
                <span className="flex gap-2 normal-case tracking-normal">
                  <a className="cursor-pointer" style={{ color: 'var(--rh-brand)' }} onClick={() => setCols(visibleVars.map((v) => v.name))}>All</a>
                  <a className="cursor-pointer" style={{ color: 'var(--rh-brand)' }} onClick={() => setCols([])}>None</a>
                </span>
              </div>
              {visibleVars.map((v) => (
                <label key={v.name} className="mi">
                  <input type="checkbox" className="accent-[var(--rh-brand)]" checked={cols.includes(v.name)} onChange={(e) => setCols((c) => (e.target.checked ? [...c, v.name].sort((a, b) => (byName.get(a)?.sort_order ?? 0) - (byName.get(b)?.sort_order ?? 0)) : c.filter((x) => x !== v.name)))} />
                  <span className="min-w-0 flex-1 truncate">{v.label || v.name}</span>
                </label>
              ))}
            </div>
          )}
        </Dropdown>
        <div className="seg">
          <button className={labels ? 'on' : ''} onClick={() => setLabels(true)}><Icon name="tags" />Labels</button>
          <button className={!labels ? 'on' : ''} onClick={() => setLabels(false)}><Icon name="123" />Codes</button>
        </div>
        <button className="btn btn-icon" onClick={() => { setCompact((c) => { ls.set('lm_compact', c ? '0' : '1'); return !c; }); }} title={compact ? 'Comfortable rows' : 'Compact rows'}><Icon name={compact ? 'arrows-expand' : 'arrows-collapse'} /></button>
        {forms.length > 0 && <select className="field w-52" value={formFilter} onChange={(e) => setFormFilter(e.target.value)} aria-label="Form"><option value="">All forms</option>{forms.map((f) => <option key={f.uuid} value={f.uuid}>{f.title}</option>)}<option value="__none">All variables (manual)</option></select>}
        <select className="field w-44" value={range} onChange={(e) => setRange(e.target.value as typeof range)} aria-label="Created"><option value="any">Any date</option><option value="today">Created today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select>
        <button className="btn" onClick={() => { setSearch(''); setFilter('all'); setRange('any'); setFormFilter(''); setSort({ key: '_updated', dir: -1 }); }}><Icon name="funnel" />Reset</button>
      </div>

      {selected.size > 0 && (
        <div className="bulk anim-in"><b>{plural(selected.size, 'record')} selected</b><span className="flex-1" />
          <button className="btn btn-sm" onClick={exportSelected}><Icon name="filetype-csv" />Export</button>
          <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(picked.map((r) => r.uuid).join('\n')); toast('Record ids copied.'); }}><Icon name="clipboard" />Copy ids</button>
          {project.can.delete && project.status === 'active' && <button className="btn btn-sm btn-danger" onClick={deleteSelected}><Icon name="trash3" />Delete</button>}
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}><Icon name="x-lg" />Clear</button></div>
      )}
      <div className="tbl-wrap anim-in" style={{ maxHeight: 'calc(100vh - 21rem)', minHeight: '14rem' }}>
        <table className={`tbl ${compact ? 'compact' : ''}`}>
          <thead>
            <tr>
              <th style={{ width: '2.6rem' }}><input type="checkbox" className="accent-[var(--rh-brand)]" checked={pageAll} onChange={() => setSelected((p) => { const n = new Set(p); for (const r of view) { if (pageAll) n.delete(r.uuid); else n.add(r.uuid); } return n; })} aria-label="Select this page" /></th>
              {th('_created', 'Record', 'Sort by creation date')}
              {shownCols.map((c) => <th key={c.name} className="sortable" onClick={() => setSort((s) => ({ key: c.name, dir: s.key === c.name ? (s.dir === 1 ? -1 : 1) : 1 }))} title={c.name}>
                {c.label || c.name}{sort.key === c.name && <Icon name={sort.dir === 1 ? 'arrow-up' : 'arrow-down'} />}
              </th>)}
              {th('_answered', 'Answered')}
              {th('_status', 'Status')}
              {th('_updated', 'Last change')}
              {th('_sync', 'Sync')}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.uuid} className="click" onClick={() => openEditor({ project: project.uuid, record: r.uuid, form: r.form })} title="Open record">
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="accent-[var(--rh-brand)]" checked={selected.has(r.uuid)} onChange={() => toggleOne(r.uuid)} aria-label="Select record" /></td>
                <td><span className="idchip">{r.uuid.slice(0, 8)}</span></td>
                {shownCols.map((c, i) => {
                  const v = r.data[c.name];
                  const txt = c.type === 'file' ? (isAnswered(v) ? '📎 file' : '') : labels ? displayValue(c, v) : codeValue(v);
                  return <td key={c.name} className={i === 0 ? 'link' : ['integer', 'decimal', 'number', 'calculated'].includes(c.type) ? 'numc' : ''} title={txt}>{txt}</td>;
                })}
                <td className="muted num">{Object.values(r.data).filter(isAnswered).length}/{answerable}</td>
                <td><StatusChip status={r.status} /></td>
                <td className="muted">{shortDate(r.updated_at)}</td>
                <td><SyncChip dirty={r.dirty} error={r.sync_error} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.data && !view.length && (
          <Empty icon={search || filter !== 'all' ? 'search' : 'inbox'} title={search || filter !== 'all' ? 'No record matches' : 'No records yet'}>
            {search || filter !== 'all' ? <button className="btn" onClick={() => { setSearch(''); setFilter('all'); }}>Clear search and filters</button>
              : canAdd ? <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })}><Icon name="plus-lg" />Enter the first record</button> : null}
          </Empty>
        )}
      </div>

      {rows.length > PAGE && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span className="muted">{page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length.toLocaleString()}</span>
          <button className="btn btn-sm btn-icon" disabled={page === 0} onClick={() => setPage(0)} aria-label="First page"><Icon name="chevron-double-left" /></button>
          <button className="btn btn-sm btn-icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><Icon name="chevron-left" /></button>
          <b className="ink">Page {page + 1} / {pages}</b>
          <button className="btn btn-sm btn-icon" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><Icon name="chevron-right" /></button>
          <button className="btn btn-sm btn-icon" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page"><Icon name="chevron-double-right" /></button>
        </div>
      )}
    </div>
  );
}
