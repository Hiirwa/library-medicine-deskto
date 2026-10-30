import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { bytes, plural } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import type { Form } from '../lib/types';
import type { ProjectCtx } from './ProjectView';

const questions = (f: Form) => (f.layout?.pages ?? []).reduce((n, p) => n + (p.items ?? []).filter((i) => i.type === 'variable').length + (p.sections ?? []).reduce((m, s) => m + (s.items ?? []).filter((i) => i.type === 'variable').length, 0), 0);
const sectionsOf = (f: Form) => (f.layout?.pages ?? []).reduce((n, p) => n + Math.max(1, (p.sections ?? []).length), 0);

/** The project's data-entry forms; each one opens the record editor laid out like the form on the website. */
export function FormsView({ project, vars, forms }: ProjectCtx) {
  const { openEditor } = useUi();
  const records = useQuery({ queryKey: ['records', project.uuid, ''], queryFn: () => store.listRecords(project.uuid, '') });
  const per = useMemo(() => { const m = new Map<string, number>(); for (const r of records.data ?? []) m.set(r.form ?? '', (m.get(r.form ?? '') ?? 0) + 1); return m; }, [records.data]);
  const canAdd = project.can.add && project.status === 'active';
  return (
    <div className="space-y-4">
      <PageHead icon="ui-checks-grid" title="Forms" sub={`${plural(forms.length, 'form')} available offline`} />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(19rem, 1fr))' }}>
        {forms.map((f) => (
          <div key={f.uuid} className="pcard anim-in" style={{ cursor: 'default' }}>
            <div className="flex items-start gap-3">
              <span className="pc-ic" style={{ background: 'var(--v-grad)' }}><Icon name="ui-checks-grid" /></span>
              <div className="min-w-0"><h3>{f.title}</h3><div className="mt-1 flex flex-wrap gap-1.5"><span className={`chip ${f.status === 'published' || f.status === 'active' ? 'chip-ok' : ''}`}>{f.status || 'form'}</span></div></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="well px-3 py-2"><b className="num block text-lg ink">{questions(f)}</b><span className="muted text-xs font-bold uppercase">Questions</span></div>
              <div className="well px-3 py-2"><b className="num block text-lg ink">{sectionsOf(f)}</b><span className="muted text-xs font-bold uppercase">Sections</span></div>
              <div className="well px-3 py-2"><b className="num block text-lg ink">{per.get(f.uuid) ?? 0}</b><span className="muted text-xs font-bold uppercase">Records</span></div>
            </div>
            {canAdd && <button className="btn btn-primary" onClick={() => openEditor({ project: project.uuid, record: null, form: f.uuid })}><Icon name="pencil-square" />Fill in this form</button>}
          </div>
        ))}
        <div className="pcard anim-in" style={{ cursor: 'default' }}>
          <div className="flex items-start gap-3">
            <span className="pc-ic"><Icon name="list-ul" /></span>
            <div className="min-w-0"><h3>All variables</h3><p className="muted mt-1 text-sm">Manual entry with every question of the project, in codebook order.</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="well px-3 py-2"><b className="num block text-lg ink">{vars.filter((v) => v.type !== 'calculated').length}</b><span className="muted text-xs font-bold uppercase">Questions</span></div>
            <div className="well px-3 py-2"><b className="num block text-lg ink">{per.get('') ?? 0}</b><span className="muted text-xs font-bold uppercase">Records</span></div>
          </div>
          {canAdd && <button className="btn" onClick={() => openEditor({ project: project.uuid, record: null, form: '__all' })}><Icon name="pencil-square" />Manual entry</button>}
        </div>
      </div>
      {!canAdd && <div className="notice info"><Icon name="info-circle" /><span>{project.status !== 'active' ? 'This project is archived, so no new records can be added.' : 'Your role in this project cannot add records.'}</span></div>}
    </div>
  );
}

