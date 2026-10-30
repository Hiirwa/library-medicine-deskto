// Reads every table format the Import page accepts and returns it as rows of text.
// xlsx/xlsm (read-excel-file, no web worker so it works under the app's CSP), ods (fflate + XML),
// csv/tsv/txt, json, jsonl/ndjson, xml, html tables, markdown tables and pasted text.
import readXlsx from 'read-excel-file/universal';
import { unzipSync, strFromU8 } from 'fflate';
import { jsonToRows, parseDelimited } from './csvparse';

export interface Sheet { name: string; rows: string[][] }
export interface Loaded { sheets: Sheet[]; format: string }

export const IMPORT_FORMATS = ['.xlsx', '.xlsm', '.ods', '.csv', '.tsv', '.txt', '.json', '.jsonl', '.ndjson', '.xml', '.html', '.htm', '.md'];
export const FORMAT_LABELS: [string, string, string][] = [
  ['file-earmark-excel', 'Excel', '.xlsx .xlsm (all sheets)'], ['file-earmark-spreadsheet', 'OpenDocument', '.ods'], ['filetype-csv', 'CSV / TSV / TXT', 'comma, semicolon, tab'],
  ['filetype-json', 'JSON / JSONL', 'list of records, one per line'], ['filetype-xml', 'XML', 'repeated record elements'], ['filetype-html', 'HTML / Markdown', 'tables'], ['clipboard-data', 'Paste', 'copy cells from Excel'],
];

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) { const p = (n: number) => String(n).padStart(2, '0'); const d = v; return d.getUTCHours() || d.getUTCMinutes() ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00` : `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; }
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
};
const clean = (rows: string[][]) => rows.filter((r) => r.some((c) => c.trim() !== ''));

function fromXml(src: string): string[][] {
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The XML file is not valid.');
  // the record element is the most frequent element name that holds child elements
  const counts = new Map<string, number>();
  doc.querySelectorAll('*').forEach((el) => { if (el.children.length && el.parentElement) counts.set(el.tagName, (counts.get(el.tagName) ?? 0) + 1); });
  const tag = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!tag) throw new Error('No repeated record elements found in the XML file.');
  const recs = [...doc.getElementsByTagName(tag)];
  const head = [...new Set(recs.flatMap((r) => [...[...r.attributes].map((a) => a.name), ...[...r.children].map((c) => c.tagName)]))];
  return [head, ...recs.map((r) => head.map((h) => r.getAttribute(h) ?? [...r.children].find((c) => c.tagName === h)?.textContent?.trim() ?? ''))];
}

