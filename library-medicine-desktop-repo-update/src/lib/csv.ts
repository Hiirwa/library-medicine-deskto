// CSV exports that open correctly in Excel (UTF-8 with BOM, CRLF, quoted cells).
import { save } from '@tauri-apps/plugin-dialog';
import { native } from './native';
import type { LocalRecord, Variable } from './types';
import { displayValue } from './format';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'export';
const stamp = () => new Date().toISOString().slice(0, 10);

/** Ask where to save, then write. Returns the path, or null when cancelled. */
export async function saveCsv(defaultName: string, rows: unknown[][]): Promise<string | null> {
  const path = await save({ title: 'Save as CSV', defaultPath: `${safe(defaultName)} ${stamp()}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
  if (!path) return null;
  await native.saveExport(path, toCsv(rows));
  return path;
}

/** Records → CSV, one column per variable. `labels` writes option labels instead of codes. */
export function recordsTable(records: LocalRecord[], vars: Variable[], opts: { labels: boolean; hidePii: boolean }): unknown[][] {
  const cols = vars.filter((v) => v.type !== 'note' && !(opts.hidePii && v.is_pii));
  const head = ['record_id', ...cols.map((v) => v.name), 'status', 'created_at', 'updated_at', 'sync_state'];
  const body = records.map((r) => [
    r.uuid,
    ...cols.map((v) => (opts.labels ? displayValue(v, r.data[v.name]) : rawValue(r.data[v.name]))),
    r.status, r.created_at, r.updated_at, r.sync_error ? 'refused' : r.dirty ? 'to send' : 'synced',
  ]);
  return [head, ...body];
}

const rawValue = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : v);

/** Variables → codebook CSV. */
export function codebookTable(vars: Variable[]): unknown[][] {
  return [
    ['name', 'label', 'type', 'required', 'personal_data', 'options', 'min', 'max', 'help_text'],
    ...vars.map((v) => [v.name, v.label ?? '', v.type, v.required ? 'yes' : 'no', v.is_pii ? 'yes' : 'no',
      (v.config?.options ?? []).map((o) => `${o.value}=${o.label}`).join(' | '), v.config?.min ?? '', v.config?.max ?? '', v.help_text ?? '']),
  ];
}

/** Ask where to save, then write any text file (csv, tsv, txt, json, md, html). */
export async function saveFile(defaultName: string, ext: 'csv' | 'tsv' | 'txt' | 'json' | 'jsonl' | 'md' | 'html' | 'xml' | 'sql', contents: string, filterName = ext.toUpperCase()): Promise<string | null> {
  const path = await save({ title: `Save as ${filterName}`, defaultPath: `${safe(defaultName)} ${stamp()}.${ext}`, filters: [{ name: filterName, extensions: [ext] }] });
  if (!path) return null;
  await native.saveExport(path, contents);
  return path;
}

export interface TableOptions { labels: boolean; hidePii: boolean; columns?: string[]; meta: boolean; recordId: boolean }

/** Records → rows with the chosen columns; metadata columns (status, dates, sync state) are optional. */
export function buildTable(records: LocalRecord[], vars: Variable[], o: TableOptions): unknown[][] {
  const cols = vars.filter((v) => v.type !== 'note' && !(o.hidePii && v.is_pii) && (!o.columns || o.columns.includes(v.name)));
  const head = [...(o.recordId ? ['record_id'] : []), ...cols.map((v) => v.name), ...(o.meta ? ['status', 'created_at', 'updated_at', 'sync_state'] : [])];
  const body = records.map((r) => [
    ...(o.recordId ? [r.uuid] : []),
    ...cols.map((v) => (o.labels ? displayValue(v, r.data[v.name]) : rawValue(r.data[v.name]))),
    ...(o.meta ? [r.status, r.created_at, r.updated_at, r.sync_error ? 'refused' : r.dirty ? 'to send' : 'synced'] : []),
  ]);
  return [head, ...body];
}

/** Records as JSON, one object per record, with answers under `data`. */
export function recordsJson(records: LocalRecord[], vars: Variable[], o: { labels: boolean; hidePii: boolean }) {
  const cols = vars.filter((v) => v.type !== 'note' && !(o.hidePii && v.is_pii));
  return records.map((r) => ({
    record_id: r.uuid, status: r.status, created_at: r.created_at, updated_at: r.updated_at,
    data: Object.fromEntries(cols.map((v) => [v.name, o.labels ? displayValue(v, r.data[v.name]) : r.data[v.name] ?? null])),
  }));
}

const xesc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (s: string) => (s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'field');

/** Tab-separated text. */
export const toTsv = (rows: unknown[][]) => rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n') + '\r\n';
/** One JSON object per line. */
export const toJsonl = (items: unknown[]) => items.map((x) => JSON.stringify(x)).join('\n') + '\n';
/** Excel 2003 XML spreadsheet: opens in Excel and LibreOffice without conversion warnings (save it as .xml). */
export function toExcelXml(rows: unknown[][], sheet = 'Records'): string {
  const cell = (c: unknown) => { const n = typeof c === 'number' || (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c) && c.length < 16 && !/^0\d/.test(c)); return `<Cell><Data ss:Type="${n ? 'Number' : 'String'}">${xesc(c)}</Data></Cell>`; };
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles><Worksheet ss:Name="${xesc(sheet.slice(0, 30))}"><Table>${rows.map((r, i) => `<Row${i === 0 ? ' ss:StyleID="h"' : ''}>${r.map((c) => (i === 0 ? `<Cell><Data ss:Type="String">${xesc(c)}</Data></Cell>` : cell(c))).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
}
/** Plain XML: one <record> element per record. */
export function toXml(rows: unknown[][], root = 'records'): string {
  const [head, ...body] = rows as string[][];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${tag(root)}>\n${body.map((r) => `  <record>\n${r.map((c, i) => `    <${tag(String(head[i]))}>${xesc(c)}</${tag(String(head[i]))}>`).join('\n')}\n  </record>`).join('\n')}\n</${tag(root)}>\n`;
}
/** HTML page with one table. */
export function toHtmlTable(rows: unknown[][], title: string): string {
  const [head, ...body] = rows;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${xesc(title)}</title><style>body{font:15px "Roboto Condensed",Arial,sans-serif;margin:2rem;background:#f4f6fa;color:#1f2a3a}h1{color:#0b1b2e}table{border-collapse:collapse;background:#fff;border-radius:.8rem;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.18)}th{background:#e8edfb;color:#2338b0;text-align:left;padding:.5rem .8rem}td{padding:.4rem .8rem}tr:nth-child(even) td{background:#f4f6fa}</style></head><body><h1>${xesc(title)}</h1><table><thead><tr>${head.map((h) => `<th>${xesc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${xesc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
/** SQL script: CREATE TABLE + INSERT statements (values as text, NULL when empty). */
export function toSql(rows: unknown[][], table: string): string {
  const [head, ...body] = rows as string[][]; const t = tag(table).toLowerCase();
  const q = (v: unknown) => (v === '' || v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  return `-- Library Medicine export\nCREATE TABLE IF NOT EXISTS ${t} (\n${head.map((h) => `  ${tag(String(h)).toLowerCase()} TEXT`).join(',\n')}\n);\n${body.map((r) => `INSERT INTO ${t} (${head.map((h) => tag(String(h)).toLowerCase()).join(', ')}) VALUES (${r.map(q).join(', ')});`).join('\n')}\n`;
}