const STATE: Record<string, [string, string, string]> = {
  downloaded: ['Available offline', 'chip-ok', 'check2-circle'],
  uploaded: ['Uploaded', 'chip-ok', 'cloud-check'],
  pending_upload: ['Waiting to upload', 'chip-warn', 'cloud-upload'],
  remote: ['Downloads at next sync', '', 'cloud-arrow-down'],
  error: ['Error', 'chip-danger', 'exclamation-octagon'],
};

/** Attachments of the project: which are on this computer, which still have to go up or come down. */
export function FilesView({ project, vars }: ProjectCtx) {
  const { openEditor } = useUi();
  const { toast, sync, online } = useSession();
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ['pfiles', project.uuid], queryFn: () => store.filesForProject(project.uuid) });
  const byName = new Map(vars.map((v) => [v.name, v]));
  const f = files.data ?? [];
  const errors = f.filter((x) => x.state === 'error').length;
  const retry = useMutation({
    mutationFn: store.retryFailedFiles,
    onSuccess: async () => { await qc.invalidateQueries(); toast('Failed files will be tried again.'); if (online) sync(); },
  });
  const open = async (path: string) => { try { await native.openLocal(path); } catch (e) { toast(String(e), 'error'); } };
  return (
    <div className="space-y-4">
      <PageHead icon="paperclip" tone="teal" title="Files" sub={`${plural(f.length, 'attachment')} · ${bytes(f.reduce((a, x) => a + (x.size || 0), 0))}`}>
        <button className="btn" onClick={() => native.revealLocal()}><Icon name="folder2-open" />Open workspace folder</button>
        {errors > 0 && <button className="btn btn-primary" onClick={() => retry.mutate()}><Icon name="arrow-clockwise" />Retry {errors} failed</button>}
      </PageHead>
      <div className="stats">
        <Stat icon="paperclip" value={f.length} label="Attachments" />
        <Stat icon="hdd" value={f.filter((x) => x.local_path).length} label="On this computer" tone="k-ok" />
        <Stat icon="cloud-upload" value={f.filter((x) => x.state === 'pending_upload').length} label="To upload" tone="k-warn" />
        <Stat icon="cloud-arrow-down" value={f.filter((x) => x.state === 'remote').length} label="To download" tone="k-muted" />
        {errors > 0 && <Stat icon="exclamation-octagon" value={errors} label="Errors" tone="k-danger" />}
      </div>
      <div className="tbl-wrap anim-in">
        <table className="tbl">
          <thead><tr><th>File</th><th>Question</th><th>Record</th><th className="numc">Size</th><th>State</th><th /></tr></thead>
          <tbody>
            {f.map((x) => {
              const st = STATE[x.state] ?? STATE.remote;
              return (
                <tr key={x.uuid}>
                  <td className="link" title={x.name}><Icon name="file-earmark" className="mr-2" />{x.name}</td>
                  <td>{x.variable ? byName.get(x.variable)?.label || x.variable : '—'}</td>
                  <td>{x.record ? <button className="idchip cursor-pointer" onClick={() => openEditor({ project: project.uuid, record: x.record, form: null })}>{x.record.slice(0, 8)}</button> : '—'}</td>
                  <td className="numc muted">{bytes(x.size)}</td>
                  <td><span className={`chip ${st[1]}`} title={x.error ?? ''}><Icon name={st[2]} />{st[0]}</span></td>
                  <td className="text-right">
                    {x.local_path && <span className="inline-flex gap-1">
                      <button className="btn btn-sm" onClick={() => open(x.local_path as string)}><Icon name="box-arrow-up-right" />Open</button>
                      <button className="btn btn-sm btn-icon" title="Show in folder" onClick={() => native.revealLocal(x.local_path as string)}><Icon name="folder2-open" /></button>
                    </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {files.data && !f.length && <Empty icon="paperclip" title="No attachments"><span>Files attached to records appear here and are kept for offline use.</span></Empty>}
      </div>
    </div>
  );
}
