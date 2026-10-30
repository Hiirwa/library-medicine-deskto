// Local SQLite store (schema: migrations in src-tauri/src/lib.rs).
// Everything the user sees is read from here, so the app works the same with or without internet.
import Database from '@tauri-apps/plugin-sql';
import type { FileManifest, Form, LocalFile, LocalRecord, OutboxRow, Project, RecordData, ServerRecord, Variable } from './types';
import { nowIso } from './time';

let dbp: Promise<Database> | null = null;
export const db = () => (dbp ??= Database.load('sqlite:library-medicine.db'));

const j = <T>(s: string | null | undefined, d: T): T => {
  if (!s) return d;
  try { return JSON.parse(s) as T; } catch { return d; }
};

// ------------------------------------------------------------------ key/value settings
export async function kvGet(key: string): Promise<string | null> {
  const r = await (await db()).select<{ value: string }[]>('SELECT value FROM kv WHERE key = $1', [key]);
  return r[0]?.value ?? null;
}
export async function kvSet(key: string, value: string) {
  await (await db()).execute('INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
export async function kvDel(key: string) {
  await (await db()).execute('DELETE FROM kv WHERE key = $1', [key]);
}

// ------------------------------------------------------------------ projects, forms, variables (replaced on every sync)
export async function saveMeta(projects: Project[], forms: Form[], variables: Record<string, Variable[]>) {
  const d = await db();
  const keepP = projects.map((p) => p.uuid);
  for (const p of projects) {
    await d.execute(
      'INSERT INTO projects (uuid, title, role, status, json) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(uuid) DO UPDATE SET title = excluded.title, role = excluded.role, status = excluded.status, json = excluded.json',
      [p.uuid, p.title, p.role, p.status, JSON.stringify(p)],
    );
  }
  // projects no longer shared with this person disappear with their data (nothing of theirs is pending)
  const old = await d.select<{ uuid: string }[]>('SELECT uuid FROM projects');
  for (const o of old) {
    if (!keepP.includes(o.uuid)) {
      const pend = await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM outbox WHERE project = $1', [o.uuid]);
      if (!pend[0]?.n) {
        await d.execute('DELETE FROM records WHERE project = $1', [o.uuid]);
        await d.execute('DELETE FROM forms WHERE project = $1', [o.uuid]);
        await d.execute('DELETE FROM variables WHERE project = $1', [o.uuid]);
        await d.execute('DELETE FROM projects WHERE uuid = $1', [o.uuid]);
      }
    }
  }
  await d.execute('DELETE FROM forms');
  for (const f of forms) {
    await d.execute('INSERT OR REPLACE INTO forms (uuid, project, title, json) VALUES ($1, $2, $3, $4)', [f.uuid, f.project, f.title, JSON.stringify(f)]);
  }
  for (const [project, vars] of Object.entries(variables)) {
    await d.execute('INSERT OR REPLACE INTO variables (project, json) VALUES ($1, $2)', [project, JSON.stringify(vars)]);
  }
}

export async function listProjects(): Promise<(Project & { records: number; pending: number })[]> {
  const rows = await (await db()).select<{ json: string; records: number; pending: number }[]>(
    `SELECT p.json,
            (SELECT COUNT(*) FROM records r WHERE r.project = p.uuid AND r.deleted_at IS NULL) AS records,
            (SELECT COUNT(*) FROM outbox o WHERE o.project = p.uuid) AS pending
       FROM projects p ORDER BY p.title COLLATE NOCASE`,
  );
  return rows.map((r) => ({ ...j<Project>(r.json, {} as Project), records: r.records, pending: r.pending }));
}

export async function listForms(project: string): Promise<Form[]> {
  const rows = await (await db()).select<{ json: string }[]>('SELECT json FROM forms WHERE project = $1 ORDER BY title COLLATE NOCASE', [project]);
  return rows.map((r) => j<Form>(r.json, {} as Form));
}

export async function getVariables(project: string): Promise<Variable[]> {
  const rows = await (await db()).select<{ json: string }[]>('SELECT json FROM variables WHERE project = $1', [project]);
  return j<Variable[]>(rows[0]?.json, []).sort((a, b) => a.sort_order - b.sort_order);
}

// ------------------------------------------------------------------ records
type RecordRow = Omit<LocalRecord, 'data'> & { data: string };
const toRecord = (r: RecordRow): LocalRecord => ({ ...r, data: j<RecordData>(r.data, {}) });

export async function listRecords(project: string, search = ''): Promise<LocalRecord[]> {
  const like = `%${search.trim()}%`;
  const rows = await (await db()).select<RecordRow[]>(
    `SELECT * FROM records WHERE project = $1 AND deleted_at IS NULL ${search.trim() ? 'AND (data LIKE $2 OR uuid LIKE $2)' : ''} ORDER BY updated_at DESC LIMIT 2000`,
    search.trim() ? [project, like] : [project],
  );
  return rows.map(toRecord);
}

export async function getRecord(uuid: string): Promise<LocalRecord | null> {
  const rows = await (await db()).select<RecordRow[]>('SELECT * FROM records WHERE uuid = $1', [uuid]);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Save a record made or edited on this computer and queue it for the server. */
export async function saveLocalRecord(input: { uuid: string; project: string; form: string | null; data: RecordData; status: 'draft' | 'complete'; isNew: boolean }) {
  const d = await db();
  const at = nowIso();
  if (input.isNew) {
    await d.execute(
      'INSERT INTO records (uuid, project, form, status, version, data, created_at, updated_at, deleted_at, dirty, sync_error) VALUES ($1, $2, $3, $4, 0, $5, $6, $6, NULL, 1, NULL)',
      [input.uuid, input.project, input.form, input.status, JSON.stringify(input.data), at],
    );
  } else {
    await d.execute('UPDATE records SET data = $1, status = $2, updated_at = $3, dirty = 1, sync_error = NULL, deleted_at = NULL WHERE uuid = $4', [
      JSON.stringify(input.data), input.status, at, input.uuid,
    ]);
  }
  await d.execute(
    'INSERT INTO outbox (uuid, op, project, form, partial, status, data, client_updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [input.uuid, 'upsert', input.project, input.form, input.status === 'draft' ? 1 : 0, input.status, JSON.stringify(input.data), at],
  );
}

/** Delete on this computer (soft) and queue the deletion. */
export async function deleteLocalRecord(rec: LocalRecord) {
  const d = await db();
  const at = nowIso();
  if (rec.version === 0) {
    // never reached the server: forget it completely
    await d.execute('DELETE FROM outbox WHERE uuid = $1', [rec.uuid]);
    await d.execute('DELETE FROM records WHERE uuid = $1', [rec.uuid]);
    return;
  }
  await d.execute('UPDATE records SET deleted_at = $1, updated_at = $1, dirty = 1 WHERE uuid = $2', [at, rec.uuid]);
  await d.execute('INSERT INTO outbox (uuid, op, project, client_updated_at) VALUES ($1, $2, $3, $4)', [rec.uuid, 'delete', rec.project, at]);
}

/** Store a record coming from the server. Local unsent edits are kept unless `force` (server won the conflict). */
export async function applyServerRecord(r: ServerRecord, force = false) {
  const d = await db();
  if (!force) {
    const pend = await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM outbox WHERE uuid = $1', [r.uuid]);
    if (pend[0]?.n) return false;
  }
  await d.execute(
    `INSERT INTO records (uuid, project, form, status, version, data, created_at, updated_at, deleted_at, dirty, sync_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, NULL)
     ON CONFLICT(uuid) DO UPDATE SET project = excluded.project, form = excluded.form, status = excluded.status, version = excluded.version,
       data = excluded.data, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, dirty = 0`, // a refusal notice (sync_error) stays until the user dismisses it
    [r.uuid, r.project, r.form, r.status, r.version, JSON.stringify(r.data ?? {}), r.created_at, r.updated_at, r.deleted_at],
  );
  return true;
}

export async function setRecordSynced(uuid: string, version: number) {
  const d = await db();
  const pend = await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM outbox WHERE uuid = $1', [uuid]);
  await d.execute('UPDATE records SET version = $1, dirty = $2, sync_error = NULL WHERE uuid = $3', [version, pend[0]?.n ? 1 : 0, uuid]);
}

export async function clearRecordError(uuid: string) {
  await (await db()).execute('UPDATE records SET sync_error = NULL WHERE uuid = $1', [uuid]);
}

export async function setRecordError(uuid: string, message: string) {
  await (await db()).execute('UPDATE records SET sync_error = $1 WHERE uuid = $2', [message, uuid]);
}

// ------------------------------------------------------------------ outbox (the offline change log)
export async function outbox(limit = 500): Promise<OutboxRow[]> {
  return (await db()).select<OutboxRow[]>('SELECT * FROM outbox ORDER BY id ASC LIMIT $1', [limit]);
}
export async function outboxCount(): Promise<number> {
  const r = await (await db()).select<{ n: number }[]>('SELECT COUNT(DISTINCT uuid) AS n FROM outbox');
  return r[0]?.n ?? 0;
}
export async function outboxRemoveUpTo(uuid: string, maxId: number) {
  await (await db()).execute('DELETE FROM outbox WHERE uuid = $1 AND id <= $2', [uuid, maxId]);
}
export async function outboxFail(ids: number[], message: string) {
  if (!ids.length) return;
  await (await db()).execute(`UPDATE outbox SET attempts = attempts + 1, last_error = $1 WHERE id IN (${ids.map((_, i) => `$${i + 2}`).join(',')})`, [message, ...ids]);
}

// ------------------------------------------------------------------ files
export async function saveManifest(project: string, files: FileManifest[]) {
  const d = await db();
  for (const f of files) {
    await d.execute(
      `INSERT INTO files (uuid, record, project, variable, name, mime, size, sha256, local_path, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'remote')
       ON CONFLICT(uuid) DO UPDATE SET record = excluded.record, variable = excluded.variable, name = excluded.name, mime = excluded.mime, size = excluded.size,
         state = CASE WHEN files.sha256 IS excluded.sha256 AND files.state IN ('downloaded', 'uploaded') THEN files.state ELSE 'remote' END,
         local_path = CASE WHEN files.sha256 IS excluded.sha256 THEN files.local_path ELSE NULL END,
         sha256 = excluded.sha256`,
      [f.uuid, f.record, project, f.variable, f.name, f.mime, f.size, f.sha256],
    );
  }
}
export async function filesToDownload(): Promise<LocalFile[]> {
  return (await db()).select<LocalFile[]>("SELECT * FROM files WHERE state IN ('remote', 'error') AND local_path IS NULL ORDER BY size ASC LIMIT 200");
}
export async function filesToUpload(): Promise<LocalFile[]> {
  return (await db()).select<LocalFile[]>("SELECT * FROM files WHERE state = 'pending_upload'");
}
export async function setFile(uuid: string, patch: Partial<Pick<LocalFile, 'state' | 'local_path' | 'error' | 'record'>>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  await (await db()).execute(`UPDATE files SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE uuid = $${keys.length + 1}`, [...keys.map((k) => patch[k] ?? null), uuid]);
}
export async function addLocalFile(f: { uuid: string; project: string; record: string; variable: string; name: string; mime: string; size: number; sha256: string; path: string }) {
  await (await db()).execute(
    "INSERT INTO files (uuid, record, project, variable, name, mime, size, sha256, local_path, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_upload')",
    [f.uuid, f.record, f.project, f.variable, f.name, f.mime, f.size, f.sha256, f.path],
  );
}
export async function filesFor(record: string): Promise<LocalFile[]> {
  return (await db()).select<LocalFile[]>('SELECT * FROM files WHERE record = $1 ORDER BY name COLLATE NOCASE', [record]);
}
export async function fileStats(): Promise<{ total: number; offline: number; waiting: number }> {
  const r = await (await db()).select<{ total: number; offline: number; waiting: number }[]>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN local_path IS NOT NULL THEN 1 ELSE 0 END) AS offline, SUM(CASE WHEN state = 'pending_upload' THEN 1 ELSE 0 END) AS waiting FROM files",
  );
  return { total: r[0]?.total ?? 0, offline: r[0]?.offline ?? 0, waiting: r[0]?.waiting ?? 0 };
}

// ------------------------------------------------------------------ log & reset
export async function logSync(ok: boolean, summary: string) {
  const d = await db();
  await d.execute('INSERT INTO sync_log (at, ok, summary) VALUES ($1, $2, $3)', [nowIso(), ok ? 1 : 0, summary]);
  await d.execute('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 100)');
}
export async function syncLog(): Promise<{ id: number; at: string; ok: number; summary: string }[]> {
  return (await db()).select('SELECT * FROM sync_log ORDER BY id DESC LIMIT 20');
}

/** Sign out: remove every local copy (only allowed when nothing is waiting to be sent). */
export async function wipe() {
  const d = await db();
  for (const t of ['records', 'outbox', 'files', 'forms', 'variables', 'projects', 'sync_log', 'kv']) {
    await d.execute(`DELETE FROM ${t}`);
  }
}
