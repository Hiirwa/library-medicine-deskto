import { useDeferredValue, useMemo, useState } from 'react';
import { Empty, Icon, PageHead, PageSkeleton, Stat } from '../components/ui';
import { HBars, HistogramChart } from '../components/charts';
import { saveCsv } from '../lib/csv';
import { plural, TYPE_ICON, TYPE_LABEL } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { addPin } from '../lib/pins';
import { answeredCount, describe, fmt, frequencies, histogram, kindOf, numbersOf, pct, type Kind } from '../lib/stats';
import { isAnswered } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import type { LocalRecord, Variable } from '../lib/types';
import type { ProjectCtx } from './ProjectView';
import { WebLink } from '../components/WebLink';

const KIND_LABEL: Record<Kind, string> = { numeric: 'Numeric', categorical: 'Categorical', date: 'Date / time', text: 'Text' };
const KIND_ICON: Record<Kind, string> = { numeric: '123', categorical: 'ui-radios', date: 'calendar3', text: 'fonts' };

interface Row { v: Variable; kind: Kind; n: number; missing: number; summary: string }

function summarise(v: Variable, kind: Kind, recs: LocalRecord[]): string {
  if (kind === 'numeric') { const d = describe(numbersOf(recs, v)); return d ? `mean ${fmt(d.mean)} · SD ${fmt(d.sd)} · range ${fmt(d.min)}–${fmt(d.max)}` : '—'; }
  if (kind === 'categorical') { const f = frequencies(recs, v); const t = f.rows.reduce((a, b) => (b.n > a.n ? b : a), f.rows[0]); return t ? `most common: ${t.label} (${t.pct.toFixed(0)}%)` : '—'; }
  const vals = recs.map((r) => r.data[v.name]).filter(isAnswered).map(String);
  if (!vals.length) return '—';
  if (kind === 'date') { const s = [...vals].sort(); return `${s[0].slice(0, 10)} → ${s[s.length - 1].slice(0, 10)}`; }
  return `${new Set(vals).size.toLocaleString()} distinct values`;
}

