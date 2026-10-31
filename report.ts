// One report model, three renderers: the on-screen document (ReportsView), a self-contained HTML file and Markdown.
import type { LocalRecord, Project, Variable } from './types';
import type { Pin } from './pins';
import { displayValue, isAnswered, TYPE_LABEL } from './format';
import { htmlToText } from './html';
import { describe, fmt, frequencies, kindOf, numbersOf, pct } from './stats';

export type Block =
  | { t: 'text'; text: string }
  | { t: 'kv'; items: [string, string][] }
  | { t: 'table'; head: string[]; rows: (string | number)[][]; caption?: string }
  | { t: 'note'; text: string };
export interface Section { id: string; title: string; blocks: Block[] }
export interface ReportModel { title: string; subtitle: string; author: string; at: string; sections: Section[] }

export const SECTION_LIST: [string, string, string][] = [
  ['info', 'info-circle', 'Project information'],
  ['collection', 'database', 'Data collection summary'],
  ['quality', 'shield-check', 'Data quality'],
  ['summaries', 'calculator', 'Variable summaries'],
  ['pins', 'pin-angle', 'Pinned analyses'],
  ['codebook', 'journal-text', 'Codebook'],
];
export const TEMPLATES: { id: string; icon: string; title: string; text: string; sections: string[] }[] = [
  { id: 'summary', icon: 'speedometer2', title: 'Project summary', text: 'One-page status for a supervisor or committee', sections: ['info', 'collection'] },
  { id: 'quality', icon: 'shield-check', title: 'Data quality', text: 'Completeness, missing data and outliers', sections: ['info', 'collection', 'quality'] },
  { id: 'analysis', icon: 'bar-chart-line', title: 'Analysis report', text: 'Variable summaries and your pinned results', sections: ['info', 'summaries', 'pins'] },
  { id: 'full', icon: 'file-earmark-text', title: 'Full report', text: 'Everything, including the codebook', sections: ['info', 'collection', 'quality', 'summaries', 'pins', 'codebook'] },
];

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function buildReport(o: { project: Project; vars: Variable[]; recs: LocalRecord[]; pins: Pin[]; sections: string[]; author: string; hidePii: boolean }): ReportModel {
  const { project, recs, pins } = o;
  const vars = o.vars.filter((v) => !(o.hidePii && v.is_pii));
  const answerable = vars.filter((v) => !['note', 'calculated', 'file', 'gps'].includes(v.type));
  const out: Section[] = [];
  const has = (id: string) => o.sections.includes(id);

  if (has('info')) out.push({ id: 'info', title: 'Project information', blocks: [
    ...(project.description ? [{ t: 'text', text: htmlToText(project.description) } as Block] : []),
    { t: 'kv', items: [['Project', project.title], ['Your role', project.role], ['Status', project.status], ['Data collection', project.period === 'closed' ? 'Ended' : project.period === 'upcoming' ? 'Starts later' : 'Open'], ['Period', project.start_date || project.end_date ? `${project.start_date ? day(project.start_date) : '…'} – ${project.end_date ? day(project.end_date) : '…'}` : 'Not set'], ['Schema version', `v${project.schema_version} · ${vars.length} variables`]] },
  ] });

  if (has('collection')) {
    const c = (s: string) => recs.filter((r) => r.status === s).length;
    const dates = recs.map((r) => r.created_at).sort();
    const span = dates.length ? Math.max(1, Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000) + 1) : 0;
    out.push({ id: 'collection', title: 'Data collection summary', blocks: [
      { t: 'table', head: ['Measure', 'Value'], rows: [['Records on this computer', recs.length], ['Complete', `${c('complete')} (${pct(c('complete'), recs.length, 0)})`], ['Drafts', `${c('draft')} (${pct(c('draft'), recs.length, 0)})`], ['Flagged', c('flagged')], ['Waiting to be sent', recs.filter((r) => r.dirty).length], ['Refused by the server', recs.filter((r) => r.sync_error).length], ['First record', dates.length ? day(dates[0]) : '—'], ['Latest record', dates.length ? day(dates[dates.length - 1]) : '—'], ['Average per day', span ? fmt(recs.length / span, 1) : '—']].map((r) => [r[0], String(r[1])]) },
    ] });
  }

  if (has('quality')) {
    const rows = answerable.map((v) => { const n = recs.filter((r) => isAnswered(r.data[v.name])).length; return [v.label || v.name, v.required ? 'Yes' : '', n, recs.length - n, pct(recs.length - n, recs.length, 0)] as (string | number)[]; }).sort((a, b) => Number.parseFloat(String(b[4])) - Number.parseFloat(String(a[4])));
    const low = recs.filter((r) => answerable.length && answerable.filter((v) => isAnswered(r.data[v.name])).length / answerable.length < 0.5).length;
    const out2: (string | number)[][] = [];
    for (const v of answerable) { if (kindOf(v, recs) !== 'numeric') continue; const d = describe(numbersOf(recs, v)); if (d && d.outliers) out2.push([v.label || v.name, d.outliers, `${fmt(d.q1 - 1.5 * d.iqr)} – ${fmt(d.q3 + 1.5 * d.iqr)}`]); }
    const blocks: Block[] = [{ t: 'text', text: `${low} of ${recs.length} records have fewer than half of the questions answered.` }, { t: 'table', caption: 'Completeness by question (most missing first)', head: ['Question', 'Required', 'Answered', 'Missing', 'Missing %'], rows: rows.slice(0, 60) }];
    if (out2.length) blocks.push({ t: 'table', caption: 'Possible outliers (values beyond 1.5 × IQR)', head: ['Question', 'Outliers', 'Expected range'], rows: out2 });
    out.push({ id: 'quality', title: 'Data quality', blocks });
  }

  if (has('summaries')) {
    const numeric = answerable.filter((v) => kindOf(v, recs) === 'numeric');
    const cats = answerable.filter((v) => kindOf(v, recs) === 'categorical');
    const blocks: Block[] = [];
    if (numeric.length) blocks.push({ t: 'table', caption: 'Numeric questions', head: ['Question', 'n', 'Mean', 'SD', 'Min', 'Median', 'Max'], rows: numeric.slice(0, 60).map((v) => { const d = describe(numbersOf(recs, v)); return [v.label || v.name, d?.n ?? 0, d ? +d.mean.toFixed(2) : '—', d ? +d.sd.toFixed(2) : '—', d?.min ?? '—', d ? +d.median.toFixed(2) : '—', d?.max ?? '—']; }) });
    for (const v of cats.slice(0, 25)) { const f = frequencies(recs, v); if (f.rows.length) blocks.push({ t: 'table', caption: `${v.label || v.name} (n = ${f.answered})`, head: ['Answer', 'n', '%'], rows: f.rows.slice(0, 12).map((x) => [x.label, x.n, `${x.pct.toFixed(1)}%`]) }); }
    if (!blocks.length) blocks.push({ t: 'note', text: 'There is nothing to summarise yet.' });
    out.push({ id: 'summaries', title: 'Variable summaries', blocks });
  }

  if (has('pins')) out.push({ id: 'pins', title: 'Pinned analyses', blocks: pins.length
    ? pins.flatMap((p): Block[] => [{ t: 'table', caption: `${p.title}${p.subtitle ? ` — ${p.subtitle}` : ''}`, head: p.head, rows: p.rows }, ...(p.notes ?? []).map((n): Block => ({ t: 'note', text: n }))])
    : [{ t: 'note', text: 'No analyses pinned. In Statistics or the Workbench, press “Pin to report”.' }] });

  if (has('codebook')) out.push({ id: 'codebook', title: 'Codebook', blocks: [{ t: 'table', head: ['#', 'Name', 'Label', 'Type', 'Required', 'Answer options'], rows: vars.filter((v) => v.type !== 'note').map((v, i) => [i + 1, v.name, v.label ?? '', TYPE_LABEL[v.type] ?? v.type, v.required ? 'Yes' : '', (v.config?.options ?? []).map((x) => `${x.value} = ${x.label}`).join('; ')]) }] });

  return { title: `${project.title} — report`, subtitle: project.title, author: o.author, at: new Date().toISOString(), sections: out };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const cellText = (c: string | number) => (typeof c === 'number' ? c.toLocaleString() : c);

