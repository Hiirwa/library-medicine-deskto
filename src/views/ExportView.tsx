import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAsk } from '../components/Confirm';
import { webUrl } from '../lib/access';
import type { LocalRecord } from '../lib/types';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
import { buildTable, recordsJson, saveFile, toCsv, toExcelXml, toHtmlTable, toJsonl, toSql, toTsv, toXml } from '../lib/csv';
import { codebookTable } from '../lib/csv';
import { plural, TYPE_LABEL } from '../lib/format';
import { useRecords } from '../lib/hooks';
import { useLocal } from '../lib/useLocal';
import { ago } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { ExportWebInfo } from '../components/ExportWebInfo';
import type { ProjectCtx } from './ProjectView';

type Ext = 'csv' | 'tsv' | 'json' | 'jsonl' | 'xml' | 'html' | 'sql';
type Format = 'csv-labels' | 'csv-codes' | 'excel' | 'tsv' | 'json' | 'jsonl' | 'xml' | 'html' | 'sql' | 'codebook' | 'package';
type Scope = 'all' | 'complete' | 'draft' | 'flagged' | 'unsent' | 'week' | 'month';
interface Hist { at: string; name: string; path: string; rows: number; format: string }

const FORMATS: { id: Format; icon: string; title: string; text: string; ext: Ext }[] = [
  { id: 'csv-labels', icon: 'filetype-csv', title: 'CSV with labels', text: 'Readable answers for Excel and sharing', ext: 'csv' },
  { id: 'csv-codes', icon: '123', title: 'CSV with codes', text: 'Numeric codes for SPSS, Stata, R', ext: 'csv' },
  { id: 'excel', icon: 'file-earmark-excel', title: 'Excel spreadsheet', text: 'Opens directly in Excel and LibreOffice (.xml)', ext: 'xml' },
  { id: 'tsv', icon: 'filetype-txt', title: 'TSV (tab separated)', text: 'Paste-ready for any spreadsheet', ext: 'tsv' },
  { id: 'json', icon: 'filetype-json', title: 'JSON', text: 'Structured records for other software', ext: 'json' },
  { id: 'jsonl', icon: 'braces', title: 'JSON Lines', text: 'One record per line, for pipelines', ext: 'jsonl' },
  { id: 'xml', icon: 'filetype-xml', title: 'XML', text: 'Record elements for other systems', ext: 'xml' },
  { id: 'html', icon: 'filetype-html', title: 'Web page (HTML)', text: 'A formatted table to open or share', ext: 'html' },
  { id: 'sql', icon: 'database', title: 'SQL script', text: 'CREATE TABLE and INSERT statements', ext: 'sql' },
  { id: 'codebook', icon: 'journal-text', title: 'Codebook', text: 'Variables, types, rules and options', ext: 'csv' },
  { id: 'package', icon: 'box-seam', title: 'Data package', text: 'Project, codebook and records in one JSON', ext: 'json' },
];
/** The records of one scope (all, complete, drafts, …). */
function pickRows(r: LocalRecord[], scope: Scope): LocalRecord[] {
  const since = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  switch (scope) {
    case 'complete': case 'draft': case 'flagged': return r.filter((x) => x.status === scope);
    case 'unsent': return r.filter((x) => x.dirty);
    case 'week': return r.filter((x) => x.created_at >= since(7));
    case 'month': return r.filter((x) => x.created_at >= since(30));
    default: return r;
  }
}
const SCOPES: [Scope, string][] = [['all', 'All records'], ['complete', 'Complete'], ['draft', 'Drafts'], ['flagged', 'Flagged'], ['unsent', 'Waiting to send'], ['week', 'Last 7 days'], ['month', 'Last 30 days']];

