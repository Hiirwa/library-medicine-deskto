// Everything the Forms page shows about a form, computed on this computer from the layout, the variables and the records.
import type { Form, LocalRecord, Variable } from './types';
import { isAnswered } from './format';

/** Rough seconds to answer a question of each type (used for the "about N min" estimate). */
const SECONDS: Record<string, number> = { text: 15, textarea: 45, email: 15, phone: 12, integer: 8, decimal: 10, number: 10, radio: 6, dropdown: 6, boolean: 4, checkbox: 10, date: 8, datetime: 12, time: 8, rating: 5, slider: 6, file: 30, gps: 15, calculated: 0, note: 0 };

export interface FormInfo { names: string[]; vars: Variable[]; questions: number; required: number; pii: number; calculated: number; sections: number; notes: number; types: [string, number][]; minutes: number }

export function formInfo(f: Form | null, all: Variable[]): FormInfo {
  const byName = new Map(all.map((v) => [v.name, v]));
  let names: string[] = []; let sections = 0; let notes = 0;
  if (f) {
    for (const p of f.layout?.pages ?? []) {
      const groups = [{ items: p.items ?? [] }, ...(p.sections ?? [])];
      sections += Math.max(1, (p.sections ?? []).length);
      for (const g of groups) for (const i of g.items ?? []) { if (i.type === 'variable' && i.var) names.push(i.var); else if (i.type !== 'variable') notes++; }
    }
  } else { names = all.filter((v) => v.type !== 'note').map((v) => v.name); sections = 1; }
  names = [...new Set(names)];
  const vars = names.map((n) => byName.get(n)).filter((v): v is Variable => !!v);
  const counted = vars.filter((v) => v.type !== 'calculated' && v.type !== 'note');
  const t = new Map<string, number>();
  for (const v of counted) t.set(v.type, (t.get(v.type) ?? 0) + 1);
  const secs = counted.reduce((a, v) => a + (SECONDS[v.type] ?? 10), 0);
  return {
    names, vars, questions: counted.length, required: counted.filter((v) => v.required).length, pii: counted.filter((v) => v.is_pii).length,
    calculated: vars.filter((v) => v.type === 'calculated').length, sections, notes, types: [...t.entries()].sort((a, b) => b[1] - a[1]), minutes: Math.max(1, Math.round(secs / 60)),
  };
}

export interface Split { total: number; complete: number; draft: number; flagged: number; toSend: number; refused: number; first: string | null; last: string | null; week: number; answeredPct: number | null }

export function recordSplit(recs: LocalRecord[], names: string[]): Split {
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  const created = recs.map((r) => r.created_at).sort();
  const pct = recs.length && names.length ? Math.round((recs.reduce((a, r) => a + names.filter((n) => isAnswered(r.data[n])).length / names.length, 0) / recs.length) * 100) : null;
  return {
    total: recs.length, complete: recs.filter((r) => r.status === 'complete').length, draft: recs.filter((r) => r.status === 'draft').length, flagged: recs.filter((r) => r.status === 'flagged').length,
    toSend: recs.filter((r) => r.dirty && !r.sync_error).length, refused: recs.filter((r) => !!r.sync_error).length,
    first: created[0] ?? null, last: [...recs.map((r) => r.updated_at)].sort().pop() ?? null, week: recs.filter((r) => r.created_at >= week).length, answeredPct: pct,
  };
}

/** Whole days until a YYYY-MM-DD date (negative when it has passed), or null. */
export function daysUntil(date?: string | null): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const end = new Date(`${date.slice(0, 10)}T23:59:59`).getTime();
  return Math.ceil((end - Date.now()) / 86400000);
}
