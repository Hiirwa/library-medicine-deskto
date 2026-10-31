// Statistics used by the Statistics, Workbench, Dashboard and Reports pages. Everything runs on this computer.
import type { LocalRecord, Variable } from './types';
import { codeValue, displayValue, isAnswered } from './format';

export type Kind = 'numeric' | 'categorical' | 'date' | 'text';

export function kindOf(v: Variable, recs: LocalRecord[] = []): Kind {
  if (['integer', 'decimal', 'number', 'rating', 'slider'].includes(v.type)) return 'numeric';
  if (['radio', 'dropdown', 'checkbox', 'boolean'].includes(v.type) || (v.config?.options?.length ?? 0) > 0) return 'categorical';
  if (['date', 'datetime', 'time'].includes(v.type)) return 'date';
  if (v.type === 'calculated') {
    const vals = recs.map((r) => r.data[v.name]).filter(isAnswered);
    if (vals.length && vals.filter((x) => Number.isFinite(Number(x))).length / vals.length >= 0.8) return 'numeric';
  }
  return 'text';
}

export const numbersOf = (recs: LocalRecord[], v: Variable): number[] =>
  recs.map((r) => r.data[v.name]).filter(isAnswered).map(Number).filter((n) => Number.isFinite(n));

export const answeredCount = (recs: LocalRecord[], v: Variable) => recs.filter((r) => isAnswered(r.data[v.name])).length;

