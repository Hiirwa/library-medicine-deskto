import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getVersion } from '@tauri-apps/api/app';
import { useAsk, useSignOut } from '../components/Confirm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CardTitle, Icon, PageHead, Switch } from '../components/ui';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { bytes, initials } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi, type Theme } from '../providers/UiProvider';

export const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search projects, records and pages'],
  ['Ctrl N', 'New record in the open project'],
  ['F5 / Ctrl R', 'Sync now'],
  ['/ or Ctrl F', 'Search in the current page'],
  ['Ctrl S', 'Save the record you are editing'],
  ['Esc', 'Close the editor or a menu'],
  ['Ctrl B', 'Show or hide the menu'],
  ['Ctrl ,', 'Settings'],
  ['Alt ←', 'Back to the previous page'],
];

export function SettingsView() {
  const ask = useAsk();
  const { settings, setSetting, user, server, sync, online, toast } = useSession();
  const { theme, setTheme, vivid, setVivid } = useUi();
  const [devName, setDevName] = useState('');
  useEffect(() => { store.kvGet('device_name').then((n) => setDevName(n ?? '')).catch(() => {}); }, []);
  async function saveDevName() {
    await store.kvSet('device_name', devName.trim().slice(0, 120));
    await qc.invalidateQueries({ queryKey: ['deviceName'] });
    toast('Computer name saved. The website shows it at the next sync.');
  }
  const qc = useQueryClient();
  const [version, setVersion] = useState('');
  const [ws, setWs] = useState<{ root: string; size: number } | null>(null);
  const storage = useQuery({ queryKey: ['storage'], queryFn: store.storageStats });
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion('1.x'));
    Promise.all([native.workspace(), native.workspaceSize()]).then(([w, size]) => setWs({ root: w.root, size })).catch(() => {});
  }, []);

  async function replaceToken() {
    if (!(await ask('Remove the API token from this computer and enter a new one? Your offline data stays.', { title: 'Replace API token', kind: 'info', okLabel: 'Replace' }))) return;
    await native.secureDelete('api_token');
    location.reload();
  }
  async function redownload() {
    if (!(await ask('Download every record of your projects again at the next sync? Unsent changes are kept.', { title: 'Download everything again', kind: 'info', okLabel: 'Yes, at next sync' }))) return;
    await store.resetCheckpoint();
    await qc.invalidateQueries();
    toast('Everything will be downloaded again.');
    if (online) sync();
  }
  const doSignOut = useSignOut();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHead icon="gear" title="Settings" sub="Appearance, synchronisation, account and storage" />
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(26rem, 1fr))' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="palette" tone="k-pink" title="Appearance" sub="Same look as librarymedicine.online" />
          <div className="setting">
            <div className="s-txt"><b>Theme</b><span>Follow Windows, or always light or dark.</span></div>
            <div className="seg light">
              {([['system', 'circle-half', 'System'], ['light', 'sun', 'Light'], ['dark', 'moon-stars', 'Dark']] as [Theme, string, string][]).map(([t, ic, l]) => (
                <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}><Icon name={ic} />{l}</button>
              ))}
            </div>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Record form</b><span>Website: the same form, layout, logic and checks as librarymedicine.online. Compact: the desktop's quick editor.</span></div>
            <div className="seg light">
              {([['website', 'globe2', 'Website'], ['classic', 'layout-sidebar', 'Compact']] as const).map(([v, ic, l]) => (
                <button key={v} className={settings.formStyle === v ? 'on' : ''} onClick={() => setSetting('formStyle', v)}><Icon name={ic} />{l}</button>
              ))}
            </div>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Colourful</b><span>Colour-coded menu, gradient tiles, headers and buttons. Off gives the calm look.</span></div>
            <span className="swatches" aria-hidden="true">{[1, 2, 3, 5, 8, 9].map((n) => <i key={n} style={{ background: `var(--vv-${n})` }} />)}</span>
            <Switch on={vivid} onChange={setVivid} label="Colourful" />
          </div>
        </section>

        <section className="card p-5 anim-in">
          <CardTitle icon="arrow-repeat" tone="k-teal" title="Synchronisation" sub="When the app talks to the server" />
          <div className="setting">
            <div className="s-txt"><b>Automatic sync</b><span>While online, send and receive changes regularly.</span></div>
            <select className="field w-44" value={settings.autoSyncMin} onChange={(e) => setSetting('autoSyncMin', Number(e.target.value))} aria-label="Automatic sync interval">
              <option value={0}>Off</option><option value={1}>Every minute</option><option value={5}>Every 5 minutes</option><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option><option value={60}>Every hour</option>
            </select>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Live sync</b><span>Watch the website and pick up its changes within seconds; send what you save here straight away.</span></div>
            <Switch on={settings.liveSync} onChange={(v) => setSetting('liveSync', v)} label="Live sync" />
          </div>
          {settings.liveSync && (
            <div className="setting">
              <div className="s-txt"><b>Check the website every</b><span>One very small request; a change triggers a full sync.</span></div>
              <select className="field w-44" value={settings.liveEverySec} onChange={(e) => setSetting('liveEverySec', Number(e.target.value))} aria-label="Live check interval">
                <option value={5}>5 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option>
              </select>
            </div>
          )}
          <div className="setting">
            <div className="s-txt"><b>Records kept on this computer</b><span>Team: everything collected in projects where your role sees all data (website forms, colleagues). Mine: only what you entered.</span></div>
            <div className="seg light">
              {([['team', 'people', 'Team'], ['own', 'person', 'Mine']] as const).map(([v, ic, l]) => (
                <button key={v} className={settings.syncScope === v ? 'on' : ''} onClick={async () => {
                  if (v === settings.syncScope) return;
                  await setSetting('syncScope', v);
                  toast(v === 'team' ? 'Team records will be downloaded at the next sync.' : 'Only your own records will be kept from the next sync.');
                  if (online) setTimeout(() => sync(), 300);
                }}><Icon name={ic} />{l}</button>
              ))}
            </div>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Name of this computer</b><span>Shown on the website under Account → Devices.</span></div>
            <input className="field w-44" value={devName} maxLength={120} placeholder="e.g. Ward laptop" onChange={(e) => setDevName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveDevName(); }} />
            <button className="btn btn-sm" onClick={saveDevName}><Icon name="check2" />Save</button>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Sync on start and on reconnect</b><span>Sync when the app opens and when the internet comes back.</span></div>
            <Switch on={settings.syncOnStart} onChange={(v) => setSetting('syncOnStart', v)} label="Sync on start" />
          </div>
          <div className="setting">
            <div className="s-txt"><b>Keep attachments offline</b><span>Download attached files during sync so they open without internet.</span></div>
            <Switch on={settings.downloadFiles} onChange={(v) => setSetting('downloadFiles', v)} label="Download attachments" />
          </div>
          <div className="setting">
            <div className="s-txt"><b>Repair the offline copy</b><span>Download every record again at the next sync.</span></div>
            <button className="btn btn-sm" onClick={redownload}><Icon name="cloud-arrow-down" />Download again</button>
          </div>
        </section>

        <section className="card p-5 anim-in">
          <CardTitle icon="person-circle" tone="k-violet" title="Account" sub={new URL(server).host} />
          <div className="setting">
            <span className="avatar">{initials(user?.name || user?.email)}</span>
            <div className="s-txt"><b>{user?.name}</b><span>{user?.email}{user?.institution ? ` · ${user.institution}` : ''}</span></div>
            <button className="btn btn-sm" onClick={() => openUrl(`${server}/account`)}><Icon name="box-arrow-up-right" />Manage</button>
          </div>
          <div className="setting">
            <div className="s-txt"><b>API token</b><span>Stored in the Windows Credential Manager, never in a file.</span></div>
            <button className="btn btn-sm" onClick={replaceToken}><Icon name="key" />Replace</button>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Sign out</b><span>Removes the token and the offline copy from this computer.</span></div>
            <button className="btn btn-sm btn-danger" onClick={doSignOut}><Icon name="box-arrow-right" />Sign out</button>
          </div>
        </section>

        <section className="card p-5 anim-in">
          <CardTitle icon="hdd-stack" tone="k-warn" title="Storage on this computer" sub="Local database and workspace folder" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="well px-4 py-3"><b className="num block text-xl ink">{storage.data?.projects ?? 0}</b><span className="muted text-xs font-bold uppercase">Projects</span></div>
            <div className="well px-4 py-3"><b className="num block text-xl ink">{(storage.data?.records ?? 0).toLocaleString()}</b><span className="muted text-xs font-bold uppercase">Records</span></div>
            <div className="well px-4 py-3"><b className="num block text-xl ink">{storage.data?.files ?? 0}</b><span className="muted text-xs font-bold uppercase">Attachments</span></div>
            <div className="well px-4 py-3"><b className="num block text-xl ink">{bytes(ws?.size ?? storage.data?.offlineBytes ?? 0)}</b><span className="muted text-xs font-bold uppercase">Workspace size</span></div>
          </div>
          <div className="setting">
            <div className="s-txt"><b>Workspace folder</b><span className="selectable block truncate" title={ws?.root}>{ws?.root ?? '…'}</span></div>
            <button className="btn btn-sm" onClick={() => native.revealLocal()}><Icon name="folder2-open" />Open</button>
          </div>
        </section>

        <section className="card p-5 anim-in">
          <CardTitle icon="keyboard" tone="k-sky" title="Keyboard shortcuts" />
          <div className="mt-3">
            {SHORTCUTS.map(([k, d]) => <div key={k} className="setting" style={{ padding: '.55rem 0' }}><span className="s-txt">{d}</span><span className="flex gap-1">{k.split(' / ').map((x) => <kbd key={x}>{x}</kbd>)}</span></div>)}
          </div>
        </section>

        <section className="card p-5 anim-in">
          <CardTitle icon="info-circle" tone="k-ok" title="About" />
          <div className="mt-4 flex items-center gap-4">
            <span className="logo" style={{ width: '3.5rem', height: '3.5rem', fontSize: '1.7rem' }}><Icon name="bar-chart-steps" /></span>
            <div><b className="brand-name">Library Medicine Desktop</b><span className="muted text-sm">Version {version} · offline data collection</span></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-sm" onClick={() => openUrl(server)}><Icon name="globe2" />Website</button>
            <button className="btn btn-sm" onClick={() => openUrl(`${server}/docs`)}><Icon name="book" />Documentation</button>
            <button className="btn btn-sm" onClick={() => openUrl(`${server}/contact`)}><Icon name="envelope" />Contact support</button>
            <button className="btn btn-sm" onClick={() => window.dispatchEvent(new Event('lm-setup'))}><Icon name="magic" />Run setup again</button>
          </div>
        </section>
      </div>
    </div>
  );
}
