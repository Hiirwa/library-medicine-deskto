// Sync engine: pushes the offline change log, pulls everything changed on the server, keeps files available offline.
//
//  1. upload files attached offline (they must exist on the server before records point to them)
//  2. POST /api/v1/sync with the change log (coalesced per record) and the last checkpoint
//  3. apply the per-change results: applied → drop from the log; server_wins → overwrite the local copy; rejected → keep, flag
//  4. merge the server delta (paged), replace projects/forms/variables
//  5. download attachments that are not on this computer yet
//  6. store the new checkpoint (the server time of the FIRST page, so nothing changed during paging is missed)
//
// Sync 2 (servers from November 2026, older servers simply ignore the extra fields):
//  - scope: 'team' keeps every record of projects where the person's role may see all data (web submissions,
//    colleagues' entries), 'own' only what they submitted
//  - a scope key: when projects, roles or the scope change, everything is downloaded again and records that are
//    no longer visible are removed (reconciliation)
//  - purged: records deleted for good on the website disappear here too
//  - a fingerprint compared with GET /api/v1/sync/status, so website changes arrive within seconds (live sync)
//  - the device reports its name, app version and waiting changes (shown on the website under Account → Devices)
//  - a change that lost against a newer one on the server is kept as a conflict copy that can be restored
import { getVersion } from '@tauri-apps/api/app';
import { api, apiError, native } from './native';
import * as store from './db';
import type { ChangeResult, OutboxRow, SyncResponse, SyncStatus } from './types';

export type SyncStage = 'idle' | 'files-up' | 'pushing' | 'pulling' | 'files-down' | 'done' | 'error';
export interface SyncProgress { stage: SyncStage; message: string; done?: number; total?: number }
export interface SyncSummary { pushed: number; serverWins: number; rejected: number; pulled: number; downloaded: number; uploaded: number; purged: number; full: boolean; errors: string[] }
export type SyncScope = 'team' | 'own';

/** Thrown when the website disconnected this computer (Account → Devices). */
export class DeviceRevokedError extends Error { code = 'device_revoked' as const }

/** This computer's id, created once. */
export async function deviceId(): Promise<string> {
  const have = await store.kvGet('device_id');
  if (have) return have;
  const id = crypto.randomUUID();
  await store.kvSet('device_id', id);
  return id;
}

/** How the computer introduces itself to the server (name, system, app version). */
async function clientInfo() {
  const ua = navigator.userAgent;
  const platform = /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Desktop';
  const name = (await store.kvGet('device_name')) || `${platform} computer`;
  const version = await getVersion().catch(() => '');
  return { name, platform, version };
}

const isRevoked = (r: { status: number; body: unknown }) => r.status === 403 && (r.body as { code?: string } | null)?.code === 'device_revoked';

const BATCH = 400;
let running: Promise<SyncSummary> | null = null;

/** Coalesce the log: several edits of one record become one upsert with the merged data; a delete wins. */
function coalesce(rows: OutboxRow[]) {
  const byUuid = new Map<string, { change: Record<string, unknown>; ids: number[] }>();
  for (const r of rows) {
    const cur = byUuid.get(r.uuid);
    const data = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : undefined;
    if (!cur) {
      byUuid.set(r.uuid, {
        ids: [r.id],
        change: { op: r.op, uuid: r.uuid, project: r.project, form: r.form, partial: !!r.partial, status: r.status ?? undefined, data, client_updated_at: r.client_updated_at },
      });
      continue;
    }
    cur.ids.push(r.id);
    if (r.op === 'delete') {
      cur.change = { op: 'delete', uuid: r.uuid, project: r.project, client_updated_at: r.client_updated_at };
    } else {
      const prev = cur.change.op === 'upsert' ? ((cur.change.data as Record<string, unknown>) ?? {}) : {};
      cur.change = { ...cur.change, op: 'upsert', data: { ...prev, ...(data ?? {}) }, partial: !!r.partial, status: r.status ?? cur.change.status, client_updated_at: r.client_updated_at };
    }
  }
  return [...byUuid.values()];
}

