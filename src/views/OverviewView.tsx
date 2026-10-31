import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, CardTitle, Icon, Stat, StatusChip } from '../components/ui';
import { Ring } from '../components/charts';
import * as store from '../lib/db';
import { isAnswered, plural } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { ago } from '../lib/time';
import { Rich } from '../components/Rich';
import { useUi, type ProjectTab } from '../providers/UiProvider';
import type { ProjectCtx } from './ProjectView';

const GROUPS: { title: string; items: [ProjectTab, string, string, string][] }[] = [
  { title: 'Share & analyse', items: [['sharing', 'share', 'Sharing', 'Links, QR codes and the team'], ['statistics', 'calculator', 'Statistics', 'Summaries of every variable'], ['workbench', 'bezier2', 'Workbench', 'Cross-tabs, tests, correlation'], ['dashboard', 'pie-chart', 'Dashboard', 'Live charts of the project'], ['reports', 'file-earmark-bar-graph', 'Reports', 'Print or share a report']] },
  { title: 'Data management', items: [['data', 'table', 'Data view', 'Search, sort and edit records'], ['import', 'cloud-upload', 'Import', 'Bring records from Excel / CSV'], ['export', 'box-arrow-down', 'Export', 'CSV, JSON, codebook'], ['files', 'paperclip', 'Files', 'Attachments kept offline']] },
];