function fromHtml(src: string): Sheet[] {
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const tables = [...doc.querySelectorAll('table')];
  if (!tables.length) throw new Error('No table found in the HTML file.');
  return tables.map((t, i) => ({ name: t.querySelector('caption')?.textContent?.trim() || `Table ${i + 1}`, rows: clean([...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').trim()))) }));
}

function fromMarkdown(src: string): string[][] {
  const lines = src.split(/\r?\n/).filter((l) => l.includes('|'));
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const rows = lines.map(cells).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  if (rows.length < 2) throw new Error('No Markdown table found.');
  return rows;
}

async function fromOds(buf: ArrayBuffer): Promise<Sheet[]> {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'content.xml' });
  const xml = files['content.xml'];
  if (!xml) throw new Error('This OpenDocument file has no content.');
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'; const O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
  return [...doc.getElementsByTagNameNS(T, 'table')].map((tb, i) => {
    const rows: string[][] = [];
    for (const tr of [...tb.getElementsByTagNameNS(T, 'table-row')]) {
      const rep = Math.min(Number(tr.getAttributeNS(T, 'number-rows-repeated') ?? 1) || 1, 50);
      const cells: string[] = [];
      for (const c of [...tr.children]) {
        if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
        const n = Math.min(Number(c.getAttributeNS(T, 'number-columns-repeated') ?? 1) || 1, 200);
        const vt = c.getAttributeNS(O, 'value-type');
        const val = vt === 'float' || vt === 'percentage' || vt === 'currency' ? c.getAttributeNS(O, 'value') ?? '' : vt === 'date' ? (c.getAttributeNS(O, 'date-value') ?? '').replace('T', ' ') : vt === 'boolean' ? (c.getAttributeNS(O, 'boolean-value') === 'true' ? '1' : '0') : [...c.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'p')].map((p) => p.textContent ?? '').join('\n');
        for (let k = 0; k < n; k++) cells.push(val);
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length) for (let k = 0; k < rep; k++) rows.push([...cells]);
    }
    return { name: tb.getAttributeNS(T, 'name') || `Sheet ${i + 1}`, rows: clean(rows) };
  });
}

/** Parse pasted or file text. JSON, JSONL, XML, HTML and Markdown are recognised by content; everything else is delimited text. */
export function readText(src: string, name = 'Pasted data'): Loaded {
  const t = src.trim();
  if (!t) throw new Error('Nothing to read.');
  let sheets: Sheet[]; let format = 'Delimited text';
  if (/^[[{]/.test(t)) {
    try { sheets = [{ name, rows: clean(jsonToRows(t)) }]; format = 'JSON'; }
    catch (e) { if (!t.includes('\n{')) throw e; sheets = [{ name, rows: clean(jsonToRows(`[${t.split(/\r?\n/).filter(Boolean).join(',')}]`)) }]; format = 'JSON Lines'; }
  } else if (/^<\?xml|^<[a-z]/i.test(t) && /<\/[a-z]/i.test(t)) {
    if (/<table[\s>]/i.test(t)) { sheets = fromHtml(t); format = 'HTML table'; } else { sheets = [{ name, rows: clean(fromXml(t)) }]; format = 'XML'; }
  } else if (/^\s*\|.*\|\s*$/m.test(t) && /^\s*\|?\s*:?-{2,}/m.test(t)) { sheets = [{ name, rows: clean(fromMarkdown(t)) }]; format = 'Markdown table'; }
  else sheets = [{ name, rows: parseDelimited(t).rows }];
  return { sheets: sheets.filter((s) => s.rows.length), format };
}

/** Read a file chosen by the person. */
export async function readFileAny(file: File): Promise<Loaded> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  let out: Loaded;
  if (ext === 'xlsx' || ext === 'xlsm') {
    const all = (await readXlsx(await file.arrayBuffer())) as unknown as { sheet: string; data: unknown[][] }[];
    out = { sheets: all.map((s) => ({ name: s.sheet, rows: clean(s.data.map((r) => r.map(text))) })), format: 'Excel workbook' };
  } else if (ext === 'ods') out = { sheets: await fromOds(await file.arrayBuffer()), format: 'OpenDocument spreadsheet' };
  else if (ext === 'xls') throw new Error('Old .xls files cannot be read. Open it in Excel and choose Save As → Excel Workbook (.xlsx) or CSV.');
  else if (ext === 'numbers' || ext === 'pdf' || ext === 'docx') throw new Error(`.${ext} files are not tables. Export the data as .xlsx or .csv first.`);
  else if (ext === 'jsonl' || ext === 'ndjson') out = { sheets: [{ name: file.name, rows: clean(jsonToRows(`[${(await file.text()).split(/\r?\n/).filter((l) => l.trim()).join(',')}]`)) }], format: 'JSON Lines' };
  else if (ext === 'html' || ext === 'htm') out = { sheets: fromHtml(await file.text()), format: 'HTML table' };
  else if (ext === 'md') out = { sheets: [{ name: file.name, rows: clean(fromMarkdown(await file.text())) }], format: 'Markdown table' };
  else if (ext === 'xml') out = { sheets: [{ name: file.name, rows: clean(fromXml(await file.text())) }], format: 'XML' };
  else out = readText(await file.text(), file.name);
  out.sheets = out.sheets.filter((s) => s.rows.length > 0);
  if (!out.sheets.length) throw new Error('The file has no data.');
  return out;
}
