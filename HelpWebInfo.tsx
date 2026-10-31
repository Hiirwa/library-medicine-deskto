import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Empty, Icon } from './ui';
import { cacheHelpInfo, cachedHelpInfo, fetchHelpInfo, type HelpInfo } from '../lib/helpinfo';
import { plural } from '../lib/format';
import { ago } from '../lib/time';
import { useSession } from '../providers/AppProvider';

const tone = (s: string) => (/answer|repl|resolv|clos|done/i.test(s) ? 'chip-ok' : /open|new|pend|wait/i.test(s) ? 'chip-warn' : '');

/** Cards with information pulled from the website: support contacts, the person's support requests, and their account. */
export function HelpWebInfo() {
  const { online, server, toast } = useSession();
  const q = useQuery({ queryKey: ['helpinfo'], queryFn: fetchHelpInfo, enabled: online, staleTime: 30000 });
  const live: HelpInfo | null = q.data && q.data.ok ? q.data.data : null;
  useEffect(() => { if (live) cacheHelpInfo(live); }, [live]);
  const cached = useMemo(() => cachedHelpInfo(), [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = live ?? cached?.data ?? null;
  const base = server.replace(/\/$/, '');
  const open = (url: string) => openUrl(url).catch(() => toast('Could not open the website.', 'error'));
  const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); toast(`${what} copied.`); } catch { toast('Could not copy.', 'error'); } };

  if (online && q.isLoading && !info) return <section className="card p-5"><div className="skel" style={{ height: '1.2rem', width: '9rem' }} /><div className="skel mt-3" style={{ height: '6rem' }} /></section>;
  if (!info) {
    const bad = q.data && !q.data.ok ? q.data : null;
    return (
      <section className="card p-5 anim-in">
        <div className="mb-2 flex items-center gap-3"><span className="pk-ic"><Icon name="globe2" /></span><h3 className="text-lg">From the website</h3></div>
        <Empty icon={bad?.unsupported ? 'cloud-slash' : online ? 'exclamation-octagon' : 'wifi-off'} title={bad?.unsupported ? 'Needs a server update' : online ? 'Could not load' : 'You are offline'}>
          <span>{bad?.unsupported ? 'Update the server to see support contacts, your support requests and your account here.' : bad ? bad.error : 'Connect to see support contacts and your account.'}</span>
          <div className="mt-2 flex flex-wrap justify-center gap-2"><button className="btn btn-sm" onClick={() => open(`${base}/contact`)}><Icon name="envelope" />Contact page</button><button className="btn btn-sm" onClick={() => open(`${base}/docs`)}><Icon name="book" />Documentation</button></div>
        </Empty>
      </section>
    );
  }

  const s = info.support; const a = info.account; const c = info.conversations; const t = a.tokens;
  const stale = !live;
  const tokPct = t.max > 0 ? Math.min(100, (t.used / t.max) * 100) : 0;
  const rows: [string, string, string, (() => void)?, string?][] = [
    ...(s.email ? [['envelope', 'Email', s.email, () => copy(s.email, 'Email address'), 'Copy'] as [string, string, string, () => void, string]] : []),
    ...(s.phone ? [['telephone', 'Phone', s.phone, () => copy(s.phone, 'Phone number'), 'Copy'] as [string, string, string, () => void, string]] : []),
    ...(s.whatsapp ? [['whatsapp', 'WhatsApp', `+${s.whatsapp}`, () => open(`https://wa.me/${s.whatsapp}`), 'Chat'] as [string, string, string, () => void, string]] : []),
    ...(s.hours ? [['clock', 'Hours', s.hours] as [string, string, string]] : []),
    ...(s.address ? [['geo-alt', 'Address', s.address] as [string, string, string]] : []),
  ];

  return (
    <>
      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="headset" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">Support &amp; contact</h3><p className="muted text-sm">{stale ? `Offline · as of ${ago(cached!.at)}` : `From ${info.site.name}`}</p></div>
          <button className="btn btn-icon btn-sm" onClick={() => q.refetch()} disabled={!online || q.isFetching} aria-label="Refresh" title="Refresh"><Icon name="arrow-clockwise" className={q.isFetching ? 'spin' : ''} /></button></div>
        {s.intro && <p className="muted text-sm" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.intro}</p>}
        {rows.length > 0 ? <ul className="ew-hist">{rows.map(([ic, l, v, act, al]) => (
          <li key={l}><span className="ic-sm"><Icon name={ic} /></span><span className="min-w-0 flex-1"><small className="muted block">{l}</small><b className="ink block truncate text-sm selectable" title={v}>{v}</b></span>{act && <button className="btn btn-sm" onClick={act}>{al}</button>}</li>))}</ul>
          : <p className="muted text-sm">No contact details are published yet. Use the contact form on the website.</p>}
        {s.topics.length > 0 && <div><span className="label-cap">Write to us about</span><div className="flex flex-wrap gap-1.5">{s.topics.map((x) => <button key={x} className="chip-btn" onClick={() => open(`${info.site.contact}?topic=${encodeURIComponent(x)}`)}>{x}</button>)}</div></div>}
        <button className="btn btn-primary" onClick={() => open(info.site.contact)}><Icon name="envelope-paper" />Open the contact form</button>
      </section>

      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="chat-dots" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">Your support requests</h3><p className="muted text-sm">{c.total ? plural(c.total, 'conversation') : 'No conversation yet'}</p></div></div>
        {c.recent.length ? <ul className="ew-hist">{c.recent.map((r) => (
          <li key={r.ref}><span className="ic-sm"><Icon name="chat-left-text" /></span><span className="min-w-0 flex-1"><b className="ink block truncate text-sm">{r.topic || 'Request'}</b><small className="muted block truncate">#{r.ref} · {ago(r.created_at.replace(' ', 'T') + 'Z')}{r.last_author ? ` · last reply: ${r.last_author}` : ''}</small></span><span className={`chip ${tone(r.status)}`}>{r.status}</span></li>))}</ul>
          : <p className="muted text-sm">When you write to support, your conversations and the answers appear here.</p>}
        <div className="flex gap-2"><button className="btn btn-sm flex-1" onClick={() => open(info.site.contact)}><Icon name="box-arrow-up-right" />Open conversations</button><button className="btn btn-sm flex-1" onClick={() => open(info.site.contact)}><Icon name="plus-lg" />New request</button></div>
      </section>

      <section className="card ew-card anim-in">
        <div className="flex items-center gap-3"><span className="pk-ic"><Icon name="person-badge" /></span><div className="min-w-0 flex-1"><h3 className="truncate text-lg">{a.name}</h3><p className="muted truncate text-sm">{a.email}</p></div><span className="chip chip-brand"><Icon name="gem" />{a.plan.name}</span></div>
        <div className={t.max === 0 ? 'k-warn' : tokPct >= 100 ? 'k-warn' : 'k-brand'}>
          <div className="mb-1 flex justify-between text-sm"><span className="muted">API tokens</span><b className="num" style={{ color: 'var(--k)' }}>{t.max === 0 ? 'Not included' : t.max < 0 ? `${t.used} · unlimited` : `${t.used} / ${t.max}`}</b></div>
          {t.max > 0 && <div className="bar"><i style={{ width: `${tokPct}%` }} /></div>}
        </div>
        <ul className="ew-facts"><li><Icon name="kanban" />{plural(a.projects, 'project')}</li><li><Icon name="globe2" />{new URL(info.site.url).host}</li></ul>
        <div className="flex flex-wrap gap-2"><button className="btn btn-sm flex-1" onClick={() => open(info.site.account)}><Icon name="person-gear" />Manage account</button><button className="btn btn-sm flex-1" onClick={() => open(info.site.docs)}><Icon name="book" />Documentation</button>
          <button className="btn btn-sm btn-primary w-full" onClick={() => open(a.plan.upgrade_url)}><Icon name="rocket-takeoff" />Plans &amp; billing</button></div>
      </section>
    </>
  );
}
