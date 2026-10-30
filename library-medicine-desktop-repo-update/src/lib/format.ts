import type { Variable } from './types';

/** A value as people read it: option labels instead of codes, Yes/No for booleans. */
export function displayValue(v: Variable | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const o = v?.config?.options;
  if (Array.isArray(value)) return value.map((x) => o?.find((y) => y.value === String(x))?.label ?? String(x)).join(', ');
  if (typeof value === 'object') {
    const g = value as { lat?: number; lng?: number };
    return g.lat !== undefined && g.lng !== undefined ? `${g.lat}, ${g.lng}` : JSON.stringify(value);
  }
  if (v?.type === 'boolean') return String(value) === '1' ? 'Yes' : String(value) === '0' ? 'No' : String(value);
  return o?.find((y) => y.value === String(value))?.label ?? String(value);
}

export const codeValue = (value: unknown): string =>
  value === null || value === undefined ? '' : Array.isArray(value) ? value.join(';') : typeof value === 'object' ? JSON.stringify(value) : String(value);

export const isAnswered = (x: unknown) => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && !x.length);

export function bytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const initials = (s: string | null | undefined) =>
  (s || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const TYPE_LABEL: Record<string, string> = {
  text: 'Short text', textarea: 'Long text', integer: 'Whole number', decimal: 'Decimal', number: 'Number', date: 'Date', datetime: 'Date & time', time: 'Time',
  boolean: 'Yes / No', radio: 'Single choice', dropdown: 'Dropdown', checkbox: 'Multiple choice', calculated: 'Calculated', file: 'File', email: 'Email', phone: 'Phone',
  gps: 'GPS location', rating: 'Rating', slider: 'Slider', note: 'Note',
};
export const TYPE_ICON: Record<string, string> = {
  text: 'fonts', textarea: 'text-paragraph', integer: '123', decimal: '123', number: '123', date: 'calendar3', datetime: 'calendar-event', time: 'clock',
  boolean: 'toggle-on', radio: 'ui-radios', dropdown: 'menu-button-wide', checkbox: 'ui-checks', calculated: 'calculator', file: 'paperclip', email: 'envelope',
  phone: 'telephone', gps: 'geo-alt', rating: 'star', slider: 'sliders', note: 'sticky',
};
