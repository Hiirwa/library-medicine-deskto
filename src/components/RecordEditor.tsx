import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { open as pickFile, ask } from '@tauri-apps/plugin-dialog';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { shortDate, uuid as newId } from '../lib/time';
import type { Form, LocalFile, LocalRecord, Project, RecordData, Variable } from '../lib/types';
import { FieldInput } from './FieldInput';
import { useSession } from '../providers/AppProvider';

interface Props {
  project: Project;
  variables: Variable[];
  forms: Form[];
  record: LocalRecord | null; // null = new record
  formUuid: string | null;
  onClose: () => void;
}

type Section = { title: string; description?: string; vars: Variable[] };

/** Questions grouped the way the form shows them on the website (or all variables when no form is used). */
function sectionsFor(form: Form | undefined, vars: Variable[]): Section[] {
  const by = new Map(vars.map((v) => [v.name, v]));
  if (!form?.layout?.pages?.length) return [{ title: 'All questions', vars: vars.filter((v) => v.visibility !== 'hidden') }];
  const out: Section[] = [];
  for (const p of form.layout.pages) {
    const pick = (items?: { type: string; var?: string }[]) => (items ?? []).filter((i) => i.type === 'variable' && i.var && by.has(i.var)).map((i) => by.get(i.var as string) as Variable);
    if (p.items?.length) out.push({ title: p.title || 'Questions', description: p.description, vars: pick(p.items) });
    for (const s of p.sections ?? []) out.push({ title: s.title || p.title || 'Questions', description: s.description, vars: pick(s.items) });
  }
  return out.filter((s) => s.vars.length);
}

