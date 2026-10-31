import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { bytes, plural, TYPE_ICON, TYPE_LABEL } from '../lib/format';
import { formInfo, recordSplit, daysUntil, type Split } from '../lib/formstats';
import { ACCESS_INFO, type Access } from '../lib/sharing';
import { checkAccess } from '../lib/access';
import { Rich } from '../components/Rich';
import { ago } from '../lib/time';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import type { ProjectCtx } from './ProjectView';

/** Short date such as 12 Oct 2026. */
const day = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? '' : 'Z')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function SplitBar({ s }: { s: Split }) {
  const parts: [string, number, string][] = [['Complete', s.complete, 'var(--rh-success)'], ['Draft', s.draft, '#64748b'], ['Flagged', s.flagged, 'var(--rh-amber)']];
  const t = Math.max(1, s.total);
  return (
    <div>
      <div className="fi-split" role="img" aria-label={parts.map(([l, n]) => `${l} ${n}`).join(', ')}>{parts.map(([l, n, c]) => n > 0 && <i key={l} style={{ width: `${(n / t) * 100}%`, background: c }} title={`${l}: ${n}`} />)}</div>
      <div className="fi-legend">{parts.map(([l, n, c]) => <span key={l}><i style={{ background: c }} />{l} <b className="num">{n}</b></span>)}
        {s.toSend > 0 && <span className="k-warn"><Icon name="send" />To send <b className="num">{s.toSend}</b></span>}{s.refused > 0 && <span className="k-danger"><Icon name="exclamation-octagon" />Refused <b className="num">{s.refused}</b></span>}</div>
    </div>
  );
}

function Stat4({ items }: { items: [string | number, string, string?][] }) {
  return <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map(([v, l, t]) => <div key={l} className="well px-3 py-2" title={t}><b className="num block text-lg ink">{v}</b><span className="muted text-xs font-bold uppercase">{l}</span></div>)}</div>;
}

