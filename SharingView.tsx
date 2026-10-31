import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Empty, Icon, PageHead, PageSkeleton, Switch } from '../components/ui';
import { useAsk } from '../components/Confirm';
import { Qr, qrSvg } from '../components/Qr';
import { Ring } from '../components/charts';
import { WebLink } from '../components/WebLink';
import { saveFile } from '../lib/csv';
import { initials, plural } from '../lib/format';
import { ago, shortDate } from '../lib/time';
import { ACCESS_INFO, ROLES, ROLE_INFO, fetchSharing, inviteMembers, parseEmails, removeMember, resendInvitation, revokeInvitation, saveFormSharing, updateMember, validEmail,
  type Access, type FormSettings, type Invitation, type Member, type Overview, type Result, type RoleKey, type SharingForm } from '../lib/sharing';
import { webUrl } from '../lib/access';
import { useSession } from '../providers/AppProvider';
import type { ProjectCtx } from './ProjectView';

type Tab = 'forms' | 'team' | 'invites';
const STATUS_CHIP: Record<string, string> = { open: 'chip-ok', draft: '', closed: 'chip-warn' };

/** Who can respond and who is on the team: public links and QR codes, access and limits per form, members, roles and invitations. */
export function SharingView({ project }: ProjectCtx) {
  const { toast, online, server } = useSession();
  const qc = useQueryClient();
  const ask = useAsk();
  const q = useQuery({ queryKey: ['sharing', project.uuid], queryFn: () => fetchSharing(project.uuid), enabled: online, staleTime: 10000 });
  const [tab, setTab] = useState<Tab>('forms');
  const [editing, setEditing] = useState<SharingForm | null>(null);
  const [qrFor, setQrFor] = useState<SharingForm | null>(null);
  const [assigning, setAssigning] = useState<Member | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);

  const o: Overview | null = q.data && q.data.ok ? q.data.data : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['sharing', project.uuid] });

  /** Run a server action: show its message, explain plan limits, refresh the lists. */
  async function run<T extends { message?: string }>(key: string, fn: () => Promise<Result<T>>, after?: (d: T) => void): Promise<boolean> {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (r.ok) { toast(r.data.message ?? 'Saved.'); after?.(r.data); await refresh(); return true; }
    toast(r.error, 'error');
    if (r.upgrade && (await ask(r.error, { title: 'Your plan’s limit is reached', kind: 'info', okLabel: 'View plans', cancelLabel: 'Close', icon: 'gem' }))) openUrl(r.upgrade).catch(() => {});
    return false;
  }

  if (!online) return <Wrap project={project.uuid}><div className="card"><Empty icon="wifi-off" title="Sharing needs an internet connection"><span>Connect to manage who can respond and who is on the team. Everything else keeps working offline.</span></Empty></div></Wrap>;
  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return null;
  if (!q.data.ok) {
    const r = q.data;
    return (
      <Wrap project={project.uuid}>
        <div className="card">
          <Empty icon={r.unsupported ? 'cloud-slash' : 'exclamation-octagon'} title={r.unsupported ? 'The server needs an update first' : 'Could not load sharing'}>
            <span className="max-w-xl">{r.unsupported ? 'Sharing is managed on the website until your server is updated to the latest version of the API. Nothing is lost, you can open the same pages there.' : r.error}</span>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button className="btn btn-primary" onClick={() => openUrl(webUrl(server, project.uuid, 'sharing')).catch(() => {})}><Icon name="people" />Open the Team page</button>
              <button className="btn" onClick={() => openUrl(webUrl(server, project.uuid, 'forms')).catch(() => {})}><Icon name="ui-checks-grid" />Open Forms (Share &amp; settings)</button>
              <button className="btn" onClick={() => q.refetch()}><Icon name="arrow-clockwise" />Try again</button>
            </div>
          </Empty>
        </div>
      </Wrap>
    );
  }
  if (!o) return null;

  const canWrite = project.status === 'active';
  const myRole = o.role;
  const mayChange = (m: Member, to?: RoleKey) => canWrite && (myRole === 'owner' || (m.role !== 'owner' && m.role !== 'researcher' && to !== 'owner' && to !== 'researcher'));

  return (
    <Wrap project={project.uuid} onRefresh={() => q.refetch()} fetching={q.isFetching}>
      {!canWrite && <div className="notice warn"><Icon name="archive" /><span>This project is archived, so sharing and the team are read-only.</span></div>}

      <div className="stats">
        {ROLES.map((r) => {
          const l = o.limits[r]; const unlimited = l.max < 0; const full = !unlimited && l.used >= l.max;
          return (
            <div key={r} className={`stat ${full ? 'k-warn' : ''}`} title={`${ROLE_INFO[r].label}: ${l.used} of ${unlimited ? 'unlimited' : l.max} used (open invitations count)`}>
              <span className="ic"><Icon name={ROLE_INFO[r].icon} /></span>
              <span className="min-w-0 flex-1"><b>{l.used}<small style={{ display: 'inline', fontSize: '.85rem' }}> / {unlimited ? '∞' : l.max}</small></b><small>{ROLE_INFO[r].label}s</small>
                {!unlimited && <div className="bar mt-1"><i style={{ width: `${Math.min(100, (l.used / Math.max(1, l.max)) * 100)}%` }} /></div>}</span>
            </div>
          );
        })}
        <div className="stat k-teal" title="Your plan sets these limits"><span className="ic"><Icon name="gem" /></span><span className="min-w-0"><b style={{ fontSize: '1.05rem' }}>{o.plan.name}</b><small>Your plan</small></span></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="seg">
          <button className={tab === 'forms' ? 'on' : ''} onClick={() => setTab('forms')}><Icon name="link-45deg" />Forms &amp; links <span className="count soft">{o.forms.length}</span></button>
          <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}><Icon name="people" />Team <span className="count soft">{o.members.length}</span></button>
          <button className={tab === 'invites' ? 'on' : ''} onClick={() => setTab('invites')}><Icon name="envelope-paper" />Invitations <span className="count soft">{o.invitations.length}</span></button>
        </div>
      </div>

      {tab === 'forms' && (
        <StickyColumns className="sh-split">
          <FormsTab o={o} project={project.uuid} canWrite={canWrite} onEdit={setEditing} onQr={setQrFor} run={run} />
          <SharingAside o={o} canWrite={canWrite} setTab={setTab} onEdit={setEditing} />
        </StickyColumns>
      )}
      {tab === 'team' && <TeamTab o={o} project={project.uuid} canWrite={canWrite} mayChange={mayChange} busy={busy} run={run} onAssign={setAssigning} link={link} setLink={setLink} ask={ask} />}
      {tab === 'invites' && <InvitesTab o={o} project={project.uuid} canWrite={canWrite} busy={busy} run={run} link={link} setLink={setLink} ask={ask} />}

      {editing && <FormSettingsDialog form={editing} o={o} onClose={() => setEditing(null)} onSave={async (body) => { const ok = await run('form-' + editing.id, () => saveFormSharing(project.uuid, editing.id, body)); if (ok) setEditing(null); }} saving={busy === 'form-' + editing.id} />}
      {qrFor && qrFor.public_url && <QrDialog form={qrFor} onClose={() => setQrFor(null)} toast={toast} />}
      {assigning && <AssignDialog member={assigning} forms={o.forms} onClose={() => setAssigning(null)} saving={busy === 'assign'} onSave={async (forms) => { const ok = await run('assign', () => updateMember(project.uuid, assigning.id, { forms })); if (ok) setAssigning(null); }} />}
    </Wrap>
  );
}

