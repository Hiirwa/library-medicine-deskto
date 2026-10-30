import { useMemo, useState } from 'react';
import { Empty, Icon, PageHead, Switch } from '../components/ui';
import { saveFile } from '../lib/csv';
import { useRecords } from '../lib/hooks';
import { loadPins, savePins, type Pin } from '../lib/pins';
import { buildReport, cellText, SECTION_LIST, TEMPLATES, toHtml, toMarkdown, type Block } from '../lib/report';
import { useLocal } from '../lib/useLocal';
import { useSession } from '../providers/AppProvider';
import type { ProjectCtx } from './ProjectView';
import { WebLink } from '../components/WebLink';

function BlockView({ b }: { b: Block }) {
  if (b.t === 'text') return <p className="rp-p selectable">{b.text}</p>;
  if (b.t === 'note') return <p className="rp-note selectable"><Icon name="lightbulb" />{b.text}</p>;
  if (b.t === 'kv') return <dl className="rp-kv">{b.items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="selectable">{v}</dd></div>)}</dl>;
  return (
    <div className="rp-tw">
      {b.caption && <h4>{b.caption}</h4>}
      <div className="tbl-wrap"><table className="tbl compact"><thead><tr>{b.head.map((h, i) => <th key={i} className={i && typeof b.rows[0]?.[i] === 'number' ? 'numc' : ''}>{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'numc' : ''} style={{ whiteSpace: 'normal' }}>{cellText(c)}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

/** Build a report from templates and sections, read it on screen, print / save as PDF, or save as HTML or Markdown. */
export function ReportsView({ project, vars }: ProjectCtx) {
  const { toast, user } = useSession();
  const records = useRecords(project.uuid);
  const [template, setTemplate] = useLocal<string>(`lm_report_tpl_${project.uuid}`, 'summary');
  const [sections, setSections] = useLocal<string[]>(`lm_report_sec_${project.uuid}`, TEMPLATES[0].sections);
  const [notes, setNotes] = useLocal<string>(`lm_report_notes_${project.uuid}`, '');
  const [pins, setPins] = useState<Pin[]>(() => loadPins(project.uuid));
  const hidePii = !project.can.pii;

  const base = useMemo(() => buildReport({ project, vars, recs: records.data ?? [], pins, sections: SECTION_LIST.map((s) => s[0]).filter((id) => sections.includes(id)), author: user?.name || user?.email || 'Library Medicine user', hidePii }),
    [project, vars, records.data, pins, sections, user, hidePii]);
  const model = useMemo(() => (notes.trim() ? { ...base, sections: [{ id: 'notes', title: 'Summary and comments', blocks: notes.trim().split(/\n{2,}/).map((t) => ({ t: 'text' as const, text: t })) }, ...base.sections] } : base), [base, notes]);

  const pick = (id: string) => { setTemplate(id); setSections(TEMPLATES.find((t) => t.id === id)?.sections ?? sections); };
  const toggle = (id: string, on: boolean) => { setTemplate('custom'); setSections(on ? [...sections, id] : sections.filter((x) => x !== id)); };
  const removePin = (id: string) => { const n = pins.filter((p) => p.id !== id); setPins(n); savePins(project.uuid, n); };
  const save = async (ext: 'html' | 'md') => {
    try { const p = await saveFile(`${project.title} - report`, ext, ext === 'html' ? toHtml(model) : toMarkdown(model), ext === 'html' ? 'Web page (HTML)' : 'Markdown'); if (p) toast(`Report saved to ${p}`); }
    catch (e) { toast(`Could not save: ${String(e)}`, 'error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(toMarkdown(model)); toast('Report copied as text.'); } catch { toast('Could not copy.', 'error'); } };

  return (
    <div className="space-y-4 report-page">
      <div className="no-print"><PageHead icon="file-earmark-bar-graph" title="Reports" sub="Turn your project’s figures into a document you can print, share or archive">
        <WebLink project={project.uuid} tab="reports" />
        <button className="btn" onClick={copy}><Icon name="clipboard" />Copy text</button>
        <button className="btn" onClick={() => save('md')}><Icon name="markdown" />Markdown</button>
        <button className="btn" onClick={() => save('html')}><Icon name="filetype-html" />HTML</button>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="printer" />Print / PDF</button>
      </PageHead></div>
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: '21rem minmax(0, 1fr)' }}>
        <aside className="card no-print space-y-4 p-5 anim-in">
          <div><span className="label-cap">Template</span>
            <div className="space-y-2">{TEMPLATES.map((t) => (
              <button key={t.id} type="button" className={`pick ${template === t.id ? 'on' : ''}`} onClick={() => pick(t.id)} aria-pressed={template === t.id}>
                <span className="pk-ic"><Icon name={t.icon} /></span><span className="min-w-0 text-left"><b className="ink block">{t.title}</b><small className="muted">{t.text}</small></span>
              </button>))}</div>
          </div>
          <div><span className="label-cap">Sections</span>
            <div className="space-y-1">{SECTION_LIST.map(([id, ic, label]) => <div key={id} className="flex items-center gap-3 rounded-xl px-2 py-1.5"><Icon name={ic} className="muted" /><span className="flex-1">{label}{id === 'pins' && pins.length > 0 && <span className="count soft ml-2">{pins.length}</span>}</span><Switch on={sections.includes(id)} onChange={(v) => toggle(id, v)} label={label} /></div>)}</div>
          </div>
          {pins.length > 0 && (
            <div><span className="label-cap">Pinned analyses</span>
              <div className="space-y-1.5">{pins.map((p) => <div key={p.id} className="well flex items-center gap-2 px-3 py-2 text-sm"><Icon name="pin-angle" /><span className="min-w-0 flex-1 truncate" title={p.title}>{p.title}</span><button className="btn btn-icon btn-sm" onClick={() => removePin(p.id)} aria-label={`Remove ${p.title}`}><Icon name="x-lg" /></button></div>)}</div>
            </div>
          )}
          <div><label className="label-cap" htmlFor="rp-notes">Your summary (printed at the top)</label><textarea id="rp-notes" className="field" rows={4} placeholder="Write key messages, limitations or recommendations. Leave a blank line between paragraphs." value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {hidePii && <div className="notice info"><Icon name="shield-lock" /><span>Personal-data questions are left out because your role cannot see them.</span></div>}
        </aside>
        <article className="report-doc anim-in">
          <header><span className="rp-logo"><Icon name="clipboard2-pulse" /></span>
            <div><h1>{model.title}</h1><div className="muted">Prepared by {model.author} · {new Date(model.at).toLocaleDateString(undefined, { dateStyle: 'long' })}</div></div></header>
          {model.sections.length > 1 && <nav className="toc no-print" aria-label="Contents">{model.sections.map((s) => <button key={s.id} onClick={() => document.getElementById(`rp-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{s.title}</button>)}</nav>}
          {model.sections.length ? model.sections.map((s) => (
            <section key={s.id} id={`rp-${s.id}`}><h2><Icon name={SECTION_LIST.find((x) => x[0] === s.id)?.[1] ?? 'chat-left-text'} />{s.title}</h2>{s.blocks.map((b, i) => <BlockView key={i} b={b} />)}</section>
          )) : <Empty icon="file-earmark" title="No section selected"><span>Switch on at least one section.</span></Empty>}
        </article>
      </div>
    </div>
  );
}
