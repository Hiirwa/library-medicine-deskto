import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, CardTitle, Empty, Icon, Stat } from '../components/ui';
import { useProjects } from '../components/Shell';
import * as store from '../lib/db';
import { isAnswered, plural } from '../lib/format';
import { useUi, type ProjectTab } from '../providers/UiProvider';
import { DataView } from './DataView';
import { VariablesView } from './VariablesView';
import { FilesView, FormsView } from './FormsFilesViews';
import type { Form, Project, Variable } from '../lib/types';

export type ProjectWithCounts = Project & { records: number; pending: number };
export interface ProjectCtx { project: ProjectWithCounts; vars: Variable[]; forms: Form[] }

export function ProjectView({ uuid, tab }: { uuid: string; tab: ProjectTab }) {
  const projects = useProjects();
  const { go } = useUi();
  const project = projects.data?.find((p) => p.uuid === uuid);
  const vars = useQuery({ queryKey: ['variables', uuid], queryFn: () => store.getVariables(uuid) });
  const forms = useQuery({ queryKey: ['forms', uuid], queryFn: () => store.listForms(uuid) });
  if (projects.isLoading) return null;
  if (!project) {
    return <div className="card"><Empty icon="folder-x" title="This project is not on this computer"><span>It may have been removed from your account. Sync to refresh the list.</span><button className="btn btn-primary mt-2" onClick={() => go({ page: 'home' })}>Back to my projects</button></Empty></div>;
  }
  if (!vars.data || !forms.data) return null;
  const ctx: ProjectCtx = { project, vars: vars.data, forms: forms.data };
  switch (tab) {
    case 'data': return <DataView {...ctx} />;
    case 'variables': return <VariablesView {...ctx} />;
    case 'forms': return <FormsView {...ctx} />;
    case 'files': return <FilesView {...ctx} />;
    default: return <OverviewView {...ctx} />;
  }
}

function OverviewView({ project, vars }: ProjectCtx) {
  const { go, openEditor } = useUi();
  const [range, setRange] = useState<7 | 14 | 30>(30);
  const stats = useQuery({ queryKey: ['pstats', project.uuid], queryFn: () => store.projectStats(project.uuid) });
  const days = useQuery({ queryKey: ['days', range, project.uuid], queryFn: () => store.dayCounts(range, project.uuid) });
  const records = useQuery({ queryKey: ['records', project.uuid, ''], queryFn: () => store.listRecords(project.uuid, '') });
  const s = stats.data;
  const canAdd = project.can.add && project.status === 'active';

  // completeness: share of records that answered each question (required questions first, least complete first)
  const completeness = useMemo(() => {
    const recs = records.data ?? [];
    if (!recs.length) return [];
    return vars.filter((v) => !['note', 'calculated'].includes(v.type))
      .map((v) => ({ v, pct: Math.round((recs.filter((r) => isAnswered(r.data[v.name])).length / recs.length) * 100) }))
      .sort((a, b) => Number(b.v.required) - Number(a.v.required) || a.pct - b.pct)
      .slice(0, 7);
  }, [records.data, vars]);

  const sum = days.data?.reduce((a, d) => a + d.n, 0) ?? 0;
  const period = project.period === 'closed' ? 'Data collection ended' : project.period === 'upcoming' ? 'Starts later' : 'Collecting data';
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  return (
    <div className="space-y-5">
      <section className="page-head anim-in" style={{ alignItems: 'flex-start' }}>
        <div className="min-w-0 flex-1">
          <h1 style={{ fontSize: '1.65rem', lineHeight: 1.25 }}>{project.title}</h1>
          {project.description && <p className="muted mt-2 max-w-4xl whitespace-pre-line font-medium selectable">{project.description}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar teal"><Icon name="person-badge" /></span><span><span className="label-cap" style={{ margin: 0 }}>Your role</span><b className="ink capitalize">{project.role}</b></span></div>
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar"><Icon name="calendar-range" /></span><span><span className="label-cap" style={{ margin: 0 }}>{period}</span><b className="ink">{project.start_date || project.end_date ? `${fmt(project.start_date)} – ${fmt(project.end_date)}` : 'No dates set'}</b></span></div>
            <div className="card-flat flex items-center gap-3 px-3 py-2"><span className="avatar" style={{ background: 'linear-gradient(135deg,#a78bfa,#6d28d9)' }}><Icon name="layers" /></span><span><span className="label-cap" style={{ margin: 0 }}>Schema version</span><b className="ink">v{project.schema_version} · {plural(vars.length, 'variable')}</b></span></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'data' })}><Icon name="table" />Open data</button>
            {canAdd && <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: null })}><Icon name="plus-lg" />New record</button>}
            <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'variables' })}><Icon name="journal-text" />Codebook</button>
          </div>
        </div>
      </section>

      {project.status !== 'active' && <div className="notice warn"><Icon name="archive" /><span>This project is archived. You can read and export its records, but not change them.</span></div>}

      <div className="stats">
        <Stat icon="database" value={s?.total ?? 0} label="Records" tone="k-teal" onClick={() => go({ page: 'project', project: project.uuid, tab: 'data' })} />
        <Stat icon="graph-up" value={s?.week ?? 0} label="Last 7 days" />
        <Stat icon="check2-circle" value={s?.complete ?? 0} label="Complete" tone="k-ok" />
        <Stat icon="pencil" value={s?.draft ?? 0} label="Drafts" tone="k-muted" />
        <Stat icon="send" value={s?.toSend ?? 0} label="To send" tone="k-warn" onClick={() => go({ page: 'sync' })} />
        <Stat icon="diagram-3" value={vars.length} label="Variables" onClick={() => go({ page: 'project', project: project.uuid, tab: 'variables' })} />
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 24rem' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="bar-chart-line" title="Submissions" sub={<><b className="ink">{plural(sum, 'record')}</b> in the last {range} days</>}>
            <div className="seg light">{([7, 14, 30] as const).map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}d</button>)}</div>
          </CardTitle>
          <div className="mt-5">{days.data && <BarChart data={days.data} teal />}</div>
        </section>
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
      </div>
    </div>
  );
}