export function RecordEditor({ project, variables, forms, record, formUuid, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useSession();
  const isNew = record === null;
  const [id] = useState(() => record?.uuid ?? newId());
  const [data, setData] = useState<RecordData>(() => ({ ...(record?.data ?? {}) }));
  const [touched, setTouched] = useState(false);
  const form = forms.find((f) => f.uuid === (record?.form ?? formUuid)) ;
  const sections = useMemo(() => sectionsFor(form, variables), [form, variables]);
  const readOnly = project.status !== 'active' || (!isNew && !project.can.edit) || (isNew && !project.can.add);
  const files = useQuery({ queryKey: ['files', id], queryFn: () => store.filesFor(id) });
  const missing = sections.flatMap((s) => s.vars).filter((v) => v.required && v.type !== 'calculated' && (data[v.name] === undefined || data[v.name] === null || data[v.name] === '' || (Array.isArray(data[v.name]) && !(data[v.name] as unknown[]).length)));

  const save = useMutation({
    mutationFn: async (status: 'draft' | 'complete') => {
      await store.saveLocalRecord({ uuid: id, project: project.uuid, form: form?.uuid ?? null, data, status, isNew: isNew && !(await store.getRecord(id)) });
    },
    onSuccess: async (_d, status) => {
      await qc.invalidateQueries();
      toast(status === 'draft' ? 'Draft saved on this computer.' : 'Record saved on this computer. It will be sent at the next sync.');
      onClose();
    },
    onError: (e) => toast(`Could not save: ${String(e)}`, 'error'),
  });

  const remove = useMutation({
    mutationFn: async () => { if (record) await store.deleteLocalRecord(record); },
    onSuccess: async () => { await qc.invalidateQueries(); toast('Record deleted. The deletion will be sent at the next sync.'); onClose(); },
  });

  async function attach(v: Variable) {
    const picked = await pickFile({ multiple: false, directory: false, title: `Attach a file for "${v.label || v.name}"` });
    if (!picked || Array.isArray(picked)) return;
    try {
      const f = await native.importAttachment(picked);
      await store.addLocalFile({ uuid: f.uuid, project: project.uuid, record: id, variable: v.name, name: f.name, mime: f.mime, size: f.size, sha256: f.sha256, path: f.path });
      setData((d) => ({ ...d, [v.name]: f.uuid }));
      setTouched(true);
      await qc.invalidateQueries({ queryKey: ['files', id] });
    } catch (e) {
      toast(`Could not attach the file: ${String(e)}`, 'error');
    }
  }

  async function close() {
    if (touched && !(await ask('Close without saving your changes?', { title: 'Unsaved changes', kind: 'warning' }))) return;
    onClose();
  }

  const fileFor = (v: Variable): LocalFile | undefined => (files.data ?? []).find((f) => f.uuid === data[v.name] || (f.variable === v.name && !data[v.name]));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/25" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="edTitle">
        <header className="flex items-center gap-3 bg-white px-6 py-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <h2 id="edTitle" className="truncate text-lg font-bold">{isNew ? 'New record' : 'Edit record'}{form ? ` · ${form.title}` : ''}</h2>
            <p className="truncate text-xs text-slate-500 selectable">{project.title} · ID {id.slice(0, 8)}{record ? ` · last change ${shortDate(record.updated_at)}` : ''}</p>
          </div>
          <button className="btn-ghost" onClick={close}>Close</button>
        </header>
        {record?.sync_error && (
          <div className="flex items-start gap-3 bg-red-50 px-6 py-3 text-sm font-medium text-red-700">
            <span className="flex-1">The server refused your last change: {record.sync_error}</span>
            <button type="button" className="btn-ghost py-1" onClick={async () => { await store.clearRecordError(record.uuid); await qc.invalidateQueries(); onClose(); }}>Dismiss</button>
          </div>
        )}
        {readOnly && <div className="bg-amber-50 px-6 py-3 text-sm font-medium text-amber-800">Read-only: {project.status !== 'active' ? 'this project is archived.' : 'your role cannot change records here.'}</div>}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {sections.map((s, si) => (
            <section key={si} className="card p-5">
              <h3 className="text-base font-bold text-slate-900">{s.title}</h3>
              {s.description && <p className="mt-1 text-sm text-slate-500">{s.description}</p>}
              <div className="mt-4 grid gap-4">
                {s.vars.map((v) => {
                  const f = fileFor(v);
                  return (
                    <div key={v.name}>
                      <label className="mb-1 block text-sm font-semibold text-slate-800" htmlFor={`f_${v.name}`} id={`f_${v.name}_l`}>
                        {v.label || v.name}{v.required && v.type !== 'calculated' && <span className="text-red-600"> *</span>}
                      </label>
                      {v.help_text && <p className="mb-1 text-xs text-slate-500">{v.help_text}</p>}
                      <FieldInput v={v} value={data[v.name]} disabled={readOnly} masked={v.is_pii && !project.can.pii && !isNew}
                        onChange={(val) => { setData((d) => ({ ...d, [v.name]: val })); setTouched(true); }}
                        fileSlot={
                          <div className="flex flex-wrap items-center gap-2">
                            {f ? (
                              <>
                                <span className="chip bg-slate-100 text-slate-700">📎 {f.name}</span>
                                <span className={`chip ${f.state === 'pending_upload' ? 'bg-amber-100 text-amber-800' : f.local_path ? 'bg-emerald-100 text-emerald-800' : f.state === 'error' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {f.state === 'pending_upload' ? 'waiting to upload' : f.local_path ? 'available offline' : f.state === 'error' ? `error: ${f.error}` : 'downloads at next sync'}
                                </span>
                                {f.local_path && <button type="button" className="btn-ghost py-1" onClick={() => native.openLocal(f.local_path as string)}>Open</button>}
                              </>
                            ) : data[v.name] ? <span className="chip bg-slate-100 text-slate-600">File on the server — downloads at next sync</span> : <span className="text-sm text-slate-400">No file</span>}
                            {!readOnly && <button type="button" className="btn-ghost py-1" onClick={() => attach(v)}>{f || data[v.name] ? 'Replace…' : 'Attach file…'}</button>}
                          </div>
                        } />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {!readOnly && (
          <footer className="flex flex-wrap items-center gap-2 bg-white px-6 py-4 shadow-[0_-1px_0_rgba(15,23,42,.06)]">
            {!isNew && project.can.delete && (
              <button className="btn-danger" disabled={remove.isPending} onClick={async () => { if (await ask('Delete this record? The deletion is sent to the server at the next sync.', { title: 'Delete record', kind: 'warning' })) remove.mutate(); }}>Delete</button>
            )}
            <span className="flex-1 text-xs text-slate-500">{missing.length ? `${missing.length} required question${missing.length === 1 ? '' : 's'} not answered yet.` : 'All required questions answered.'}</span>
            <button className="btn-ghost" disabled={save.isPending} onClick={() => save.mutate('draft')}>Save as draft</button>
            <button className="btn-primary" disabled={save.isPending || missing.length > 0} title={missing.length ? 'Answer the required questions, or save as draft' : ''} onClick={() => save.mutate('complete')}>Save record</button>
          </footer>
        )}
      </div>
    </div>
  );
}
