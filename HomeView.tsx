import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, CardTitle, Empty, Icon, StatusChip, SyncChip } from '../components/ui';
import { useProjects } from '../components/Shell';
import * as store from '../lib/db';
import { ago, shortDate } from '../lib/time';
import { initials, plural } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

/** "My projects": greeting, key numbers, project cards and recent activity, all from the offline copy. */
export function HomeView() {
  const { user, online, sync, syncing, lastSync } = useSession();
  const { go, openEditor } = useUi();
  const projects = useProjects();
  const stats = useQuery({ queryKey: ['gstats'], queryFn: store.globalStats });
  const days = useQuery({ queryKey: ['days', 14], queryFn: () => store.dayCounts(14) });
  const week = useQuery({ queryKey: ['days', 7], queryFn: () => store.dayCounts(7) });
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => store.recentRecords(8) });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'archived'>('all');
  const [sort, setSort] = useState<'title' | 'records'>('title');

  const list = useMemo(() => {
    let l = projects.data ?? [];
    if (q.trim()) l = l.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase()));
    if (filter === 'active') l = l.filter((p) => p.status === 'active');
    if (filter === 'archived') l = l.filter((p) => p.status !== 'active');
    if (filter === 'pending') l = l.filter((p) => p.pending > 0);
    return [...l].sort((a, b) => (sort === 'records' ? b.records - a.records : a.title.localeCompare(b.title)));
  }, [projects.data, q, filter, sort]);

  const s = stats.data;
  const first = (user?.name || '').split(' ')[0] || 'there';
  const canEnter = projects.data?.find((p) => p.can.add && p.status === 'active');
  const diff = (s?.week ?? 0) - (s?.prevWeek ?? 0);
  const count = (f: typeof filter) => (projects.data ?? []).filter((p) => f === 'all' || (f === 'active' ? p.status === 'active' : f === 'archived' ? p.status !== 'active' : p.pending > 0)).length;

  return (
    <div className="space-y-5">
      <section className="hero anim-in">
        <span className="date"><Icon name="calendar3" />{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        <h1>{greeting()}, {first} 👋</h1>
        <p>You have <b>{s?.active ?? 0}</b> active project{s?.active === 1 ? '' : 's'} and <b>{s?.week ?? 0}</b> new record{s?.week === 1 ? '' : 's'} this week{s?.toSend ? <> · <b>{s.toSend}</b> waiting to send</> : null}.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="quick k-teal" disabled={!canEnter} onClick={() => canEnter && openEditor({ project: canEnter.uuid, record: null, form: null })}><span className="q-ic"><Icon name="clipboard-plus" /></span>Enter data</button>
          <button className="quick k-brand" disabled={!online || syncing} onClick={() => sync()}><span className="q-ic"><Icon name="arrow-repeat" /></span>Sync now{s?.toSend ? <span className="count">{s.toSend}</span> : null}</button>
          <button className="quick k-warn" onClick={() => go({ page: 'sync' })}><span className="q-ic"><Icon name="activity" /></span>Sync centre</button>
          <button className="quick k-brand" onClick={() => go({ page: 'settings' })}><span className="q-ic"><Icon name="gear" /></span>Settings</button>
          <button className="quick k-brand" onClick={() => go({ page: 'help' })}><span className="q-ic"><Icon name="question-lg" /></span>Help</button>
        </div>
      </section>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12.5rem, 1fr))' }}>
        <div className="metric k-teal anim-in">
          <div className="m-head"><span className="m-ic"><Icon name="folder2-open" /></span><span className="m-label">Active projects</span></div>
          <div className="m-val"><b>{s?.active ?? 0}</b><span>{s?.projects ?? 0} on this computer</span></div>
          <div className="mt-auto"><div className="mb-1 flex justify-between text-xs font-bold" style={{ color: 'var(--rh-teal)' }}><span>Available offline</span><span>100%</span></div><div className="bar"><i style={{ width: '100%' }} /></div></div>
        </div>
        <div className="metric k-brand anim-in">
          <div className="m-head"><span className="m-ic"><Icon name="database" /></span><span className="m-label">Total records</span></div>
          <div className="m-val"><b>{(s?.records ?? 0).toLocaleString()}</b><span>in your offline copy</span></div>
          <div className="mt-auto"><div className="mb-1 flex justify-between text-xs font-bold muted"><span>Synced</span><span style={{ color: 'var(--rh-brand)' }}>{s?.records ? Math.round(((s.records - s.toSend) / s.records) * 100) : 100}%</span></div><div className="bar"><i style={{ width: `${s?.records ? Math.round(((s.records - s.toSend) / s.records) * 100) : 100}%` }} /></div></div>
        </div>
        <div className="metric k-brand anim-in" style={{ ['--k' as string]: '#6366f1', ['--k-soft' as string]: 'rgba(99,102,241,.12)' }}>
          <div className="m-head"><span className="m-ic"><Icon name="graph-up-arrow" /></span><span className="m-label">New this week</span></div>
          <div className="m-val"><b>{s?.week ?? 0}</b>{s && <span className={`chip ${diff >= 0 ? 'chip-ok' : 'chip-danger'}`}><Icon name={diff >= 0 ? 'arrow-up-right' : 'arrow-down-right'} />{Math.abs(diff)} vs last week</span>}</div>
          {week.data && <div className="mt-auto"><BarChart data={week.data} labels="weekday" height="3.6rem" /></div>}
        </div>
        <div className="metric k-warn anim-in">
          <div className="m-head"><span className="m-ic"><Icon name="cloud-upload" /></span><span className="m-label">Waiting to send</span></div>
          <div className="m-val"><b>{s?.toSend ?? 0}</b><span>{s?.refused ? `${s.refused} refused` : online ? 'sent at next sync' : 'you are offline'}</span></div>
          <div className="mt-auto flex items-center justify-between text-xs font-bold muted"><span>Last sync {ago(lastSync)}</span><button className="btn btn-sm btn-soft" onClick={() => go({ page: 'sync' })}>Details</button></div>
        </div>
      </div>

      <StickyColumns className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 22rem' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="folder2" title="My projects" sub={plural(projects.data?.length ?? 0, 'project') + ' in total'} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="field-ic min-w-[14rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="field w-48" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort projects">
              <option value="title">Name A–Z</option><option value="records">Most records</option>
            </select>
          </div>
          <div className="seg light mt-3">
            {(['all', 'active', 'pending', 'archived'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'pending' ? 'Waiting to send' : f.charAt(0).toUpperCase() + f.slice(1)} <span className="count soft">{count(f)}</span></button>
            ))}
          </div>
          <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}>
            {list.map((p) => (
              <button key={p.uuid} className="pcard" onClick={() => go({ page: 'project', project: p.uuid, tab: 'overview' })}>
                <div className="flex items-start gap-3">
                  <span className="pc-ic">{initials(p.title)}</span>
                  <div className="min-w-0"><h3>{p.title}</h3><div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="chip chip-brand">{p.role}</span>
                    {p.status !== 'active' ? <span className="chip chip-warn">Archived</span> : <span className="chip chip-teal"><span className="dot" />{p.period === 'closed' ? 'Collection ended' : p.period === 'upcoming' ? 'Starts later' : 'Collecting'}</span>}
                  </div></div>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2">
                  <div className="well px-3 py-2"><b className="num block text-lg ink">{p.records.toLocaleString()}</b><span className="muted text-xs font-bold uppercase tracking-wider">Records</span></div>
                  <div className="well px-3 py-2"><b className="num block text-lg" style={{ color: p.pending ? 'var(--rh-warning)' : 'var(--rh-ink)' }}>{p.pending}</b><span className="muted text-xs font-bold uppercase tracking-wider">To send</span></div>
                </div>
              </button>
            ))}
          </div>
          {projects.data && !list.length && (
            <Empty icon="folder2-open" title={projects.data.length ? 'No project matches' : 'No projects yet'}>
              {projects.data.length ? <span>Try another search or filter.</span> : <><span>{online ? 'Download your projects from the website.' : 'Connect to the internet and sync to download your projects.'}</span>{online && <button className="btn btn-primary mt-2" onClick={() => sync()}><Icon name="arrow-repeat" />Sync now</button>}</>}
            </Empty>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5 anim-in">
            <CardTitle icon="bar-chart-line-fill" tone="k-teal" title="Records, last 14 days" sub={plural(days.data?.reduce((a, d) => a + d.n, 0) ?? 0, 'record') + ' in total'} />
            <div className="mt-4">{days.data && <BarChart data={days.data} />}</div>
          </section>
          <section className="card p-5 anim-in">
            <CardTitle icon="clock-history" title="Recent activity" sub="Last changed records" />
            <div className="mt-3 space-y-1">
              {recent.data?.map((r) => (
                <button key={r.uuid} className="nav-item" style={{ padding: '.45rem .5rem' }} onClick={() => openEditor({ project: r.project, record: r.uuid, form: r.form })}>
                  <Icon name={r.dirty ? 'pencil-square' : 'file-earmark-text'} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold ink">{r.project_title}</span><span className="muted block truncate text-xs">{shortDate(r.updated_at)} · ID {r.uuid.slice(0, 8)}</span></span>
                  {r.sync_error || r.dirty ? <SyncChip dirty={r.dirty} error={r.sync_error} /> : <StatusChip status={r.status} />}
                </button>
              ))}
              {recent.data && !recent.data.length && <p className="muted py-4 text-center text-sm">Nothing yet.</p>}
            </div>
          </section>
        </div>
      </StickyColumns>
    </div>
  );
}
