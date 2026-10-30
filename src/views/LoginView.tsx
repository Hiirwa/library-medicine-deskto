import { useState, type FormEvent } from 'react';
import { Brand } from '../components/Brand';
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
    <div className="grid h-full place-items-center bg-gradient-to-br from-brand-50 via-white to-teal-50 p-6">
      <form onSubmit={submit} className="card w-full max-w-md p-8">
        <Brand />
        <h1 className="mt-6 text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Use the same account as on {new URL(server || 'https://librarymedicine.online').host}.</p>
        {!online && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">You are offline. Signing in for the first time needs internet.</p>}
        <label className="label mt-6" htmlFor="email">Email or username</label>
        <input id="email" className="field" autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label className="label mt-4" htmlFor="password">Password</label>
        <input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {needOtp && (
          <>
            <label className="label mt-4" htmlFor="otp">Two-factor code</label>
            <input id="otp" className="field tracking-[.3em]" inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
          </>
        )}
        {advanced && (
          <>
            <label className="label mt-4" htmlFor="server">Server address</label>
            <input id="server" className="field" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://librarymedicine.online" />
          </>
        )}
        {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">{error}</p>}
        <button className="btn-primary mt-6 w-full py-3" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="mt-4 text-xs font-semibold text-slate-500 hover:text-brand-600" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? 'Hide server address' : 'Use another server address'}
        </button>
      </form>
    </div>
  );
}
