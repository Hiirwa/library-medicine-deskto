// The record editor in "website" style: the form is drawn by the website's own form engine (public/webform/, the
// same form-runtime.js, formula.js and stylesheet as librarymedicine.online), so questions, skip logic, calculated
// fields, repeated sections, validation and design are identical on both platforms. Answers are saved on this
// computer through the runtime's save() hook and sent with the next sync, in exactly the format the website uses.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { open as pickFile } from '@tauri-apps/plugin-dialog';
import { useAsk } from './Confirm';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { shortDate, uuid as newId } from '../lib/time';
import type { Form, LocalRecord, Project, RecordData, Variable } from '../lib/types';
import { Icon, StatusChip, SyncChip } from './ui';
import { useSession } from '../providers/AppProvider';
import { useUi, type EditorTarget } from '../providers/UiProvider';

type RHFormInstance = { data: RecordData; collectPage: () => void; payload: () => { data: RecordData } };
type FormWindow = Window & { mountForm?: (o: Record<string, unknown>) => RHFormInstance; setTheme?: (dark: boolean) => void; rhForm?: RHFormInstance };

type ProjectExtra = Project & { form_meta?: Record<string, unknown> | null; consent?: { required: boolean; text: string } };

const ALL = 'all';

/** The website's "All variables" form: every variable on one page (Collect::allVariablesForm). */
function allVariablesForm(vars: Variable[]) {
  return {
    title: 'All variables', description: null as string | null, settings: { show_progress: false } as Record<string, unknown>,
    layout: { pages: [{ id: 'all', title: 'All variables', sections: [{ id: 'all', title: '', items: vars.map((v) => ({ type: 'variable', var: v.name })) }], jumps: [] }] },
  };
}

interface Props { target: EditorTarget; project: Project; variables: Variable[]; forms: Form[]; source: LocalRecord | null; onClose: () => void }

