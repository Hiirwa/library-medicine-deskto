import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState, type ReactNode } from 'react';
import { Empty, Icon, PageHead, PageSkeleton } from '../components/ui';
import { Donut, HBars, PALETTE, Scatter } from '../components/charts';
import { useLocal } from '../lib/useLocal';
import { saveCsv } from '../lib/csv';
import { displayValue, isAnswered, plural } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { addPin } from '../lib/pins';
import { chiSquare, compareGroups, describe, fmt, fmtP, frequencies, groupKey, kindOf, numbersOf, pearson, strength, verdict } from '../lib/stats';
import { useSession } from '../providers/AppProvider';
import { openUrl } from '@tauri-apps/plugin-opener';
import { webUrl } from '../lib/access';
import { native } from '../lib/native';
import type { Variable } from '../lib/types';
import type { ProjectCtx } from './ProjectView';
import { WebLink } from '../components/WebLink';

type Kindof = 'freq' | 'desc' | 'cross' | 'means' | 'corr';
const TYPES: { id: Kindof; icon: string; title: string; text: string }[] = [
  { id: 'freq', icon: 'bar-chart-steps', title: 'Frequencies', text: 'Counts and percentages of each answer' },
  { id: 'desc', icon: 'rulers', title: 'Descriptives', text: 'Mean, SD, quartiles of several numbers' },
  { id: 'cross', icon: 'grid-3x3-gap', title: 'Cross-tabulation', text: 'Two questions against each other, with χ² test' },
  { id: 'means', icon: 'columns-gap', title: 'Compare groups', text: 'A number by group, with one-way ANOVA' },
  { id: 'corr', icon: 'graph-up', title: 'Correlation', text: 'Two numbers: Pearson r and regression line' },
];

interface Result { title: string; subtitle?: string; head: string[]; rows: (string | number)[][]; notes: string[]; tiles?: [string, string][]; chart?: ReactNode }

const labelFor = (v: Variable, key: string) => (v.type === 'checkbox' && key.includes(';') ? key.split(';').map((k) => displayValue(v, k) || k).join(', ') : displayValue(v, key) || key);