/** The project's data-entry forms; each one opens the record editor laid out like the form on the website. */
export function FormsView({ project, vars, forms }: ProjectCtx) {
  const { openEditor, go } = useUi();
  const records = useQuery({ queryKey: ['records', project.uuid, ''], queryFn: () => store.listRecords(project.uuid, '') });
  const canAdd = project.can.add && project.status === 'active';
  const canShare = checkAccess('sharing', project).ok;
  const [q, setQ] = useState('');
  const [openForm, setOpenForm] = useState<string | null>(null);
  const toData = (form: string) => { try { localStorage.setItem('lm_pending_filter', `${project.uuid}|all|${form}`); } catch { /* ignore */ } go({ page: 'project', project: project.uuid, tab: 'data' }); };
  const shownForms = forms.filter((f) => !q.trim() || f.title.toLowerCase().includes(q.trim().toLowerCase()));
  const recsOf = (f: string | null) => (records.data ?? []).filter((r) => (f === null ? !r.form : r.form === f));
  const all = useMemo(() => formInfo(null, vars), [vars]);
  const allSplit = recordSplit(recsOf(null), all.names);

  const TypeChips = ({ types }: { types: [string, number][] }) => (
    <div className="flex flex-wrap gap-1.5">{types.slice(0, 6).map(([t, n]) => <span key={t} className="chip" title={`${n} × ${TYPE_LABEL[t] ?? t}`}><Icon name={TYPE_ICON[t] ?? 'dot'} />{TYPE_LABEL[t] ?? t} <b className="num">{n}</b></span>)}{types.length > 6 && <span className="chip">+{types.length - 6}</span>}</div>
  );

  return (
    <div className="space-y-4">
      <PageHead icon="ui-checks-grid" title="Forms" sub={`${plural(forms.length, 'form')} available offline · ${plural(vars.filter((v) => v.type !== 'note').length, 'question')} in the project`} />
      {forms.length > 3 && <div className="toolbar"><div className="field-ic min-w-[16rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search forms…" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></div></div>}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(26rem, 1fr))' }}>
        {shownForms.map((f) => {
          const info = formInfo(f, vars); const sp = recordSplit(recsOf(f.uuid), info.names);
          const acc = f.access ? ACCESS_INFO[f.access as Access] : null;
          const left = daysUntil(f.settings?.close_at); const lim = f.settings?.max_responses ?? null;
          const open = f.status === 'published' || f.status === 'active' || f.status === 'open';
          return (
            <div key={f.uuid} className="sg-cell"><section className="pcard fi-card anim-in" style={{ cursor: 'default' }}>
              <div className="flex items-start gap-3">
                <span className="pc-ic" style={{ background: 'var(--v-grad)' }}><Icon name={acc?.icon ?? 'ui-checks-grid'} /></span>
                <div className="min-w-0 flex-1"><h3 title={f.title}>{f.title}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`chip ${open ? 'chip-ok' : f.status === 'closed' ? 'chip-warn' : ''}`}><Icon name={open ? 'broadcast' : f.status === 'closed' ? 'lock' : 'pencil'} />{f.status}</span>
                    {acc && <span className="chip chip-brand" title={acc.text}><Icon name={acc.icon} />{acc.label}</span>}
                    {left !== null && <span className={`chip ${left < 0 ? 'chip-danger' : left <= 7 ? 'chip-warn' : ''}`} title={`Closes on ${day(f.settings?.close_at)}`}><Icon name="calendar-event" />{left < 0 ? 'Closed' : left === 0 ? 'Closes today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
                    {f.settings?.offline === false && <span className="chip chip-warn"><Icon name="wifi" />Online only</span>}
                    {f.settings?.allow_edit && <span className="chip"><Icon name="pencil-square" />Editable</span>}
                  </div></div>
              </div>
              {f.description && <div className="fi-desc"><Rich html={f.description} className="muted text-sm" fold={220} /></div>}
              <Stat4 items={[[info.questions, 'Questions', `${info.calculated} calculated question(s) are filled in automatically`], [info.required, 'Required', 'Must be answered to save as complete'], [info.sections, 'Sections'], [sp.total, 'Records']]} />
              <div><span className="label-cap">Questions by type</span><TypeChips types={info.types} /></div>
              <div className="fi-meta"><span title="Rough estimate from the question types"><Icon name="stopwatch" />≈ {info.minutes} min to fill</span>{info.pii > 0 && <span className="k-warn" title="Questions that hold personal data"><Icon name="shield-lock" />{info.pii} personal</span>}{info.calculated > 0 && <span><Icon name="calculator" />{info.calculated} calculated</span>}{info.notes > 0 && <span><Icon name="chat-left-text" />{info.notes} note{info.notes === 1 ? '' : 's'}</span>}</div>
              <div><div className="mb-1 flex items-center justify-between"><span className="label-cap" style={{ margin: 0 }}>Records on this computer</span>{sp.total > 0 && <span className="muted text-xs">{sp.week} in the last 7 days</span>}</div>
                {sp.total ? <SplitBar s={sp} /> : <p className="muted text-sm">No record yet. Fill in this form to add the first one.</p>}</div>
              {sp.total > 0 && <div className="k-teal"><div className="mb-1 flex justify-between text-sm"><span className="muted">Average answered</span><b className="num" style={{ color: 'var(--k)' }}>{sp.answeredPct === null ? '—' : `${sp.answeredPct}%`}</b></div><div className="bar"><i style={{ width: `${sp.answeredPct ?? 0}%` }} /></div></div>}
              {lim !== null && <div className={sp.total >= lim ? 'k-warn' : 'k-brand'}><div className="mb-1 flex justify-between text-sm"><span className="muted">Response limit</span><b className="num" style={{ color: 'var(--k)' }}>{sp.total} / {lim}</b></div><div className="bar"><i style={{ width: `${Math.min(100, (sp.total / Math.max(1, lim)) * 100)}%` }} /></div></div>}
              <div className="fi-meta muted">{f.updated_at && <span><Icon name="clock-history" />Form updated {day(f.updated_at)}</span>}{sp.last && <span><Icon name="pencil" />Last entry {ago(sp.last)}</span>}{sp.first && <span><Icon name="flag" />First entry {day(sp.first)}</span>}</div>
              <button className="btn btn-sm" onClick={() => setOpenForm(openForm === f.uuid ? null : f.uuid)} aria-expanded={openForm === f.uuid}><Icon name={openForm === f.uuid ? 'chevron-up' : 'list-nested'} />{openForm === f.uuid ? 'Hide structure' : 'Preview structure'}</button>
              {openForm === f.uuid && (
                <div className="well max-h-72 space-y-3 overflow-y-auto p-3 text-sm">
                  {(f.layout?.pages ?? []).map((pg, pi) => {
                    const groups = [...((pg.items ?? []).length ? [{ id: 'p', title: undefined as string | undefined, items: pg.items ?? [] }] : []), ...(pg.sections ?? []).map((x) => ({ id: x.id, title: x.title, items: x.items ?? [] }))];
                    return (
                      <div key={pg.id ?? pi}><b className="ink block">{pg.title || `Page ${pi + 1}`}</b>
                        {groups.map((g, gi) => (
                          <div key={g.id ?? gi}>{g.title && <div className="ink mt-1 pl-1 font-bold">{g.title}</div>}
                            {g.items.map((i, k) => { if (i.type !== 'variable') return i.text ? <div key={k} className="muted pl-3 text-xs italic">{i.text}</div> : null; const v = vars.find((x) => x.name === i.var); return v ? <div key={k} className="muted flex items-center gap-2 pl-3"><Icon name={TYPE_ICON[v.type] ?? 'dot'} /><span className="flex-1 truncate" title={v.name}>{v.label || v.name}</span>{v.required && <span style={{ color: 'var(--rh-danger)' }} title="Required">*</span>}{v.is_pii && <Icon name="shield-lock" />}</div> : null; })}</div>
                        ))}</div>
                    );
                  })}
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                {canAdd && <button className="btn btn-primary flex-1" onClick={() => openEditor({ project: project.uuid, record: null, form: f.uuid })}><Icon name="pencil-square" />Fill in this form</button>}
                <button className="btn" onClick={() => toData(f.uuid)} title="Show this form's records"><Icon name="table" />Data</button>
                {canShare && <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'sharing' })} title="Public link, QR code and who can submit"><Icon name="share" />Share</button>}
              </div>
            </section></div>
          );
        })}

        <div className="sg-cell"><section className="pcard fi-card anim-in" style={{ cursor: 'default' }}>
          <div className="flex items-start gap-3">
            <span className="pc-ic"><Icon name="list-ul" /></span>
            <div className="min-w-0 flex-1"><h3>All variables</h3><p className="muted mt-1 text-sm">Manual entry with every question of the project, in codebook order.</p>
              <div className="mt-1 flex flex-wrap gap-1.5"><span className="chip chip-teal"><Icon name="journal-text" />Codebook v{project.schema_version}</span></div></div>
          </div>
          <Stat4 items={[[all.questions, 'Questions'], [all.required, 'Required'], [all.calculated, 'Calculated'], [allSplit.total, 'Records']]} />
          <div><span className="label-cap">Questions by type</span><TypeChips types={all.types} /></div>
          <div className="fi-meta"><span><Icon name="stopwatch" />≈ {all.minutes} min to fill everything</span>{all.pii > 0 && <span className="k-warn"><Icon name="shield-lock" />{all.pii} personal</span>}</div>
          <div><span className="label-cap">Records entered manually</span>{allSplit.total ? <SplitBar s={allSplit} /> : <p className="muted text-sm">No manual record yet.</p>}</div>
          {allSplit.total > 0 && <div className="k-teal"><div className="mb-1 flex justify-between text-sm"><span className="muted">Average answered</span><b className="num" style={{ color: 'var(--k)' }}>{allSplit.answeredPct === null ? '—' : `${allSplit.answeredPct}%`}</b></div><div className="bar"><i style={{ width: `${allSplit.answeredPct ?? 0}%` }} /></div></div>}
          <div className="fi-meta muted">{allSplit.last && <span><Icon name="pencil" />Last entry {ago(allSplit.last)}</span>}<span><Icon name="info-circle" />Use it when no form fits, or to see every question.</span></div>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {canAdd && <button className="btn btn-primary flex-1" onClick={() => openEditor({ project: project.uuid, record: null, form: '__all' })}><Icon name="pencil-square" />Manual entry</button>}
            <button className="btn" onClick={() => toData('__none')}><Icon name="table" />Data</button>
            <button className="btn" onClick={() => go({ page: 'project', project: project.uuid, tab: 'variables' })}><Icon name="diagram-3" />Codebook</button>
          </div>
        </section></div>
      </div>
      {!canAdd && <div className="notice info"><Icon name="info-circle" /><span>{project.status !== 'active' ? 'This project is archived, so no new records can be added.' : 'Your role in this project cannot add records.'}</span></div>}
    </div>
  );
}

