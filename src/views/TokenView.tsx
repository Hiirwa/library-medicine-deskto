import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
import { api, apiError, native } from '../lib/native';
import * as store from '../lib/db';
import { useSession } from '../providers/AppProvider';
import type { Me } from '../lib/types';
import { apiTokenAccess, isPlanRefusal } from '../lib/plans';
import { PlansView } from './PlansView';
import { AccountCard, Burst, Journey, NextCard, SegProgress, STEP_COLORS, WebMock } from '../components/ConnectParts';

const STEPS: { icon: string; title: string; text: string; tips: string[] }[] = [
  { icon: 'person-circle', title: 'Open your account', text: 'On the website, click your name at the bottom of the menu, then Account & security.', tips: ['Use the button on the right to open the page directly.', 'Sign in to the website with the same account you just used here.'] },
  { icon: 'key', title: 'Create a token', text: 'In the API tokens section, click Create token and name it “Desktop app” so you recognise it later.', tips: ['One token per computer is best, so you can revoke a lost laptop without affecting others.'] },
  { icon: 'toggles', title: 'Choose read & write', text: 'Keep the scope “Read & write” so records entered offline can be sent. Leave the project empty to use all your projects.', tips: ['A read-only token can download data but cannot send your offline records.'] },
  { icon: 'clipboard-check', title: 'Copy it once', text: 'The token starts with rdp_ and is shown only once. Copy it, then paste it into the box.', tips: ['If you lose it, create a new token and revoke the old one.'] },
];
const FAQ: [string, string, string, string][] = [
  ['shield-lock-fill', 'var(--rh-brand)', 'Why a token and not my password?', 'A token can be limited to read & write, revoked at any time and never reveals your password. The app stores only the token, in the Windows Credential Manager.'],
  ['eye-slash-fill', '#d97706', 'I cannot see the API tokens section', 'API tokens depend on your plan. Check “Your account” on the left for how many you may create, or compare plans. Ask your project owner if the section is missing for your role.'],
  ['person-x-fill', '#db2777', 'The app says the token belongs to someone else', 'You created the token while signed in as another person. Sign out of the website, sign in as yourself and create a new token.'],
  ['safe2-fill', 'var(--rh-teal)', 'Is my token safe on this computer?', 'It is encrypted with your Windows account and never written to a file. Signing out removes the token and the offline copy.'],
  ['clock-history', '#7c3aed', 'It says the token is not valid', 'Tokens can be revoked or can expire. Create a new one on the website and paste it here. Make sure you copied all of it, starting with rdp_.'],
];

