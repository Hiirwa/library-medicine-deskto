// Sync engine: pushes the offline change log, pulls everything changed on the server, keeps files available offline.
//
//  1. upload files attached offline (they must exist on the server before records point to them)
//  2. POST /api/v1/sync with the change log (coalesced per record) and the last checkpoint
//  3. apply the per-change results: applied → drop from the log; server_wins → overwrite the local copy; rejected → keep, flag
//  4. merge the server delta (paged), replace projects/forms/variables
//  5. download attachments that are not on this computer yet
//  6. store the new checkpoint (the server time of the FIRST page, so nothing changed during paging is missed)
import { api, apiError, native } from './native';
import * as store from './db';
import type { ChangeResult, OutboxRow, SyncResponse } from './types';

export type SyncStage = 'idle' | 'files-up' | 'pushing' | 'pulling' | 'files-down' | 'done' | 'error';
export interface SyncProgress { stage: SyncStage; message: string; done?: number; total?: number }
export interface SyncSummary { pushed: number; serverWins: number; rejected: number; pulled: number; downloaded: number; uploaded: number; errors: string[] }

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

async function downloadFiles(onProgress: (p: SyncProgress) => void, sum: SyncSummary) {
  const list = await store.filesToDownload();
  let i = 0;
  const queue = [...list];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      onProgress({ stage: 'files-down', message: `Downloading ${f.name}`, done: ++i, total: list.length });
      try {
        const path = await native.download(f.uuid, f.project, f.name, f.sha256);
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
export function syncNow(onProgress: (p: SyncProgress) => void = () => {}): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const sum: SyncSummary = { pushed: 0, serverWins: 0, rejected: 0, pulled: 0, downloaded: 0, uploaded: 0, errors: [] };
    const device = (await store.kvGet('device_id')) ?? (await (async () => { const id = crypto.randomUUID(); await store.kvSet('device_id', id); return id; })());
    try {
      await uploadFiles(onProgress, sum);

      const last = await store.kvGet('last_sync');
      let checkpoint: string | null = null;
      // push the log in batches; the first response also starts the pull
      let rows = await store.outbox(BATCH * 3);
      let batch = coalesce(rows).slice(0, BATCH);
      let cursor: Record<string, unknown> | null = null;
      let page = 0;
      let rounds = 0;
      do {
        if (++rounds > 200) throw new Error('Sync stopped after 200 rounds; it will continue next time.');
        onProgress({ stage: batch.length ? 'pushing' : 'pulling', message: batch.length ? `Sending ${batch.length} change${batch.length === 1 ? '' : 's'}…` : page ? `Receiving updates (page ${page + 1})…` : 'Checking for updates…' });
        const r: { status: number; body: SyncResponse } = await api<SyncResponse>('POST', 'api/v1/sync', { changes: batch.map((b) => b.change), last_sync: last, cursor, device: `desktop:${device}` });
        if (r.status !== 200) {
          await store.outboxFail(batch.flatMap((b) => b.ids), apiError(r));
          throw new Error(apiError(r, 'Sync failed'));
        }
        const res: SyncResponse = r.body;
        checkpoint ??= res.server_time;
        if (batch.length) await applyResults(res.results, batch, sum);
        if (res.meta) await store.saveMeta(res.meta.projects, res.meta.forms, res.meta.variables);
        for (const rec of res.records) {
          if (await store.applyServerRecord(rec)) sum.pulled++;
        }
        const byProject = new Map<string, typeof res.files>();
        for (const f of res.files) {
          const rec = res.records.find((x: SyncResponse['records'][number]) => x.uuid === f.record);
          const p = rec?.project;
          if (p) byProject.set(p, [...(byProject.get(p) ?? []), f]);
        }
        for (const [p, files] of byProject) await store.saveManifest(p, files);

        // more local changes queued? keep pushing (with no cursor: each push request restarts the pull at the checkpoint)
        rows = await store.outbox(BATCH * 3);
        const next = coalesce(rows).filter((c) => !batch.some((b) => b.change.uuid === c.change.uuid && Math.max(...b.ids) >= Math.max(...c.ids)));
        if (next.length && batch.length) {
          batch = next.slice(0, BATCH);
          cursor = null;
        } else {
          batch = [];
          cursor = res.has_more ? res.cursor : null;
          page++;
          if (!res.has_more) break;
        }
      } while (true);

      await downloadFiles(onProgress, sum);
      if (checkpoint) await store.kvSet('last_sync', checkpoint);
      await store.kvSet('last_sync_ok', new Date().toISOString());
      const summary = `Sent ${sum.pushed}, received ${sum.pulled}, files ↑${sum.uploaded} ↓${sum.downloaded}` + (sum.serverWins ? `, ${sum.serverWins} newer on server` : '') + (sum.rejected ? `, ${sum.rejected} rejected` : '');
      await store.logSync(sum.rejected === 0, summary);
      onProgress({ stage: 'done', message: summary });
      return sum;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await store.logSync(false, msg);
      onProgress({ stage: 'error', message: msg });
      sum.errors.push(msg);
      throw Object.assign(new Error(msg), { summary: sum });
    }
  })().finally(() => { running = null; });
  return running;
}

export const isSyncing = () => running !== null;
