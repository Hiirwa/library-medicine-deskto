import { useState, type FormEvent } from 'react';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
import { api, apiError, native } from '../lib/native';
import { useSession } from '../providers/AppProvider';
import type { Me } from '../lib/types';

/** View 1 — sign in with the Library Medicine account (email or username + password, 2FA code when enabled). */
export function LoginView() {
  const { server: savedServer, setLoggedIn, online } = useSession();
  const [server, setServer] = useState(savedServer);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const srv = await native.setServer(server);
      const r = await api<{ access_token?: string; error?: string }>('POST', 'api/v1/auth/login', { email: email.trim(), password, otp: otp.trim() || undefined }, 'none');
      if (r.status !== 200 || !r.body.access_token) {
        const msg = apiError(r, 'Sign-in failed');
        if (/two-factor|otp/i.test(msg)) { setNeedOtp(true); setError(needOtp ? 'That code is not valid. Try the current code from your authenticator app.' : 'Enter the 6-digit code from your authenticator app.'); }
        else setError(r.status === 401 ? 'Wrong email/username or password.' : msg);
        return;
      }
      // the session token proves who you are; data access uses the personal API token on the next screen
      const me = await api<Me>('GET', 'api/v1/me', undefined, r.body.access_token);
      if (me.status !== 200) { setError(apiError(me)); return; }
      await setLoggedIn(srv, me.body);
    } catch (err) {
      setError(String(err).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="grid w-full max-w-5xl items-center gap-10" style={{ gridTemplateColumns: 'minmax(0,1fr) 28rem' }}>
        <div className="anim-in">
          <Brand />
          <h1 className="mt-8 text-[2.6rem] leading-tight" style={{ background: 'var(--rh-head-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Collect research data anywhere — even without internet.</h1>
          <p className="muted mt-4 max-w-lg text-lg">The Library Medicine desktop app keeps your projects on this computer and syncs them with librarymedicine.online when you are back online.</p>
          <div className="mt-7 grid max-w-lg gap-3">
            {[['wifi-off', 'Works offline', 'Enter and edit records in the field, at the ward or on the road.'], ['arrow-repeat', 'Syncs automatically', 'Changes go up and come down by themselves when you are connected.'], ['shield-lock', 'Secure', 'Your token is kept in the Windows Credential Manager.']].map(([ic, t, d]) => (
              <div key={t} className="card-flat flex items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg" style={{ background: 'var(--rh-brand-soft)', color: 'var(--rh-brand)' }}><Icon name={ic} /></span>
                <span><b className="ink block">{t}</b><span className="muted text-sm">{d}</span></span>
              </div>
            ))}
          </div>
        </div>
        <form onSubmit={submit} className="auth-card anim-in">
          <h2 className="text-2xl grad-text">Sign in</h2>
          <p className="muted mt-1">Use the same account as on {(() => { try { return new URL(server || 'https://librarymedicine.online').host; } catch { return 'the website'; } })()}.</p>
          {!online && <div className="notice warn mt-4"><Icon name="wifi-off" /><span>You are offline. Signing in for the first time needs internet.</span></div>}
          <label className="label mt-6" htmlFor="email">Email or username</label>
          <div className="field-ic"><Icon name="person" /><input id="email" className="field" autoFocus autoComplete="username" placeholder="Dr@librarymedicine.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <label className="label mt-4" htmlFor="password">Password</label>
          <div className="field-ic"><Icon name="lock" /><input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {needOtp && (
            <>
              <label className="label mt-4" htmlFor="otp">Two-factor code</label>
              <div className="field-ic"><Icon name="shield-check" /><input id="otp" className="field tracking-[.3em]" inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus /></div>
            </>
          )}
          {advanced && (
            <>
              <label className="label mt-4" htmlFor="server">Server address</label>
              <div className="field-ic"><Icon name="globe2" /><input id="server" className="field" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://librarymedicine.online" /></div>
            </>
          )}
          {error && <div className="notice danger mt-4" role="alert"><Icon name="exclamation-octagon" /><span>{error}</span></div>}
          <button className="btn btn-primary btn-lg mt-6 w-full" disabled={busy || !email || !password}>{busy ? <><Icon name="arrow-repeat" className="spin" />Signing in…</> : <><Icon name="box-arrow-in-right" />Sign in</>}</button>
          <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAdvanced((a) => !a)}>
            <Icon name="hdd-network" />{advanced ? 'Hide server address' : 'Use another server address'}
          </button>
        </form>
      </div>
    </div>
  );
}
