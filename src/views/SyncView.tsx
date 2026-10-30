import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ask } from '@tauri-apps/plugin-dialog';
import { CardTitle, Empty, Icon, PageHead, Stat } from '../components/ui';
import * as store from '../lib/db';
import { ago, shortDate } from '../lib/time';
import { plural } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';

/** Everything about synchronisation in one place: what waits, what was refused, what happened. */
export function SyncView() {
  const { online, sync, syncing, lastSync, lastResult, server, toast, settings } = useSession();
  const { openEditor, go } = useUi();
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ['pendingList'], queryFn: store.pendingChanges });
  const refused = useQuery({ queryKey: ['refused'], queryFn: store.refusedRecords });
  const log = useQuery({ queryKey: ['synclogFull'], queryFn: () => store.syncLog(60) });
  const fstats = useQuery({ queryKey: ['fstats'], queryFn: store.fileStats });

  const discard = useMutation({
    mutationFn: store.discardChange,
    onSuccess: async () => { await qc.invalidateQueries(); toast('Local change discarded. The server copy comes back at the next sync.'); },
  });
  const dismiss = useMutation({ mutationFn: store.clearRecordError, onSuccess: () => qc.invalidateQueries() });

  async function confirmDiscard(uuid: string, isNew: boolean) {
    const ok = await ask(isNew ? 'This record was created on this computer and has never been sent. Discarding deletes it for good.' : 'Discard your unsent change to this record? The version on the server will replace it at the next sync.', { title: 'Discard change', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Keep' });
    if (ok) discard.mutate(uuid);
  }

  const p = pending.data ?? [];
  return (
    <div className="space-y-5">
      <PageHead icon="arrow-repeat" title="Sync centre" sub={<>{online ? <>Connected to <b className="ink">{new URL(server).host}</b></> : 'Offline — everything is saved on this computer'} · last sync {ago(lastSync)}</>}>
        <button className="btn btn-primary" disabled={!online || syncing} onClick={() => sync()}><Icon name="arrow-repeat" className={syncing ? 'spin' : ''} />{syncing ? 'Syncing…' : 'Sync now'}</button>
      </PageHead>

      {!online && <div className="notice warn"><Icon name="wifi-off" /><span>You are offline. Keep working: new and edited records are kept here and sent automatically when the connection is back.</span></div>}
      {lastResult && !lastResult.ok && lastResult.error && <div className="notice danger"><Icon name="exclamation-octagon" /><span>The last sync did not finish: {lastResult.error}</span></div>}

      <div className="stats">
        <Stat icon="send" value={p.length} label="Records to send" tone="k-warn" />
        <Stat icon="exclamation-octagon" value={refused.data?.length ?? 0} label="Refused by server" tone="k-danger" />
        <Stat icon="cloud-upload" value={fstats.data?.waiting ?? 0} label="Files to upload" tone="k-teal" />
        <Stat icon="stopwatch" value={settings.autoSyncMin ? `${settings.autoSyncMin} min` : 'Off'} label="Auto-sync" onClick={() => go({ page: 'settings' })} title="Change in Settings" />
      </div>

      <section className="card p-5 anim-in">
        <CardTitle icon="hourglass-split" tone="k-warn" title="Waiting to send" sub="Changes made on this computer that the server has not received yet" />
        {p.length ? (
          <div className="tbl-wrap mt-4" style={{ boxShadow: 'none', background: 'transparent' }}>
            <table className="tbl">
              <thead><tr><th>Record</th><th>Project</th><th>Change</th><th>Saved</th><th>Attempts</th><th /></tr></thead>
              <tbody>
                {p.map((c) => (
                  <tr key={c.uuid}>
                    <td><span className="idchip">{c.uuid.slice(0, 8)}</span></td>
                    <td className="clip" title={c.project_title ?? ''}>{c.project_title ?? '—'}</td>
                    <td>{c.op === 'delete' ? <span className="chip chip-danger"><Icon name="trash3" />Deletion</span> : <span className="chip chip-brand"><Icon name="pencil" />{c.changes > 1 ? `${c.changes} edits` : 'Edit'}</span>}</td>
                    <td className="muted">{shortDate(c.at)}</td>
                    <td className="clip">{c.attempts ? <span className="chip chip-warn" title={c.last_error ?? ''}>{c.attempts} · {c.last_error?.slice(0, 40)}</span> : <span className="muted">—</span>}</td>
                    <td className="text-right"><span className="inline-flex gap-1">
                      {c.op !== 'delete' && <button className="btn btn-sm" onClick={() => openEditor({ project: c.project, record: c.uuid, form: null })}>Open</button>}
                      <button className="btn btn-sm btn-danger" onClick={() => confirmDiscard(c.uuid, !c.version)}>Discard</button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="check2-all" title="Everything is sent"><span>No change is waiting on this computer.</span></Empty>}
      </section>

      {!!refused.data?.length && (
        <section className="card p-5 anim-in">
          <CardTitle icon="exclamation-octagon" tone="k-danger" title="Refused by the server" sub="The server kept its own copy; open the record to see why and enter it again" />
          <div className="mt-4 space-y-2">
            {refused.data.map((r) => (
              <div key={r.uuid} className="notice danger">
                <Icon name="exclamation-octagon" />
                <span className="min-w-0 flex-1"><b className="block">{r.project_title} · <span className="idchip">{r.uuid.slice(0, 8)}</span></b><span className="text-sm">{r.sync_error}</span></span>
                <button className="btn btn-sm" onClick={() => openEditor({ project: r.project, record: r.uuid, form: r.form })}>Open</button>
                <button className="btn btn-sm btn-ghost" onClick={() => dismiss.mutate(r.uuid)}>Dismiss</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-5 anim-in">
        <CardTitle icon="clock-history" title="Sync history" sub={`${plural(log.data?.length ?? 0, 'sync')} kept on this computer`} />
        <div className="mt-4 space-y-1">
          {log.data?.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl px-2 py-2" style={{ background: 'transparent' }}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${l.ok ? 'k-ok' : 'k-danger'}`} style={{ background: 'var(--k-soft)', color: 'var(--k)' }}><Icon name={l.ok ? 'check2' : 'x-lg'} /></span>
              <span className="min-w-0 flex-1 truncate font-medium ink" title={l.summary}>{l.summary}</span>
              <span className="muted shrink-0 text-sm">{shortDate(l.at)}</span>
            </div>
          ))}
          {log.data && !log.data.length && <p className="muted py-4 text-center text-sm">No sync yet.</p>}
        </div>
      </section>
    </div>
  );
}