/** Two side-by-side columns where the shorter one stays in view while the longer one scrolls. */
function useStickyShorter() {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<{ side: 'left' | 'right' | null; top: number }>({ side: null, top: 16 });
  useEffect(() => {
    const measure = () => {
      const a = left.current?.offsetHeight ?? 0; const b = right.current?.offsetHeight ?? 0;
      if (Math.abs(a - b) < 24) { setSt({ side: null, top: 16 }); return; }
      const short = a < b ? a : b;
      // a short column that is still taller than the window sticks by its bottom edge instead of its top
      setSt({ side: a < b ? 'left' : 'right', top: Math.min(16, Math.round(window.innerHeight - short - 24)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (left.current) ro.observe(left.current);
    if (right.current) ro.observe(right.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const style = (side: 'left' | 'right') => (st.side === side ? { position: 'sticky' as const, top: st.top, alignSelf: 'start' as const } : undefined);
  return { left, right, style };
}

/** Step 2 — guided instructions and API token, validated against the server and kept in the Windows Credential Manager. */
export function TokenView() {
  const { server, user, setTokenSaved, sync, signOut, toast } = useSession();
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [done, setDone] = useState<boolean[]>([false, false, false, false]);
  const [faq, setFaq] = useState<number | null>(null);
  const sticky = useStickyShorter();
  const [planBlock, setPlanBlock] = useState('');
  const [copied, setCopied] = useState(false);
  const [burst, setBurst] = useState(false);
  const goPlans = () => setPlanBlock(' ');

  const t = token.trim();
  const checks = useMemo(() => [['Starts with rdp_', /^rdp_/i.test(t)], ['Long enough', t.length >= 24], ['Only letters and digits', /^rdp_[a-z0-9]+$/i.test(t)]] as [string, boolean][], [t]);
  const valid = /^rdp_[a-f0-9]{20,}$/i.test(t);
  const doneCount = valid ? 4 : done.filter(Boolean).length;
  useEffect(() => { if (valid) { setBurst(true); const id = window.setTimeout(() => setBurst(false), 1400); return () => window.clearTimeout(id); } }, [valid]);
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((x) => Math.max(0, Math.min(3, x + (e.key === 'ArrowDown' ? 1 : -1)))); } };

  const mark = (i: number) => setDone((d) => d.map((x, k) => (k === i ? !x : x)));
  const next = (i: number) => { setDone((d) => d.map((x, k) => (k === i ? true : x))); setActive(Math.min(3, i + 1)); };

  async function paste() {
    try { const x = (await navigator.clipboard.readText()).trim(); if (x) { setToken(x); setError(''); setDone([true, true, true, true]); } else toast('The clipboard is empty.', 'error'); }
    catch { toast('Could not read the clipboard. Paste with Ctrl+V.', 'error'); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!valid) { setError('That does not look like a Library Medicine API token (it starts with rdp_).'); return; }
    setBusy(true);
    try {
      const me = await api<Me>('GET', 'api/v1/me', undefined, t);
      if (isPlanRefusal(me.status, apiError(me, ''))) { setPlanBlock(apiError(me, 'Your plan does not include API tokens.')); return; }
      if (me.status !== 200) { setError(me.status === 401 ? 'This token is not valid (revoked, expired or mistyped).' : apiError(me)); return; }
      if (user && me.body.id !== user.id) { setError(`This token belongs to ${me.body.email}, not to ${user.email}. Create a token while signed in as yourself.`); return; }
      if (!(me.body.scope?.scopes ?? []).includes('write')) { setError('This token is read-only. Create a "Read & write" token so your offline records can be sent.'); return; }
      await native.secureSet('api_token', t);
      await store.kvSet('token_scope', JSON.stringify(me.body.scope ?? null));
      toast('Token saved securely. Downloading your projects…');
      await setTokenSaved();
      await sync();
    } catch (err) { setError(String(err).replace(/^Error: /, '')); } finally { setBusy(false); }
  }

  if (apiTokenAccess(user) === 'no' || planBlock) return <PlansView reason={planBlock.trim() || undefined} onBack={apiTokenAccess(user) === 'no' ? undefined : () => setPlanBlock('')} />;

  return (
    <div className="auth-bg" tabIndex={-1}>
      <div className="auth-card anim-in" style={{ maxWidth: '72rem' }}>
        <div className="flex items-center justify-between"><Brand />
          <div className="flex items-center gap-3"><ol className="mini-steps" aria-label="Setup progress"><li className="done"><span><Icon name="check-lg" /></span>Sign in</li><li className="on"><span>2</span>Connect</li><li><span>3</span>Work</li></ol>
            <button className="btn btn-ghost btn-sm" onClick={() => signOut()}><Icon name="box-arrow-left" />Sign out</button></div></div>

        <header className="cn-hero">
          <div className="min-w-0 flex-1" style={{ minWidth: '16rem' }}>
            <h1 className="text-3xl grad-text">Connect this computer</h1>
            <p className="muted mt-1">Signed in as <b className="ink">{user?.name || user?.email}</b>. The app syncs with a personal API token, so your password is never stored.</p>
            <div className="cn-chips"><span className="chip chip-brand"><Icon name="stopwatch" />About 2 minutes</span><span className="chip chip-ok"><Icon name="shield-check" />Password never stored</span><span className="chip chip-teal"><Icon name="x-octagon" />Revoke any time</span></div>
          </div>
          <Journey done={doneCount} valid={valid} />
        </header>
        <SegProgress done={done} active={active} onPick={setActive} valid={valid} />

        <div className="mt-5 grid items-start gap-5" style={{ gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)' }}>
          <div ref={sticky.left} className="space-y-4" style={sticky.style('left')}>
            <ol className="space-y-2" onKeyDown={onKey}>
              {STEPS.map((s, i) => (
                <li key={s.title} className={`istep ${active === i ? 'open' : ''} ${done[i] || valid ? 'done' : ''}`} style={{ ['--sc' as string]: STEP_COLORS[i] }}>
                  <button type="button" className="ihead" onClick={() => setActive(i)} aria-expanded={active === i}>
                    <span className="n">{done[i] || valid ? <Icon name="check-lg" /> : i + 1}</span><span className="ic"><Icon name={s.icon} /></span><b className="ink flex-1 text-left">{s.title}</b><Icon name={active === i ? 'chevron-up' : 'chevron-down'} className="muted" />
                  </button>
                  {active === i && (
                    <div className="ibody anim-in"><p className="muted">{s.text}</p>
                      <ul className="mt-2 space-y-1 text-sm">{s.tips.map((x) => <li key={x} className="flex gap-2"><Icon name="lightbulb-fill" className="mt-0.5 text-[var(--rh-amber)]" /><span>{x}</span></li>)}</ul>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {i === 0 && <button type="button" className="btn btn-primary btn-sm" onClick={() => { openUrl(`${server}/account#tokens`); window.setTimeout(() => next(0), 500); }}><Icon name="box-arrow-up-right" />Open Account & security</button>}
                        {i === 1 && <button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText('Desktop app'); setCopied(true); window.setTimeout(() => setCopied(false), 1800); toast('Copied “Desktop app”'); }}><Icon name={copied ? 'check2' : 'clipboard'} />{copied ? 'Copied' : 'Copy name “Desktop app”'}</button>}
                        {i > 0 && <button type="button" className="btn btn-sm" onClick={() => setActive(i - 1)}><Icon name="arrow-left" />Back</button>}
                        <button type="button" className="btn btn-sm" onClick={() => (done[i] ? mark(i) : next(i))}><Icon name={done[i] ? 'arrow-counterclockwise' : 'check2'} />{done[i] ? 'Undo' : i < 3 ? 'Done, next step' : 'Done'}</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <WebMock step={active} onStep={setActive} />
            <AccountCard user={user} onPlans={goPlans} />
            <NextCard />
          </div>

          <div ref={sticky.right} className="space-y-4" style={sticky.style('right')}>
            <form onSubmit={submit} className={`well p-5 cn-form ${valid ? 'ok' : ''}`}>
              <Burst show={burst} />
              <label className="label" htmlFor="token">Your API token</label>
              <div className="field-ic"><Icon name="key" /><input id="token" type={show ? 'text' : 'password'} className="field" style={{ paddingRight: '5.4rem', fontFamily: 'ui-monospace, Consolas, monospace' }} placeholder="rdp_…" value={token} onChange={(e) => { setToken(e.target.value); setError(''); }} onPaste={() => setDone([true, true, true, true])} autoComplete="off" spellCheck={false} />
                <span className="eye-group"><button type="button" className="eye" onClick={() => setShow((x) => !x)} aria-label={show ? 'Hide token' : 'Show token'}><Icon name={show ? 'eye-slash' : 'eye'} /></button><button type="button" className="eye" onClick={paste} aria-label="Paste from clipboard" title="Paste from clipboard"><Icon name="clipboard" /></button></span></div>
              <ul className="mt-3 flex flex-wrap gap-2">{checks.map(([l, ok]) => <li key={l} className={`chip ${t ? (ok ? 'chip-ok' : 'chip-warn') : ''}`}><Icon name={t ? (ok ? 'check2' : 'x') : 'circle'} />{l}</li>)}</ul>
              {valid && <p className="mt-3 flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--rh-success)' }}><Icon name="patch-check-fill" />This looks like a valid token. Press the green button to connect.</p>}
              {error && <div className="notice danger mt-3" role="alert"><Icon name="exclamation-octagon" /><span>{error}</span></div>}
              <button className="btn btn-primary btn-lg mt-4 w-full" disabled={busy || !valid}>{busy ? <><Icon name="arrow-repeat" className="spin" />Checking…</> : <><Icon name="cloud-arrow-down" />Save & download my projects</>}</button>
              <p className="help mt-3"><Icon name="shield-lock" className="mr-1" />Stored in the Windows Credential Manager, encrypted with your Windows account.</p>
            </form>
            <div className="notice info"><Icon name="gem" /><span>API tokens depend on your plan. You can revoke a token on the website at any time; the app then asks for a new one. <button type="button" className="hl-link" onClick={goPlans}>No “API tokens” section? See the plans</button></span></div>
            <div><span className="label-cap">Trouble?</span>
              <div className="space-y-2">{FAQ.map(([ic, c, q, a], i) => (
                <div key={q} className="well" style={{ ['--sc' as string]: c }}><button type="button" className="faq-q" onClick={() => setFaq(faq === i ? null : i)} aria-expanded={faq === i}><span className="fq-ic"><Icon name={ic} /></span><span className="flex-1 text-left">{q}</span><Icon name={faq === i ? 'dash' : 'plus'} /></button>{faq === i && <p className="muted anim-in px-4 pb-3 text-sm selectable">{a}</p>}</div>))}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
