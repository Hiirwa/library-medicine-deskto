import { useState, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Brand } from '../components/Brand';
import { api, apiError, native } from '../lib/native';
import * as store from '../lib/db';
import { useSession } from '../providers/AppProvider';
import type { Me } from '../lib/types';

const STEPS = [
  ['Open your account', 'On the website, click your name at the bottom of the menu, then Account & security.'],
  ['Create a token', 'In the API tokens section, click Create token. Name it "Desktop app" so you recognise it later.'],
  ['Choose read & write', 'Keep the scope "Read & write" so the app can send the records you enter offline. Leave the project empty to use all your projects.'],
  ['Copy it once', 'The token (it starts with rdp_) is shown only once. Copy it and paste it below.'],
];

/** View 2 — instructions + API token, validated against the server and kept in the Windows Credential Manager. */
export function TokenView() {
  const { server, user, setTokenSaved, sync, signOut, toast } = useSession();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = token.trim();
    setError('');
    if (!/^rdp_[a-f0-9]{20,}$/i.test(t)) { setError('That does not look like a Library Medicine API token (it starts with rdp_).'); return; }
    setBusy(true);
    try {
      const me = await api<Me>('GET', 'api/v1/me', undefined, t);
      if (me.status !== 200) { setError(me.status === 401 ? 'This token is not valid (revoked, expired or mistyped).' : apiError(me)); return; }
      if (user && me.body.id !== user.id) { setError(`This token belongs to ${me.body.email}, not to ${user.email}. Create a token while signed in as yourself.`); return; }
      const scopes = me.body.scope?.scopes ?? [];
      if (!scopes.includes('write')) { setError('This token is read-only. Create a "Read & write" token so your offline records can be sent.'); return; }
      await native.secureSet('api_token', t); // Windows Credential Manager
      await store.kvSet('token_scope', JSON.stringify(me.body.scope ?? null));
      toast('Token saved securely. Downloading your projects…');
      await setTokenSaved();
      await sync();
    } catch (err) {
      setError(String(err).replace(/^Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center overflow-auto bg-gradient-to-br from-brand-50 via-white to-teal-50 p-6">
      <div className="card w-full max-w-3xl p-8">
        <div className="flex items-center justify-between"><Brand /><button className="btn-ghost" onClick={() => signOut()}>Sign out</button></div>
        <h1 className="mt-6 text-2xl font-bold">Connect this computer</h1>
        <p className="mt-1 text-sm text-slate-500">Signed in as <b className="text-slate-700">{user?.name || user?.email}</b>. The desktop app uses a personal API token to sync your data, so your password is never stored.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-2xl bg-slate-50 p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <span><b className="block text-sm text-slate-900">{t}</b><span className="text-sm text-slate-600">{d}</span></span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-slate-500">API tokens are part of the Pro and Max plans. You can revoke a token on the website at any time; the app then asks for a new one.</p>
        <button type="button" className="btn-ghost mt-4" onClick={() => openUrl(`${server}/account#tokens`)}>Open Account &amp; security on the website ↗</button>
        <form onSubmit={submit} className="mt-6">
          <label className="label" htmlFor="token">Your API token</label>
          <div className="flex gap-2">
            <input id="token" className="field font-mono" placeholder="rdp_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
            <button className="btn-primary shrink-0" disabled={busy || !token.trim()}>{busy ? 'Checking…' : 'Save & sync'}</button>
          </div>
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">{error}</p>}
          <p className="mt-3 text-xs text-slate-500">The token is stored in the Windows Credential Manager, encrypted with your Windows account.</p>
        </form>
      </div>
    </div>
  );
}
