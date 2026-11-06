import { Rich } from './Rich';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { open as pickFile } from '@tauri-apps/plugin-dialog';
import { useAsk } from './Confirm';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { shortDate, uuid as newId } from '../lib/time';
import { bytes, isAnswered, TYPE_ICON, TYPE_LABEL } from '../lib/format';
import { useLocal } from '../lib/useLocal';
import type { Form, LocalFile, LocalRecord, Project, RecordData, Variable } from '../lib/types';
import { FieldInput } from './FieldInput';
import { Icon, StatusChip, SyncChip } from './ui';
import { useProjects } from './Shell';
import { useSession } from '../providers/AppProvider';
import { useUi, type EditorTarget } from '../providers/UiProvider';
import { WebFormEditor } from './WebFormEditor';

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
  const { settings } = useSession();
  const projects = useProjects();
  const project = projects.data?.find((p) => p.uuid === editor?.project);
  const vars = useQuery({ queryKey: ['variables', editor?.project], queryFn: () => store.getVariables(editor!.project), enabled: !!editor });
  const forms = useQuery({ queryKey: ['forms', editor?.project], queryFn: () => store.listForms(editor!.project), enabled: !!editor });
  const rec = useQuery({ queryKey: ['record', editor?.record ?? editor?.copyOf ?? 'new'], queryFn: () => (editor?.record || editor?.copyOf ? store.getRecord((editor.record ?? editor.copyOf) as string) : Promise.resolve(null)), enabled: !!editor, gcTime: 0 });
  if (!editor || !project || !vars.data || !forms.data || rec.isLoading) return null;
  const key = `${editor.record ?? 'new'}-${editor.copyOf ?? ''}`;
  // "website": the website's own form (same look, logic and validation); "classic": the compact desktop editor
  if (settings.formStyle !== 'classic') return <WebFormEditor key={key} target={editor} project={project} variables={vars.data} forms={forms.data} source={rec.data ?? null} onClose={closeEditor} />;
  return <RecordEditor key={key} target={editor} project={project} variables={vars.data} forms={forms.data} source={rec.data ?? null} onClose={closeEditor} />;
}

interface Props { target: EditorTarget; project: Project; variables: Variable[]; forms: Form[]; source: LocalRecord | null; onClose: () => void }