function Wrap({ project, children, onRefresh, fetching }: { project: string; children: ReactNode; onRefresh?: () => void; fetching?: boolean }) {
  return (
    <div className="space-y-4">
      <PageHead icon="share" title="Sharing" sub="Who can respond to your forms, and who is on the team">
        {onRefresh && <button className="btn" onClick={onRefresh} disabled={fetching}><Icon name="arrow-clockwise" className={fetching ? 'spin' : ''} />Refresh</button>}
        <WebLink project={project} tab="sharing" />
      </PageHead>
      {children}
    </div>
  );
}

type Run = <T extends { message?: string }>(key: string, fn: () => Promise<Result<T>>, after?: (d: T) => void) => Promise<boolean>;

// ------------------------------------------------------------------ forms & links
function FormsTab({ o, project, canWrite, onEdit, onQr, run }: { o: Overview; project: string; canWrite: boolean; onEdit: (f: SharingForm) => void; onQr: (f: SharingForm) => void; run: Run }) {
  const { toast, server } = useSession();
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Link copied.'); } catch { toast('Could not copy.', 'error'); } };
  if (!o.forms.length) return <div className="card"><Empty icon="ui-checks-grid" title="No form yet"><span>Forms are designed on the website. Once a form exists you can share it here.</span></Empty></div>;
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(25rem, 1fr))' }}>
      {o.forms.map((f) => {
        const a = ACCESS_INFO[f.access] ?? ACCESS_INFO.assigned;
        return (
          <section key={f.id} className="card sh-card anim-in">
            <div className="flex items-start gap-3">
              <span className="pk-ic"><Icon name={a.icon} /></span>
              <div className="min-w-0 flex-1"><h3 className="truncate text-lg" title={f.title}>{f.title}</h3>
                <div className="mt-1 flex flex-wrap gap-1.5"><span className={`chip ${STATUS_CHIP[f.status] ?? ''}`}><Icon name={f.status === 'open' ? 'broadcast' : f.status === 'closed' ? 'lock' : 'pencil'} />{f.status.charAt(0).toUpperCase() + f.status.slice(1)}</span><span className="chip chip-brand"><Icon name={a.icon} />{a.label}</span></div></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="well px-3 py-2"><b className="num block text-lg ink">{f.responses}</b><span className="muted text-xs font-bold uppercase">Responses</span></div>
              <div className="well px-3 py-2"><b className="block text-sm ink">{f.last_response ? ago(f.last_response) : '—'}</b><span className="muted text-xs font-bold uppercase">Last one</span></div>
              <div className="well px-3 py-2"><b className="num block text-lg ink">{f.settings.max_responses ? `${f.responses}/${f.settings.max_responses}` : f.access === 'assigned' ? f.assigned : '∞'}</b><span className="muted text-xs font-bold uppercase">{f.settings.max_responses ? 'Limit' : f.access === 'assigned' ? 'Assigned' : 'No limit'}</span></div>
            </div>
            {f.access === 'public' && f.public_url ? (
              <div className="well sh-link">
                <div className="flex items-center gap-2"><Icon name="link-45deg" /><input className="field" readOnly value={f.public_url} aria-label="Public link" onFocus={(e) => e.currentTarget.select()} /></div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-sm btn-primary" onClick={() => copy(f.public_url as string)}><Icon name="clipboard" />Copy link</button>
                  <button className="btn btn-sm" onClick={() => onQr(f)}><Icon name="qr-code" />QR code</button>
                  <button className="btn btn-sm" onClick={() => openUrl(f.public_url as string).catch(() => {})}><Icon name="box-arrow-up-right" />Open</button>
                  <button className="btn btn-sm" onClick={() => openUrl(`https://wa.me/?text=${encodeURIComponent(`${f.title} ${f.public_url}`)}`).catch(() => {})}><Icon name="whatsapp" />WhatsApp</button>
                </div>
              </div>
            ) : (
              <div className="well text-sm"><Icon name="info-circle" className="mr-1" />{f.access === 'authenticated' ? 'Every signed-in project member who can submit can respond.' : 'Owners, researchers and the collectors you assign can respond.'}
                {o.features.public_form ? <button className="link-btn blue ml-2" disabled={!canWrite} onClick={() => onEdit({ ...f, access: 'public' })}><Icon name="globe2" />Create a public link</button> : <span className="chip chip-warn ml-2"><Icon name="gem" />Public links: {o.plan.key === 'free' ? 'Pro' : 'upgrade'}</span>}</div>
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <div className="seg" role="group" aria-label="Status">{(['open', 'closed'] as const).map((s) => <button key={s} disabled={!canWrite} className={f.status === s ? 'on' : ''} onClick={() => f.status !== s && run('st-' + f.id, () => saveFormSharing(project, f.id, { status: s }))}><Icon name={s === 'open' ? 'broadcast' : 'lock'} />{s === 'open' ? 'Open' : 'Closed'}</button>)}</div>
              <span className="flex-1" />
              <button className="btn btn-sm" onClick={() => openUrl(`${server.replace(/\/$/, '')}/p/${project}/forms/${f.id}/edit?share=1`).catch(() => {})} title="Open the form builder on the website"><Icon name="globe2" /></button>
              <button className="btn btn-primary btn-sm" disabled={!canWrite} onClick={() => onEdit(f)}><Icon name="sliders" />Share &amp; settings</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ side cards: overview, plan, team
function SharingAside({ o, canWrite, setTab, onEdit }: { o: Overview; canWrite: boolean; setTab: (t: Tab) => void; onEdit: (f: SharingForm) => void }) {
  const { toast } = useSession();
  const others = o.members.filter((m) => !m.is_me);
  const open = o.forms.filter((f) => f.status === 'open');
  const pub = o.forms.filter((f) => f.access === 'public' && f.public_url);
  const assignedForms = o.forms.filter((f) => f.access === 'assigned');
  const collectors = o.members.filter((m) => m.role === 'collector');
  const withClose = o.forms.filter((f) => f.settings.close_at);
  const soon = o.invitations.filter((i) => new Date(i.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now() < 2 * 86400000).length;
  const firstDraftOrPrivate = o.forms.find((f) => f.access !== 'public') ?? o.forms[0];

  type Row = { ok: boolean; locked?: boolean; icon: string; title: string; sub: string; act?: [string, () => void] };
  const rows: Row[] = [
    { ok: open.length > 0, icon: 'broadcast', title: `${open.length} of ${plural(o.forms.length, 'form')} open`, sub: open.length ? 'People can submit responses now.' : 'Open a form so people can respond.' },
    o.features.public_form
      ? { ok: pub.length > 0, icon: 'globe2', title: pub.length ? `${plural(pub.length, 'public link')} active` : 'No public link yet', sub: pub.length ? 'Share the link or QR code.' : 'Let anyone respond without an account.', act: !pub.length && firstDraftOrPrivate && canWrite ? ['Create', () => onEdit({ ...firstDraftOrPrivate, access: 'public' })] : undefined }
      : { ok: false, locked: true, icon: 'globe2', title: 'Public links', sub: `Not included in the ${o.plan.name}.` },
    { ok: others.length > 0, icon: 'people', title: others.length ? `${plural(others.length, 'colleague')} on the team` : 'You are the only member', sub: others.length ? 'Roles decide who sees and changes what.' : 'Invite colleagues to collect or review data.', act: !others.length && canWrite ? ['Invite', () => setTab('team')] : undefined },
    { ok: assignedForms.length === 0 || collectors.some((c) => c.forms.length > 0), icon: 'person-check', title: assignedForms.length ? (collectors.some((c) => c.forms.length > 0) ? 'Collectors have forms assigned' : 'No collector can fill “assigned” forms') : 'No assigned-only forms', sub: assignedForms.length ? 'Assign forms to your data collectors.' : 'Every form is open to more people.', act: assignedForms.length && !collectors.some((c) => c.forms.length > 0) && canWrite ? ['Assign', () => setTab('team')] : undefined },
    o.features.auto_close
      ? { ok: withClose.length > 0, icon: 'calendar-event', title: withClose.length ? `${plural(withClose.length, 'form')} close automatically` : 'No closing date set', sub: 'A closing date stops late responses by itself.' }
      : { ok: false, locked: true, icon: 'calendar-event', title: 'Automatic closing date', sub: `Not included in the ${o.plan.name}.` },
    { ok: o.invitations.length === 0 || soon === 0, icon: 'envelope-paper', title: o.invitations.length ? `${plural(o.invitations.length, 'pending invitation')}${soon ? ` · ${soon} expiring soon` : ''}` : 'No pending invitation', sub: o.invitations.length ? 'Resend or withdraw them in Invitations.' : 'Everyone you invited has answered.', act: o.invitations.length ? ['View', () => setTab('invites')] : undefined },
  ];
  const scored = rows.filter((r) => !r.locked); const done = scored.filter((r) => r.ok).length;

  const feats: [boolean, string, string][] = [
    [o.features.public_form, 'globe2', 'Public form links and QR codes'], [o.features.auto_close, 'calendar-event', 'Closing date'], [o.features.offline, 'wifi-off', 'Offline forms'],
    [o.features.submit_again, 'arrow-repeat', '“Submit another response”'], [o.features.edit_response, 'pencil-square', 'Respondents can edit their answers'],
  ];
  const full = feats.every((f) => f[0]);
  const top = [...o.members].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role)).slice(0, 5);

  return (
    <aside className="sh-aside">
      <section className="card p-5 anim-in">
        <div className="flex items-center gap-3"><Ring value={(done / Math.max(1, scored.length)) * 100} label="" size={78} tone="var(--rh-teal)" /><div className="min-w-0 flex-1"><h3 className="text-lg">Sharing at a glance</h3><p className="muted text-sm">{done} of {scored.length} things set up</p></div></div>
        <ul className="sa-list">{rows.map((r) => (
          <li key={r.title} className={r.locked ? 'locked' : r.ok ? 'ok' : ''}>
            <span className="sa-ic"><Icon name={r.locked ? 'lock-fill' : r.ok ? 'check-lg' : r.icon} /></span>
            <span className="min-w-0 flex-1"><b className="ink block text-sm">{r.title}</b><small className="muted">{r.sub}</small></span>
            {r.act && <button className="btn btn-sm" onClick={r.act[1]}>{r.act[0]}</button>}
          </li>))}</ul>
      </section>

      <section className="card p-5 anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="gem" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">{o.plan.name}</h3><p className="muted text-sm">{full ? 'Everything for sharing is included.' : 'What your plan includes'}</p></div></div>
        <ul className="sa-feats">{feats.map(([ok, ic, t]) => <li key={t} className={ok ? '' : 'off'}><Icon name={ok ? 'check-circle-fill' : 'x-circle-fill'} className={ok ? 'text-[var(--rh-success)]' : 'text-[var(--rh-muted)]'} /><Icon name={ic} /><span>{t}</span></li>)}</ul>
        <div className="sa-caps">
          {o.caps.max_responses_max !== null && <span className="chip"><Icon name="database" />Up to {o.caps.max_responses_max.toLocaleString()} records</span>}
          {o.caps.close_max && <span className="chip"><Icon name="calendar-range" />Closes by {o.caps.close_max}</span>}
        </div>
        {!full && <button className="btn btn-primary w-full mt-3" onClick={() => openUrl(o.plan.upgrade_url).catch(() => toast('Could not open the website.', 'error'))}><Icon name="rocket-takeoff" />See plans &amp; upgrade</button>}
      </section>

      <section className="card p-5 anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="people" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">Team</h3><p className="muted text-sm">{plural(o.members.length, 'member')}{o.invitations.length ? ` · ${plural(o.invitations.length, 'invitation')} pending` : ''}</p></div></div>
        <ul className="sa-team">{top.map((m) => <li key={m.id}><span className="avatar">{initials(m.name || m.email)}</span><span className="min-w-0 flex-1"><b className="ink block truncate text-sm">{m.name}{m.is_me && <span className="muted font-medium"> (you)</span>}</b><small className="muted block truncate">{m.last_login_at ? `Active ${ago(m.last_login_at)}` : 'Not signed in yet'}</small></span><span className="chip chip-brand"><Icon name={ROLE_INFO[m.role].icon} />{ROLE_INFO[m.role].label}</span></li>)}</ul>
        {o.members.length > top.length && <p className="muted mt-1 text-sm">+{o.members.length - top.length} more</p>}
        <div className="mt-3 flex gap-2"><button className="btn btn-sm flex-1" onClick={() => setTab('team')}><Icon name="people" />Manage team</button>{canWrite && <button className="btn btn-sm btn-primary flex-1" onClick={() => setTab('team')}><Icon name="person-plus" />Invite</button>}</div>
      </section>
    </aside>
  );
}

// ------------------------------------------------------------------ team
function InviteCard({ o, project, canWrite, run, setLink }: { o: Overview; project: string; canWrite: boolean; run: Run; setLink: (l: { email: string; link: string } | null) => void }) {
  const [emails, setEmails] = useState('');
  const roles = (['researcher', 'collector', 'viewer'] as const).filter((r) => r !== 'researcher' || o.can.manage_privileged);
  const [role, setRole] = useState<RoleKey>('collector');
  const [forms, setForms] = useState<string[]>([]);
  const list = parseEmails(emails); const bad = list.filter((e) => !validEmail(e));
  const l = o.limits[role]; const left = l.max < 0 ? Infinity : Math.max(0, l.max - l.used);
  const send = async () => {
    const ok = await run('invite', () => inviteMembers(project, { emails: list.join(' '), role, forms: role === 'collector' ? forms : [] }), (d) => setLink(d.invite_link));
    if (ok) { setEmails(''); setForms([]); }
  };
  return (
    <section className="card p-5 anim-in">
      <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="person-plus" /></span><div><h3 className="text-lg">Invite people</h3><p className="muted text-sm">They get an email with a link that is valid for 14 days.</p></div></div>
      <div className="mt-4 grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
        <div>
          <label className="label" htmlFor="inv-emails">Email addresses</label>
          <textarea id="inv-emails" className="field" rows={3} placeholder="name@example.org, other@example.org" value={emails} onChange={(e) => setEmails(e.target.value)} disabled={!canWrite} />
          <div className="mt-2 flex flex-wrap gap-1.5">{list.slice(0, 12).map((e) => <span key={e} className={`chip ${validEmail(e) ? 'chip-ok' : 'chip-danger'}`}><Icon name={validEmail(e) ? 'check2' : 'x'} />{e}</span>)}{list.length > 12 && <span className="chip">+{list.length - 12}</span>}</div>
        </div>
        <div className="space-y-3">
          <div><span className="label-cap">Role</span>
            <div className="space-y-1.5">{roles.map((r) => <button key={r} type="button" className={`pick ${role === r ? 'on' : ''}`} onClick={() => setRole(r)} aria-pressed={role === r}><span className="pk-ic"><Icon name={ROLE_INFO[r].icon} /></span><span className="min-w-0 text-left"><b className="ink block">{ROLE_INFO[r].label}</b><small className="muted">{ROLE_INFO[r].text}</small></span></button>)}</div></div>
        </div>
      </div>
      {role === 'collector' && o.forms.length > 0 && (
        <div className="mt-3"><span className="label-cap">Forms this collector can fill <span className="muted normal-case tracking-normal">(only used when a form is “Assigned collectors”)</span></span>
          <div className="flex flex-wrap gap-2">{o.forms.map((f) => <button key={f.id} type="button" className={`chip-btn ${forms.includes(f.id) ? 'on' : ''}`} onClick={() => setForms(forms.includes(f.id) ? forms.filter((x) => x !== f.id) : [...forms, f.id])} aria-pressed={forms.includes(f.id)}>{f.title}</button>)}</div></div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary btn-lg" disabled={!canWrite || !list.length || bad.length > 0 || list.length > left} onClick={send}><Icon name="send" />Send {list.length > 1 ? `${list.length} invitations` : 'invitation'}</button>
        <span className="help">{bad.length ? 'Fix the addresses marked in red.' : left === Infinity ? `${ROLE_INFO[role].label}s: no limit on your plan.` : list.length > left ? `Your plan allows ${left} more ${ROLE_INFO[role].label.toLowerCase()}(s) here (open invitations count).` : `${left} more ${ROLE_INFO[role].label.toLowerCase()}(s) allowed on the ${o.plan.name}.`}</span>
      </div>
    </section>
  );
}

function LinkNotice({ link, onClose }: { link: { email: string; link: string }; onClose: () => void }) {
  const { toast } = useSession();
  return (
    <div className="notice ok"><Icon name="link-45deg" /><span className="min-w-0 flex-1"><b>Invitation for {link.email}.</b> You can also send this link yourself:<br /><span className="selectable break-all text-sm">{link.link}</span></span>
      <button className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(link.link); toast('Invitation link copied.'); } catch { toast('Could not copy.', 'error'); } }}><Icon name="clipboard" />Copy</button>
      <button className="btn btn-sm btn-icon" onClick={onClose} aria-label="Dismiss"><Icon name="x-lg" /></button></div>
  );
}

function TeamTab({ o, project, canWrite, mayChange, busy, run, onAssign, link, setLink, ask }: { o: Overview; project: string; canWrite: boolean; mayChange: (m: Member, to?: RoleKey) => boolean; busy: string | null; run: Run; onAssign: (m: Member) => void; link: { email: string; link: string } | null; setLink: (l: { email: string; link: string } | null) => void; ask: ReturnType<typeof useAsk> }) {
  const formTitle = useMemo(() => new Map(o.forms.map((f) => [f.id, f.title])), [o.forms]);
  async function changeRole(m: Member, to: RoleKey) {
    if (to === m.role) return;
    const down = ROLES.indexOf(to) > ROLES.indexOf(m.role);
    if (down && !(await ask(`${m.name} will become ${ROLE_INFO[to].label.toLowerCase()} and lose the permissions of a ${ROLE_INFO[m.role].label.toLowerCase()}.`, { title: `Change role of ${m.name}?`, kind: 'warning', okLabel: 'Change role', icon: 'person-gear' }))) return;
    await run('role-' + m.id, () => updateMember(project, m.id, { role: to }));
  }
  async function remove(m: Member) {
    if (!(await ask(`${m.name} (${m.email}) will lose access to this project. Their records stay in the project.`, { title: 'Remove from the team?', kind: 'warning', okLabel: 'Remove', icon: 'person-x' }))) return;
    await run('rm-' + m.id, () => removeMember(project, m.id));
  }
  return (
    <div className="space-y-4">
      {link && <LinkNotice link={link} onClose={() => setLink(null)} />}
      {canWrite && <InviteCard o={o} project={project} canWrite={canWrite} run={run} setLink={setLink} />}
      <div className="tbl-wrap anim-in">
        <table className="tbl">
          <thead><tr><th>Person</th><th>Role</th><th>Forms</th><th className="numc">Records</th><th>Last sign-in</th><th style={{ width: '3rem' }} /></tr></thead>
          <tbody>
            {o.members.map((m) => (
              <tr key={m.id}>
                <td><span className="flex items-center gap-3"><span className="avatar">{initials(m.name || m.email)}</span><span className="min-w-0"><b className="ink block truncate">{m.name}{m.is_me && <span className="chip chip-teal ml-2">You</span>}</b><small className="muted block truncate">{m.email}{m.institution ? ` · ${m.institution}` : ''}</small></span></span></td>
                <td style={{ minWidth: '12rem' }}>
                  <select className="field" value={m.role} disabled={!mayChange(m) || busy === 'role-' + m.id} onChange={(e) => changeRole(m, e.target.value as RoleKey)} aria-label={`Role of ${m.name}`}>
                    {ROLES.filter((r) => r === m.role || mayChange(m, r)).map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
                  </select>
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  {m.role === 'collector' ? (
                    <span className="flex flex-wrap items-center gap-1.5">{m.forms.length ? m.forms.slice(0, 2).map((f) => <span key={f} className="chip">{formTitle.get(f) ?? 'Form'}</span>) : <span className="muted text-sm">None assigned</span>}{m.forms.length > 2 && <span className="chip">+{m.forms.length - 2}</span>}
                      {canWrite && <button className="btn btn-sm btn-icon" onClick={() => onAssign(m)} title="Choose forms" aria-label={`Choose forms for ${m.name}`}><Icon name="pencil" /></button>}</span>
                  ) : <span className="muted text-sm">{m.role === 'viewer' ? 'Read-only' : 'All forms'}</span>}
                </td>
                <td className="numc">{m.records ? m.records.toLocaleString() : <span className="muted">—</span>}</td>
                <td className="muted" title={m.last_login_at ? shortDate(m.last_login_at) : ''}>{m.last_login_at ? ago(m.last_login_at) : 'Never'}</td>
                <td>{mayChange(m) && !m.is_me && m.role !== 'owner' && <button className="btn btn-sm btn-icon btn-danger" disabled={busy === 'rm-' + m.id} onClick={() => remove(m)} title="Remove" aria-label={`Remove ${m.name}`}><Icon name="person-x" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!o.members.length && <Empty icon="people" title="No member yet" />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ invitations
function InvitesTab({ o, project, canWrite, busy, run, link, setLink, ask }: { o: Overview; project: string; canWrite: boolean; busy: string | null; run: Run; link: { email: string; link: string } | null; setLink: (l: { email: string; link: string } | null) => void; ask: ReturnType<typeof useAsk> }) {
  const days = (i: Invitation) => Math.max(0, Math.ceil((new Date(i.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 86400000));
  return (
    <div className="space-y-4">
      {link && <LinkNotice link={link} onClose={() => setLink(null)} />}
      {o.invitations.length ? (
        <div className="tbl-wrap anim-in">
          <table className="tbl">
            <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th>Invited by</th><th style={{ width: '14rem' }} /></tr></thead>
            <tbody>{o.invitations.map((i) => (
              <tr key={i.id}>
                <td className="link">{i.email}</td>
                <td><span className="chip chip-brand"><Icon name={ROLE_INFO[i.role]?.icon ?? 'person'} />{ROLE_INFO[i.role]?.label ?? i.role}</span></td>
                <td><span className={`chip ${days(i) <= 2 ? 'chip-warn' : ''}`}><Icon name="hourglass-split" />{days(i)} day{days(i) === 1 ? '' : 's'}</span></td>
                <td className="muted">{i.invited_by ?? '—'} · {ago(i.created_at.replace(' ', 'T') + 'Z')}</td>
                <td className="text-right">{canWrite && <span className="inline-flex gap-1.5">
                  <button className="btn btn-sm" disabled={busy === 'rs-' + i.id} onClick={() => run('rs-' + i.id, () => resendInvitation(project, i.id), (d) => setLink(d.invite_link))}><Icon name="arrow-repeat" className={busy === 'rs-' + i.id ? 'spin' : ''} />Resend</button>
                  <button className="btn btn-sm btn-danger" disabled={busy === 'rv-' + i.id} onClick={async () => { if (await ask(`The link sent to ${i.email} stops working.`, { title: 'Withdraw this invitation?', kind: 'warning', okLabel: 'Withdraw', icon: 'envelope-x' })) run('rv-' + i.id, () => revokeInvitation(project, i.id)); }}><Icon name="x-lg" />Withdraw</button></span>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : <div className="card"><Empty icon="envelope-paper" title="No pending invitation"><span>People you invite appear here until they accept. {plural(o.members.length, 'member')} on the team now.</span></Empty></div>}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs
function Lock({ o, what }: { o: Overview; what: string }) {
  return <span className="chip chip-warn" title={`${what} is not included in the ${o.plan.name}`}><Icon name="gem" />{o.plan.key === 'free' ? 'Pro' : 'Upgrade'}</span>;
}

function FormSettingsDialog({ form, o, onClose, onSave, saving }: { form: SharingForm; o: Overview; onClose: () => void; onSave: (b: { access?: Access; status?: string; settings?: Partial<FormSettings> }) => void; saving: boolean }) {
  const [access, setAccess] = useState<Access>(form.access);
  const [status, setStatus] = useState(form.status);
  const [s, setS] = useState<FormSettings>(form.settings);
  const set = <K extends keyof FormSettings>(k: K, v: FormSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const f = o.features;
  const today = new Date().toISOString().slice(0, 10);

  const body = useMemo(() => {
    const settings: Partial<FormSettings> = {};
    (Object.keys(s) as (keyof FormSettings)[]).forEach((k) => { if (s[k] !== form.settings[k]) (settings as Record<string, unknown>)[k] = s[k]; });
    return { ...(access !== form.access ? { access } : {}), ...(status !== form.status ? { status } : {}), ...(Object.keys(settings).length ? { settings } : {}) };
  }, [s, access, status, form]);
  const dirty = Object.keys(body).length > 0;
  const closeBad = !!s.close_at && !!o.caps.close_max && s.close_at > o.caps.close_max;
  const maxBad = !!s.max_responses && !!o.caps.max_responses_max && s.max_responses > o.caps.max_responses_max;

  const sw = (id: keyof FormSettings, icon: string, title: string, text: string, allowed: boolean) => (
    <div className={`su-row ${allowed ? '' : 'locked'}`}><span className="ic-sm"><Icon name={icon} /></span><div className="s-txt"><b>{title} {!allowed && <Lock o={o} what={title} />}</b><span>{text}</span></div>
      <Switch on={allowed && !!s[id]} onChange={(v) => allowed && set(id, v as never)} label={title} /></div>
  );

  return createPortal(
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog sharedlg" role="dialog" aria-modal="true" aria-labelledby="sd-t">
        <div className="sd-head"><span className="pk-ic"><Icon name="share" /></span><div className="min-w-0 flex-1"><h2 id="sd-t" className="truncate text-xl">Share &amp; settings</h2><p className="muted truncate text-sm">{form.title}</p></div><button className="btn btn-icon" onClick={onClose} aria-label="Close"><Icon name="x-lg" /></button></div>
        <div className="sd-body">
          <span className="label-cap">Who can submit?</span>
          <div className="space-y-2">{(['assigned', 'authenticated', 'public'] as Access[]).map((k) => {
            const locked = k === 'public' && !f.public_form && form.access !== 'public';
            return <button key={k} type="button" disabled={locked} className={`pick ${access === k ? 'on' : ''}`} onClick={() => setAccess(k)} aria-pressed={access === k}><span className="pk-ic"><Icon name={ACCESS_INFO[k].icon} /></span><span className="min-w-0 flex-1 text-left"><b className="ink block">{ACCESS_INFO[k].label} {locked && <Lock o={o} what="Public links" />}</b><small className="muted">{ACCESS_INFO[k].text}</small></span>{access === k && <Icon name="check-circle-fill" className="text-[var(--rh-brand)]" />}</button>;
          })}</div>

          <span className="label-cap mt-5">Status</span>
          <div className="seg w-full">{([['draft', 'Draft', 'pencil'], ['open', 'Open', 'broadcast'], ['closed', 'Closed', 'lock']] as const).map(([k, t, ic]) => <button key={k} className={`flex-1 ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}><Icon name={ic} />{t}</button>)}</div>

          <span className="label-cap mt-5">Responses</span>
          <div className="grid grid-cols-2 gap-3">
            <div className={f.auto_close ? '' : 'locked'}><label className="label" htmlFor="sd-close">Close automatically on {!f.auto_close && <Lock o={o} what="A closing date" />}</label>
              <input id="sd-close" type="date" className="field" value={s.close_at ?? ''} min={today} max={o.caps.close_max ?? undefined} disabled={!f.auto_close} onChange={(e) => set('close_at', e.target.value || null)} />
              <p className="help mt-1" style={closeBad ? { color: 'var(--rh-danger)' } : undefined}>{o.caps.close_max ? `Latest: ${o.caps.close_max}` : 'No closing date'}</p></div>
            <div><label className="label" htmlFor="sd-max">Maximum responses</label>
              <input id="sd-max" type="number" min={1} className="field" placeholder={o.caps.max_responses_max ? `up to ${o.caps.max_responses_max}` : 'No limit'} value={s.max_responses ?? ''} onChange={(e) => set('max_responses', e.target.value ? Number(e.target.value) : null)} />
              <p className="help mt-1" style={maxBad ? { color: 'var(--rh-danger)' } : undefined}>{o.caps.max_responses_max ? `Your plan: ${o.caps.max_responses_max} records per project` : 'Unlimited on your plan'}</p></div>
          </div>

          <div className="mt-3 space-y-2">
            {sw('show_progress', 'bar-chart-steps', 'Show progress bar', 'People see how far through the form they are.', true)}
            {sw('allow_multiple', 'arrow-repeat', 'Offer “Submit another response”', 'Useful when one person enters several records in a row.', f.submit_again)}
            {sw('offline', 'wifi-off', 'Works offline', 'Responses are saved on the device and sent when it is back online.', f.offline)}
            {sw('allow_edit', 'pencil-square', 'Let people edit their response', 'After sending, people get a private link to change their answers (public link only).', f.edit_response)}
            {f.edit_response && s.allow_edit && <div className="su-row"><span className="ic-sm"><Icon name="hourglass-split" /></span><div className="s-txt"><b>How long they can edit</b></div>
              <select className="field w-40" value={s.edit_days} onChange={(e) => set('edit_days', Number(e.target.value))} aria-label="Edit window"><option value={0}>Till closed</option><option value={1}>24 hours</option><option value={7}>7 days</option><option value={30}>30 days</option></select></div>}
          </div>

          <label className="label mt-5" htmlFor="sd-msg">Message after submission</label>
          <textarea id="sd-msg" className="field" rows={3} placeholder="Thank you! Your response has been recorded." value={s.submit_message} onChange={(e) => set('submit_message', e.target.value)} />
          <p className="help mt-1">Plain text here. Formatting can be added on the website.</p>
        </div>
        <div className="cf-actions sd-foot">
          <span className="help flex-1">{dirty ? 'You have unsaved changes.' : 'No changes yet.'}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-lg" disabled={!dirty || saving || closeBad || maxBad} onClick={() => onSave(body)}>{saving ? <><Icon name="arrow-repeat" className="spin" />Saving…</> : <><Icon name="check2-circle" />Save changes</>}</button>
        </div>
      </div>
    </div>
    , document.body);
}

function QrDialog({ form, onClose, toast }: { form: SharingForm; onClose: () => void; toast: (m: string, k?: 'ok' | 'error') => void }) {
  const url = form.public_url as string;
  const saveSvg = async () => { try { const p = await saveFile(`${form.title} - QR code`, 'svg', qrSvg(url, 12), 'SVG image'); if (p) toast(`QR code saved to ${p}`); } catch (e) { toast(`Could not save: ${String(e)}`, 'error'); } };
  return createPortal(
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog confirm" role="dialog" aria-modal="true" aria-labelledby="qr-t" style={{ textAlign: 'center' }}>
        <h2 id="qr-t" className="text-xl">{form.title}</h2>
        <p className="muted text-sm">Scan with a phone camera to open the form.</p>
        <div className="qr-wrap"><Qr text={url} size={260} /></div>
        <p className="selectable break-all text-sm muted">{url}</p>
        <div className="cf-actions" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast('Could not copy.', 'error'); } }}><Icon name="clipboard" />Copy link</button>
          <button className="btn" onClick={saveSvg}><Icon name="download" />Save QR (.svg)</button>
          <button className="btn btn-primary" onClick={onClose} autoFocus>Done</button>
        </div>
      </div>
    </div>
    , document.body);
}

function AssignDialog({ member, forms, onClose, onSave, saving }: { member: Member; forms: SharingForm[]; onClose: () => void; onSave: (f: string[]) => void; saving: boolean }) {
  const [sel, setSel] = useState<string[]>(member.forms);
  const changed = sel.slice().sort().join() !== member.forms.slice().sort().join();
  return createPortal(
    <div className="overlay" style={{ zIndex: 70 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog confirm" role="dialog" aria-modal="true" aria-labelledby="as-t">
        <div className="cf-head"><span className="cf-ic info"><Icon name="clipboard2-check" /></span><div className="min-w-0"><h2 id="as-t">Forms for {member.name}</h2><div className="cf-msg">Choose the forms this data collector can fill. It applies to forms set to “Assigned collectors”.</div></div></div>
        <div className="space-y-2">{forms.map((f) => (
          <label key={f.id} className="cf-check"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={sel.includes(f.id)} onChange={(e) => setSel(e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} />
            <span><b className="ink block">{f.title}</b><small className="muted">{ACCESS_INFO[f.access]?.label ?? f.access}{f.access !== 'assigned' ? ' — assignment has no effect while the form is open to more people' : ''}</small></span></label>
        ))}</div>
        <div className="cf-actions"><button className="btn" onClick={() => setSel(forms.map((f) => f.id))}>All</button><button className="btn" onClick={() => setSel([])}>None</button><span className="flex-1" /><button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!changed || saving} onClick={() => onSave(sel)}>{saving ? 'Saving…' : 'Save'}</button></div>
      </div>
    </div>
    , document.body);
}