/** Export centre: choose the format, which records and which columns, preview, then save. */
export function ExportView({ project, vars }: ProjectCtx) {
  const { toast, online, syncing, sync, server } = useSession();
  const ask = useAsk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const records = useRecords(project.uuid);
  const [format, setFormat] = useState<Format>('csv-labels');
  const [scope, setScope] = useState<Scope>('all');
  const [meta, setMeta] = useState(true);
  const [recordId, setRecordId] = useState(true);
  const [cols, setCols] = useState<string[] | null>(null);
  const [colQ, setColQ] = useState('');
  const [hist, setHist] = useLocal<Hist[]>(`lm_exports_${project.uuid}`, []);
  const hidePii = !project.can.pii;
  const columns = useMemo(() => vars.filter((v) => v.type !== 'note' && !(hidePii && v.is_pii)), [vars, hidePii]);
  const chosen = cols ?? columns.map((v) => v.name);
  const isData = format !== 'codebook';

  const rows = useMemo(() => pickRows(records.data ?? [], scope), [records.data, scope]);

  const preview = useMemo(() => (format === 'codebook' ? codebookTable(columns).slice(0, 6) : buildTable(rows.slice(0, 5), vars, { labels: format !== 'csv-codes' && format !== 'sql', hidePii, columns: chosen, meta, recordId })), [format, rows, vars, hidePii, chosen, meta, recordId, columns]);
  const fmtInfo = FORMATS.find((f) => f.id === format)!;

  const table = (rows: LocalRecord[]) => buildTable(rows, vars, { labels: format !== 'csv-codes' && format !== 'sql', hidePii, columns: chosen, meta, recordId });
  const build = (rows: LocalRecord[]): string => {
    if (format === 'codebook') return toCsv(codebookTable(columns));
    if (format === 'csv-labels' || format === 'csv-codes') return toCsv(table(rows));
    if (format === 'excel') return toExcelXml(table(rows), project.title);
    if (format === 'tsv') return toTsv(table(rows));
    if (format === 'xml') return toXml(table(rows), 'records');
    if (format === 'html') return toHtmlTable(table(rows), `${project.title} — records`);
    if (format === 'sql') return toSql(table(rows), project.title);
    const recs = recordsJson(rows, vars.filter((v) => chosen.includes(v.name)), { labels: false, hidePii });
    if (format === 'jsonl') return toJsonl(recs);
    if (format === 'json') return JSON.stringify(recs, null, 2);
    return JSON.stringify({ exported_at: new Date().toISOString(), source: 'Library Medicine desktop', project: { id: project.uuid, title: project.title, schema_version: project.schema_version }, codebook: columns.map((v) => ({ name: v.name, label: v.label, type: v.type, required: v.required, options: v.config?.options ?? null })), records: recs }, null, 2);
  };

  /**
   * Save the export. Never a dead button: with no record here it first fetches the records from the website (sync),
   * and when there is still none it explains why and offers the website's export or an empty file with the headings.
   */
  async function run() {
    if (busy) return;
    if (isData && !chosen.length) {
      toast('Choose at least one column to export (3 · Columns).', 'error');
      document.getElementById('exColumns')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    let list = rows;
    try {
      if (isData && !list.length) {
        if (online && !syncing) {
          setBusy('Getting the records from the website…');
          await sync();
          await qc.invalidateQueries({ queryKey: ['exportinfo', project.uuid] });
          list = pickRows((await records.refetch()).data ?? [], scope);
          setBusy(null);
          if (list.length) toast(`${plural(list.length, 'record')} received from the website.`);
        }
        if (!list.length) {
          const info = qc.getQueryData<{ ok: boolean; data?: { server?: { records?: number } } }>(['exportinfo', project.uuid]);
          const onWeb = info?.ok ? Number(info.data?.server?.records ?? 0) : 0;
          if (onWeb > 0 && scope === 'all') {
            const go = await ask(
              `The website has ${plural(onWeb, 'record')} in this project, but none of them are on this computer. This happens when they were entered by other people and the website does not yet send team records to the desktop, or when Settings → Synchronisation → "Records kept on this computer" is set to "Mine".\n\nOpen the Export page on the website to download them now?`,
              { title: 'No records on this computer', kind: 'warning', okLabel: 'Open website export', cancelLabel: 'Not now' },
            );
            if (go) await openUrl(webUrl(server, project.uuid, 'export'));
            return;
          }
          const empty = await ask(
            scope === 'all'
              ? `${online ? 'This project has no records yet.' : 'There are no records on this computer, and you are offline so they cannot be fetched now.'} Save a file with only the column headings (useful as a template)?`
              : 'No record matches this selection. Choose "All records" in 2 · Records, or save a file with only the column headings?',
            { title: 'Nothing to export yet', kind: 'info', okLabel: 'Save headings only', cancelLabel: 'Cancel' },
          );
          if (!empty) return;
        }
      }
      const name = `${project.title} - ${format === 'codebook' ? 'codebook' : format === 'package' ? 'package' : 'records'}`;
      setBusy('Saving…');
      const path = await saveFile(name, fmtInfo.ext, build(list), fmtInfo.title);
      if (!path) return;
      const count = format === 'codebook' ? columns.length : list.length;
      setHist([{ at: new Date().toISOString(), name: fmtInfo.title, path, rows: count, format: fmtInfo.ext.toUpperCase() }, ...hist].slice(0, 8));
      toast(`Exported ${plural(count, format === 'codebook' ? 'variable' : 'record')} to ${path}`);
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally { setBusy(null); }
  }
  const btnText = busy ?? (!isData ? 'Choose location & save' : !rows.length ? (online ? 'Get records from the website & save' : 'Save headings only') : 'Choose location & save');
  const btnIcon = busy ? 'arrow-repeat' : isData && !rows.length && online ? 'cloud-arrow-down' : 'download';

  const shown = columns.filter((v) => !colQ.trim() || `${v.name} ${v.label ?? ''}`.toLowerCase().includes(colQ.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <PageHead icon="box-arrow-down" title="Export" sub="Save records and the codebook to a file you choose"><button className="btn btn-primary" onClick={run} disabled={!!busy}><Icon name={btnIcon} className={busy ? 'spin' : ''} />Export {isData ? plural(rows.length, 'record') : 'codebook'}</button></PageHead>
      <div className="stats">
        <Stat icon="database" value={records.data?.length ?? 0} label="Records here" tone="k-teal" />
        <Stat icon="funnel" value={isData ? rows.length : columns.length} label={isData ? 'In this export' : 'Variables'} />
        <Stat icon="columns" value={isData ? chosen.length : columns.length} label="Columns" tone="k-muted" />
        <Stat icon="send" value={(records.data ?? []).filter((r) => r.dirty).length} label="Not yet synced" tone="k-warn" />
      </div>
      {hidePii && <div className="notice info"><Icon name="shield-lock" /><span>Personal-data questions are excluded because your role cannot see them.</span></div>}
      <StickyColumns className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 22rem' }}>
        <div className="space-y-4">
          <section className="card p-5 anim-in"><span className="label-cap">1 · Format</span>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}>{FORMATS.map((f) => (
              <button key={f.id} type="button" className={`pick ${format === f.id ? 'on' : ''}`} onClick={() => setFormat(f.id)} aria-pressed={format === f.id}><span className="pk-ic"><Icon name={f.icon} /></span><span className="min-w-0 text-left"><b className="ink block">{f.title}</b><small className="muted">{f.text}</small></span></button>))}</div>
          </section>
          {isData && (<>
            <section className="card p-5 anim-in"><span className="label-cap">2 · Records</span>
              <div className="flex flex-wrap gap-2">{SCOPES.map(([id, t]) => <button key={id} className={`chip-btn ${scope === id ? 'on' : ''}`} onClick={() => setScope(id)} aria-pressed={scope === id}>{t}</button>)}</div>
              {['csv-labels', 'csv-codes', 'excel', 'tsv', 'xml', 'html', 'sql'].includes(format) && <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={recordId} onChange={(e) => setRecordId(e.target.checked)} />Record id column</label>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={meta} onChange={(e) => setMeta(e.target.checked)} />Status, dates and sync state</label></div>}
            </section>
            <section className="card p-5 anim-in" id="exColumns">
              <div className="flex flex-wrap items-center gap-3"><span className="label-cap flex-1" style={{ margin: 0 }}>3 · Columns <span className="count soft">{chosen.length}/{columns.length}</span></span>
                <button className="btn btn-sm" onClick={() => setCols(columns.map((v) => v.name))}>All</button>
                <button className="btn btn-sm" onClick={() => setCols(columns.filter((v) => v.required).map((v) => v.name))}>Required only</button>
                <button className="btn btn-sm" onClick={() => setCols(columns.filter((v) => !v.is_pii).map((v) => v.name))}>Without personal data</button>
                <button className="btn btn-sm" onClick={() => setCols([])}>None</button></div>
              <div className="field-ic mt-3"><Icon name="search" /><input className="field" placeholder="Filter columns…" value={colQ} onChange={(e) => setColQ(e.target.value)} /></div>
              <div className="well mt-3 grid max-h-60 gap-1 overflow-y-auto p-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}>
                {shown.map((v) => <label key={v.name} className="mi flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5" title={`${v.name} · ${TYPE_LABEL[v.type] ?? v.type}`}><input type="checkbox" className="accent-[var(--rh-brand)]" checked={chosen.includes(v.name)} onChange={(e) => setCols(e.target.checked ? [...chosen, v.name] : chosen.filter((x) => x !== v.name))} /><span className="truncate">{v.label || v.name}</span>{v.is_pii && <Icon name="shield-lock" className="muted" />}</label>)}
              </div>
            </section>
          </>)}
          <section className="card p-5 anim-in"><span className="label-cap">Preview</span>
            {isData && !rows.length ? <Empty icon="inbox" title="No record in this selection" /> : (
              <div className="tbl-wrap"><table className="tbl compact"><thead><tr>{(preview[0] ?? []).map((h, i) => <th key={i}>{String(h)}</th>)}</tr></thead>
                <tbody>{preview.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="clip" title={String(c ?? '')}>{String(c ?? '')}</td>)}</tr>)}</tbody></table></div>)}
            <p className="help mt-2">{format === 'excel' ? 'Open the saved .xml file with Excel; numbers stay numbers.' : format.startsWith('csv') || format === 'codebook' ? 'CSV files open correctly in Excel (UTF-8).' : 'The preview shows the first rows as a table.'} Showing up to 5 rows.</p>
          </section>
        </div>
        <aside className="space-y-4">
          <section className="card p-5 anim-in"><span className="label-cap">Ready to save</span>
            <div className="well space-y-1 p-3 text-sm"><div className="flex justify-between"><span className="muted">Format</span><b className="ink">{fmtInfo.title}</b></div>
              <div className="flex justify-between"><span className="muted">{isData ? 'Records' : 'Variables'}</span><b className="ink num">{isData ? rows.length.toLocaleString() : columns.length}</b></div>
              <div className="flex justify-between"><span className="muted">Columns</span><b className="ink num">{isData ? chosen.length : codebookTable(columns)[0]?.length ?? 0}</b></div></div>
            <button className="btn btn-primary btn-lg mt-4 w-full" onClick={run} disabled={!!busy} aria-busy={!!busy}><Icon name={btnIcon} className={busy ? 'spin' : ''} />{btnText}</button>
            {isData && !rows.length && !busy && <p className="help mt-2">{online ? 'No record is on this computer yet: the button first downloads them from the website, then saves.' : 'Offline: you can save a file with the column headings now, or connect to get the records.'}</p>}
          </section>
          <section className="card p-5 anim-in"><span className="label-cap">Recent exports</span>
            {hist.length ? <div className="space-y-2">{hist.map((h, i) => <div key={i} className="well px-3 py-2 text-sm"><div className="flex items-center gap-2"><Icon name="file-earmark-check" /><b className="ink flex-1 truncate">{h.name}</b><span className="chip">{h.format}</span></div><div className="muted truncate text-xs" title={h.path}>{h.path}</div><div className="muted text-xs">{plural(h.rows, 'row')} · {ago(h.at)}</div></div>)}</div>
              : <p className="muted text-sm">Files you export appear here.</p>}
            {hist.length > 0 && <button className="btn btn-sm mt-3" onClick={() => setHist([])}><Icon name="trash3" />Clear list</button>}
          </section>
          <ExportWebInfo project={project.uuid} schemaVersion={project.schema_version} localRecords={records.data?.length ?? 0} toSend={(records.data ?? []).filter((r) => r.dirty && !r.sync_error).length} />
        </aside>
      </StickyColumns>
    </div>
  );
}