async function uploadFiles(onProgress: (p: SyncProgress) => void, sum: SyncSummary) {
  const files = await store.filesToUpload();
  let i = 0;
  for (const f of files) {
    onProgress({ stage: 'files-up', message: `Uploading ${f.name}`, done: ++i, total: files.length });
    if (!f.local_path || !f.variable) continue;
    try {
      const r = await native.upload(f.local_path, f.uuid, f.project, f.variable, f.sha256 ?? '');
      if (r.status === 201 || (r.status === 200 && r.body.ok)) {
        await store.setFile(f.uuid, { state: 'uploaded', error: null });
        sum.uploaded++;
      } else if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) {
        await store.setFile(f.uuid, { state: 'error', error: apiError(r) });
        sum.errors.push(`${f.name}: ${apiError(r)}`);
      } else {
        throw new Error(apiError(r));
      }
    } catch (e) {
      throw new Error(`Uploading ${f.name} failed: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
}

async function applyResults(results: ChangeResult[], batch: ReturnType<typeof coalesce>, sum: SyncSummary) {
  const byUuid = new Map(batch.map((b) => [b.change.uuid as string, b]));
  for (const res of results) {
    const b = byUuid.get(res.uuid);
    if (!b) continue;
    const maxId = Math.max(...b.ids);
    if (res.status === 'applied' || res.status === 'unchanged') {
      await store.outboxRemoveUpTo(res.uuid, maxId);
      if (b.change.op === 'delete') {
        await (await store.db()).execute('UPDATE records SET dirty = 0 WHERE uuid = $1', [res.uuid]);
      } else {
        await store.setRecordSynced(res.uuid, res.version ?? 1);
      }
      sum.pushed++;
    } else if (res.status === 'server_wins' && res.record) {
      // keep what this computer had, so the person can compare and restore it from the Sync centre
      const local = await store.getRecord(res.uuid);
      const mine = b.change.op === 'upsert' ? ((b.change.data as Record<string, unknown>) ?? {}) : {};
      if (local || Object.keys(mine).length) {
        await store.addConflict({
          id: crypto.randomUUID(), uuid: res.uuid, project: String(b.change.project ?? res.record.project), form: (b.change.form as string | null) ?? res.record.form,
          at: new Date().toISOString(), op: b.change.op === 'delete' ? 'delete' : 'upsert',
          mine: { ...(local?.data ?? {}), ...mine }, mine_at: String(b.change.client_updated_at ?? local?.updated_at ?? ''),
          theirs: res.record.data ?? {}, theirs_at: res.record.updated_at,
        });
      }
      await store.outboxRemoveUpTo(res.uuid, maxId);
      await store.applyServerRecord(res.record, true);
      sum.serverWins++;
    } else {
      const msg = res.error + (res.errors ? ' ' + Object.entries(res.errors).map(([k, v]) => `${k}: ${v}`).join('; ') : '');
      // a rejected change will not succeed by retrying: take it out of the queue, keep the local copy and show why
      await store.outboxRemoveUpTo(res.uuid, maxId);
      // the server copy (unchanged) comes back with the delta; the notice tells the user what was refused
      await store.setRecordError(res.uuid, (msg || 'Rejected by the server.') + ' The server copy was kept.');
      sum.rejected++;
      sum.errors.push(msg);
    }
  }
}

async function downloadFiles(onProgress: (p: SyncProgress) => void, sum: SyncSummary, scope: SyncScope) {
  const list = await store.filesToDownload();
  let i = 0;
  const queue = [...list];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      onProgress({ stage: 'files-down', message: `Downloading ${f.name}`, done: ++i, total: list.length });
      try {
        const path = await native.download(f.uuid, f.project, f.name, f.sha256, scope);
        await store.setFile(f.uuid, { state: 'downloaded', local_path: path, error: null });
        sum.downloaded++;
      } catch (e) {
        await store.setFile(f.uuid, { state: 'error', error: String(e) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/** Runs one full sync. Concurrent calls share the same run. */
export function syncNow(onProgress: (p: SyncProgress) => void = () => {}, opts: { downloadFiles?: boolean; scope?: SyncScope } = {}): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const sum: SyncSummary = { pushed: 0, serverWins: 0, rejected: 0, pulled: 0, downloaded: 0, uploaded: 0, purged: 0, full: false, errors: [] };
    const scope: SyncScope = opts.scope ?? 'team';
    const device = await deviceId();
    const client = await clientInfo();
    try {
      await uploadFiles(onProgress, sum);

      let last = await store.kvGet('last_sync');
      const storedKey = await store.kvGet('scope_key');
      // a full download: first sync, "download again", or another scope than last time
      let full = last === null;
      const received = new Set<string>();
      let metaProjects: string[] | null = null;
      let fingerprint: string | null = null;
      let scopeKey: string | null = null;
      let checkpoint: string | null = null;
      // push the log in batches; the first response also starts the pull
      let rows = await store.outbox(BATCH * 3);
      let batch = coalesce(rows).slice(0, BATCH);
      let cursor: Record<string, unknown> | null = null;
      let page = 0;
      let rounds = 0;
      do {
        if (++rounds > 200) throw new Error('Sync stopped after 200 rounds; it will continue next time.');
        onProgress({ stage: batch.length ? 'pushing' : 'pulling', message: batch.length ? `Sending ${batch.length} change${batch.length === 1 ? '' : 's'}…` : page ? `Receiving updates (page ${page + 1})…` : full ? 'Downloading your projects…' : 'Checking for updates…' });
        const pending = await store.outboxCount();
        const r: { status: number; body: SyncResponse } = await api<SyncResponse>('POST', 'api/v1/sync', { changes: batch.map((b) => b.change), last_sync: last, cursor, device: `desktop:${device}`, scope, client, pending });
        if (isRevoked(r)) throw new DeviceRevokedError(apiError(r));
        if (r.status !== 200) {
          await store.outboxFail(batch.flatMap((b) => b.ids), apiError(r));
          throw new Error(apiError(r, 'Sync failed'));
        }
        const res: SyncResponse = r.body;
        checkpoint ??= res.server_time;
        if (res.fingerprint) fingerprint = res.fingerprint;
        if (batch.length) await applyResults(res.results, batch, sum);
        if (res.meta) {
          await store.saveMeta(res.meta.projects, res.meta.forms, res.meta.variables);
          metaProjects = res.meta.projects.map((p) => p.uuid);
        }
        for (const rec of res.records) {
          if (full) received.add(rec.uuid);
          if (await store.applyServerRecord(rec)) sum.pulled++;
        }
        if (res.purged?.length) sum.purged += await store.purgeLocal(res.purged);
        const byProject = new Map<string, typeof res.files>();
        for (const f of res.files) {
          const rec = res.records.find((x: SyncResponse['records'][number]) => x.uuid === f.record);
          const p = rec?.project;
          if (p) byProject.set(p, [...(byProject.get(p) ?? []), f]);
        }
        for (const [p, files] of byProject) await store.saveManifest(p, files);

        // projects, roles or scope changed since the last sync: start the download again from the beginning
        if (res.scope?.key) {
          scopeKey = res.scope.key;
          if (!full && storedKey !== res.scope.key) { // also the first sync with a sync-2 server
            full = true;
            last = null;
            cursor = null;
            page = 0;
            batch = coalesce(await store.outbox(BATCH * 3)).slice(0, BATCH);
            onProgress({ stage: 'pulling', message: 'Your projects or access changed — downloading everything again…' });
            continue;
          }
        }

        // more local changes queued? keep pushing (with no cursor: each push request restarts the pull at the checkpoint)
        rows = await store.outbox(BATCH * 3);
        const next = coalesce(rows).filter((c) => !batch.some((b) => b.change.uuid === c.change.uuid && Math.max(...b.ids) >= Math.max(...c.ids)));
        if (next.length && batch.length) {
          batch = next.slice(0, BATCH);
          cursor = null;
          if (full) received.clear(); // the pull restarts too
        } else {
          batch = [];
          cursor = res.has_more ? res.cursor : null;
          page++;
          if (!res.has_more) break;
        }
      } while (true);

      // after a complete download, drop what the server no longer has for this person
      if (full && metaProjects) {
        onProgress({ stage: 'pulling', message: 'Tidying the offline copy…' });
        sum.purged += await store.reconcile(metaProjects, received);
      }
      sum.full = full;

      if (opts.downloadFiles !== false) await downloadFiles(onProgress, sum, scope);
      if (checkpoint) await store.kvSet('last_sync', checkpoint);
      if (scopeKey) await store.kvSet('scope_key', scopeKey);
      if (fingerprint) await store.kvSet('fingerprint', fingerprint);
      await store.kvSet('last_sync_ok', new Date().toISOString());
      const summary = `Sent ${sum.pushed}, received ${sum.pulled}, files ↑${sum.uploaded} ↓${sum.downloaded}` + (sum.purged ? `, ${sum.purged} removed` : '') + (sum.serverWins ? `, ${sum.serverWins} newer on server` : '') + (sum.rejected ? `, ${sum.rejected} rejected` : '') + (full ? ' · full download' : '');
      await store.logSync(sum.rejected === 0, summary);
      onProgress({ stage: 'done', message: summary });
      return sum;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.logSync(false, msg);
      onProgress({ stage: 'error', message: msg });
      sum.errors.push(msg);
      if (e instanceof DeviceRevokedError) throw Object.assign(e, { summary: sum });
      throw Object.assign(new Error(msg), { summary: sum });
    }
  })().finally(() => { running = null; });
  return running;
}

/**
 * Has anything changed on the server since the last sync? One small request; used every few seconds by live sync.
 * Returns 'unsupported' for servers without the endpoint (the timer-based sync still works with them).
 */
export async function checkRemote(scope: SyncScope): Promise<'changed' | 'same' | 'unsupported'> {
  const device = await deviceId();
  const pending = await store.outboxCount();
  const r = await api<SyncStatus>('GET', `api/v1/sync/status?scope=${scope}&device=${encodeURIComponent(`desktop:${device}`)}&pending=${pending}`);
  if (isRevoked(r)) throw new DeviceRevokedError(apiError(r));
  if (r.status === 404 || r.status === 405) return 'unsupported';
  if (r.status !== 200 || !r.body?.fingerprint) throw new Error(apiError(r, 'Status check failed'));
  const [fp, key] = await Promise.all([store.kvGet('fingerprint'), store.kvGet('scope_key')]);
  return fp !== r.body.fingerprint || key !== r.body.scope?.key ? 'changed' : 'same';
}

export const isSyncing = () => running !== null;
