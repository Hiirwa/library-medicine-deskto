import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
import { api, apiError, native } from '../lib/native';
import { useSession } from '../providers/AppProvider';
import { readJson, writeJson } from '../lib/useLocal';
import { useUi } from '../providers/UiProvider';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Me } from '../lib/types';

const FEATURES: [string, string, string, string][] = [
  ['wifi-off', 'Works offline', 'Collect without internet', 'Enter, edit and attach files at the ward, in the field or on the road. Everything is saved on this computer the moment you press save.'],
  ['arrow-repeat', 'Automatic sync', 'Nothing gets lost', 'When the connection returns, changes go up and everyone else’s come down. If two people edit the same record, the newest change wins.'],
  ['graph-up-arrow', 'Analysis built in', 'From data to report', 'Statistics, a workbench, a live dashboard and printable reports are ready inside every project, even offline.'],
  ['shield-lock', 'Secure by design', 'Your password is never stored', 'A personal token is kept in the Windows Credential Manager, encrypted with your Windows account.'],
];

/** Step 1 — sign in with the Library Medicine account (email or username + password, 2FA code when enabled). */
export function LoginView() {
  const { server: savedServer, setLoggedIn, online } = useSession();
  const [server, setServer] = useState(savedServer);
  const [email, setEmail] = useState(() => readJson<string>('lm_last_user', ''));
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  const { dark, setTheme } = useUi();
  const [feat, setFeat] = useState(0);
  const [paused, setPaused] = useState(false);
  const [test, setTest] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle');

  useEffect(() => { if (paused) return; const t = setInterval(() => setFeat((f) => (f + 1) % FEATURES.length), 6000); return () => clearInterval(t); }, [paused]);
  const host = (() => { try { return new URL(server || 'https://librarymedicine.online').host; } catch { return 'the website'; } })();
  const onKey = (e: KeyboardEvent) => setCaps(e.getModifierState?.('CapsLock') ?? false);

  async function testServer() {
    setTest('busy');
    try { await native.setServer(server); const r = await native.checkNetwork(); setTest(r.online ? 'ok' : 'fail'); } catch { setTest('fail'); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const srv = await native.setServer(server);
      const r = await api<{ access_token?: string; error?: string }>('POST', 'api/v1/auth/login', { email: email.trim(), password, otp: otp.trim() || undefined }, 'none');
      if (r.status !== 200 || !r.body.access_token) {
        const msg = apiError(r, 'Sign-in failed');
        if (/two-factor|otp/i.test(msg)) { setNeedOtp(true); setError(needOtp ? 'That code is not valid. Try the current code from your authenticator app.' : 'Enter the 6-digit code from your authenticator app.'); }
        else setError(r.status === 401 ? 'Wrong email/username or password.' : msg);
        return;
      }
      const me = await api<Me>('GET', 'api/v1/me', undefined, r.body.access_token);
      if (me.status !== 200) { setError(apiError(me)); return; }
      writeJson('lm_last_user', remember ? email.trim() : '');
      await setLoggedIn(srv, me.body);
    } catch (err) {
      setError(String(err).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  const f = FEATURES[feat];
  return (
    <div className="auth-bg">
      <button type="button" className="btn btn-icon theme-fab" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme"><Icon name={dark ? 'sun' : 'moon-stars'} /></button>
      <div className="auth-split anim-in">
        <section className="auth-hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <Brand />
          <h1 className="auth-h1">Research data collection that never waits for the network.</h1>
          <p className="auth-lead">Library Medicine Desktop keeps your projects on this computer and syncs them with {host} whenever you are connected.</p>
          <div className="feat-card" key={feat}>
            <span className="feat-ic"><Icon name={f[0]} /></span>
            <div><span className="label-cap" style={{ margin: 0 }}>{f[1]}</span><b className="ink block text-lg">{f[2]}</b><p className="muted mt-1 text-sm">{f[3]}</p></div>
          </div>
          <div className="feat-dots" role="tablist" aria-label="Features"><button type="button" className="btn btn-icon btn-sm" style={{ width: '1.9rem', height: '1.9rem' }} aria-label="Previous" onClick={() => setFeat((f) => (f + FEATURES.length - 1) % FEATURES.length)}><Icon name="chevron-left" /></button>{FEATURES.map((x, i) => <button key={x[1]} role="tab" aria-selected={i === feat} aria-label={x[1]} className={i === feat ? 'on' : ''} onClick={() => setFeat(i)} />)}<button type="button" className="btn btn-icon btn-sm" style={{ width: '1.9rem', height: '1.9rem' }} aria-label="Next" onClick={() => setFeat((f) => (f + 1) % FEATURES.length)}><Icon name="chevron-right" /></button></div>
          <div className="trust"><span><Icon name="shield-check" />Encrypted token</span><span><Icon name="hdd" />Local database</span><span><Icon name="cloud-check" />Auto-sync</span></div>
        </section>

        <form onSubmit={submit} className="auth-card auth-form">
          <ol className="mini-steps" aria-label="Setup progress"><li className="on"><span>1</span>Sign in</li><li><span>2</span>Connect</li><li><span>3</span>Work</li></ol>
          <h2 className="mt-5 text-2xl grad-text">Welcome back</h2>
          <p className="muted mt-1">Use the same account as on {host}.</p>
          {!online && <div className="notice warn mt-4"><Icon name="wifi-off" /><span>You are offline. The first sign-in needs internet.</span></div>}
          <label className="label mt-5" htmlFor="email">Email or username</label>
          <div className="field-ic"><Icon name="person" /><input id="email" className="field" autoFocus={!email} autoComplete="username" placeholder="you@institution.org" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <label className="label mt-4" htmlFor="password">Password</label>
          <div className="field-ic"><Icon name="lock" /><input id="password" type={show ? 'text' : 'password'} className="field" style={{ paddingRight: '2.9rem' }} autoFocus={!!email} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} required />
            <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eye-slash' : 'eye'} /></button></div>
          {caps && <div className="help mt-2" style={{ color: 'var(--rh-warning)' }}><Icon name="capslock" className="mr-1" />Caps Lock is on</div>}
          {needOtp && (<>
            <label className="label mt-4" htmlFor="otp">Two-factor code</label>
            <div className="field-ic"><Icon name="shield-check" /><input id="otp" className="field tracking-[.3em]" inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus /></div>
          </>)}
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember my email on this computer</label>
          {advanced && (<div className="well mt-4 p-3">
            <label className="label" htmlFor="server">Server address</label>
            <div className="flex gap-2"><div className="field-ic flex-1"><Icon name="globe2" /><input id="server" className="field" value={server} onChange={(e) => { setServer(e.target.value); setTest('idle'); }} placeholder="https://librarymedicine.online" /></div>
              <button type="button" className="btn" onClick={testServer} disabled={test === 'busy'}>{test === 'busy' ? <Icon name="arrow-repeat" className="spin" /> : <Icon name="broadcast" />}Test</button></div>
            {test === 'ok' && <div className="help mt-2" style={{ color: 'var(--rh-success)' }}><Icon name="check-circle-fill" className="mr-1" />Server reachable</div>}
            {test === 'fail' && <div className="help mt-2" style={{ color: 'var(--rh-danger)' }}><Icon name="x-circle-fill" className="mr-1" />Cannot reach this server</div>}
          </div>)}
          {error && <div className="notice danger mt-4" role="alert"><Icon name="exclamation-octagon" /><span>{error}</span></div>}
          <button className="btn btn-primary btn-lg mt-6 w-full" disabled={busy || !email || !password}>{busy ? <><Icon name="arrow-repeat" className="spin" />Signing in…</> : <><Icon name="box-arrow-in-right" />Sign in</>}</button>
          <div className="mt-3 flex items-center justify-between">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openUrl(server || "https://librarymedicine.online")} title="Open the website to reset your password"><Icon name="question-circle" />Reset password on the website</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdvanced((a) => !a)}><Icon name="hdd-network" />{advanced ? 'Hide server' : 'Server address'}</button>
            <span className={`netpill ${online ? 'on' : 'off'}`}><span className="dot" />{online ? 'Online' : 'Offline'}</span>
          </div>
        </form>
      </div>
    </div>
  );
}
