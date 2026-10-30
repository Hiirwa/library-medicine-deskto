import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ask } from '@tauri-apps/plugin-dialog';
import { Brand } from '../components/Brand';
import { RecordEditor } from '../components/RecordEditor';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { ago, shortDate } from '../lib/time';
import type { LocalRecord, Variable } from '../lib/types';
import { useSession } from '../providers/AppProvider';

const label = (v: Variable | undefined, value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  const o = v?.config?.options;
  if (Array.isArray(value)) return value.map((x) => o?.find((y) => y.value === String(x))?.label ?? String(x)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (v?.type === 'boolean') return String(value) === '1' ? 'Yes' : 'No';
  return o?.find((y) => y.value === String(value))?.label ?? String(value);
};

/** View 3 — workspace: projects, records, files, sync state. Everything is read from the local database. */
export function DashboardView() {
  const { user, online, sync, syncing, lastSync, lastResult, signOut, server } = useSession();
  const projects = useQuery({ queryKey: ['projects'], queryFn: store.listProjects });
  const [current, setCurrent] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ record: LocalRecord | null; form: string | null } | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!current && projects.data?.length) setCurrent(projects.data[0].uuid);
  }, [projects.data, current]);
  const project = projects.data?.find((p) => p.uuid === current) ?? null;
  const vars = useQuery({ queryKey: ['variables', current], queryFn: () => store.getVariables(current as string), enabled: !!current });
  const forms = useQuery({ queryKey: ['forms', current], queryFn: () => store.listForms(current as string), enabled: !!current });
  const records = useQuery({ queryKey: ['records', current, search], queryFn: () => store.listRecords(current as string, search), enabled: !!current });
  const pending = useQuery({ queryKey: ['pending'], queryFn: store.outboxCount });
  const fstats = useQuery({ queryKey: ['fstats'], queryFn: store.fileStats });
  const log = useQuery({ queryKey: ['synclog'], queryFn: store.syncLog });

  // the first answered questions make the columns of the table
  const cols = useMemo(() => (vars.data ?? []).filter((v) => !['file', 'textarea', 'note'].includes(v.type) && !(v.is_pii && project && !project.can.pii)).slice(0, 4), [vars.data, project]);
  const byName = useMemo(() => new Map((vars.data ?? []).map((v) => [v.name, v])), [vars.data]);
  const [newForm, setNewForm] = useState<string>('');

  async function doSignOut() {
    const n = pending.data ?? 0;
    if (n > 0) {
      const keep = await ask(`${n} record${n === 1 ? ' has' : 's have'} not been sent yet. Signing out now would lose ${n === 1 ? 'it' : 'them'}. Sync first?`, { title: 'Unsent changes', kind: 'warning', okLabel: 'Sync first', cancelLabel: 'Sign out anyway' });
      if (keep) { await sync(); return; }
    } else if (!(await ask('Sign out and remove the offline copy of your data from this computer?', { title: 'Sign out', kind: 'info' }))) return;
    await signOut();
  }

  return (
    <div className="flex h-full">
      {/* projects */}
      <aside className="flex w-72 shrink-0 flex-col bg-white shadow-[1px_0_0_rgba(15,23,42,.06)]">
        <div className="p-5"><Brand /></div>
        <div className="px-5 pb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">Projects</div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {projects.data?.map((p) => (
            <button key={p.uuid} onClick={() => { setCurrent(p.uuid); setSearch(''); }}
              className={`w-full rounded-xl px-3 py-2.5 text-left transition ${p.uuid === current ? 'bg-brand-600 text-white shadow-[0_8px_18px_-10px_rgba(45,75,216,.9)]' : 'text-slate-700 hover:bg-slate-100'}`}>
              <div className="truncate text-sm font-semibold">{p.title}</div>
              <div className={`mt-0.5 flex gap-2 text-xs ${p.uuid === current ? 'text-white/80' : 'text-slate-500'}`}>
                <span>{p.records} record{p.records === 1 ? '' : 's'}</span>
                {p.pending > 0 && <span className="font-bold">· {p.pending} to send</span>}
                {p.status !== 'active' && <span>· archived</span>}
              </div>
            </button>
          ))}
          {projects.data?.length === 0 && <p className="px-3 text-sm text-slate-500">No projects yet. {online ? 'Click Sync now.' : 'Connect to the internet and sync.'}</p>}
        </nav>
        <div className="relative p-3">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-100" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{(user?.name || user?.email || '?').slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1"><b className="block truncate text-sm">{user?.name}</b><span className="block truncate text-xs text-slate-500">{user?.email}</span></span>
          </button>
          {menu && (
            <div className="card absolute bottom-16 left-3 right-3 z-30 p-2">
              <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { native.revealLocal(); setMenu(false); }}>Open workspace folder</button>
              <button className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={async () => { setMenu(false); await native.secureDelete('api_token'); location.reload(); }}>Replace API token</button>
              <div className="my-1 h-px bg-slate-100" />
              <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => { setMenu(false); doSignOut(); }}>Sign out</button>
            </div>
          )}
        </div>
      </aside>

      {/* main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 bg-white/80 px-6 py-4 shadow-sm backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{project?.title ?? 'Your workspace'}</h1>
            {project && <p className="text-xs text-slate-500">Role: {project.role} · {project.period === 'closed' ? 'data collection ended' : project.period === 'upcoming' ? 'starts later' : 'collecting'}</p>}
          </div>
          <span className={`chip ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}><span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />{online ? 'Online' : 'Offline — changes are saved locally'}</span>
          <button className="btn-primary" onClick={() => sync()} disabled={!online || syncing} title={online ? '' : `Cannot reach ${server}`}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </header>

        {project && (
          <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
            <input className="field max-w-sm" placeholder="Search records…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
            <span className="flex-1" />
            {project.can.add && project.status === 'active' && (
              <div className="flex gap-2">
                {(forms.data?.length ?? 0) > 1 && (
                  <select className="field w-56" value={newForm} onChange={(e) => setNewForm(e.target.value)} aria-label="Form for the new record">
                    {forms.data?.map((f) => <option key={f.uuid} value={f.uuid}>{f.title}</option>)}
                  </select>
                )}
                <button className="btn-primary" onClick={() => setEditing({ record: null, form: newForm || forms.data?.[0]?.uuid || null })}>+ New record</button>
              </div>
            )}
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {project && (
            <div className="card overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {cols.map((c) => <th key={c.name} className="px-4 py-3 font-bold">{c.label || c.name}</th>)}
                    <th className="px-4 py-3 font-bold">Answered</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Last change</th>
                    <th className="px-4 py-3 font-bold">Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {records.data?.map((r) => (
                    <tr key={r.uuid} className="cursor-pointer odd:bg-white even:bg-slate-50/60 hover:bg-brand-50" onClick={() => setEditing({ record: r, form: r.form })}>
                      {cols.map((c) => <td key={c.name} className="max-w-56 truncate px-4 py-3">{label(byName.get(c.name), r.data[c.name])}</td>)}
                      <td className="px-4 py-3 text-slate-500">{Object.values(r.data).filter((x) => x !== null && x !== '' && !(Array.isArray(x) && !x.length)).length}/{vars.data?.filter((v) => v.type !== 'calculated').length ?? 0}</td>
                      <td className="px-4 py-3"><span className={`chip ${r.status === 'draft' ? 'bg-slate-100 text-slate-600' : r.status === 'flagged' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{r.status}</span></td>
                      <td className="px-4 py-3 text-slate-500">{shortDate(r.updated_at)}</td>
                      <td className="px-4 py-3">
                        {r.sync_error ? <span className="chip bg-red-100 text-red-700" title={r.sync_error}>refused</span>
                          : r.dirty ? <span className="chip bg-amber-100 text-amber-800">to send</span>
                          : <span className="chip bg-slate-100 text-slate-500">synced</span>}
                      </td>
                    </tr>
                  ))}
                  {records.data?.length === 0 && (
                    <tr><td colSpan={cols.length + 4} className="px-4 py-10 text-center text-slate-500">{search ? 'No record matches your search.' : 'No records yet in this project.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-white px-6 py-2.5 text-xs text-slate-500 shadow-[0_-1px_0_rgba(15,23,42,.06)]">
          <span>Last sync: <b className="text-slate-700">{ago(lastSync)}</b>{lastResult && !lastResult.ok && <span className="text-red-600"> · {lastResult.error ?? 'some changes refused'}</span>}</span>
          <span>Waiting to send: <b className={pending.data ? 'text-amber-700' : 'text-slate-700'}>{pending.data ?? 0}</b></span>
          <span>Files offline: <b className="text-slate-700">{fstats.data?.offline ?? 0}/{fstats.data?.total ?? 0}</b>{fstats.data?.waiting ? ` · ${fstats.data.waiting} to upload` : ''}</span>
          <span className="flex-1" />
          {log.data?.[0] && <span title={log.data.map((l) => `${shortDate(l.at)} — ${l.summary}`).join('\n')}>{log.data[0].summary}</span>}
        </footer>
      </main>

      {editing && project && vars.data && forms.data && (
        <RecordEditor project={project} variables={vars.data} forms={forms.data} record={editing.record} formUuid={editing.form} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
