import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Empty, Icon } from './ui';
import { cacheExportInfo, cachedExportInfo, fetchExportInfo, type ExportInfo } from '../lib/exportinfo';
import { plural } from '../lib/format';
import { ago } from '../lib/time';
import { webUrl } from '../lib/access';
import { useSession } from '../providers/AppProvider';

/** Formats this app can save itself; the others are produced by the website only. */
const IN_APP: Record<string, string> = { csv: 'In this app', json: 'In this app', xlsx: 'Excel (.xml) here · .xlsx on the website' };
const ICON: Record<string, string> = { csv: 'filetype-csv', xlsx: 'file-earmark-excel', json: 'filetype-json', sav: 'file-earmark-bar-graph', dta: 'file-earmark-bar-graph', rds: 'file-earmark-code' };

/** Cards with information pulled from the website: how its data compares with this computer, the plan's export options, and recent exports. */
export function ExportWebInfo({ project, schemaVersion, localRecords, toSend }: { project: string; schemaVersion: number; localRecords: number; toSend: number }) {
  const { online, sync, syncing, server, toast } = useSession();
  const q = useQuery({ queryKey: ['exportinfo', project], queryFn: () => fetchExportInfo(project), enabled: online, staleTime: 15000 });
  const live: ExportInfo | null = q.data && q.data.ok ? q.data.data : null;
  useEffect(() => { if (live) cacheExportInfo(project, live); }, [live, project]);
  const cached = useMemo(() => cachedExportInfo(project), [project, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = live ?? cached?.data ?? null;
  const open = (url: string) => openUrl(url).catch(() => toast('Could not open the website.', 'error'));
  const exportUrl = info?.website.export ?? webUrl(server, project, 'export');

  if (online && q.isLoading && !info) return <section className="card p-5"><div className="skel" style={{ height: '1.2rem', width: '9rem' }} /><div className="skel mt-3" style={{ height: '5rem' }} /></section>;
  if (!info) {
    const bad = q.data && !q.data.ok ? q.data : null;
    return (
      <section className="card p-5 anim-in">
        <div className="mb-2 flex items-center gap-3"><span className="pk-ic"><Icon name="globe2" /></span><h3 className="text-lg">From the website</h3></div>
        <Empty icon={bad?.unsupported ? 'cloud-slash' : online ? 'exclamation-octagon' : 'wifi-off'} title={bad?.unsupported ? 'Needs a server update' : online ? 'Could not load' : 'You are offline'}>
          <span>{bad?.unsupported ? 'Update the server to see the website’s data, export formats and export history here.' : bad ? bad.error : 'Connect to see what the website knows about this project.'}</span>
          <div className="mt-2 flex justify-center gap-2"><button className="btn btn-sm" onClick={() => open(exportUrl)}><Icon name="box-arrow-up-right" />Open Export on the website</button>{online && <button className="btn btn-sm" onClick={() => q.refetch()}><Icon name="arrow-clockwise" />Retry</button>}</div>
        </Empty>
      </section>
    );
  }

  const s = info.server; const gap = s.records - localRecords; const stale = !live; const t = Math.max(1, s.records);
  const parts: [string, number, string][] = [['Complete', s.complete, 'var(--rh-success)'], ['Draft', s.draft, '#64748b'], ['Flagged', s.flagged, 'var(--rh-amber)']];
  const schemaDiff = info.project.schema_version !== schemaVersion;
  const lockedAny = info.formats.some((f) => !f.allowed) || !info.features.export_opts || !info.features.dictionary;

  return (
    <>
      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3">
          <span className="pk-ic"><Icon name="globe2" /></span>
          <div className="min-w-0 flex-1"><h3 className="text-lg">Data on the website</h3><p className="muted text-sm">{stale ? `Offline · as of ${ago(cached!.at)}` : q.isFetching ? 'Updating…' : `Updated ${ago(new Date(q.dataUpdatedAt).toISOString())}`}</p></div>
          <button className="btn btn-icon btn-sm" onClick={() => q.refetch()} disabled={!online || q.isFetching} aria-label="Refresh" title="Refresh"><Icon name="arrow-clockwise" className={q.isFetching ? 'spin' : ''} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="well px-3 py-2"><b className="num block text-lg ink">{s.records.toLocaleString()}</b><span className="muted text-xs font-bold uppercase">On the website</span></div>
          <div className="well px-3 py-2"><b className="num block text-lg ink">{localRecords.toLocaleString()}</b><span className="muted text-xs font-bold uppercase">On this computer</span></div>
        </div>
        {gap > 0 && <div className="notice warn"><Icon name="cloud-arrow-down" /><span className="flex-1"><b>{plural(gap, 'record')}</b> on the website {gap === 1 ? 'is' : 'are'} not on this computer yet. Sync first so your export is complete.</span><button className="btn btn-sm" disabled={!online || syncing} onClick={() => sync()}>{syncing ? <Icon name="arrow-repeat" className="spin" /> : <Icon name="arrow-repeat" />}Sync</button></div>}
        {gap <= 0 && toSend === 0 && <div className="notice ok"><Icon name="check2-circle" /><span>This computer has all the records that are on the website.</span></div>}
        {toSend > 0 && <div className="notice info"><Icon name="send" /><span><b>{plural(toSend, 'record')}</b> here {toSend === 1 ? 'has' : 'have'} not been sent yet. {toSend === 1 ? 'It is' : 'They are'} in your export but not on the website.</span></div>}
        {schemaDiff && <div className="notice warn"><Icon name="journal-text" /><span>The codebook changed on the website (v{info.project.schema_version}, here v{schemaVersion}). Sync to update the columns.</span></div>}
        <div><div className="fi-split" role="img" aria-label="Records on the website by status">{parts.map(([l, n, c]) => n > 0 && <i key={l} style={{ width: `${(n / t) * 100}%`, background: c }} title={`${l}: ${n}`} />)}</div>
          <div className="fi-legend">{parts.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} <b className="num">{n}</b></span>)}</div></div>
        <ul className="ew-facts">
          <li><Icon name="clock-history" />Last record <b>{s.last_record_at ? ago(s.last_record_at.replace(' ', 'T') + 'Z') : '—'}</b></li>
          <li><Icon name="ui-checks-grid" />{plural(s.forms, 'form')}</li>
          <li><Icon name="diagram-3" />{plural(s.variables, 'variable')}</li>
          <li><Icon name="people" />{plural(s.members, 'team member')}</li>
        </ul>
      </section>

      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="box-arrow-down" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">Website export options</h3><p className="muted text-sm">{info.plan.name}</p></div></div>
        <ul className="ew-formats">{info.formats.map((f) => (
          <li key={f.key} className={f.allowed ? '' : 'off'} title={f.description}>
            <span className="ic-sm"><Icon name={f.allowed ? ICON[f.key] ?? 'file-earmark' : 'lock-fill'} /></span>
            <span className="min-w-0 flex-1"><b className="ink block text-sm">{f.label}</b><small className="muted">{f.allowed ? (IN_APP[f.key] ?? 'On the website') : `Not in the ${info.plan.name}`}</small></span>
            {f.allowed && !IN_APP[f.key] && <button className="btn btn-sm btn-icon" onClick={() => open(exportUrl)} title="Open on the website" aria-label={`Open ${f.label} export on the website`}><Icon name="box-arrow-up-right" /></button>}
          </li>))}</ul>
        <div className="ew-feats">
          <div className={info.features.export_opts ? '' : 'off'}><Icon name={info.features.export_opts ? 'check-circle-fill' : 'lock-fill'} className={info.features.export_opts ? 'text-[var(--rh-success)]' : ''} /><span>Anonymise, option labels and leaving out metadata</span></div>
          <div className={info.features.dictionary ? '' : 'off'}><Icon name={info.features.dictionary ? 'check-circle-fill' : 'lock-fill'} className={info.features.dictionary ? 'text-[var(--rh-success)]' : ''} /><span>Data dictionary download</span>{info.features.dictionary && <button className="btn btn-sm" onClick={() => open(info.website.dictionary)}>Open</button>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm flex-1" onClick={() => open(exportUrl)}><Icon name="globe2" />Open Export on the website</button>
          {lockedAny && <button className="btn btn-sm btn-primary flex-1" onClick={() => open(info.plan.upgrade_url)}><Icon name="rocket-takeoff" />See plans</button>}
        </div>
      </section>

      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="clock-history" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">Exports from the website</h3><p className="muted text-sm">Last {Math.max(info.history.length, 0)} for this project</p></div></div>
        {info.history.length ? <ul className="ew-hist">{info.history.slice(0, 6).map((h, i) => (
          <li key={i}><span className="ic-sm"><Icon name={h.kind === 'dictionary' ? 'journal-text' : ICON[h.format] ?? 'file-earmark-arrow-down'} /></span>
            <span className="min-w-0 flex-1"><b className="ink block text-sm">{h.kind === 'dictionary' ? `Data dictionary · ${h.format.toUpperCase()}` : `${h.format.toUpperCase()}${h.records !== null ? ` · ${plural(h.records, 'record')}` : ''}`}</b>
              <small className="muted block truncate">{h.user} · {ago(h.at.replace(' ', 'T') + 'Z')}{h.anonymized ? ' · anonymised' : ''}{h.labels === false ? ' · codes' : ''}</small></span></li>))}</ul>
          : <p className="muted text-sm">Nobody has exported data from the website yet.</p>}
      </section>
    </>
  );
}