/** Project home: status, data quality, health checklist, shortcuts to every tool and recent activity. */
export function OverviewView({ project, vars, forms }: ProjectCtx) {
  const { go, openEditor } = useUi();
  const [range, setRange] = useState<7 | 14 | 30>(30);
  const stats = useQuery({ queryKey: ['pstats', project.uuid], queryFn: () => store.projectStats(project.uuid) });
  const days = useQuery({ queryKey: ['days', range, project.uuid], queryFn: () => store.dayCounts(range, project.uuid) });
  const records = useRecords(project.uuid);
  const s = stats.data;
  const canAdd = project.can.add && project.status === 'active';
  const to = (tab: ProjectTab) => go({ page: 'project', project: project.uuid, tab });
  const toData = (f: string) => { try { localStorage.setItem('lm_pending_filter', `${project.uuid}|${f}`); } catch { /* ignore */ } to('data'); };

  const completeness = useMemo(() => {
    const recs = records.data ?? [];
    if (!recs.length) return [];
    return vars.filter((v) => !['note', 'calculated'].includes(v.type))
      .map((v) => ({ v, pct: Math.round((recs.filter((r) => isAnswered(r.data[v.name])).length / recs.length) * 100) }))
      .sort((a, b) => Number(b.v.required) - Number(a.v.required) || a.pct - b.pct).slice(0, 7);
  }, [records.data, vars]);
  const quality = useMemo(() => {
    const recs = records.data ?? []; const q = vars.filter((v) => !['note', 'calculated', 'file'].includes(v.type));
    return recs.length && q.length ? (recs.reduce((a, r) => a + q.filter((v) => isAnswered(r.data[v.name])).length / q.length, 0) / recs.length) * 100 : 0;
  }, [records.data, vars]);

  const sum = days.data?.reduce((a, d) => a + d.n, 0) ?? 0;
  const period = project.period === 'closed' ? 'Data collection ended' : project.period === 'upcoming' ? 'Starts later' : 'Collecting data';
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const checks: [boolean, string, () => void][] = [
    [project.status === 'active', project.status === 'active' ? 'Project is active' : 'Project is archived (read-only)', () => to('variables')],
    [project.period !== 'closed', period, () => to('forms')],
    [(s?.refused ?? 0) === 0, (s?.refused ?? 0) ? `${plural(s?.refused ?? 0, 'record')} refused by the server` : 'No record refused', () => go({ page: 'sync' })],
    [(s?.toSend ?? 0) === 0, (s?.toSend ?? 0) ? `${plural(s?.toSend ?? 0, 'record')} waiting to be sent` : 'Everything is synced', () => go({ page: 'sync' })],
    [quality >= 80 || !(s?.total), s?.total ? `Questions answered: ${Math.round(quality)}%` : 'No records yet', () => to('statistics')],
  ];

  return (
    <div className="space-y-5">
      <section className="page-head anim-in" style={{ alignItems: 'flex-start' }}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className={`chip ${project.period === 'closed' ? 'chip-warn' : 'chip-teal'}`}><Icon name="broadcast" />{period}</span><span className="chip chip-brand"><Icon name="person-badge" />{project.role}</span></div>
          <h1 className="mt-2" style={{ fontSize: '1.65rem', lineHeight: 1.25 }}>{project.title}</h1>
          {project.description && <Rich html={project.description} fold={420} className="mt-2 max-w-4xl" />}
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar"><Icon name="calendar-range" /></span><span><span className="label-cap" style={{ margin: 0 }}>Period</span><b className="ink">{project.start_date || project.end_date ? `${fmt(project.start_date)} – ${fmt(project.end_date)}` : 'No dates set'}</b></span></div>
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar" style={{ background: 'linear-gradient(135deg,#a78bfa,#6d28d9)' }}><Icon name="layers" /></span><span><span className="label-cap" style={{ margin: 0 }}>Schema</span><b className="ink">v{project.schema_version} · {plural(vars.length, 'variable')}</b></span></div>
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar teal"><Icon name="ui-checks-grid" /></span><span><span className="label-cap" style={{ margin: 0 }}>Forms</span><b className="ink">{plural(forms.length, 'form')}</b></span></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {canAdd && <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })}><Icon name="plus-lg" />New record</button>}
            <button className="btn" onClick={() => to('dashboard')}><Icon name="pie-chart" />Dashboard</button>
            <button className="btn" onClick={() => to('reports')}><Icon name="file-earmark-bar-graph" />Report</button>
          </div>
        </div>
      </section>

      {project.status !== 'active' && <div className="notice warn"><Icon name="archive" /><span>This project is archived. You can read and export its records, but not change them.</span></div>}

      <div className="stats">
        <Stat icon="database" value={s?.total ?? 0} label="Records" tone="k-teal" onClick={() => toData('all')} title="Open all records" />
        <Stat icon="graph-up" value={s?.week ?? 0} label="Last 7 days" onClick={() => to('dashboard')} title="See the trend on the dashboard" />
        <Stat icon="check2-circle" value={s?.complete ?? 0} label="Complete" tone="k-ok" onClick={() => toData('complete')} title="Show complete records" />
        <Stat icon="pencil" value={s?.draft ?? 0} label="Drafts" tone="k-muted" onClick={() => toData('draft')} title="Show drafts" />
        <Stat icon="send" value={s?.toSend ?? 0} label="To send" tone="k-warn" onClick={() => go({ page: 'sync' })} />
        <Stat icon="diagram-3" value={vars.length} label="Variables" onClick={() => to('variables')} />
      </div>

      <StickyColumns className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 24rem' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="bar-chart-line" title="Submissions" sub={<><b className="ink">{plural(sum, 'record')}</b> in the last {range} days</>}>
            <div className="seg light">{([7, 14, 30] as const).map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}d</button>)}</div>
          </CardTitle>
          <div className="mt-5">{days.data && <BarChart data={days.data} teal />}</div>
        </section>
        <section className="card p-5 anim-in">
          <CardTitle icon="heart-pulse" tone="k-ok" title="Project health" />
          <div className="mt-3 flex items-center gap-4"><Ring value={quality} label="Data quality" size={92} tone={quality >= 80 ? 'var(--rh-success)' : quality >= 60 ? 'var(--rh-amber)' : 'var(--rh-danger)'} />
            <ul className="min-w-0 flex-1 space-y-1.5 text-sm">{checks.map(([ok, t, act]) => <li key={t}><button type="button" className="hl" onClick={act}><Icon name={ok ? 'check-circle-fill' : 'exclamation-circle-fill'} className={ok ? 'text-[var(--rh-success)]' : 'text-[var(--rh-amber)]'} /><span className="flex-1 text-left">{t}</span><Icon name="chevron-right" className="muted" /></button></li>)}</ul></div>
        </section>
      </StickyColumns>

      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))' }}>
        {GROUPS.map((g) => (
          <section key={g.title} className="card p-5 anim-in"><CardTitle icon={g.title === 'Data management' ? 'database-gear' : 'graph-up-arrow'} title={g.title} />
            <div className="mt-3 grid grid-cols-2 gap-2.5">{g.items.map(([tab, ic, t, d]) => (
              <button key={tab} className="tool" onClick={() => to(tab)}><span className="pk-ic"><Icon name={ic} /></span><span className="min-w-0 text-left"><b className="ink block">{t}</b><small className="muted">{d}</small></span></button>))}</div>
          </section>
        ))}
      </div>

      <StickyColumns className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="clipboard-data" tone="k-teal" title="Completeness" sub="Share of records that answered" />
          <div className="mt-4 space-y-3">
            {completeness.map(({ v, pct }) => (
              <div key={v.name} className={pct < 60 ? 'k-warn' : pct < 90 ? 'k-brand' : 'k-ok'}>
                <div className="mb-1 flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate font-medium ink" title={v.name}>{v.label || v.name}</span>{v.required && <span className="chip" style={{ padding: '0 .4rem' }}>req.</span>}<b className="num" style={{ color: 'var(--k)' }}>{pct}%</b></div>
                <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              </div>
            ))}
            {!completeness.length && <p className="muted py-6 text-center text-sm">No records yet.</p>}
          </div>
        </section>
        <section className="card p-5 anim-in">
          <CardTitle icon="clock-history" title="Recent activity" sub="Latest changes on this computer" />
          <div className="mt-3 space-y-1.5">
            {[...(records.data ?? [])].slice(0, 6).map((r) => (
              <button key={r.uuid} className="row-link" onClick={() => openEditor({ project: project.uuid, record: r.uuid, form: r.form })}><span className="idchip">{r.uuid.slice(0, 8)}</span><StatusChip status={r.status} /><span className="muted flex-1 text-right text-sm">{ago(r.updated_at)}</span></button>
            ))}
            {!(records.data ?? []).length && <p className="muted py-6 text-center text-sm">Nothing yet.</p>}
          </div>
        </section>
      </StickyColumns>
    </div>
  );
}