export function toMarkdown(m: ReportModel): string {
  const L: string[] = [`# ${m.title}`, '', `Prepared by ${m.author} on ${day(m.at)}`, ''];
  for (const s of m.sections) {
    L.push(`## ${s.title}`, '');
    for (const b of s.blocks) {
      if (b.t === 'text' || b.t === 'note') L.push(b.t === 'note' ? `> ${b.text}` : b.text, '');
      else if (b.t === 'kv') L.push(...b.items.map(([k, v]) => `- **${k}:** ${v}`), '');
      else { if (b.caption) L.push(`**${b.caption}**`, ''); L.push(`| ${b.head.join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`, ...b.rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`), ''); }
    }
  }
  return L.join('\n');
}

export function toHtml(m: ReportModel): string {
  const body = m.sections.map((s) => `<section><h2>${esc(s.title)}</h2>${s.blocks.map((b) => {
    if (b.t === 'text') return `<p>${esc(b.text)}</p>`;
    if (b.t === 'note') return `<p class="note">${esc(b.text)}</p>`;
    if (b.t === 'kv') return `<dl>${b.items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    return `${b.caption ? `<h3>${esc(b.caption)}</h3>` : ''}<div class="tw"><table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(cellText(c))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }).join('')}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)}</title><style>
body{margin:0;padding:2rem 1rem;background:#f4f6fa;font:16px/1.55 "Roboto Condensed","Arial Narrow",Arial,sans-serif;color:#1f2a3a}
main{max-width:56rem;margin:0 auto;background:#fff;border-radius:1.2rem;padding:2.4rem 2.6rem;box-shadow:0 1px 3px rgba(15,23,42,.1),0 18px 46px -14px rgba(15,23,42,.32)}
h1{margin:0;font-size:2rem;color:#0b1b2e;text-shadow:0 1px 2px rgba(15,23,42,.18)}h2{margin:2rem 0 .6rem;font-size:1.3rem;color:#2d4bd8;text-shadow:0 1px 2px rgba(15,23,42,.15)}h3{margin:1.1rem 0 .4rem;font-size:1rem;color:#0b1b2e}
.meta{color:#5b6b80;margin:.3rem 0 0}p{margin:.4rem 0}.note{background:#eef2f8;border-radius:.7rem;padding:.6rem .9rem;box-shadow:0 1px 2px rgba(15,23,42,.12)}
dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.6rem;margin:.6rem 0}dl div{background:#eef2f8;border-radius:.8rem;padding:.6rem .9rem;box-shadow:0 1px 2px rgba(15,23,42,.12)}dt{font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5b6b80}dd{margin:0;font-weight:700;color:#0b1b2e}
.tw{overflow:auto;border-radius:.8rem;box-shadow:0 1px 3px rgba(15,23,42,.14)}table{border-collapse:collapse;width:100%;font-size:.92rem}th{background:#e8edfb;color:#2338b0;text-align:left;padding:.55rem .8rem}td{padding:.45rem .8rem}tbody tr:nth-child(even) td{background:#f4f6fa}
@media print{body{background:#fff;padding:0}main{box-shadow:none;padding:0}}
</style></head><body><main><h1>${esc(m.title)}</h1><p class="meta">Prepared by ${esc(m.author)} · ${esc(day(m.at))} · Library Medicine</p>${body}</main></body></html>`;
}

export { displayValue };
