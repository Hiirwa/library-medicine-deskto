import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown, Empty, Icon, PageHead, Stat, StatusChip, SyncChip } from '../components/ui';
import * as store from '../lib/db';
import { recordsTable, saveCsv } from '../lib/csv';
import { codeValue, displayValue, isAnswered, plural } from '../lib/format';
import { ago, shortDate } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
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
  const { toast, lastSync } = useSession();
  const { openEditor } = useUi();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [labels, setLabels] = useState(true);
  const [compact, setCompact] = useState(() => ls.get('lm_compact') === '1');
  const [sort, setSort] = useState<SortKey>({ key: '_updated', dir: -1 });
  const [page, setPage] = useState(0);
  const hidePii = !project.can.pii;
  const visibleVars = useMemo(() => vars.filter((v) => !['note'].includes(v.type) && !(hidePii && v.is_pii)), [vars, hidePii]);
  const colKey = `lm_cols_${project.uuid}`;
  const [cols, setCols] = useState<string[]>(() => {
    try { const c = JSON.parse(ls.get(colKey) ?? 'null') as string[] | null; if (c?.length) return c; } catch { /* default */ }
    return visibleVars.filter((v) => !['file', 'textarea'].includes(v.type)).slice(0, 6).map((v) => v.name);
  });
  useEffect(() => { ls.set(colKey, JSON.stringify(cols)); }, [cols, colKey]);
  useEffect(() => { setPage(0); }, [search, filter, sort]);

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
  }, [all.data, filter, search, sort, labels, byName, visibleVars, startToday]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const canAdd = project.can.add && project.status === 'active';

  async function exportCsv(withLabels: boolean, onlyShown: boolean) {
    try {
      const data = onlyShown ? rows : all.data ?? [];
      const path = await saveCsv(`${project.title} - records`, recordsTable(data, vars, { labels: withLabels, hidePii }));
      if (path) toast(`Exported ${plural(data.length, 'record')} to ${path}`);
    } catch (e) {
      toast(`Export failed: ${String(e)}`, 'error');
    }
  }

  const th = (key: string, label: string, title?: string) => (
    <th className="sortable" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} title={title ?? `Sort by ${label}`}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.key === key && <Icon name={sort.dir === 1 ? 'arrow-up' : 'arrow-down'} />}
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHead icon="table" title="Data" sub={<>{plural(counts.all, 'record')} · updated {ago(lastSync)}</>}>
        {canAdd && (forms.length > 1 ? (
          <Dropdown button={(_o, t) => <button className="btn btn-primary" onClick={t}><Icon name="plus-lg" />New record<Icon name="chevron-down" /></button>}>
            {(close) => (<>
              <div className="mh">Choose a form</div>
              {forms.map((f) => <button key={f.uuid} onClick={() => { close(); openEditor({ project: project.uuid, record: null, form: f.uuid }); }}><Icon name="ui-checks-grid" />{f.title}</button>)}
              <hr /><button onClick={() => { close(); openEditor({ project: project.uuid, record: null, form: '__all' }); }}><Icon name="list-ul" />All variables (manual entry)</button>
            </>)}
          </Dropdown>
        ) : <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })} title="New record (Ctrl+N)"><Icon name="plus-lg" />New record</button>)}
        <Dropdown button={(_o, t) => <button className="btn" onClick={t}><Icon name="box-arrow-down" />Export<Icon name="chevron-down" /></button>} width="18rem">
          {(close) => (<>
            <div className="mh">CSV for Excel, SPSS, R, Stata</div>
            <button onClick={() => { close(); exportCsv(true, false); }}><Icon name="filetype-csv" />All records · labels</button>
            <button onClick={() => { close(); exportCsv(false, false); }}><Icon name="123" />All records · codes</button>
            <hr />
            <button disabled={!rows.length} onClick={() => { close(); exportCsv(labels, true); }}><Icon name="funnel" />Only the {plural(rows.length, 'record')} shown</button>
          </>)}
        </Dropdown>
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
          <input id="search" className="field" placeholder="Search all columns…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
          <kbd>/</kbd>
        </div>
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
        <button className="btn" onClick={() => { setSearch(''); setFilter('all'); setSort({ key: '_updated', dir: -1 }); }}><Icon name="funnel" />Reset</button>
      </div>

      <div className="tbl-wrap anim-in" style={{ maxHeight: 'calc(100vh - 21rem)', minHeight: '14rem' }}>
        <table className={`tbl ${compact ? 'compact' : ''}`}>
          <thead>
            <tr>
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
