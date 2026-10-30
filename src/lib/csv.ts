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
