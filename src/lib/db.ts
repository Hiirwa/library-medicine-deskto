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
    `SELECT * FROM records WHERE project = $1 AND deleted_at IS NULL ${search.trim() ? 'AND (data LIKE $2 OR uuid LIKE $2)' : ''} ORDER BY updated_at DESC LIMIT 10000`,
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

// ------------------------------------------------------------------ dashboards & statistics (all computed from the local copy)
const isoDaysAgo = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };

export interface ProjectStats { total: number; complete: number; draft: number; flagged: number; toSend: number; refused: number; today: number; week: number }
export async function projectStats(project: string): Promise<ProjectStats> {
  const r = await (await db()).select<Record<string, number | null>[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) AS complete,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft,
            SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
            SUM(CASE WHEN dirty = 1 THEN 1 ELSE 0 END) AS toSend,
            SUM(CASE WHEN sync_error IS NOT NULL THEN 1 ELSE 0 END) AS refused,
            SUM(CASE WHEN created_at >= $2 THEN 1 ELSE 0 END) AS today,
            SUM(CASE WHEN created_at >= $3 THEN 1 ELSE 0 END) AS week
       FROM records WHERE project = $1 AND deleted_at IS NULL`,
    [project, isoDaysAgo(0), isoDaysAgo(6)],
  );
  const x = r[0] ?? {};
  const n = (k: string) => Number(x[k] ?? 0);
  return { total: n('total'), complete: n('complete'), draft: n('draft'), flagged: n('flagged'), toSend: n('toSend'), refused: n('refused'), today: n('today'), week: n('week') };
}

export interface GlobalStats { projects: number; active: number; archived: number; records: number; week: number; prevWeek: number; toSend: number; refused: number }
export async function globalStats(): Promise<GlobalStats> {
  const d = await db();
  const p = await d.select<{ n: number; act: number | null }[]>("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS act FROM projects");
  const r = await d.select<Record<string, number | null>[]>(
    `SELECT COUNT(*) AS records,
            SUM(CASE WHEN created_at >= $1 THEN 1 ELSE 0 END) AS week,
            SUM(CASE WHEN created_at >= $2 AND created_at < $1 THEN 1 ELSE 0 END) AS prevWeek,
            SUM(CASE WHEN sync_error IS NOT NULL THEN 1 ELSE 0 END) AS refused
       FROM records WHERE deleted_at IS NULL`,
    [isoDaysAgo(6), isoDaysAgo(13)],
  );
  const n = Number(p[0]?.n ?? 0);
  const act = Number(p[0]?.act ?? 0);
  return { projects: n, active: act, archived: n - act, records: Number(r[0]?.records ?? 0), week: Number(r[0]?.week ?? 0), prevWeek: Number(r[0]?.prevWeek ?? 0), toSend: await outboxCount(), refused: Number(r[0]?.refused ?? 0) };
}

/** Records created per local day for the last `days` days (oldest first). */
export async function dayCounts(days: number, project?: string): Promise<{ day: string; n: number }[]> {
  const rows = await (await db()).select<{ created_at: string }[]>(
    `SELECT created_at FROM records WHERE deleted_at IS NULL AND created_at >= $1 ${project ? 'AND project = $2' : ''}`,
    project ? [isoDaysAgo(days - 1), project] : [isoDaysAgo(days - 1)],
  );
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const map = new Map<string, number>();
  for (const r of rows) { const k = key(new Date(r.created_at)); map.set(k, (map.get(k) ?? 0) + 1); }
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push({ day: key(d), n: map.get(key(d)) ?? 0 }); }
  return out;
}

/** The most recently changed records across all projects. */
export async function recentRecords(limit = 8): Promise<(LocalRecord & { project_title: string })[]> {
  const rows = await (await db()).select<(RecordRow & { project_title: string })[]>(
    'SELECT r.*, p.title AS project_title FROM records r JOIN projects p ON p.uuid = r.project WHERE r.deleted_at IS NULL ORDER BY r.updated_at DESC LIMIT $1', [limit],
  );
  return rows.map((r) => ({ ...toRecord(r), project_title: r.project_title }));
}

export interface PendingChange { uuid: string; op: string; project: string; project_title: string | null; changes: number; at: string; attempts: number; last_error: string | null; data: string | null; version: number | null }
/** The offline change log grouped per record, for the Sync centre. */
export async function pendingChanges(): Promise<PendingChange[]> {
  return (await db()).select<PendingChange[]>(
    `SELECT o.uuid, (SELECT op FROM outbox x WHERE x.uuid = o.uuid ORDER BY id DESC LIMIT 1) AS op, o.project, p.title AS project_title, COUNT(*) AS changes,
            MAX(o.client_updated_at) AS at, MAX(o.attempts) AS attempts, MAX(o.last_error) AS last_error,
            (SELECT data FROM records r WHERE r.uuid = o.uuid) AS data,
            (SELECT version FROM records r WHERE r.uuid = o.uuid) AS version
       FROM outbox o LEFT JOIN projects p ON p.uuid = o.project GROUP BY o.uuid ORDER BY MAX(o.id) DESC`,
  );
}

/** Throw away the unsent change of one record. The server copy comes back at the next sync. */
export async function discardChange(uuid: string) {
  const d = await db();
  const rec = await getRecord(uuid);
  await d.execute('DELETE FROM outbox WHERE uuid = $1', [uuid]);
  if (rec && rec.version === 0) {
    await d.execute('DELETE FROM records WHERE uuid = $1', [uuid]);
    await d.execute("DELETE FROM files WHERE record = $1 AND state = 'pending_upload'", [uuid]);
  } else {
    await d.execute('UPDATE records SET dirty = 0, sync_error = NULL WHERE uuid = $1', [uuid]);
    await kvDel('last_sync'); // pull everything again so the server copy replaces the discarded edit
  }
}

export async function refusedRecords(): Promise<(LocalRecord & { project_title: string })[]> {
  const rows = await (await db()).select<(RecordRow & { project_title: string })[]>(
    'SELECT r.*, p.title AS project_title FROM records r JOIN projects p ON p.uuid = r.project WHERE r.sync_error IS NOT NULL ORDER BY r.updated_at DESC',
  );
  return rows.map((r) => ({ ...toRecord(r), project_title: r.project_title }));
}

/** Quick search across every project (command palette). */
export async function searchRecords(q: string, limit = 8): Promise<{ uuid: string; project: string; form: string | null; project_title: string; data: string; updated_at: string }[]> {
  const like = `%${q.trim()}%`;
  return (await db()).select(
    'SELECT r.uuid, r.project, r.form, p.title AS project_title, r.data, r.updated_at FROM records r JOIN projects p ON p.uuid = r.project WHERE r.deleted_at IS NULL AND (r.uuid LIKE $1 OR r.data LIKE $1) ORDER BY r.updated_at DESC LIMIT $2',
    [like, limit],
  );
}

export async function filesForProject(project: string): Promise<LocalFile[]> {
  return (await db()).select<LocalFile[]>('SELECT * FROM files WHERE project = $1 ORDER BY name COLLATE NOCASE', [project]);
}

export async function retryFailedFiles() {
  await (await db()).execute("UPDATE files SET state = CASE WHEN local_path IS NOT NULL THEN 'pending_upload' ELSE 'remote' END, error = NULL WHERE state = 'error'");
}

export async function storageStats(): Promise<{ records: number; projects: number; files: number; offlineBytes: number; totalBytes: number }> {
  const d = await db();
  const r = await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM records WHERE deleted_at IS NULL');
  const p = await d.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM projects');
  const f = await d.select<{ n: number; off: number | null; tot: number | null }[]>('SELECT COUNT(*) AS n, SUM(CASE WHEN local_path IS NOT NULL THEN size ELSE 0 END) AS off, SUM(size) AS tot FROM files');
  return { records: r[0]?.n ?? 0, projects: p[0]?.n ?? 0, files: f[0]?.n ?? 0, offlineBytes: Number(f[0]?.off ?? 0), totalBytes: Number(f[0]?.tot ?? 0) };
}

/** Next sync downloads every record again (repairs a local copy that looks wrong). */
export async function resetCheckpoint() { await kvDel('last_sync'); }

// ------------------------------------------------------------------ log & reset
export async function logSync(ok: boolean, summary: string) {
  const d = await db();
  await d.execute('INSERT INTO sync_log (at, ok, summary) VALUES ($1, $2, $3)', [nowIso(), ok ? 1 : 0, summary]);
  await d.execute('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 100)');
}
export async function syncLog(limit = 20): Promise<{ id: number; at: string; ok: number; summary: string }[]> {
  return (await db()).select('SELECT * FROM sync_log ORDER BY id DESC LIMIT $1', [limit]);
}

/** Sign out: remove every local copy (only allowed when nothing is waiting to be sent). */
export async function wipe() {
  const d = await db();
  for (const t of ['records', 'outbox', 'files', 'forms', 'variables', 'projects', 'sync_log', 'kv']) {
    await d.execute(`DELETE FROM ${t}`);
  }
}