export function RecordEditor({ target, project, variables, forms, source, onClose }: Props) {
  const ask = useAsk();
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
  const [navOpen, setNavOpen] = useLocal<boolean>('lm_editor_nav', true);
  const [wide, setWide] = useLocal<boolean>('lm_editor_wide', false);
  const [find, setFind] = useState('');
  const [qfilter, setQfilter] = useState<'all' | 'required' | 'open'>('all');
  const [flash, setFlash] = useState<string | null>(null);
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
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') { e.preventDefault(); setNavOpen((o) => !o); }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setStep((x) => Math.max(0, Math.min(sections.length - 1, x + (e.key === 'ArrowRight' ? 1 : -1)))); }
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

  const stat = (x: Section) => { const vs = x.vars.filter((v) => v.type !== 'calculated'); return { a: vs.filter((v) => isAnswered(data[v.name])).length, t: vs.length, m: vs.filter((v) => v.required && !isAnswered(data[v.name])).length }; };
  const keep = (x: Section) => x.vars.filter((v) => qfilter === 'all' || (qfilter === 'required' ? v.required : v.type !== 'calculated' && !isAnswered(data[v.name])));
  const isFull = (v: Variable) => ['textarea', 'file', 'gps', 'checkbox'].includes(v.type) || (v.type === 'radio' && ((v.config?.options?.length ?? 0) > 3 || (v.config?.options ?? []).some((o) => o.label.length > 14))) || (v.label ?? '').length > 56 || !!v.help_text;
  const goto = useCallback((name: string, si: number) => {
    setQfilter('all'); setFind(''); setStep(si); setFlash(name);
    setTimeout(() => document.getElementById(`q_${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    setTimeout(() => setFlash(null), 1600);
  }, []);
  const nextMissing = () => {
    const order = sections.flatMap((x, si) => x.vars.filter((v) => v.required && v.type !== 'calculated' && !isAnswered(data[v.name])).map((v) => ({ v, si })));
    const after = order.find((o) => o.si > step) ?? order[0];
    if (after) { setShowMissing(true); goto(after.v.name, after.si); }
  };
  const hits = find.trim() ? sections.flatMap((x, si) => x.vars.filter((v) => `${v.label ?? ''} ${v.name}`.toLowerCase().includes(find.trim().toLowerCase())).map((v) => ({ v, si, title: x.title }))).slice(0, 8) : [];
  const clearAnswer = (v: Variable) => { setData((d) => ({ ...d, [v.name]: null })); setTouched(true); };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="edTitle">
        <header className="flex items-center gap-4 px-6 py-4" style={{ background: 'var(--rh-surface)', boxShadow: 'var(--rh-sh-1)' }}>
          <span className="ph-ic" style={{ width: '2.8rem', height: '2.8rem', fontSize: '1.25rem' }}><Icon name={isNew ? 'file-earmark-plus' : 'file-earmark-text'} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="edTitle" className="grad-text truncate text-xl">{isNew ? (target.copyOf ? 'Copy of record' : 'New record') : 'Edit record'}{form ? ` · ${form.title}` : ''}</h2>
            <p className="muted truncate text-sm selectable">{project.title} · ID {id.slice(0, 8)}{record ? ` · last change ${shortDate(record.updated_at)}` : ''}</p>
          </div>
          {touched && !readOnly && <span className="chip chip-warn" title="You have changes that are not saved yet"><Icon name="pencil" />Unsaved</span>}
          {record && <span className="flex gap-1.5"><StatusChip status={record.status} /><SyncChip dirty={record.dirty} error={record.sync_error} /></span>}
          {!isNew && project.can.add && project.status === 'active' && (
            <button className="btn btn-sm" title="Start a new record with the same answers" onClick={() => openEditor({ project: project.uuid, record: null, form: record?.form ?? null, copyOf: record?.uuid })}><Icon name="copy" />Duplicate</button>
          )}
          <button className="btn btn-icon btn-sm" onClick={() => setWide((w) => !w)} aria-label={wide ? 'Narrow window' : 'Widen window'} title={wide ? 'Narrow window' : 'Widen window'}><Icon name={wide ? 'fullscreen-exit' : 'arrows-angle-expand'} /></button>
          <button className="btn btn-icon" onClick={close} aria-label="Close (Esc)" title="Close (Esc)"><Icon name="x-lg" /></button>
        </header>

        <div className="px-6 pt-3 pb-3" style={{ background: 'var(--rh-surface)' }}>
          <div className="flex items-center gap-3 text-sm">
            <span className="muted font-bold">{answered}/{all.length} answered</span>
            {multi ? (
              <div className="seg-bar flex-1" role="tablist" aria-label="Progress by section">
                {sections.map((x, i) => { const st = stat(x); return (
                  <button key={i} role="tab" aria-selected={i === step} className={`seg-part ${i === step ? 'on' : ''} ${st.m ? 'warn' : st.t && st.a === st.t ? 'full' : ''}`} onClick={() => setStep(i)} title={`${x.title}: ${st.a}/${st.t} answered${st.m ? ` · ${st.m} required missing` : ''}`}>
                    <i style={{ width: `${st.t ? (st.a / st.t) * 100 : 0}%` }} />
                  </button>); })}
              </div>
            ) : <div className={`bar flex-1 ${missing.length ? 'k-brand' : 'k-ok'}`}><i style={{ width: `${pct}%` }} /></div>}
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
            <nav className={`ed-nav ${navOpen ? 'open' : 'rail'}`} aria-label="Sections">
              <div className="ed-nav-head">
                {navOpen && <span className="label-cap" style={{ margin: 0 }}>Sections <span className="count soft">{sections.length}</span></span>}
                <button className="btn btn-icon btn-sm" onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen} aria-label={navOpen ? 'Collapse sections' : 'Expand sections'} title={`${navOpen ? 'Collapse' : 'Expand'} sections (Ctrl+\\)`}><Icon name={navOpen ? 'chevron-bar-left' : 'chevron-bar-right'} /></button>
              </div>
              {navOpen && (
                <div className="ed-find"><div className="field-ic"><Icon name="search" /><input className="field" placeholder="Find a question…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a question" /></div>
                  {find.trim() && <div className="ed-hits">{hits.length ? hits.map((h) => <button key={h.v.name} onClick={() => goto(h.v.name, h.si)}><b className="truncate">{h.v.label || h.v.name}</b><small className="muted truncate">{h.title}</small></button>) : <p className="muted px-2 py-2 text-sm">No question matches.</p>}</div>}
                </div>
              )}
              <div className="steps">
                {sections.map((x, i) => {
                  const st = stat(x); const done = sectionDone(x) && i !== step;
                  return (
                    <button key={i} className={`step ${i === step ? 'on' : ''} ${done ? 'done' : ''} ${st.m && showMissing ? 'warn' : ''}`} onClick={() => setStep(i)} title={`${x.title} — ${st.a}/${st.t} answered${st.m ? `, ${st.m} required missing` : ''}`} aria-current={i === step ? 'step' : undefined}>
                      <span className="n">{done ? <Icon name="check-lg" /> : st.m && showMissing ? <Icon name="exclamation-lg" /> : i + 1}</span>
                      {navOpen && (
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{x.title}</span>
                          <span className="step-sub"><span className="mini"><i style={{ width: `${st.t ? (st.a / st.t) * 100 : 0}%` }} /></span><small>{st.a}/{st.t}</small>{st.m > 0 && <small className="req">{st.m} req.</small>}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {navOpen && missing.length > 0 && <button className="btn btn-sm ed-jump" onClick={nextMissing}><Icon name="arrow-down-circle" />Next required question</button>}
              {navOpen && <p className="help ed-keys"><kbd>Alt ←</kbd><kbd>Alt →</kbd> sections · <kbd>Ctrl \</kbd> menu</p>}
            </nav>
          )}
          <div ref={bodyRef} className="min-w-0 flex-1 overflow-y-auto p-5 pl-2" style={multi ? undefined : { paddingLeft: '1.5rem' }}>
            {shown.map((x, si) => {
              const st = stat(x); const qs = keep(x);
              return (
                <section key={si} className="card ed-section anim-in">
                  <div className="ed-sec-head">
                    <span className="ed-sec-ic">{multi ? <>{(multi ? step : si) + 1}</> : <Icon name="ui-checks-grid" />}</span>
                    <div className="min-w-0 flex-1">
                      {multi && <div className="label-cap" style={{ color: 'var(--rh-teal)', margin: 0 }}>Section {step + 1} of {sections.length}</div>}
                      <h3 className="text-lg">{x.title}</h3>
                      {x.description && <Rich html={x.description} className="muted mt-1 text-sm" />}
                    </div>
                    <span className={`chip ${st.t && st.a === st.t ? 'chip-ok' : st.m ? 'chip-warn' : 'chip-brand'}`}><Icon name={st.t && st.a === st.t ? 'check2-circle' : 'ui-checks'} />{st.a}/{st.t}</span>
                  </div>
                  <div className="ed-filter">
                    <div className="seg">{([['all', 'All questions'], ['required', 'Required'], ['open', 'Unanswered']] as const).map(([k, t]) => <button key={k} className={qfilter === k ? 'on' : ''} onClick={() => setQfilter(k)}>{t}</button>)}</div>
                    {qfilter !== 'all' && <span className="muted text-sm">{qs.length} shown</span>}
                  </div>
                  <div className="q-grid">
                    {qs.map((v) => {
                      const f = fileFor(v);
                      const has = isAnswered(data[v.name]);
                      const miss = showMissing && v.required && v.type !== 'calculated' && !has;
                      const num = x.vars.indexOf(v) + 1;
                      return (
                        <div key={v.name} id={`q_${v.name}`} className={`qc ${has ? 'answered' : ''} ${miss ? 'missing' : ''} ${flash === v.name ? 'flash' : ''} ${isFull(v) ? 'full' : ''}`}>
                          <div className="qc-head">
                            <span className="qc-n">{num}</span>
                            <label className="label qc-label" htmlFor={`f_${v.name}`} id={`f_${v.name}_l`}>
                              {v.label || v.name}{v.required && v.type !== 'calculated' && <span style={{ color: 'var(--rh-danger)' }}> *</span>}
                            </label>
                            {v.is_pii && <span className="chip chip-warn" style={{ padding: '0 .4rem' }}><Icon name="shield-lock" />personal</span>}
                            <span className="qc-type" title={TYPE_LABEL[v.type] ?? v.type}><Icon name={TYPE_ICON[v.type] ?? 'dot'} /></span>
                            {has && !readOnly && v.type !== 'file' && v.type !== 'calculated' && <button type="button" className="qc-clear" onClick={() => clearAnswer(v)} title="Clear this answer" aria-label={`Clear ${v.label || v.name}`}><Icon name="x-circle-fill" /></button>}
                            <span className={`qc-state ${has ? 'ok' : miss ? 'bad' : ''}`} aria-hidden="true"><Icon name={has ? 'check-circle-fill' : miss ? 'exclamation-circle-fill' : 'circle'} /></span>
                          </div>
                          {v.help_text && <Rich html={v.help_text} className="help mb-2" />}
                          {miss && <p className="qc-miss"><Icon name="exclamation-triangle-fill" />This question is required.</p>}
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
                  {!qs.length && <div className="empty"><span className="e-ic"><Icon name={qfilter === 'required' ? 'asterisk' : 'check2-all'} /></span><h3>{qfilter === 'open' ? 'Everything here is answered' : 'No required question in this section'}</h3><button className="btn btn-sm" onClick={() => setQfilter('all')}>Show all questions</button></div>}
                </section>
              );
            })}
            {multi && (
              <div className="ed-pager">
                <button className="pager" disabled={step === 0} onClick={() => setStep((x) => x - 1)}><Icon name="arrow-left" /><span><small>Previous</small><b className="truncate">{step > 0 ? sections[step - 1].title : '—'}</b></span></button>
                <button className="pager next" disabled={step >= sections.length - 1} onClick={() => setStep((x) => x + 1)}><span><small>Next</small><b className="truncate">{step < sections.length - 1 ? sections[step + 1].title : '—'}</b></span><Icon name="arrow-right" /></button>
              </div>
            )}
          </div>
        </div>

        {!readOnly && (
          <footer className="flex flex-wrap items-center gap-2 px-6 py-4" style={{ background: 'var(--rh-surface)', boxShadow: '0 -4px 14px -8px rgba(15, 23, 42, .25)' }}>
            {!isNew && project.can.delete && (
              <button className="btn btn-danger" disabled={remove.isPending} onClick={async () => { if (await ask('Delete this record? The deletion is sent to the server at the next sync.', { title: 'Delete record', kind: 'warning', okLabel: 'Delete' })) remove.mutate(); }}><Icon name="trash3" />Delete</button>
            )}
            {missing.length > 0
              ? <button type="button" className="link-btn amber" onClick={nextMissing}><Icon name="exclamation-circle-fill" />{missing.length} required question{missing.length === 1 ? '' : 's'} not answered — go to next</button>
              : <span className="text-sm" style={{ color: 'var(--rh-success)' }}><Icon name="check2-circle" className="mr-1" />All required questions answered</span>}
            <span className="flex-1" />
            <span className="muted mr-2 text-xs"><kbd>Ctrl S</kbd> save</span>
            <button className="btn btn-soft" disabled={save.isPending} onClick={() => trySave('draft')}><Icon name="floppy" />Save as draft</button>
            <button className="btn btn-primary" disabled={save.isPending} onClick={() => trySave('complete')}><Icon name="check2-circle" />Save record</button>
          </footer>
        )}
      </div>
    </div>
  );
}