const STATE: Record<string, [string, string, string]> = {
  downloaded: ['Available offline', 'chip-ok', 'check2-circle'],
  uploaded: ['Uploaded', 'chip-ok', 'cloud-check'],
  pending_upload: ['Waiting to upload', 'chip-warn', 'cloud-upload'],
  remote: ['Downloads at next sync', '', 'cloud-arrow-down'],
  error: ['Error', 'chip-danger', 'exclamation-octagon'],
};

/** Attachments of the project: which are on this computer, which still have to go up or come down. */
export function FilesView({ project, vars }: ProjectCtx) {
  const { openEditor } = useUi();
  const { toast, sync, online } = useSession();
  const qc = useQueryClient();
  const files = useQuery({ queryKey: ['pfiles', project.uuid], queryFn: () => store.filesForProject(project.uuid) });
  const byName = new Map(vars.map((v) => [v.name, v]));
  const f = files.data ?? [];
  const errors = f.filter((x) => x.state === 'error').length;
  const retry = useMutation({
    mutationFn: store.retryFailedFiles,
    onSuccess: async () => { await qc.invalidateQueries(); toast('Failed files will be tried again.'); if (online) sync(); },
  });
  const open = async (path: string) => { try { await native.openLocal(path); } catch (e) { toast(String(e), 'error'); } };
  return (
    <div className="space-y-4">
      <PageHead icon="paperclip" tone="teal" title="Files" sub={`${plural(f.length, 'attachment')} · ${bytes(f.reduce((a, x) => a + (x.size || 0), 0))}`}>
        <button className="btn" onClick={() => native.revealLocal()}><Icon name="folder2-open" />Open workspace folder</button>
        {errors > 0 && <button className="btn btn-primary" onClick={() => retry.mutate()}><Icon name="arrow-clockwise" />Retry {errors} failed</button>}
      </PageHead>
      <div className="stats">
        <Stat icon="paperclip" value={f.length} label="Attachments" />
        <Stat icon="hdd" value={f.filter((x) => x.local_path).length} label="On this computer" tone="k-ok" />
        <Stat icon="cloud-upload" value={f.filter((x) => x.state === 'pending_upload').length} label="To upload" tone="k-warn" />
        <Stat icon="cloud-arrow-down" value={f.filter((x) => x.state === 'remote').length} label="To download" tone="k-muted" />
        {errors > 0 && <Stat icon="exclamation-octagon" value={errors} label="Errors" tone="k-danger" />}
      </div>
      <div className="tbl-wrap anim-in">
        <table className="tbl">
          <thead><tr><th>File</th><th>Question</th><th>Record</th><th className="numc">Size</th><th>State</th><th /></tr></thead>
          <tbody>
            {f.map((x) => {
              const st = STATE[x.state] ?? STATE.remote;
              return (
                <tr key={x.uuid}>
                  <td className="link" title={x.name}><Icon name="file-earmark" className="mr-2" />{x.name}</td>
                  <td>{x.variable ? byName.get(x.variable)?.label || x.variable : '—'}</td>
                  <td>{x.record ? <button className="idchip cursor-pointer" onClick={() => openEditor({ project: project.uuid, record: x.record, form: null })}>{x.record.slice(0, 8)}</button> : '—'}</td>
                  <td className="numc muted">{bytes(x.size)}</td>
                  <td><span className={`chip ${st[1]}`} title={x.error ?? ''}><Icon name={st[2]} />{st[0]}</span></td>
                  <td className="text-right">
                    {x.local_path && <span className="inline-flex gap-1">
                      <button className="btn btn-sm" onClick={() => open(x.local_path as string)}><Icon name="box-arrow-up-right" />Open</button>
                      <button className="btn btn-sm btn-icon" title="Show in folder" onClick={() => native.revealLocal(x.local_path as string)}><Icon name="folder2-open" /></button>
                    </span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {files.data && !f.length && <Empty icon="paperclip" title="No attachments"><span>Files attached to records appear here and are kept for offline use.</span></Empty>}
      </div>
    </div>
  );
}
