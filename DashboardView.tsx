import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CardTitle, Dropdown, Empty, Icon, PageHead, PageSkeleton, Stat, Switch } from '../components/ui';
import { AreaChart, Donut, HBars, HistogramChart, Ring } from '../components/charts';
import { isAnswered, plural } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { useLocal } from '../lib/useLocal';
import { describe, fmt, frequencies, histogram, kindOf, numbersOf, perDay } from '../lib/stats';
import { ago } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import type { Variable } from '../lib/types';
import type { ProjectCtx } from './ProjectView';
import { WebLink } from '../components/WebLink';
import { StatusChip, SyncChip } from '../components/ui';

interface Layout { widgets: Record<string, boolean>; charts: string[]; range: 7 | 14 | 30 | 90; auto?: 0 | 30 | 60 }
const WIDGETS: [string, string, string][] = [
  ['kpi', 'speedometer2', 'Key figures'], ['trend', 'graph-up', 'Records over time'], ['status', 'pie-chart', 'Status split'], ['quality', 'shield-check', 'Data quality'],
  ['forms', 'ui-checks-grid', 'Records per form'], ['recent', 'clock-history', 'Recent activity'],
];

/** A live overview of the project; choose which panels to show and add a chart of any question. */
export function DashboardView({ project, vars, forms }: ProjectCtx) {
  const { lastSync, online } = useSession();
  const { go, openEditor } = useUi();
  const qc = useQueryClient();
  const records = useRecords(project.uuid);
  const [layout, setLayout] = useLocal<Layout>(`lm_dash_${project.uuid}`, { widgets: { kpi: true, trend: true, status: true, quality: true, forms: true, recent: true }, charts: [], range: 30 });
  const [stamp, setStamp] = useState(() => new Date());
  const [full, setFull] = useState(false);
  const auto = layout.auto ?? 0;
  useEffect(() => { if (!auto) return; const id = window.setInterval(() => { qc.invalidateQueries(); setStamp(new Date()); }, auto * 1000); return () => window.clearInterval(id); }, [auto, qc]);
  useEffect(() => { const on = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on); }, []);
  const toggleFull = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { /* not available */ } };
  const toData = (f: string) => { try { localStorage.setItem('lm_pending_filter', `${project.uuid}|${f}`); } catch { /* ignore */ } go({ page: 'project', project: project.uuid, tab: 'data' }); };
  const recs = records.data ?? [];
  const on = (id: string) => layout.widgets[id] !== false;
  const hidePii = !project.can.pii;

  const answerable = useMemo(() => vars.filter((v) => !['note', 'calculated', 'file'].includes(v.type) && !(hidePii && v.is_pii)), [vars, hidePii]);
  const stat = useMemo(() => {
    const c = (s: string) => recs.filter((r) => r.status === s).length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const avg = recs.length && answerable.length ? recs.reduce((a, r) => a + answerable.filter((v) => isAnswered(r.data[v.name])).length / answerable.length, 0) / recs.length : 0;
    const req = vars.filter((v) => v.required && v.type !== 'calculated');
    const reqOk = recs.length && req.length ? recs.filter((r) => req.every((v) => isAnswered(r.data[v.name]))).length / recs.length : recs.length ? 1 : 0;
    return { total: recs.length, complete: c('complete'), draft: c('draft'), flagged: c('flagged'), toSend: recs.filter((r) => r.dirty).length, refused: recs.filter((r) => r.sync_error).length, today: recs.filter((r) => new Date(r.created_at) >= today).length, avg, reqOk };
  }, [recs, answerable, vars]);
  const days = useMemo(() => perDay(recs, layout.range), [recs, layout.range]);
  const inRange = days.reduce((a, d) => a + d.n, 0);
  const perForm = useMemo(() => { const m = new Map<string, number>(); for (const r of recs) m.set(r.form ?? '', (m.get(r.form ?? '') ?? 0) + 1); return [...m.entries()].map(([k, n]) => ({ label: forms.find((f) => f.uuid === k)?.title ?? 'All variables', value: n })).sort((a, b) => b.value - a.value); }, [recs, forms]);
  const chartVars = layout.charts.map((n) => vars.find((v) => v.name === n)).filter((v): v is Variable => !!v);
  const addable = answerable.filter((v) => ['categorical', 'numeric'].includes(kindOf(v, recs)) && !layout.charts.includes(v.name));
  const canAdd = project.can.add && project.status === 'active';
  const synced = stat.total ? ((stat.total - stat.toSend) / stat.total) * 100 : 100;

  if (records.isLoading) return <PageSkeleton />;
  return (
    <div className="space-y-4">
      <PageHead icon="pie-chart" title="Dashboard" sub={<>{project.title} · refreshed {ago(stamp.toISOString())} · last sync {ago(lastSync)}</>}>
        <WebLink project={project.uuid} tab="dashboard" />
        <button className="btn" onClick={() => { qc.invalidateQueries(); setStamp(new Date()); }}><Icon name="arrow-clockwise" />Refresh</button>
        <button className={`btn btn-icon fs-btn ${full ? 'on' : ''}`} onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen (for meetings and wall displays)'} aria-label="Toggle full screen"><Icon name={full ? 'fullscreen-exit' : 'arrows-fullscreen'} /></button>
        <Dropdown width="19rem" button={(_o, t) => <button className="btn" onClick={t}><Icon name="sliders" />Customize<Icon name="chevron-down" /></button>}>
          {() => (<>
            <div className="mh">Panels</div>
            {WIDGETS.map(([id, ic, label]) => <div key={id} className="mi flex items-center gap-3 px-3 py-2"><Icon name={ic} /><span className="flex-1">{label}</span><Switch on={on(id)} onChange={(v) => setLayout({ ...layout, widgets: { ...layout.widgets, [id]: v } })} label={label} /></div>)}
            <hr /><div className="mh">Refresh automatically</div>
            <div className="p-2"><div className="seg w-full">{([[0, 'Off'], [30, '30 s'], [60, '1 min']] as const).map(([v, t]) => <button key={v} className={`flex-1 ${auto === v ? 'on' : ''}`} onClick={() => setLayout({ ...layout, auto: v })}>{t}</button>)}</div></div>
            <hr /><div className="mh">Add a chart of a question</div>
            <div className="max-h-56 overflow-y-auto">{addable.map((v) => <button key={v.name} onClick={() => setLayout({ ...layout, charts: [...layout.charts, v.name] })}><Icon name="plus-circle" /><span className="truncate">{v.label || v.name}</span></button>)}{!addable.length && <p className="muted px-3 py-2 text-sm">No more questions to chart.</p>}</div>
          </>)}
        </Dropdown>
        {canAdd && <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })}><Icon name="plus-lg" />New record</button>}
      </PageHead>

      {!recs.length ? <div className="card"><Empty icon="pie-chart" title="The dashboard fills as records arrive"><span>Enter, import or sync records to see charts here.</span></Empty></div> : (<>
        {on('kpi') && (
          <div className="stats">
            <Stat icon="database" value={stat.total} label="Records" tone="k-teal" onClick={() => go({ page: 'project', project: project.uuid, tab: 'data' })} />
            <Stat icon="calendar-check" value={stat.today} label="Today" />
            <Stat icon="check2-circle" value={stat.complete} label="Complete" tone="k-ok" />
            <Stat icon="pencil" value={stat.draft} label="Drafts" tone="k-muted" />
            <Stat icon="send" value={stat.toSend} label="To send" tone="k-warn" onClick={() => go({ page: 'sync' })} />
            <Stat icon="graph-up" value={inRange} label={`Last ${layout.range} days`} />
          </div>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(26rem, 1fr))' }}>
          {on('trend') && (
            <section className="card p-5 anim-in" style={{ gridColumn: 'span 2' }}>
              <CardTitle icon="graph-up" title="Records over time" sub={<><b className="ink">{plural(inRange, 'record')}</b> in the last {layout.range} days</>}>
                <div className="seg light">{([7, 14, 30, 90] as const).map((r) => <button key={r} className={layout.range === r ? 'on' : ''} onClick={() => setLayout({ ...layout, range: r })}>{r}d</button>)}</div>
              </CardTitle>
              <div className="mt-3"><AreaChart data={days} /></div>
            </section>
          )}
          {on('status') && (
            <section className="card p-5 anim-in"><CardTitle icon="pie-chart" tone="k-teal" title="Status of records" sub="Click a slice to open those records" />
              <div className="mt-4"><Donut sub="records" onSlice={(l) => toData(l === 'Complete' ? 'complete' : l === 'Drafts' ? 'draft' : 'flagged')} data={[{ label: 'Complete', value: stat.complete, color: 'var(--rh-success)' }, { label: 'Drafts', value: stat.draft, color: '#64748b' }, { label: 'Flagged', value: stat.flagged, color: 'var(--rh-amber)' }].filter((d) => d.value > 0)} /></div></section>
          )}
          {on('quality') && (
            <section className="card p-5 anim-in"><CardTitle icon="shield-check" tone="k-ok" title="Data quality" sub="Computed from the records on this computer" />
              <div className="mt-4 flex flex-wrap justify-around gap-4">
                <Ring value={stat.avg * 100} label="Questions answered" />
                <Ring value={stat.reqOk * 100} label="Required complete" tone="var(--rh-teal)" />
                <Ring value={synced} label="Already synced" tone={stat.refused ? 'var(--rh-danger)' : 'var(--rh-success)'} />
              </div>
              {stat.refused > 0 && <div className="notice danger mt-4"><Icon name="exclamation-octagon" /><span>{plural(stat.refused, 'record')} refused by the server. Open the Sync centre to read why.</span></div>}
              {!online && <div className="notice warn mt-3"><Icon name="wifi-off" /><span>Offline: figures reflect this computer only.</span></div>}
            </section>
          )}
          {on('forms') && perForm.length > 0 && (
            <section className="card p-5 anim-in"><CardTitle icon="ui-checks-grid" title="Records per form" /><div className="mt-4"><HBars data={perForm} /></div></section>
          )}
          {chartVars.map((v) => <VarChart key={v.name} v={v} recs={recs} onRemove={() => setLayout({ ...layout, charts: layout.charts.filter((x) => x !== v.name) })} />)}
          {on('recent') && (
            <section className="card p-5 anim-in" style={{ gridColumn: 'span 2' }}>
              <CardTitle icon="clock-history" title="Recent activity" sub="Latest changes on this computer" />
              <div className="mt-3 space-y-1.5">
                {[...recs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 7).map((r) => (
                  <button key={r.uuid} className="row-link" onClick={() => openEditor({ project: project.uuid, record: r.uuid, form: r.form })}>
                    <span className="idchip">{r.uuid.slice(0, 8)}</span><StatusChip status={r.status} /><span className="muted flex-1 truncate text-sm">{answerable.slice(0, 3).map((v) => String(r.data[v.name] ?? '')).filter(Boolean).join(' · ')}</span><span className="muted text-sm">{ago(r.updated_at)}</span><SyncChip dirty={r.dirty} error={r.sync_error} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </>)}
    </div>
  );
}

function VarChart({ v, recs, onRemove }: { v: Variable; recs: ReturnType<typeof useRecords>['data'] & object; onRemove: () => void }) {
  const kind = kindOf(v, recs);
  const nums = kind === 'numeric' ? numbersOf(recs, v) : [];
  const d = describe(nums);
  const f = kind === 'categorical' ? frequencies(recs, v) : null;
  return (
    <section className="card p-5 anim-in">
      <CardTitle icon={kind === 'numeric' ? 'bar-chart' : 'pie-chart'} tone="k-teal" title={v.label || v.name} sub={kind === 'numeric' && d ? `mean ${fmt(d.mean)} · median ${fmt(d.median)} · n=${d.n}` : f ? `${f.answered} answered` : ''}>
        <button className="btn btn-icon btn-sm" onClick={onRemove} title="Remove this chart" aria-label="Remove chart"><Icon name="x-lg" /></button>
      </CardTitle>
      <div className="mt-4">
        {kind === 'numeric' && nums.length ? <HistogramChart bins={histogram(nums)} />
          : f && f.rows.length ? (f.rows.length <= 6 ? <Donut sub="answers" data={f.rows.map((x) => ({ label: x.label, value: x.n }))} /> : <HBars data={f.rows.slice(0, 10).map((x) => ({ label: x.label, value: x.n, note: `${x.pct.toFixed(0)}%` }))} />)
            : <p className="muted py-6 text-center text-sm">No answers yet.</p>}
      </div>
    </section>
  );
}
