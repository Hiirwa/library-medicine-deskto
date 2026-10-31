// What the website knows about a project's data and exports (needs the server update: Api\ExportInfo).
import { call, type Result } from './sharing';
import { readJson, writeJson } from './useLocal';

export interface ExportFormat { key: string; label: string; description: string; allowed: boolean }
export interface ExportHistory { at: string; user: string; kind: 'data' | 'dictionary'; format: string; records: number | null; variables: number | null; anonymized: boolean; labels: boolean | null }
export interface ExportInfo {
  project: { id: string; title: string; schema_version: number; status: string };
  role: string;
  plan: { key: string; name: string; upgrade_url: string };
  server: { records: number; complete: number; draft: number; flagged: number; last_record_at: string | null; forms: number; variables: number; members: number };
  formats: ExportFormat[];
  features: { export_opts: boolean; dictionary: boolean };
  history: ExportHistory[];
  website: { export: string; dictionary: string };
}

export const fetchExportInfo = (project: string): Promise<Result<ExportInfo>> => call<ExportInfo>('GET', `api/v1/projects/${project}/export-info`);

const key = (p: string) => `lm_exportinfo_${p}`;
/** Last information received, so the card still shows something when you are offline. */
export const cachedExportInfo = (p: string) => readJson<{ at: string; data: ExportInfo } | null>(key(p), null);
export const cacheExportInfo = (p: string, data: ExportInfo) => writeJson(key(p), { at: new Date().toISOString(), data });
