import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
import { saveCsv } from '../lib/csv';
import { FORMAT_LABELS, IMPORT_FORMATS, readFileAny, readText, type Loaded } from '../lib/readers';
import { readJson, writeJson } from '../lib/useLocal';
import * as store from '../lib/db';
import { plural, TYPE_LABEL } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { uuid } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import type { RecordData, Variable } from '../lib/types';
import type { ProjectCtx } from './ProjectView';

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const MAX_ROWS = 20000;
const sig = (h: string[]) => h.map(norm).join('|');
type Conv = { ok: true; value: unknown } | { ok: false; error: string };

function optionMap(v: Variable) { const m = new Map<string, string>(); for (const o of v.config?.options ?? []) { m.set(String(o.value).toLowerCase(), o.value); m.set(String(o.label).toLowerCase(), o.value); } return m; }
const pad = (n: string) => n.padStart(2, '0');

function convert(v: Variable, raw: string, opts: Map<string, string>): Conv {
  const s = raw.trim();
  if (s === '') return { ok: true, value: undefined };
  const range = (n: number): Conv => {
    const { min, max } = v.config ?? {};
    if (typeof min === 'number' && n < min) return { ok: false, error: `${n} is below the minimum (${min})` };
    if (typeof max === 'number' && n > max) return { ok: false, error: `${n} is above the maximum (${max})` };
    return { ok: true, value: n };
  };
  switch (v.type) {
    case 'integer': case 'decimal': case 'number': case 'rating': case 'slider': {
      const t = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s.replace(/\s/g, '');
      const n = Number(t);
      if (!Number.isFinite(n) || t === '') return { ok: false, error: `“${s}” is not a number` };
      if (v.type === 'integer' && !Number.isInteger(n)) return { ok: false, error: `“${s}” is not a whole number` };
      return range(n);
    }
    case 'boolean': {
      const x = s.toLowerCase();
      if (['1', 'yes', 'y', 'true', 'oui', 'si', 'sí', 'ego', 'yego'].includes(x)) return { ok: true, value: '1' };
      if (['0', 'no', 'n', 'false', 'non', 'oya'].includes(x)) return { ok: true, value: '0' };
      return { ok: false, error: `“${s}” is not Yes or No` };
    }
    case 'radio': case 'dropdown': { const c = opts.get(s.toLowerCase()); return c !== undefined ? { ok: true, value: c } : { ok: false, error: `“${s}” is not one of the answer options` }; }
    case 'checkbox': {
      const parts = s.split(/[;|]/).map((x) => x.trim()).filter(Boolean); const out: string[] = [];
      for (const p of parts) { const c = opts.get(p.toLowerCase()); if (c === undefined) return { ok: false, error: `“${p}” is not one of the answer options` }; if (!out.includes(c)) out.push(c); }
      return { ok: true, value: out };
    }
    case 'date': {
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      if (m) return { ok: true, value: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
      if (m) return { ok: true, value: `${m[3]}-${pad(m[2])}-${pad(m[1])}` };
      return { ok: false, error: `“${s}” is not a date (use YYYY-MM-DD)` };
    }
    case 'datetime': {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
      return m ? { ok: true, value: `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4] ?? '0')}:${m[5] ?? '00'}:${m[6] ?? '00'}` } : { ok: false, error: `“${s}” is not a date and time` };
    }
    case 'time': { const m = /^(\d{1,2}):(\d{2})/.exec(s); return m ? { ok: true, value: `${pad(m[1])}:${m[2]}` } : { ok: false, error: `“${s}” is not a time (HH:MM)` }; }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { ok: true, value: s } : { ok: false, error: `“${s}” is not an email address` };
    default: return { ok: true, value: s };
  }
}

interface Checked { line: number; data: RecordData; status: 'draft' | 'complete'; id: string | null; update: boolean; errors: string[]; warnings: string[]; blank: boolean; raw: string[] }

/** Four steps: choose a file, match its columns to questions, review problems, import. Nothing is saved until the last step. */
export function ImportView({ project, vars, forms }: ProjectCtx) {
  const { toast, sync, online } = useSession();
  const { go } = useUi();
  const qc = useQueryClient();
  const existing = useRecords(project.uuid);
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<string[]>([]);
  const [form, setForm] = useState<string>('');
  const [statusMode, setStatusMode] = useState<'auto' | 'draft' | 'complete'>('auto');
  const [update, setUpdate] = useState(true);
  const [skipBad, setSkipBad] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [paste, setPaste] = useState('');
  const [remembered, setRemembered] = useState(false);
  const hidePii = !project.can.pii;
  const canAdd = project.can.add && project.status === 'active';
  const targets = useMemo(() => vars.filter((v) => !['note', 'calculated', 'file', 'gps'].includes(v.type) && !(hidePii && v.is_pii)), [vars, hidePii]);
  const byName = useMemo(() => new Map(targets.map((v) => [v.name, v])), [targets]);
  const optMaps = useMemo(() => new Map(targets.map((v) => [v.name, optionMap(v)])), [targets]);
  const head = table[0] ?? [];
  const body = useMemo(() => table.slice(1), [table]);

  function autoMap(rows: string[][]): string[] {
    const saved = readJson<Record<string, string[]>>(`lm_map_${project.uuid}`, {})[sig(rows[0])];
    if (saved && saved.length === rows[0].length && saved.every((m) => !m || m.startsWith('__') || byName.has(m))) { setRemembered(true); return saved; }
    setRemembered(false);
    const used = new Set<string>();
    return rows[0].map((h) => {
      const n = norm(h);
      if (n === 'recordid' || n === 'uuid') return '__id';
      if (n === 'status') return '__status';
      if (['createdat', 'updatedat', 'syncstate'].includes(n)) return '';
      const v = targets.find((t) => !used.has(t.name) && (norm(t.name) === n || norm(t.label ?? '') === n));
      if (v) used.add(v.name);
      return v?.name ?? '';
    });
  }
  function openSheet(l: Loaded, i: number, name: string) {
    const rows = l.sheets[i].rows;
    if (rows.length < 2) { toast('That sheet has no data rows.', 'error'); return; }
    if (rows.length - 1 > MAX_ROWS) { toast(`Import up to ${MAX_ROWS.toLocaleString()} rows at a time.`, 'error'); return; }
    setLoaded(l); setSheetIdx(i); setTable(rows); setMap(autoMap(rows)); setFileName(name); setStep(2); setResult(null);
  }
  async function load(file: File | undefined | null) {
    if (!file) return;
    try { const l = await readFileAny(file); openSheet(l, 0, file.name); }
    catch (e) { toast(`Could not read the file: ${String(e).replace(/^Error: /, '')}`, 'error'); }
  }
  function loadPasted() {
    try { const l = readText(paste); openSheet(l, 0, 'Pasted data'); } catch (e) { toast(String(e).replace(/^Error: /, ''), 'error'); }
  }

  const checked = useMemo<Checked[]>(() => {
    if (step < 3) return [];
    const have = new Map((existing.data ?? []).map((r) => [r.uuid, r]));
    const req = targets.filter((v) => v.required);
    return body.map((cells, i) => {
      const data: RecordData = {}; const errors: string[] = []; const warnings: string[] = []; let id: string | null = null; let fileStatus: string | null = null; let any = false;
      map.forEach((target, c) => {
        const raw = cells[c] ?? '';
        if (!target) return;
        if (target === '__id') { id = raw.trim() || null; return; }
        if (target === '__status') { fileStatus = raw.trim().toLowerCase(); return; }
        if (raw.trim() !== '') any = true;
        const v = byName.get(target); if (!v) return;
        const r = convert(v, raw, optMaps.get(v.name)!);
        if (!r.ok) errors.push(`${v.label || v.name}: ${r.error}`); else if (r.value !== undefined) data[v.name] = r.value;
      });
      const prior = update && id ? have.get(id) : undefined;
      const merged = prior ? { ...prior.data, ...data } : data;
      const missing = req.filter((v) => { const x = merged[v.name]; return x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length); });
      let status: 'draft' | 'complete' = statusMode === 'auto' ? (fileStatus === 'draft' ? 'draft' : missing.length ? 'draft' : 'complete') : statusMode;
      if (missing.length) { if (statusMode === 'complete') errors.push(`Required: ${missing.map((v) => v.label || v.name).join(', ')}`); else { status = 'draft'; warnings.push(`Saved as draft: ${missing.length} required question${missing.length === 1 ? '' : 's'} empty`); } }
      return { line: i + 2, data: merged, status, id: prior ? id : null, update: !!prior, errors, warnings, blank: !any, raw: cells };
    });
  }, [step, body, map, byName, optMaps, targets, statusMode, update, existing.data]);

  const live = checked.filter((r) => !r.blank);
  const bad = live.filter((r) => r.errors.length);
  const good = live.filter((r) => !r.errors.length);
  const toWrite = skipBad ? good : live;
  const drafts = good.filter((r) => r.status === 'draft').length;
  const mapped = map.filter((m) => m && !m.startsWith('__')).length;
  const dupTargets = map.filter((m, i) => m && !m.startsWith('__') && map.indexOf(m) !== i);

  async function run() {
    setStep(4); setProgress({ done: 0, total: toWrite.length });
    let created = 0; let updated = 0;
    try {
      for (let i = 0; i < toWrite.length; i++) {
        const r = toWrite[i];
        if (r.update && r.id) { await store.saveLocalRecord({ uuid: r.id, project: project.uuid, form: existing.data?.find((x) => x.uuid === r.id)?.form ?? (form || null), data: r.data, status: r.status, isNew: false }); updated++; }
        else { await store.saveLocalRecord({ uuid: uuid(), project: project.uuid, form: form || null, data: r.data, status: r.status, isNew: true }); created++; }
        if (i % 25 === 0) setProgress({ done: i + 1, total: toWrite.length });
      }
      setProgress({ done: toWrite.length, total: toWrite.length });
      setResult({ created, updated, skipped: live.length - toWrite.length });
      await qc.invalidateQueries();
      toast(`Imported ${plural(created + updated, 'record')}. They will be sent at the next sync.`);
    } catch (e) { toast(`Import stopped: ${String(e)}`, 'error'); setResult({ created, updated, skipped: live.length - created - updated }); await qc.invalidateQueries(); }
  }

  async function problems() {
    try { const p = await saveCsv(`${project.title} - import problems`, [['file_line', 'problems', ...head], ...bad.map((r) => [r.line, r.errors.join(' | '), ...r.raw])]); if (p) toast(`Saved to ${p}`); } catch (e) { toast(String(e), 'error'); }
  }
  async function template() {
    try { const p = await saveCsv(`${project.title} - import template`, [['record_id', ...targets.map((v) => v.name)]]); if (p) toast(`Template saved to ${p}`); } catch (e) { toast(String(e), 'error'); }
  }
  const reset = () => { setLoaded(null); setPaste(''); setStep(1); setTable([]); setMap([]); setFileName(''); setResult(null); setProgress(null); if (fileInput.current) fileInput.current.value = ''; };

  const STEPS: [string, string][] = [['1', 'Choose file'], ['2', 'Match columns'], ['3', 'Review'], ['4', 'Import']];
  return (
    <div className="space-y-4">
      <PageHead icon="cloud-upload" tone="teal" title="Import" sub="Bring records from Excel, ODS, CSV, JSON, XML, HTML tables or pasted cells"><button className="btn" onClick={template}><Icon name="file-earmark-arrow-down" />Download template</button></PageHead>
      {!canAdd && <div className="notice warn"><Icon name="lock" /><span>{project.status !== 'active' ? 'This project is archived, so records cannot be imported.' : 'Your role in this project cannot add records.'}</span></div>}
      <ol className="wiz" aria-label="Import steps">{STEPS.map(([n, t], i) => <li key={n} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><span className="n">{step > i + 1 ? <Icon name="check-lg" /> : n}</span>{t}</li>)}</ol>

      {step === 1 && (
        <section className="card space-y-5 p-6 anim-in">
          <div className={`dropzone ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}>
            <span className="e-ic"><Icon name="file-earmark-spreadsheet" /></span>
            <h3>Choose a file to import</h3>
            <p className="muted max-w-xl">The first row of the table must hold the column names. Excel workbooks with several sheets are supported; you pick the sheet next.</p>
            <input ref={fileInput} type="file" accept={IMPORT_FORMATS.join(',')} className="hidden" onChange={(e) => load(e.target.files?.[0])} aria-label="Choose file" />
            <button className="btn btn-primary btn-lg" disabled={!canAdd} onClick={() => fileInput.current?.click()}><Icon name="folder2-open" />Browse files</button>
          </div>
          <div><span className="label-cap">Accepted formats</span>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>{FORMAT_LABELS.map(([ic, t, d]) => <div key={t} className="well flex items-center gap-3 px-3 py-2"><span className="ic-sm"><Icon name={ic} /></span><span className="min-w-0"><b className="ink block">{t}</b><small className="muted">{d}</small></span></div>)}</div>
            <p className="help mt-2">Old .xls files: open them in Excel and use Save As → Excel Workbook (.xlsx) or CSV.</p></div>
          <div><span className="label-cap">Or paste data</span>
            <textarea className="field" rows={5} placeholder="Copy cells in Excel, Google Sheets or a web page and paste them here (Ctrl+V). CSV, JSON, XML and Markdown tables also work." value={paste} onChange={(e) => setPaste(e.target.value)} disabled={!canAdd} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '.88rem' }} />
            <div className="mt-2 flex items-center gap-3"><button className="btn btn-primary" disabled={!canAdd || !paste.trim()} onClick={loadPasted}><Icon name="clipboard-check" />Use pasted data</button>
              <button className="btn" disabled={!canAdd} onClick={async () => { try { setPaste(await navigator.clipboard.readText()); } catch { toast('Could not read the clipboard. Paste with Ctrl+V.', 'error'); } }}><Icon name="clipboard" />Paste from clipboard</button></div></div>
        </section>
      )}

      {step === 2 && (
        <StickyColumns className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 21rem' }}>
          <section className="card p-5 anim-in">
            <div className="flex items-center gap-3"><span className="ic-sm"><Icon name="file-earmark-check" /></span><div className="min-w-0 flex-1"><b className="ink block truncate">{fileName}</b><span className="muted text-sm">{plural(body.length, 'row')} · {plural(head.length, 'column')} · {plural(mapped, 'column')} matched</span></div><button className="btn btn-sm" onClick={reset}><Icon name="arrow-left" />Other file</button></div>
            {loaded && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="chip chip-brand"><Icon name="file-earmark-check" />{loaded.format}</span>{loaded.sheets.length > 1 && <><span className="muted text-sm">Sheet</span><div className="seg">{loaded.sheets.map((sh, i) => <button key={sh.name} className={sheetIdx === i ? 'on' : ''} onClick={() => openSheet(loaded, i, fileName)}>{sh.name}</button>)}</div></>}{remembered && <span className="chip chip-ok" title="You used this column layout before"><Icon name="magic" />Matching remembered</span>}</div>}
            <div className="tbl-wrap mt-4" style={{ maxHeight: 'calc(100vh - 27rem)' }}>
              <table className="tbl compact">
                <thead><tr><th>Column in file</th><th>Example</th><th>Goes into</th></tr></thead>
                <tbody>{head.map((h, c) => (
                  <tr key={c}>
                    <td className="link">{h || `(column ${c + 1})`}</td>
                    <td className="muted" title={body.slice(0, 3).map((r) => r[c]).join(' · ')}>{body.slice(0, 3).map((r) => r[c]).filter(Boolean).join(' · ') || '—'}</td>
                    <td style={{ minWidth: '17rem' }}>
                      <select className="field" value={map[c] ?? ''} onChange={(e) => setMap(map.map((m, i) => (i === c ? e.target.value : m)))} aria-label={`Map ${h}`}>
                        <option value="">Ignore this column</option>
                        <option value="__id">Record id (update existing)</option>
                        <option value="__status">Status (draft / complete)</option>
                        <optgroup label="Questions">{targets.map((v) => <option key={v.name} value={v.name}>{v.label || v.name} — {TYPE_LABEL[v.type] ?? v.type}</option>)}</optgroup>
                      </select>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
            {dupTargets.length > 0 && <div className="notice warn mt-3"><Icon name="exclamation-triangle" /><span>Two columns go into the same question; the later one wins.</span></div>}
          </section>
          <aside className="card space-y-4 p-5 anim-in">
            <div><label className="label" htmlFor="imp-form">Add to form</label><select id="imp-form" className="field" value={form} onChange={(e) => setForm(e.target.value)}><option value="">No specific form</option>{forms.map((f) => <option key={f.uuid} value={f.uuid}>{f.title}</option>)}</select></div>
            <div><span className="label-cap">Status of imported records</span><div className="seg w-full">{([['auto', 'Automatic'], ['draft', 'Draft'], ['complete', 'Complete']] as const).map(([k, t]) => <button key={k} className={`flex-1 ${statusMode === k ? 'on' : ''}`} onClick={() => setStatusMode(k)}>{t}</button>)}</div><p className="help mt-2">Automatic: complete when every required question is answered, otherwise draft.</p></div>
            <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 accent-[var(--rh-brand)]" checked={update} onChange={(e) => setUpdate(e.target.checked)} /><span><b className="ink block">Update matching records</b><span className="muted text-sm">If a Record id in the file exists on this computer, its answers are updated instead of adding a copy.</span></span></label>
            <button className="btn btn-primary btn-lg w-full" disabled={!mapped} onClick={() => { const all = readJson<Record<string, string[]>>(`lm_map_${project.uuid}`, {}); all[sig(head)] = map; writeJson(`lm_map_${project.uuid}`, all); setStep(3); }}>Review {plural(body.length, 'row')}<Icon name="arrow-right" /></button>
          </aside>
        </StickyColumns>
      )}

      {step === 3 && (<>
        <div className="stats">
          <Stat icon="table" value={live.length} label="Rows read" />
          <Stat icon="check2-circle" value={good.length} label="Ready" tone="k-ok" />
          <Stat icon="pencil" value={drafts} label="Will be drafts" tone="k-muted" />
          <Stat icon="exclamation-octagon" value={bad.length} label="With problems" tone={bad.length ? 'k-danger' : 'k-muted'} />
          <Stat icon="arrow-repeat" value={good.filter((r) => r.update).length} label="Updates" tone="k-teal" />
        </div>
        <section className="card p-5 anim-in">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-lg">{bad.length ? 'Fix or skip the rows below' : 'Everything looks good'}</h2>
            {bad.length > 0 && <button className="btn btn-sm" onClick={problems}><Icon name="filetype-csv" />Download problems</button>}
            {bad.length > 0 && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={skipBad} onChange={(e) => setSkipBad(e.target.checked)} />Skip rows with problems</label>}
          </div>
          {bad.length > 0 ? (
            <div className="tbl-wrap mt-3" style={{ maxHeight: '19rem' }}><table className="tbl compact"><thead><tr><th>Line</th><th>Problem</th></tr></thead>
              <tbody>{bad.slice(0, 150).map((r) => <tr key={r.line}><td className="num">{r.line}</td><td style={{ whiteSpace: 'normal' }}>{r.errors.join(' · ')}</td></tr>)}</tbody></table></div>
          ) : <div className="notice ok mt-3"><Icon name="check2-circle" /><span>All {plural(good.length, 'row')} passed the checks.</span></div>}
          {live.some((r) => r.warnings.length && !r.errors.length) && <div className="notice info mt-3"><Icon name="info-circle" /><span>{plural(live.filter((r) => r.warnings.length && !r.errors.length).length, 'row')} will be saved as drafts because required questions are empty.</span></div>}
        </section>
        <section className="card p-5 anim-in">
          <h3 className="mb-3 text-base">Preview of the first rows as they will be saved</h3>
          <div className="tbl-wrap"><table className="tbl compact"><thead><tr><th>Line</th>{targets.filter((v) => map.includes(v.name)).slice(0, 6).map((v) => <th key={v.name}>{v.label || v.name}</th>)}<th>Status</th></tr></thead>
            <tbody>{good.slice(0, 6).map((r) => <tr key={r.line}><td className="num">{r.line}</td>{targets.filter((v) => map.includes(v.name)).slice(0, 6).map((v) => <td key={v.name}>{Array.isArray(r.data[v.name]) ? (r.data[v.name] as string[]).join(', ') : String(r.data[v.name] ?? '')}</td>)}<td>{r.status}</td></tr>)}</tbody></table></div>
        </section>
        <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => setStep(2)}><Icon name="arrow-left" />Back to matching</button><span className="flex-1" /><button className="btn btn-primary btn-lg" disabled={!toWrite.length} onClick={run}><Icon name="cloud-upload" />Import {plural(toWrite.length, 'record')}</button></div>
      </>)}

      {step === 4 && (
        <section className="card p-8 text-center anim-in">
          {!result ? (<><Icon name="arrow-repeat" className="spin muted text-4xl" /><h2 className="mt-3 text-xl">Importing…</h2>
            <div className="bar mx-auto mt-4 max-w-md" style={{ height: '.7rem' }}><i style={{ width: `${progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0}%` }} /></div>
            <p className="muted mt-2 num">{progress?.done ?? 0} / {progress?.total ?? 0}</p></>) : (
            <Empty icon="check2-circle" title={`${plural(result.created, 'record')} added${result.updated ? `, ${plural(result.updated, 'record')} updated` : ''}`}>
              <span>{result.skipped ? `${plural(result.skipped, 'row')} skipped. ` : ''}The records are saved on this computer and queued for the next sync.</span>
              <div className="mt-3 flex flex-wrap justify-center gap-2"><button className="btn btn-primary" onClick={() => go({ page: 'project', project: project.uuid, tab: 'data' })}><Icon name="table" />View the data</button>{online && <button className="btn" onClick={() => sync()}><Icon name="arrow-repeat" />Sync now</button>}<button className="btn" onClick={reset}><Icon name="plus-lg" />Import another file</button></div>
            </Empty>)}
        </section>
      )}
    </div>
  );
}
