import { Rich } from './Rich';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { open as pickFile, ask } from '@tauri-apps/plugin-dialog';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { shortDate, uuid as newId } from '../lib/time';
import { bytes, isAnswered } from '../lib/format';
import type { Form, LocalFile, LocalRecord, Project, RecordData, Variable } from '../lib/types';
import { FieldInput } from './FieldInput';
import { Icon, StatusChip, SyncChip } from './ui';
import { useProjects } from './Shell';
import { useSession } from '../providers/AppProvider';
import { useUi, type EditorTarget } from '../providers/UiProvider';

type Section = { title: string; description?: string; vars: Variable[] };

/** Questions grouped the way the form shows them on the website (or all variables when no form is used). */
function sectionsFor(form: Form | undefined, vars: Variable[]): Section[] {
  const by = new Map(vars.map((v) => [v.name, v]));
  if (!form?.layout?.pages?.length) return [{ title: 'All questions', vars: vars.filter((v) => v.visibility !== 'hidden' && v.type !== 'note') }];
  const out: Section[] = [];
  for (const p of form.layout.pages) {
    const pick = (items?: { type: string; var?: string }[]) => (items ?? []).filter((i) => i.type === 'variable' && i.var && by.has(i.var)).map((i) => by.get(i.var as string) as Variable);
    if (p.items?.length) out.push({ title: p.title || 'Questions', description: p.description, vars: pick(p.items) });
    for (const s of p.sections ?? []) out.push({ title: s.title || p.title || 'Questions', description: s.description, vars: pick(s.items) });
  }
  return out.filter((s) => s.vars.length);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Default answers; "today" / "now" become the actual date or time on this computer. */
function resolveDefault(v: Variable): unknown {
  const def = v.default;
  if (def === null || def === undefined || def === '' || v.type === 'calculated') return undefined;
  if (typeof def === 'string' && /^(today|now|current|\{?today\}?|\{?now\}?)$/i.test(def.trim())) {
    const d = new Date();
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (v.type === 'date') return date;
    if (v.type === 'datetime') return `${date} ${time}:00`;
    if (v.type === 'time') return time;
    return undefined;
  }
  return def;
}

/** Loads what the editor needs for an editor target (record, project, variables, forms). */
export function EditorHost() {
  const { editor, closeEditor } = useUi();
  const projects = useProjects();
  const project = projects.data?.find((p) => p.uuid === editor?.project);
  const vars = useQuery({ queryKey: ['variables', editor?.project], queryFn: () => store.getVariables(editor!.project), enabled: !!editor });
  const forms = useQuery({ queryKey: ['forms', editor?.project], queryFn: () => store.listForms(editor!.project), enabled: !!editor });
  const rec = useQuery({ queryKey: ['record', editor?.record ?? editor?.copyOf ?? 'new'], queryFn: () => (editor?.record || editor?.copyOf ? store.getRecord((editor.record ?? editor.copyOf) as string) : Promise.resolve(null)), enabled: !!editor, gcTime: 0 });
  if (!editor || !project || !vars.data || !forms.data || rec.isLoading) return null;
  return <RecordEditor key={`${editor.record ?? 'new'}-${editor.copyOf ?? ''}`} target={editor} project={project} variables={vars.data} forms={forms.data} source={rec.data ?? null} onClose={closeEditor} />;
}

interface Props { target: EditorTarget; project: Project; variables: Variable[]; forms: Form[]; source: LocalRecord | null; onClose: () => void }

export function RecordEditor({ target, project, variables, forms, source, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useSession();
  const { openEditor } = useUi();
  const record = target.record ? source : null; // the record being edited (null = new)
  const isNew = record === null;
  const [id] = useState(() => record?.uuid ?? newId());
  const [data, setData] = useState<RecordData>(() => {
    if (record) return { ...record.data };
    if (target.copyOf && source) {
      // a copy keeps the answers, not the attachments or calculated values
      const d: RecordData = {};
      for (const v of variables) if (!['file', 'calculated'].includes(v.type) && source.data[v.name] !== undefined) d[v.name] = source.data[v.name];
      return d;
    }
    const d: RecordData = {};
    for (const v of variables) {
      const def = resolveDefault(v);
      if (def !== undefined) d[v.name] = def;
    }
    return d;
  });
  const [touched, setTouched] = useState(!!target.copyOf);
  const [step, setStep] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  const formId = target.form === '__all' ? null : (record?.form ?? target.form ?? (target.copyOf ? source?.form : null) ?? (forms.length === 1 ? forms[0].uuid : null));
  const form = forms.find((f) => f.uuid === formId);
  const sections = useMemo(() => sectionsFor(form, variables), [form, variables]);
  const readOnly = project.status !== 'active' || (!isNew && !project.can.edit) || (isNew && !project.can.add);
  const files = useQuery({ queryKey: ['files', id], queryFn: () => store.filesFor(id) });
  const bodyRef = useRef<HTMLDivElement>(null);

  const all = sections.flatMap((s) => s.vars).filter((v) => v.type !== 'calculated');
  const answered = all.filter((v) => isAnswered(data[v.name])).length;
  const missing = all.filter((v) => v.required && !isAnswered(data[v.name]));
  const pct = all.length ? Math.round((answered / all.length) * 100) : 0;
  const sectionDone = (s: Section) => s.vars.filter((v) => v.required && v.type !== 'calculated').every((v) => isAnswered(data[v.name])) && s.vars.some((v) => isAnswered(data[v.name]));

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

  const trySave = useCallback((status: 'draft' | 'complete') => {
    if (readOnly || save.isPending) return;
    if (status === 'complete' && missing.length) {
      setShowMissing(true);
      const first = missing[0];
      const si = sections.findIndex((s) => s.vars.includes(first));
      if (si >= 0) setStep(si);
      setTimeout(() => document.getElementById(`q_${first.name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      toast(`${missing.length} required question${missing.length === 1 ? ' is' : 's are'} not answered. Answer ${missing.length === 1 ? 'it' : 'them'} or save as draft.`, 'error');
      return;
    }
    save.mutate(status);
  }, [readOnly, save, missing, sections, toast]);

  async function close() {
    if (touched && !readOnly && !(await ask('Close without saving your changes?', { title: 'Unsaved changes', kind: 'warning', okLabel: 'Discard changes', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); trySave(record?.status === 'draft' || isNew ? (missing.length ? 'draft' : 'complete') : 'complete'); }
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('select')) { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

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

  const fileFor = (v: Variable): LocalFile | undefined => (files.data ?? []).find((f) => f.uuid === data[v.name] || (f.variable === v.name && !data[v.name]));
  const multi = sections.length > 1;
  const sec = sections[Math.min(step, sections.length - 1)];
  const shown = multi ? [sec] : sections;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="edTitle">
        <header className="flex items-center gap-4 px-6 py-4" style={{ background: 'var(--rh-surface)', boxShadow: 'var(--rh-sh-1)' }}>
          <span className="ph-ic" style={{ width: '2.8rem', height: '2.8rem', fontSize: '1.25rem' }}><Icon name={isNew ? 'file-earmark-plus' : 'file-earmark-text'} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="edTitle" className="grad-text truncate text-xl">{isNew ? (target.copyOf ? 'Copy of record' : 'New record') : 'Edit record'}{form ? ` · ${form.title}` : ''}</h2>
            <p className="muted truncate text-sm selectable">{project.title} · ID {id.slice(0, 8)}{record ? ` · last change ${shortDate(record.updated_at)}` : ''}</p>
          </div>
          {record && <span className="flex gap-1.5"><StatusChip status={record.status} /><SyncChip dirty={record.dirty} error={record.sync_error} /></span>}
          {!isNew && project.can.add && project.status === 'active' && (
            <button className="btn btn-sm" title="Start a new record with the same answers" onClick={() => openEditor({ project: project.uuid, record: null, form: record?.form ?? null, copyOf: record?.uuid })}><Icon name="copy" />Duplicate</button>
          )}
          <button className="btn btn-icon" onClick={close} aria-label="Close (Esc)" title="Close (Esc)"><Icon name="x-lg" /></button>
        </header>

        <div className="px-6 pt-3" style={{ background: 'var(--rh-surface)' }}>
          <div className="flex items-center gap-3 pb-3 text-sm">
            <span className="muted font-bold">{answered}/{all.length} answered</span>
            <div className={`bar flex-1 ${missing.length ? 'k-brand' : 'k-ok'}`}><i style={{ width: `${pct}%` }} /></div>
            <b className="num" style={{ color: missing.length ? 'var(--rh-brand)' : 'var(--rh-success)' }}>{pct}%</b>
          </div>
        </div>

        {record?.sync_error && (
          <div className="notice danger mx-6 mt-4">
            <Icon name="exclamation-octagon" />
            <span className="flex-1">The server refused your last change: {record.sync_error}</span>
            <button type="button" className="btn btn-sm" onClick={async () => { await store.clearRecordError(record.uuid); await qc.invalidateQueries(); onClose(); }}>Dismiss</button>
          </div>
        )}
        {readOnly && <div className="notice warn mx-6 mt-4"><Icon name="lock" /><span>Read-only: {project.status !== 'active' ? 'this project is archived.' : 'your role cannot change records here.'}</span></div>}

        <div className="flex min-h-0 flex-1">
          {multi && (
            <nav className="w-64 shrink-0 overflow-y-auto p-4" aria-label="Sections">
              <div className="label-cap px-2">Sections</div>
              <div className="steps">
                {sections.map((s, i) => (
                  <button key={i} className={`step ${i === step ? 'on' : ''} ${sectionDone(s) ? 'done' : ''}`} onClick={() => setStep(i)}>
                    <span className="n">{sectionDone(s) && i !== step ? <Icon name="check-lg" /> : i + 1}</span><span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </button>
                ))}
              </div>
            </nav>
          )}
          <div ref={bodyRef} className="min-w-0 flex-1 overflow-y-auto p-5 pl-2" style={multi ? undefined : { paddingLeft: '1.5rem' }}>
            {shown.map((s, si) => (
              <section key={si} className="card p-6 anim-in" style={{ marginBottom: '1.2rem' }}>
                {multi && <div className="label-cap" style={{ color: 'var(--rh-teal)' }}>Section {step + 1} of {sections.length}</div>}
                <h3 className="text-lg">{s.title}</h3>
                {s.description && <Rich html={s.description} className="muted mt-1 text-sm" />}
                <div className="mt-5">
                  {s.vars.map((v) => {
                    const f = fileFor(v);
                    const miss = showMissing && v.required && v.type !== 'calculated' && !isAnswered(data[v.name]);
                    return (
                      <div key={v.name} id={`q_${v.name}`} className={`q ${miss ? 'missing' : ''}`}>
                        <label className="label" htmlFor={`f_${v.name}`} id={`f_${v.name}_l`}>
                          {v.label || v.name}{v.required && v.type !== 'calculated' && <span style={{ color: 'var(--rh-danger)' }}> *</span>}
                          {v.is_pii && <span className="chip chip-warn ml-2" style={{ padding: '0 .4rem' }}><Icon name="shield-lock" />personal</span>}
                        </label>
                        {v.help_text && <Rich html={v.help_text} className="help mb-1.5" />}
                        <FieldInput v={v} value={data[v.name]} disabled={readOnly} masked={v.is_pii && !project.can.pii && !isNew}
                          onChange={(val) => { setData((d) => ({ ...d, [v.name]: val })); setTouched(true); }}
                          fileSlot={
                            <div className="well flex flex-wrap items-center gap-2 p-3">
                              {f ? (
                                <>
                                  <span className="chip chip-brand"><Icon name="paperclip" />{f.name}</span>
                                  <span className="muted text-xs">{bytes(f.size)}</span>
                                  <span className={`chip ${f.state === 'pending_upload' ? 'chip-warn' : f.local_path ? 'chip-ok' : f.state === 'error' ? 'chip-danger' : ''}`}>
                                    {f.state === 'pending_upload' ? 'waiting to upload' : f.local_path ? 'available offline' : f.state === 'error' ? `error: ${f.error}` : 'downloads at next sync'}
                                  </span>
                                  {f.local_path && <button type="button" className="btn btn-sm" onClick={() => native.openLocal(f.local_path as string)}><Icon name="box-arrow-up-right" />Open</button>}
                                </>
                              ) : data[v.name] ? <span className="chip">File on the server — downloads at next sync</span> : <span className="muted text-sm">No file attached</span>}
                              {!readOnly && <button type="button" className="btn btn-sm ml-auto" onClick={() => attach(v)}><Icon name="paperclip" />{f || data[v.name] ? 'Replace…' : 'Attach file…'}</button>}
                            </div>
                          } />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {multi && (
              <div className="flex justify-between">
                <button className="btn" disabled={step === 0} onClick={() => setStep((x) => x - 1)}><Icon name="arrow-left" />Previous</button>
                <button className="btn" disabled={step >= sections.length - 1} onClick={() => setStep((x) => x + 1)}>Next<Icon name="arrow-right" /></button>
              </div>
            )}
          </div>
        </div>

        {!readOnly && (
          <footer className="flex flex-wrap items-center gap-2 px-6 py-4" style={{ background: 'var(--rh-surface)', boxShadow: '0 -1px 0 color-mix(in srgb, var(--rh-muted) 12%, transparent)' }}>
            {!isNew && project.can.delete && (
              <button className="btn btn-danger" disabled={remove.isPending} onClick={async () => { if (await ask('Delete this record? The deletion is sent to the server at the next sync.', { title: 'Delete record', kind: 'warning', okLabel: 'Delete' })) remove.mutate(); }}><Icon name="trash3" />Delete</button>
            )}
            <span className="flex-1 text-sm" style={{ color: missing.length ? 'var(--rh-warning)' : 'var(--rh-success)' }}>
              <Icon name={missing.length ? 'exclamation-circle' : 'check2-circle'} className="mr-1" />
              {missing.length ? `${missing.length} required question${missing.length === 1 ? '' : 's'} not answered yet` : 'All required questions answered'}
            </span>
            <span className="muted mr-2 text-xs"><kbd>Ctrl S</kbd> save</span>
            <button className="btn btn-soft" disabled={save.isPending} onClick={() => trySave('draft')}><Icon name="floppy" />Save as draft</button>
            <button className="btn btn-primary" disabled={save.isPending} onClick={() => trySave('complete')}><Icon name="check2-circle" />Save record</button>
          </footer>
        )}
      </div>
    </div>
  );
}