function StackedBars({ rows, cols }: { rows: { label: string; counts: number[] }[]; cols: string[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const t = r.counts.reduce((a, b) => a + b, 0) || 1;
        return (
          <div key={r.label} className="hb">
            <span className="hb-l truncate" title={r.label}>{r.label}</span>
            <span className="hb-t" style={{ display: 'flex' }}>{r.counts.map((c, i) => c ? <i key={i} style={{ width: `${(c / t) * 100}%`, background: PALETTE[i % PALETTE.length], borderRadius: 0 }} title={`${cols[i]}: ${c} (${((c / t) * 100).toFixed(0)}%)`} /> : null)}</span>
            <b className="num">{t}</b>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 pt-1 text-sm">{cols.map((c, i) => <span key={c} className="inline-flex items-center gap-1.5"><i style={{ width: '.7rem', height: '.7rem', borderRadius: '.25rem', background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />{c}</span>)}</div>
    </div>
  );
}

/** Build an analysis by choosing a method and variables; the result updates as you change them. */
function LocalWorkbench({ project, vars, onLive }: ProjectCtx & { onLive?: () => void }) {
  const { toast } = useSession();
  const records = useRecords(project.uuid);
  const hidePii = !project.can.pii;
  const [type, setType] = useState<Kindof>('freq');
  const [scope, setScope] = useState<'all' | 'complete'>('all');
  const [hist, setHist] = useLocal<{ type: Kindof; n1: string; n2: string; scope: 'all' | 'complete' }[]>(`lm_wb_hist_${project.uuid}`, []);
  const [pie, setPie] = useState(false);
  const [n1, setN1] = useState(''); const [n2, setN2] = useState(''); const [multi, setMulti] = useState<string[] | null>(null);

  const recs = useMemo(() => (records.data ?? []).filter((r) => scope === 'all' || r.status === 'complete'), [records.data, scope]);
  const usable = useMemo(() => vars.filter((v) => !['note', 'file', 'gps'].includes(v.type) && !(hidePii && v.is_pii)).map((v) => ({ v, kind: kindOf(v, records.data ?? []) })), [vars, hidePii, records.data]);
  const cats = usable.filter((x) => x.kind === 'categorical').map((x) => x.v);
  const nums = usable.filter((x) => x.kind === 'numeric').map((x) => x.v);
  const any = usable.map((x) => x.v);

  const pool1 = type === 'freq' ? any : type === 'cross' || type === 'means' ? cats : nums;
  const pool2 = type === 'cross' ? cats : type === 'means' || type === 'corr' ? nums : [];
  const a = pool1.find((v) => v.name === n1) ?? pool1[0];
  const b = pool2.find((v) => v.name === n2 && v.name !== a?.name) ?? pool2.find((v) => v.name !== a?.name);
  const chosen = multi ?? nums.slice(0, 6).map((v) => v.name);

  const result = useMemo<Result | null>(() => {
    if (!recs.length) return null;
    const sub = `${plural(recs.length, 'record')}${scope === 'complete' ? ' (complete only)' : ''}`;
    if (type === 'freq' && a) {
      const f = frequencies(recs, a); const rows = f.rows.slice(0, 40); let cum = 0;
      return { title: `Frequencies: ${a.label || a.name}`, subtitle: sub, head: ['Answer', 'n', '%', 'Cumulative %'], rows: rows.map((x) => { cum += x.pct; return [x.label, x.n, +x.pct.toFixed(1), +cum.toFixed(1)]; }),
        tiles: [['Valid', String(f.answered)], ['Missing', String(recs.length - f.answered)], ['Distinct answers', String(f.rows.length)]], notes: f.rows.length > 40 ? [`Showing the 40 most frequent of ${f.rows.length} answers.`] : [],
        chart: pie && rows.length <= 10 ? <Donut sub="answers" data={rows.map((x) => ({ label: x.label, value: x.n }))} /> : <HBars data={rows.slice(0, 12).map((x) => ({ label: x.label, value: x.n, note: `${x.pct.toFixed(0)}%` }))} /> };
    }
    if (type === 'desc') {
      const list = nums.filter((v) => chosen.includes(v.name));
      const rows = list.map((v) => { const d = describe(numbersOf(recs, v)); return [v.label || v.name, d?.n ?? 0, recs.length - (d?.n ?? 0), d ? +d.mean.toFixed(2) : '—', d ? +d.sd.toFixed(2) : '—', d?.min ?? '—', d ? +d.q1.toFixed(2) : '—', d ? +d.median.toFixed(2) : '—', d ? +d.q3.toFixed(2) : '—', d?.max ?? '—'] as (string | number)[]; });
      return { title: 'Descriptive statistics', subtitle: sub, head: ['Variable', 'n', 'Missing', 'Mean', 'SD', 'Min', 'Q1', 'Median', 'Q3', 'Max'], rows, notes: [], tiles: [['Variables', String(list.length)], ['Records', String(recs.length)]] };
    }
    if (type === 'cross' && a && b) {
      const rk = new Map<string, Map<string, number>>(); const ck = new Set<string>();
      for (const r of recs) { const x = groupKey(a, r.data[a.name]); const y = groupKey(b, r.data[b.name]); if (!x || !y) continue; ck.add(y); if (!rk.has(x)) rk.set(x, new Map()); rk.get(x)!.set(y, (rk.get(x)!.get(y) ?? 0) + 1); }
      const colKeys = [...ck].sort(); const rowKeys = [...rk.keys()].sort();
      if (rowKeys.length < 1 || colKeys.length < 1) return { title: 'Cross-tabulation', subtitle: sub, head: [], rows: [], notes: ['No record answered both questions.'] };
      const table = rowKeys.map((x) => colKeys.map((y) => rk.get(x)?.get(y) ?? 0));
      const totals = colKeys.map((_, j) => table.reduce((s, r) => s + r[j], 0)); const N = totals.reduce((s, x) => s + x, 0);
      const chi = chiSquare(table);
      const rows = rowKeys.map((x, i) => { const t = table[i].reduce((s, z) => s + z, 0); return [labelFor(a, x), ...table[i].map((c) => `${c} (${t ? ((c / t) * 100).toFixed(0) : 0}%)`), t]; });
      rows.push(['Total', ...totals.map((t) => `${t} (${N ? ((t / N) * 100).toFixed(0) : 0}%)`), N]);
      const notes = chi ? [`χ²(${chi.df}) = ${fmt(chi.chi2)}, p = ${fmtP(chi.p)}; Cramér’s V = ${fmt(chi.v, 3)}. ${verdict(chi.p)}`, ...(chi.lowCells / chi.cells > 0.2 ? [`${chi.lowCells} of ${chi.cells} cells have an expected count below 5, so the χ² test may be unreliable.`] : [])] : ['A test needs at least two rows and two columns.'];
      return { title: `${a.label || a.name} × ${b.label || b.name}`, subtitle: `${N} records answered both · percentages are of each row`, head: [a.label || a.name, ...colKeys.map((y) => labelFor(b, y)), 'Total'], rows, notes,
        tiles: chi ? [['χ²', fmt(chi.chi2)], ['p-value', fmtP(chi.p)], ['Cramér’s V', fmt(chi.v, 3)]] : undefined,
        chart: <StackedBars rows={rowKeys.map((x, i) => ({ label: labelFor(a, x), counts: table[i] }))} cols={colKeys.map((y) => labelFor(b, y))} /> };
    }
    if (type === 'means' && a && b) {
      const g = new Map<string, number[]>();
      for (const r of recs) { const k = groupKey(a, r.data[a.name]); const y = Number(r.data[b.name]); if (!k || !isAnswered(r.data[b.name]) || !Number.isFinite(y)) continue; if (!g.has(k)) g.set(k, []); g.get(k)!.push(y); }
      const cmp = compareGroups([...g.entries()].map(([key, values]) => ({ key, label: labelFor(a, key), values })));
      const notes = cmp.anova ? [`One-way ANOVA: F(${cmp.anova.df1}, ${cmp.anova.df2}) = ${fmt(cmp.anova.f)}, p = ${fmtP(cmp.anova.p)}; η² = ${fmt(cmp.anova.eta2, 3)}. ${verdict(cmp.anova.p)}`] : ['A test needs at least two groups with data and some spread.'];
      return { title: `${b.label || b.name} by ${a.label || a.name}`, subtitle: sub, head: ['Group', 'n', 'Mean', 'SD', 'Min', 'Max'], rows: cmp.rows.map((r) => [r.label, r.n, +r.mean.toFixed(2), +r.sd.toFixed(2), r.min, r.max]), notes,
        tiles: cmp.anova ? [['F', fmt(cmp.anova.f)], ['p-value', fmtP(cmp.anova.p)], ['η²', fmt(cmp.anova.eta2, 3)]] : undefined,
        chart: cmp.rows.length ? <HBars data={cmp.rows.map((r) => ({ label: r.label, value: r.mean, note: `n=${r.n}` }))} /> : undefined };
    }
    if (type === 'corr' && a && b) {
      const xs: number[] = []; const ys: number[] = [];
      for (const r of recs) { if (!isAnswered(r.data[a.name]) || !isAnswered(r.data[b.name])) continue; const x = Number(r.data[a.name]); const y = Number(r.data[b.name]); if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } }
      const c = pearson(xs, ys);
      if (!c) return { title: 'Correlation', subtitle: sub, head: [], rows: [], notes: ['At least 3 records with both numbers and some variation are needed.'] };
      const pts = xs.map((x, i) => ({ x, y: ys[i] })).slice(0, 800);
      return { title: `${a.label || a.name} and ${b.label || b.name}`, subtitle: `${c.n} pairs`, head: ['Statistic', 'Value'],
        rows: [['Pairs (n)', c.n], ['Pearson r', +c.r.toFixed(3)], ['R²', +c.r2.toFixed(3)], ['p-value', fmtP(c.p)], ['Slope', +c.slope.toFixed(4)], ['Intercept', +c.intercept.toFixed(4)]],
        notes: [`A ${strength(c.r)} ${c.r >= 0 ? 'positive' : 'negative'} relationship (r = ${fmt(c.r, 3)}). ${verdict(c.p)}`, `Fitted line: ${b.label || b.name} = ${fmt(c.intercept, 3)} + ${fmt(c.slope, 3)} × ${a.label || a.name}`, 'Correlation does not prove that one causes the other.'],
        tiles: [['r', fmt(c.r, 3)], ['R²', fmt(c.r2, 3)], ['p-value', fmtP(c.p)]],
        chart: <Scatter points={pts} line={c} xLabel={a.label || a.name} yLabel={b.label || b.name} /> };
    }
    return null;
  }, [recs, type, a, b, chosen.join('|'), scope, nums, pie]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = () => { if (!a || type === 'desc') return; const e = { type, n1: a.name, n2: b?.name ?? '', scope }; setHist([e, ...hist.filter((h) => JSON.stringify(h) !== JSON.stringify(e))].slice(0, 6)); };
  const swap = () => { if (type === 'cross' && a && b) { setN1(b.name); setN2(a.name); } };
  const toText = (r: Result) => [r.head.join('\t'), ...r.rows.map((x) => x.join('\t'))].join('\n');
  const copy = async (r: Result) => { try { await navigator.clipboard.writeText(`${r.title}\n${toText(r)}`); toast('Table copied. Paste it into Excel or Word.'); } catch { toast('Could not copy.', 'error'); } };
  const csv = async (r: Result) => { try { const p = await saveCsv(`${project.title} - ${r.title}`, [r.head, ...r.rows]); if (p) toast(`Saved to ${p}`); } catch (e) { toast(String(e), 'error'); } };
  const pin = (r: Result) => { remember(); const n = addPin(project.uuid, { title: r.title, subtitle: r.subtitle, head: r.head, rows: r.rows, notes: r.notes }); toast(`Pinned to the report (${n} pinned).`); };

  const need = type === 'cross' || type === 'means' || type === 'corr' ? (pool1.length && pool2.length ? '' : type === 'cross' ? 'Cross-tabulation needs two multiple-choice questions.' : type === 'means' ? 'Comparing groups needs one multiple-choice question and one numeric question.' : 'Correlation needs two numeric questions.') : type === 'desc' && !nums.length ? 'This project has no numeric questions.' : !pool1.length ? 'No suitable questions in this project.' : '';

  if (records.isLoading) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      <PageHead icon="bezier2" title="Workbench" sub="Build an analysis, read the result, then pin it to a report">{onLive && <button className="btn" onClick={onLive}><Icon name="broadcast" />Live from website</button>}<WebLink project={project.uuid} tab="workbench" /></PageHead>
      <StickyColumns className="grid items-start gap-4" style={{ gridTemplateColumns: '23rem minmax(0, 1fr)' }}>
        <aside className="card space-y-4 p-5 anim-in">
          <div><span className="label-cap">1 · Method</span>
            <div className="space-y-2">{TYPES.map((t) => (
              <button key={t.id} type="button" className={`pick ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)} aria-pressed={type === t.id}>
                <span className="pk-ic"><Icon name={t.icon} /></span><span className="min-w-0 text-left"><b className="ink block">{t.title}</b><small className="muted">{t.text}</small></span>
              </button>))}</div>
          </div>
          <div><span className="label-cap">2 · Variables</span>
            {type === 'desc' ? (
              <div className="well max-h-56 space-y-1 overflow-y-auto p-2">
                {nums.map((v) => <label key={v.name} className="mi flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={chosen.includes(v.name)} onChange={(e) => setMulti(e.target.checked ? [...chosen, v.name] : chosen.filter((x) => x !== v.name))} /><span className="truncate">{v.label || v.name}</span></label>)}
                {!nums.length && <p className="muted p-2 text-sm">No numeric questions.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <div><label className="label" htmlFor="wb1">{type === 'cross' ? 'Rows' : type === 'means' ? 'Group by' : type === 'corr' ? 'X (predictor)' : 'Question'}</label>
                  <select id="wb1" className="field" value={a?.name ?? ''} onChange={(e) => setN1(e.target.value)}>{pool1.map((v) => <option key={v.name} value={v.name}>{v.label || v.name}</option>)}</select></div>
                {type === 'cross' && b && <button type="button" className="btn btn-sm" onClick={swap}><Icon name="arrow-down-up" />Swap rows and columns</button>}
                {pool2.length > 0 && <div><label className="label" htmlFor="wb2">{type === 'cross' ? 'Columns' : type === 'means' ? 'Numeric outcome' : 'Y (outcome)'}</label>
                  <select id="wb2" className="field" value={b?.name ?? ''} onChange={(e) => setN2(e.target.value)}>{pool2.filter((v) => v.name !== a?.name).map((v) => <option key={v.name} value={v.name}>{v.label || v.name}</option>)}</select></div>}
              </div>
            )}
          </div>
          {hist.length > 0 && <div><span className="label-cap">Recent analyses</span><div className="flex flex-wrap gap-1.5">{hist.map((h, i) => { const v = vars.find((x) => x.name === h.n1); return <button key={i} className="hist-chip" onClick={() => { setType(h.type); setN1(h.n1); setN2(h.n2); setScope(h.scope); }} title="Run again"><Icon name={TYPES.find((t) => t.id === h.type)?.icon ?? 'dot'} />{v?.label || h.n1}</button>; })}</div></div>}
          <div><span className="label-cap">3 · Records</span><div className="seg w-full"><button className={`flex-1 ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>All</button><button className={`flex-1 ${scope === 'complete' ? 'on' : ''}`} onClick={() => setScope('complete')}>Complete only</button></div></div>
        </aside>
        <section className="card p-5 anim-in">
          {need ? <Empty icon="info-circle" title="This method is not available here"><span>{need}</span></Empty>
            : !recs.length ? <Empty icon="inbox" title="No records to analyse"><span>Enter or import records first.</span></Empty>
              : !result ? <Empty icon="hourglass-split" title="Choose variables" />
                : (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1"><h2 className="text-xl">{result.title}</h2>{result.subtitle && <div className="muted text-sm">{result.subtitle}</div>}</div>
                      <div className="flex flex-wrap gap-2">
                        {type === 'freq' && <div className="seg"><button className={!pie ? 'on' : ''} onClick={() => setPie(false)} aria-label="Bars"><Icon name="bar-chart-steps" /></button><button className={pie ? 'on' : ''} onClick={() => setPie(true)} aria-label="Donut"><Icon name="pie-chart" /></button></div>}
                        <button className="btn btn-sm" onClick={() => copy(result)} disabled={!result.rows.length}><Icon name="clipboard" />Copy</button>
                        <button className="btn btn-sm" onClick={() => csv(result)} disabled={!result.rows.length}><Icon name="filetype-csv" />CSV</button>
                        <button className="btn btn-sm btn-primary" onClick={() => pin(result)} disabled={!result.rows.length}><Icon name="pin-angle" />Pin to report</button>
                      </div>
                    </div>
                    {result.tiles && <div className="stats">{result.tiles.map(([k, v], i) => <div key={k} className={`stat ${i % 2 ? 'k-teal' : ''}`}><span className="ic"><Icon name={['hash', 'activity', 'percent'][i % 3]} /></span><span className="min-w-0"><b>{v}</b><small>{k}</small></span></div>)}</div>}
                    {result.chart && <div className="well p-4">{result.chart}</div>}
                    {result.rows.length > 0 && (
                      <div className="tbl-wrap" style={{ maxHeight: '22rem' }}>
                        <table className="tbl compact">
                          <thead><tr>{result.head.map((h, i) => <th key={i} className={i ? 'numc' : ''}>{h}</th>)}</tr></thead>
                          <tbody>{result.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'numc' : 'link'}>{typeof c === 'number' ? c.toLocaleString() : c}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {result.notes.map((n, i) => <div key={i} className="notice info"><Icon name="lightbulb" /><span>{n}</span></div>)}
                  </div>
                )}
        </section>
      </StickyColumns>
    </div>
  );
}


/** Online: the live Workbench from the website. Offline (or if the person prefers): the local one that runs on this computer. */
export function WorkbenchView(ctx: ProjectCtx) {
  const { project } = ctx;
  const { online, server, toast } = useSession();
  const [pref, setPref] = useLocal<'live' | 'local'>('lm_wb_mode', 'live');
  const [opened, setOpened] = useState(false);
  const url = webUrl(server, project.uuid, 'workbench');
  const openLive = () => native.openWebWindow(url, 'Workbench · Library Medicine').then(() => setOpened(true)).catch(() => { toast('Could not open the live Workbench here. Opening in your browser instead.', 'error'); openUrl(url).catch(() => undefined); });
  if (!online || pref === 'local') return <LocalWorkbench {...ctx} onLive={online ? () => setPref('live') : undefined} />;
  return (
    <div className="flex h-full min-h-[34rem] flex-col gap-3">
      <PageHead icon="bezier2" title="Workbench" sub="Live from librarymedicine.online">
        <button className="btn" onClick={() => setPref('local')}><Icon name="pc-display" />Use offline workbench</button>
        <button className="btn" onClick={() => openUrl(url).catch(() => toast('Could not open the website.', 'error'))}><Icon name="box-arrow-up-right" />Open in browser</button>
      </PageHead>
      <div className="card live-frame">
        <div className="live-loading">
          <span className="pk-ic"><Icon name="bezier2" /></span>
          <b className="ink text-lg">Live Workbench</b>
          <span className="text-sm">Opens the real Workbench from the website in its own window, already signed in to your connected account.</span>
          <button className="btn btn-primary" onClick={openLive}><Icon name="window-stack" />{opened ? 'Reopen live Workbench' : 'Open live Workbench'}</button>
        </div>
      </div>
      <p className="muted text-sm">The first time, sign in to the website in that window. Use <b>Open in browser</b> if you prefer your normal browser.</p>
    </div>
  );
}