export function WebFormEditor({ target, project, variables, forms, source, onClose }: Props) {
  const ask = useAsk();
  const qc = useQueryClient();
  const { toast } = useSession();
  const { dark, openEditor } = useUi();
  const record = target.record ? source : null;
  const isNew = record === null;
  const [id] = useState(() => record?.uuid ?? newId());
  const p = project as ProjectExtra;
  const canAll = project.can.edit;
  const [formId, setFormId] = useState<string>(() => {
    const want = target.form === '__all' ? ALL : (record?.form ?? target.form ?? (target.copyOf ? source?.form : null));
    if (want && forms.some((f) => f.uuid === want)) return want;
    if (!isNew && canAll) return ALL; // records without a form (imported, typed in "All variables") open as on the website
    return forms.length === 1 || !canAll ? (forms[0]?.uuid ?? ALL) : ALL;
  });
  const [touched, setTouched] = useState(!!target.copyOf);
  const [ready, setReady] = useState(false);
  const readOnly = project.status !== 'active' || (!isNew && !project.can.edit) || (isNew && !project.can.add);
  const files = useQuery({ queryKey: ['files', id], queryFn: () => store.filesFor(id) });
  const frame = useRef<HTMLIFrameElement>(null);
  const dataRef = useRef<RecordData | null>(null);

  // first answers: the record, a copy (answers without attachments and calculated values), or nothing (defaults come from the form)
  const initial = useMemo<RecordData>(() => {
    if (record) return { ...record.data };
    if (target.copyOf && source) {
      const d: RecordData = {};
      const skip = new Set(variables.filter((v) => ['file', 'calculated'].includes(v.type)).map((v) => v.name));
      for (const [k, v] of Object.entries(source.data)) if (!skip.has(k)) d[k] = v;
      return d;
    }
    return {};
  }, [record, source, target.copyOf, variables]);
  if (dataRef.current === null) dataRef.current = initial;

  const win = () => frame.current?.contentWindow as FormWindow | null;
  const current = (): RecordData => {
    const f = win()?.rhForm;
    if (!f) return dataRef.current ?? {};
    try { f.collectPage(); return f.payload().data; } catch { return f.data; }
  };

  const persist = async (data: RecordData, status: 'draft' | 'complete') => {
    await store.saveLocalRecord({ uuid: id, project: project.uuid, form: formId === ALL ? null : formId, data, status, isNew: isNew && !(await store.getRecord(id)) });
  };
  const draft = useMutation({
    mutationFn: () => persist(current(), 'draft'),
    onSuccess: async () => { await qc.invalidateQueries(); toast('Draft saved on this computer.'); onClose(); },
    onError: (e) => toast(`Could not save: ${String(e)}`, 'error'),
  });
  const remove = useMutation({
    mutationFn: async () => { if (record) await store.deleteLocalRecord(record); },
    onSuccess: async () => { await qc.invalidateQueries(); toast('Record deleted. The deletion will be sent at the next sync.'); onClose(); },
  });

  // (re)draw the form whenever the chosen form changes; answers typed so far are kept
  useEffect(() => {
    const w = win();
    if (!ready || !w?.mountForm || !files.data) return;
    const f = forms.find((x) => x.uuid === formId);
    const def = f ? { title: f.title, description: f.description ?? null, layout: f.layout, settings: (f.settings ?? {}) as Record<string, unknown> } : allVariablesForm(variables);
    const names = new Map(files.data.map((x) => [x.uuid, x]));
    const showMeta = (def.settings as { show_meta?: boolean }).show_meta !== false;
    w.mountForm({
      mode: readOnly ? 'readonly' : isNew ? 'fill' : 'edit',
      form: def,
      variables,
      meta: isNew && showMeta ? (p.form_meta ?? null) : null,
      data: dataRef.current,
      consent: { required: isNew && !readOnly && !!p.consent?.required, text: p.consent?.text ?? '' },
      offline: false, draftKey: null, auth: false,
      afterLinks: '',
      toast: (msg: string, kind?: string) => toast(msg, kind === 'warning' || kind === 'danger' || kind === 'error' ? 'error' : 'ok'),
      onChange: (form: RHFormInstance) => { dataRef.current = form.data; setTouched(true); },
      save: async (body: { data: RecordData }) => {
        if (readOnly) throw Object.assign(new Error('This record is read-only.'), { status: 403 });
        await persist(body.data, 'complete');
        return { ok: true };
      },
      onDone: async () => {
        await qc.invalidateQueries();
        toast(isNew ? 'Record saved on this computer. It will be sent at the next sync.' : 'Changes saved on this computer. They will be sent at the next sync.');
        onClose();
      },
      fileLabel: (uuid: string) => names.get(uuid)?.name ?? 'File attached',
      openFile: async (uuid: string) => {
        const lf = names.get(uuid) ?? (await store.filesFor(id)).find((x) => x.uuid === uuid);
        if (lf?.local_path) await native.openLocal(lf.local_path);
        else toast('This file is not on this computer yet. It downloads at the next sync.', 'error');
      },
      pickFile: async (variable: string) => {
        const v = variables.find((x) => x.name === variable);
        const picked = await pickFile({ multiple: false, directory: false, title: `Attach a file for "${v?.label || variable}"` });
        if (!picked || Array.isArray(picked)) return null;
        try {
          const lf = await native.importAttachment(picked);
          await store.addLocalFile({ uuid: lf.uuid, project: project.uuid, record: id, variable, name: lf.name, mime: lf.mime, size: lf.size, sha256: lf.sha256, path: lf.path });
          names.set(lf.uuid, { uuid: lf.uuid, name: lf.name, local_path: lf.path } as never);
          setTouched(true);
          return { uuid: lf.uuid, name: lf.name };
        } catch (e) {
          toast(`Could not attach the file: ${String(e)}`, 'error');
          return null;
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, formId, files.data === undefined]);

  useEffect(() => { win()?.setTheme?.(dark); }, [dark, ready]);

  async function close() {
    if (touched && !readOnly && !(await ask('Close without saving your changes?', { title: 'Unsaved changes', kind: 'warning', okLabel: 'Discard changes', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const chooseForm = (next: string) => { dataRef.current = current(); setFormId(next); };
  const title = forms.find((f) => f.uuid === formId)?.title ?? 'All variables';

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="drawer wf-drawer" role="dialog" aria-modal="true" aria-labelledby="edTitle">
        <header className="flex flex-wrap items-center gap-3 px-6 py-4" style={{ background: 'var(--rh-surface)', boxShadow: 'var(--rh-sh-1)' }}>
          <span className="ph-ic" style={{ width: '2.8rem', height: '2.8rem', fontSize: '1.25rem' }}><Icon name={isNew ? 'file-earmark-plus' : 'file-earmark-text'} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="edTitle" className="grad-text truncate text-xl">{isNew ? (target.copyOf ? 'Copy of record' : 'New record') : 'Edit record'} · {title}</h2>
            <p className="muted truncate text-sm selectable">{project.title} · ID {id.slice(0, 8)}{record ? ` · last change ${shortDate(record.updated_at)}` : ''}</p>
          </div>
          {(forms.length > 1 || canAll) && (
            <select className="field w-56" value={formId} onChange={(e) => chooseForm(e.target.value)} aria-label="Form">
              {canAll && <option value={ALL}>All variables</option>}
              {forms.map((f) => <option key={f.uuid} value={f.uuid}>{f.title}</option>)}
            </select>
          )}
          {touched && !readOnly && <span className="chip chip-warn" title="You have changes that are not saved yet"><Icon name="pencil" />Unsaved</span>}
          {record && <span className="flex gap-1.5"><StatusChip status={record.status} /><SyncChip dirty={record.dirty} error={record.sync_error} /></span>}
          {!readOnly && <button className="btn btn-sm" disabled={draft.isPending} onClick={() => draft.mutate()} title="Keep the answers without the required-question check"><Icon name="floppy" />Save draft</button>}
          {!isNew && project.can.add && project.status === 'active' && (
            <button className="btn btn-sm" title="Start a new record with the same answers" onClick={() => openEditor({ project: project.uuid, record: null, form: record?.form ?? null, copyOf: record?.uuid })}><Icon name="copy" />Duplicate</button>
          )}
          {record && project.can.delete && project.status === 'active' && (
            <button className="btn btn-sm btn-danger" onClick={async () => { if (await ask('Delete this record? The deletion is sent at the next sync; on the website it goes to Trash.', { title: 'Delete record', kind: 'warning', okLabel: 'Delete' })) remove.mutate(); }}><Icon name="trash3" />Delete</button>
          )}
          <button className="btn btn-icon" onClick={close} aria-label="Close (Esc)" title="Close (Esc)"><Icon name="x-lg" /></button>
        </header>
        {record?.sync_error && (
          <div className="notice danger mx-6 mt-3">
            <Icon name="exclamation-octagon" />
            <span className="flex-1">The server refused your last change: {record.sync_error}</span>
            <button type="button" className="btn btn-sm" onClick={async () => { await store.clearRecordError(record.uuid); await qc.invalidateQueries(); onClose(); }}>Dismiss</button>
          </div>
        )}
        {readOnly && <div className="notice warn mx-6 mt-3"><Icon name="lock" /><span>Read-only: {project.status !== 'active' ? 'this project is archived.' : 'your role cannot change records here.'}</span></div>}
        <iframe
          ref={frame}
          className="wf-frame"
          title={title}
          src={`${import.meta.env.BASE_URL}webform/form.html?theme=${dark ? 'dark' : 'light'}`}
          onLoad={() => setReady(true)}
        />
      </div>
    </div>
  );
}