// ---------------------------------------------------------------- special functions
function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a: number, b: number, x: number): number {
  const FP = 1e-300; const qab = a + b; const qap = a + 1; const qam = a - 1;
  let c = 1; let d = 1 - (qab * x) / qap; if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Upper regularised incomplete gamma Q(a, x). */
function gammq(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a; let sum = 1 / a; let del = sum;
    for (let n = 0; n < 300; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-12) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a; let c = 1 / 1e-300; let d = 1 / b; let h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

export const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const fmtP = (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
export const pct = (n: number, d: number, dp = 1) => (d ? `${((n / d) * 100).toFixed(dp)}%` : '—');

// ---------------------------------------------------------------- descriptives
export interface Describe { n: number; mean: number; sd: number; min: number; q1: number; median: number; q3: number; max: number; sum: number; iqr: number; outliers: number; sem: number }

const quantile = (sorted: number[], p: number) => {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

export function describe(nums: number[]): Describe | null {
  const n = nums.length;
  if (!n) return null;
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0); const mean = sum / n;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const q1 = quantile(s, 0.25); const q3 = quantile(s, 0.75); const iqr = q3 - q1;
  const outliers = s.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length;
  return { n, mean, sd, min: s[0], q1, median: quantile(s, 0.5), q3, max: s[n - 1], sum, iqr, outliers, sem: sd / Math.sqrt(n) };
}

export interface Bin { from: number; to: number; n: number }
export function histogram(nums: number[], bins?: number): Bin[] {
  if (!nums.length) return [];
  const min = Math.min(...nums); const max = Math.max(...nums);
  if (min === max) return [{ from: min, to: max, n: nums.length }];
  const k = bins ?? Math.max(5, Math.min(20, Math.ceil(Math.log2(nums.length) + 1)));
  const w = (max - min) / k;
  const out: Bin[] = Array.from({ length: k }, (_, i) => ({ from: min + i * w, to: min + (i + 1) * w, n: 0 }));
  for (const x of nums) out[Math.min(k - 1, Math.floor((x - min) / w))].n++;
  return out;
}

// ---------------------------------------------------------------- categories
export interface Freq { key: string; label: string; n: number; pct: number }

/** Counts per answer. Multiple-choice answers count each selection; the percentage is of the records that answered. */
export function frequencies(recs: LocalRecord[], v: Variable): { rows: Freq[]; answered: number } {
  const counts = new Map<string, number>();
  let answered = 0;
  for (const r of recs) {
    const x = r.data[v.name];
    if (!isAnswered(x)) continue;
    answered++;
    const keys = Array.isArray(x) ? x.map(String) : [String(x)];
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const order = (v.config?.options ?? []).map((o) => o.value);
  const rows = [...counts.entries()].map(([key, n]) => ({ key, label: displayValue(v, key) || key, n, pct: answered ? (n / answered) * 100 : 0 }));
  if (v.type === 'boolean') rows.sort((a, b) => a.key.localeCompare(b.key) * -1);
  else if (order.length) rows.sort((a, b) => (order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999));
  else rows.sort((a, b) => b.n - a.n);
  return { rows, answered };
}

export const groupKey = (_v: Variable, x: unknown): string => {
  if (!isAnswered(x)) return '';
  const raw = Array.isArray(x) ? [...x].map(String).sort().join(';') : codeValue(x);
  return raw;
};

// ---------------------------------------------------------------- tests
export interface Corr { n: number; r: number; r2: number; p: number; slope: number; intercept: number }
export function pearson(xs: number[], ys: number[]): Corr | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const df = n - 2; const t = (r * Math.sqrt(df)) / Math.sqrt(Math.max(1e-15, 1 - r * r));
  const p = betai(df / 2, 0.5, df / (df + t * t));
  const slope = sxy / sxx;
  return { n, r, r2: r * r, p, slope, intercept: my - slope * mx };
}

export interface ChiSquare { chi2: number; df: number; p: number; v: number; lowCells: number; cells: number }
export function chiSquare(table: number[][]): ChiSquare | null {
  const R = table.length; const C = table[0]?.length ?? 0;
  if (R < 2 || C < 2) return null;
  const rt = table.map((r) => r.reduce((a, b) => a + b, 0));
  const ct = Array.from({ length: C }, (_, j) => table.reduce((a, r) => a + r[j], 0));
  const N = rt.reduce((a, b) => a + b, 0);
  if (!N) return null;
  let chi2 = 0; let low = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const e = (rt[i] * ct[j]) / N;
    if (e < 5) low++;
    if (e > 0) chi2 += (table[i][j] - e) ** 2 / e;
  }
  const df = (R - 1) * (C - 1);
  return { chi2, df, p: gammq(df / 2, chi2 / 2), v: Math.sqrt(chi2 / (N * Math.min(R - 1, C - 1))), lowCells: low, cells: R * C };
}

export interface GroupStat { key: string; label: string; n: number; mean: number; sd: number; min: number; max: number }
export interface Anova { f: number; df1: number; df2: number; p: number; eta2: number }
export function compareGroups(groups: { key: string; label: string; values: number[] }[]): { rows: GroupStat[]; anova: Anova | null } {
  const g = groups.filter((x) => x.values.length > 0);
  const rows = g.map((x) => { const d = describe(x.values)!; return { key: x.key, label: x.label, n: d.n, mean: d.mean, sd: d.sd, min: d.min, max: d.max }; });
  const N = rows.reduce((a, r) => a + r.n, 0); const k = rows.length;
  if (k < 2 || N <= k) return { rows, anova: null };
  const grand = g.reduce((a, x) => a + x.values.reduce((s, y) => s + y, 0), 0) / N;
  const ssb = rows.reduce((a, r) => a + r.n * (r.mean - grand) ** 2, 0);
  const ssw = g.reduce((a, x, i) => a + x.values.reduce((s, y) => s + (y - rows[i].mean) ** 2, 0), 0);
  const df1 = k - 1; const df2 = N - k;
  if (!ssw) return { rows, anova: null };
  const f = ssb / df1 / (ssw / df2);
  return { rows, anova: { f, df1, df2, p: betai(df2 / 2, df1 / 2, df2 / (df2 + df1 * f)), eta2: ssb / (ssb + ssw) } };
}

/** Plain-language reading of a p-value. */
export const verdict = (p: number | null | undefined, alpha = 0.05) => (p === null || p === undefined || !Number.isFinite(p) ? '' : p < alpha ? 'Statistically significant at the 5% level.' : 'Not statistically significant at the 5% level.');
export const strength = (r: number) => { const a = Math.abs(r); return a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'negligible'; };

/** Each day of the last `days` days, newest last. */
export function perDay(recs: LocalRecord[], days: number): { day: string; n: number }[] {
  const out: { day: string; n: number }[] = [];
  const map = new Map<string, number>();
  for (const r of recs) { const d = new Date(r.created_at); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; map.set(k, (map.get(k) ?? 0) + 1); }
  const today = new Date(); today.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ day: k, n: map.get(k) ?? 0 });
  }
  return out;
}
