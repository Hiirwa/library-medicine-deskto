// Results the person pinned from Statistics or the Workbench; the Reports page includes them.
import { readJson, writeJson } from './useLocal';

export interface Pin { id: string; title: string; subtitle?: string; at: string; head: string[]; rows: (string | number)[][]; notes?: string[] }
const key = (project: string) => `lm_pins_${project}`;
export const loadPins = (project: string) => readJson<Pin[]>(key(project), []);
export const savePins = (project: string, pins: Pin[]) => writeJson(key(project), pins);
export function addPin(project: string, p: Omit<Pin, 'id' | 'at'>): number {
  const pins = loadPins(project);
  pins.push({ ...p, id: crypto.randomUUID(), at: new Date().toISOString() });
  savePins(project, pins);
  return pins.length;
}