/** Descriptive statistics for every variable: completeness, summary, and a profile with the distribution. */
export function StatisticsView({ project, vars }: ProjectCtx) {
  const { toast } = useSession();
  const records = useRecords(project.uuid);
  const [scope, setScope] = useState<'all' | 'complete'>('all');
  const [qRaw, setQ] = useState('');
  const q = useDeferredValue(qRaw);
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: 'label' | 'n' | 'missing' | 'kind'; dir: 1 | -1 } | null>(null);
  const hidePii = !project.can.pii;

  const recs = useMemo(() => (records.data ?? []).filter((r) => scope === 'all' || r.status === 'complete'), [records.data, scope]);
  const rows = useMemo<Row[]>(() => vars
    .filter((v) => !['note', 'file', 'gps'].includes(v.type) && !(hidePii && v.is_pii))
    .map((v) => { const kind = kindOf(v, recs); const n = answeredCount(recs, v); return { v, kind, n, missing: recs.length - n, summary: summarise(v, kind, recs) }; }), [vars, recs, hidePii]);
  const filtered = rows.filter((r) => (kindFilter === 'all' || r.kind === kindFilter) && (!q.trim() || `${r.v.name} ${r.v.label ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const list = useMemo(() => {
    if (!sort) return filtered;
    const val = (r: Row) => (sort.key === 'label' ? (r.v.label || r.v.name).toLowerCase() : sort.key === 'kind' ? r.kind : sort.key === 'n' ? r.n : r.missing);
    return [...filtered].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [filtered, sort]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = list.findIndex((r) => r.v.name === sel);
    const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { setSel(n.v.name); document.getElementById(`st-${n.v.name}`)?.scrollIntoView({ block: 'nearest' }); }
  };
  const sh = (key: NonNullable<typeof sort>['key'], label: string, cls = '') => <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s?.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))} aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{label}{sort?.key === key && <Icon name={sort.dir === 1 ? 'arrow-up' : 'arrow-down'} />}</th>;
  const current = rows.find((r) => r.v.name === sel) ?? null;
  const avgComplete = rows.length && recs.length ? rows.reduce((a, r) => a + r.n / recs.length, 0) / rows.length : 0;
  const gaps = rows.filter((r) => recs.length && r.missing / recs.length > 0.2).length;

  async function exportStats() {
    try {
      const path = await saveCsv(`${project.title} - statistics`, [['variable', 'label', 'type', 'valid_n', 'missing_n', 'missing_pct', 'summary'], ...rows.map((r) => [r.v.name, r.v.label ?? '', TYPE_LABEL[r.v.type] ?? r.v.type, r.n, r.missing, recs.length ? ((r.missing / recs.length) * 100).toFixed(1) : '', r.summary])]);
      if (path) toast(`Statistics saved to ${path}`);
    } catch (e) { toast(`Export failed: ${String(e)}`, 'error'); }
  }

  if (records.isLoading) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      <PageHead icon="calculator" title="Statistics" sub={<>{plural(recs.length, 'record')} analysed · {plural(rows.length, 'variable')} · calculated on this computer</>}>
        <div className="seg"><button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}><Icon name="collection" />All records</button><button className={scope === 'complete' ? 'on' : ''} onClick={() => setScope('complete')}><Icon name="check2-circle" />Complete only</button></div>
        <WebLink project={project.uuid} tab="statistics" />
        <button className="btn" onClick={exportStats}><Icon name="filetype-csv" />Export table</button>
      </PageHead>
      <div className="stats">
        <Stat icon="database" value={recs.length} label="Records analysed" tone="k-teal" />
        <Stat icon="123" value={rows.filter((r) => r.kind === 'numeric').length} label="Numeric" />
        <Stat icon="ui-radios" value={rows.filter((r) => r.kind === 'categorical').length} label="Categorical" tone="k-teal" />
        <Stat icon="clipboard-check" value={`${Math.round(avgComplete * 100)}%`} label="Average completeness" tone="k-ok" />
        <Stat icon="exclamation-triangle" value={gaps} label="With over 20% missing" tone={gaps ? 'k-warn' : 'k-muted'} />
      </div>
      {!recs.length ? <div className="card"><Empty icon="calculator" title="Nothing to analyse yet"><span>Statistics appear as soon as records exist on this computer.</span></Empty></div> : (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 25rem' }}>
          <div className="space-y-3">
            <div className="toolbar">
              <div className="field-ic min-w-[14rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search variables…" value={qRaw} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></div>
              <div className="seg">{(['all', 'numeric', 'categorical', 'date', 'text'] as const).map((k) => <button key={k} className={kindFilter === k ? 'on' : ''} onClick={() => setKindFilter(k)}>{k === 'all' ? 'All' : KIND_LABEL[k]}</button>)}</div>
            </div>
            <div className="tbl-wrap anim-in" tabIndex={0} onKeyDown={onKey} aria-label="Variables (use the arrow keys to move)" style={{ maxHeight: 'calc(100vh - 25rem)', minHeight: '14rem' }}>
              <table className="tbl">
                <thead><tr>{sh('label', 'Variable')}{sh('kind', 'Type')}{sh('n', 'Valid', 'numc')}{sh('missing', 'Missing')}<th>Summary</th></tr></thead>
                <tbody>
                  {list.map((r) => {
                    const mp = recs.length ? (r.missing / recs.length) * 100 : 0;
                    return (
                      <tr key={r.v.name} id={`st-${r.v.name}`} className={`click ${sel === r.v.name ? 'sel' : ''}`} onClick={() => setSel(r.v.name)}>
                        <td className="link" title={r.v.name}>{r.v.label || r.v.name}</td>
                        <td><span className="chip chip-brand"><Icon name={TYPE_ICON[r.v.type] ?? KIND_ICON[r.kind]} />{KIND_LABEL[r.kind]}</span></td>
                        <td className="numc">{r.n.toLocaleString()}</td>
                        <td><div className={`flex items-center gap-2 ${mp > 40 ? 'k-danger' : mp > 20 ? 'k-warn' : 'k-ok'}`}><div className="bar flex-1"><i style={{ width: `${Math.max(mp, 2)}%` }} /></div><b className="num text-sm" style={{ color: 'var(--k)' }}>{mp.toFixed(0)}%</b></div></td>
                        <td className="muted" title={r.summary}>{r.summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!list.length && <Empty icon="search" title="No variable matches" />}
              {list.length > 0 && <p className="help px-4 py-2"><Icon name="keyboard" className="mr-1" />Click a row, then use ↑ ↓ to move through the variables.</p>}
            </div>
          </div>
          <aside className="card p-5 anim-in sticky top-0">
            {current ? <Profile row={current} recs={recs} onPin={(p) => { const n = addPin(project.uuid, p); toast(`Pinned to the report (${n} pinned).`); }} />
              : <Empty icon="cursor" title="Select a variable"><span>Click a row to see its distribution, quartiles and frequencies.</span></Empty>}
          </aside>
        </div>
      )}
    </div>
  );
}

function Profile({ row, recs, onPin }: { row: Row; recs: LocalRecord[]; onPin: (p: { title: string; subtitle?: string; head: string[]; rows: (string | number)[][] }) => void }) {
  const { v, kind } = row;
  const nums = kind === 'numeric' ? numbersOf(recs, v) : [];
  const d = kind === 'numeric' ? describe(nums) : null;
  const f = kind === 'categorical' ? frequencies(recs, v) : null;
  const text = kind === 'text' || kind === 'date' ? (() => { const m = new Map<string, number>(); for (const r of recs) { const x = r.data[v.name]; if (isAnswered(x)) m.set(String(x), (m.get(String(x)) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8); })() : [];

  const table: { head: string[]; rows: (string | number)[][] } = d
    ? { head: ['Statistic', 'Value'], rows: [['Valid (n)', d.n], ['Missing', row.missing], ['Mean', +d.mean.toFixed(3)], ['Std. deviation', +d.sd.toFixed(3)], ['Minimum', d.min], ['25th percentile', +d.q1.toFixed(3)], ['Median', +d.median.toFixed(3)], ['75th percentile', +d.q3.toFixed(3)], ['Maximum', d.max], ['Outliers (1.5 × IQR)', d.outliers]] }
    : f ? { head: ['Answer', 'n', '%'], rows: f.rows.map((x) => [x.label, x.n, +x.pct.toFixed(1)]) }
      : { head: ['Value', 'n'], rows: text.map(([k, n]) => [k, n]) };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="ph-ic" style={{ width: '2.8rem', height: '2.8rem', fontSize: '1.25rem' }}><Icon name={TYPE_ICON[v.type] ?? KIND_ICON[kind]} /></span>
        <div className="min-w-0"><h3 className="text-lg">{v.label || v.name}</h3><div className="muted text-sm selectable">{v.name} · {TYPE_LABEL[v.type] ?? v.type}</div></div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="well px-3 py-2"><b className="num block text-lg ink">{row.n.toLocaleString()}</b><span className="muted text-xs font-bold uppercase">Valid</span></div>
        <div className="well px-3 py-2"><b className="num block text-lg ink">{row.missing.toLocaleString()}</b><span className="muted text-xs font-bold uppercase">Missing</span></div>
        <div className="well px-3 py-2"><b className="num block text-lg ink">{pct(row.n, recs.length, 0)}</b><span className="muted text-xs font-bold uppercase">Answered</span></div>
      </div>
      {d && (<>
        <div><span className="label-cap">Distribution</span><HistogramChart bins={histogram(nums)} /></div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[['Mean', fmt(d.mean)], ['Median', fmt(d.median)], ['Std. deviation', fmt(d.sd)], ['Std. error', fmt(d.sem)], ['Min – Max', `${fmt(d.min)} – ${fmt(d.max)}`], ['Q1 – Q3', `${fmt(d.q1)} – ${fmt(d.q3)}`], ['Sum', fmt(d.sum)], ['Outliers', String(d.outliers)]].map(([k, x]) => <div key={k} className="well flex justify-between gap-2 px-3 py-2"><span className="muted">{k}</span><b className="num ink">{x}</b></div>)}
        </div>
      </>)}
      {f && (<div><span className="label-cap">Frequencies</span><HBars data={f.rows.slice(0, 12).map((x) => ({ label: x.label, value: x.n, note: `${x.pct.toFixed(0)}%` }))} /></div>)}
      {!!text.length && (<div><span className="label-cap">Most common values</span><div className="space-y-1.5 text-sm">{text.map(([k, n]) => <div key={k} className="well flex justify-between gap-3 px-3 py-2"><span className="truncate" title={k}>{k}</span><b className="num ink">{n}</b></div>)}</div></div>)}
      <button className="btn w-full" onClick={() => onPin({ title: `Profile: ${v.label || v.name}`, subtitle: `${recs.length} records`, ...table })}><Icon name="pin-angle" />Pin to report</button>
    </div>
  );
}
