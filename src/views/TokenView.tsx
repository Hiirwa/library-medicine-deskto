import { useState, type FormEvent } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
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
    <div className="auth-bg">
      <div className="auth-card anim-in max-w-4xl">
        <div className="flex items-center justify-between"><Brand /><button className="btn btn-ghost btn-sm" onClick={() => signOut()}><Icon name="box-arrow-left" />Sign out</button></div>
        <h1 className="mt-7 text-3xl grad-text">Connect this computer</h1>
        <p className="muted mt-1">Signed in as <b className="ink">{user?.name || user?.email}</b>. The desktop app uses a personal API token to sync your data, so your password is never stored.</p>
        <ol className="mt-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {STEPS.map(([t, d], i) => (
            <li key={t} className="well flex gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: 'var(--v-grad)', boxShadow: 'var(--rh-sh-brand)' }}>{i + 1}</span>
              <span><b className="ink block">{t}</b><span className="muted text-sm">{d}</span></span>
            </li>
          ))}
        </ol>
        <div className="notice info mt-4"><Icon name="gem" /><span>API tokens are part of the Pro and Max plans. You can revoke a token on the website at any time; the app then asks for a new one.</span></div>
        <button type="button" className="btn mt-4" onClick={() => openUrl(`${server}/account#tokens`)}><Icon name="box-arrow-up-right" />Open Account &amp; security on the website</button>
        <form onSubmit={submit} className="mt-6">
          <label className="label" htmlFor="token">Your API token</label>
          <div className="flex gap-2">
            <div className="field-ic flex-1"><Icon name="key" /><input id="token" className="field" placeholder="rdp_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} /></div>
            <button className="btn btn-primary shrink-0" disabled={busy || !token.trim()}>{busy ? <><Icon name="arrow-repeat" className="spin" />Checking…</> : <><Icon name="cloud-arrow-down" />Save &amp; sync</>}</button>
          </div>
          {error && <div className="notice danger mt-3" role="alert"><Icon name="exclamation-octagon" /><span>{error}</span></div>}
          <p className="help mt-3"><Icon name="shield-lock" className="mr-1" />The token is stored in the Windows Credential Manager, encrypted with your Windows account.</p>
        </form>
      </div>
    </div>
  );
}
