import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getVersion } from '@tauri-apps/api/app';
import { Icon, Switch } from './ui';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { plural } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi, type Theme } from '../providers/UiProvider';

const STEPS = ['Welcome', 'Preferences', 'Ready'];

/** First-run setup after installing: confirms everything is connected, lets you choose how the app behaves, then shows where your files live. Re-open it from Settings. */
export function SetupWizard() {
  const { user, settings, setSetting, syncing, online, lastSync, toast } = useSession();
  const { theme, setTheme } = useUi();
  const qc = useQueryClient();
  const done = useQuery({ queryKey: ['setup_done'], queryFn: () => store.kvGet('setup_done') });
  const storage = useQuery({ queryKey: ['storage'], queryFn: store.storageStats });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [version, setVersion] = useState('');
  const [root, setRoot] = useState('');

  useEffect(() => { if (done.isSuccess && !done.data) setOpen(true); }, [done.isSuccess, done.data]);
  useEffect(() => { const on = () => { setStep(0); setOpen(true); }; window.addEventListener('lm-setup', on); return () => window.removeEventListener('lm-setup', on); }, []);
  useEffect(() => { if (!open) return; getVersion().then(setVersion).catch(() => {}); native.workspace().then((w) => setRoot(w.root)).catch(() => {}); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(started: boolean) {
    setOpen(false);
    await store.kvSet('setup_done', '1').catch(() => {});
    await qc.invalidateQueries({ queryKey: ['setup_done'] });
    if (started) toast('You are ready to work. Press Ctrl+K to search anywhere.');
  }
  if (!open) return null;

  const first = (user?.name ?? '').replace(/^(dr|prof|professor|mr|mrs|ms|mx|eng|pr)\.?\s+/i, '').split(/\s+/)[0];
  const d = storage.data;
  const checks: [boolean, string, string][] = [
    [true, 'Installed', version ? `Library Medicine Desktop ${version}` : 'Library Medicine Desktop'],
    [!!user, 'Signed in', user ? `${user.name || user.email}` : '…'],
    [true, 'Connected', 'Access token stored in the Windows Credential Manager'],
    [!syncing && !!lastSync, syncing ? 'Downloading your projects…' : 'Projects on this computer', d ? `${plural(d.projects, 'project')} · ${plural(d.records, 'record')}` : '…'],
  ];

  return (
    <div className="overlay" style={{ zIndex: 70 }}>
      <div className="dialog setup" role="dialog" aria-modal="true" aria-labelledby="su-t">
        <div className="su-top">
          <ol className="mini-steps" aria-label="Setup steps">{STEPS.map((t, i) => <li key={t} className={i === step ? 'on' : i < step ? 'done' : ''}><span>{i < step ? <Icon name="check-lg" /> : i + 1}</span>{t}</li>)}</ol>
          <button className="btn btn-ghost btn-sm" onClick={() => finish(false)}>Skip setup</button>
        </div>

        {step === 0 && (
          <div className="su-body" key="s0">
            <span className="cf-ic success"><Icon name="rocket-takeoff-fill" /></span>
            <h2 id="su-t">Welcome{first ? `, ${first}` : ''}</h2>
            <p className="muted">Library Medicine is installed and connected. Here is what is ready on this computer.</p>
            <ul className="su-list">{checks.map(([ok, t, sub], i) => (
              <li key={t} style={{ animationDelay: `${i * 90}ms` }}><span className={`su-tick ${ok ? 'ok' : ''}`}>{ok ? <Icon name="check-lg" /> : <Icon name="arrow-repeat" className="spin" />}</span><span className="min-w-0"><b className="ink block">{t}</b><small className="muted">{sub}</small></span></li>
            ))}</ul>
            {!online && <div className="notice warn"><Icon name="wifi-off" /><span>You are offline. Your projects will download as soon as the connection returns.</span></div>}
          </div>
        )}

        {step === 1 && (
          <div className="su-body" key="s1">
            <span className="cf-ic info"><Icon name="sliders" /></span>
            <h2 id="su-t">Choose how it works</h2>
            <p className="muted">You can change any of this later in Settings.</p>
            <div className="space-y-3 text-left">
              <div className="su-row"><div className="s-txt"><b>Appearance</b><span>Light, dark, or follow Windows.</span></div>
                <div className="seg">{([['system', 'Auto', 'circle-half'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon-stars']] as [Theme, string, string][]).map(([k, t, ic]) => <button key={k} className={theme === k ? 'on' : ''} onClick={() => setTheme(k)}><Icon name={ic} />{t}</button>)}</div></div>
              <div className="su-row"><div className="s-txt"><b>Automatic sync</b><span>How often to send and receive changes while online.</span></div>
                <select className="field w-44" value={settings.autoSyncMin} onChange={(e) => setSetting('autoSyncMin', Number(e.target.value))} aria-label="Automatic sync interval"><option value={0}>Off</option><option value={1}>Every minute</option><option value={5}>Every 5 minutes</option><option value={15}>Every 15 minutes</option><option value={30}>Every 30 minutes</option></select></div>
              <div className="su-row"><div className="s-txt"><b>Sync when the app opens</b><span>And when the internet comes back.</span></div><Switch on={settings.syncOnStart} onChange={(v) => setSetting('syncOnStart', v)} label="Sync on start" /></div>
              <div className="su-row"><div className="s-txt"><b>Keep attachments offline</b><span>Download files during sync so they open without internet.</span></div><Switch on={settings.downloadFiles} onChange={(v) => setSetting('downloadFiles', v)} label="Download attachments" /></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="su-body" key="s2">
            <span className="cf-ic success"><Icon name="check-circle-fill" /></span>
            <h2 id="su-t">You are ready to work</h2>
            <p className="muted">Everything you enter is saved on this computer first, then sent automatically.</p>
            <div className="well su-path"><Icon name="folder2-open" /><span className="min-w-0 flex-1 truncate selectable" title={root}>{root || 'Documents\\Library Medicine'}</span><button className="btn btn-sm" onClick={() => native.revealLocal()}>Open folder</button></div>
            <div className="su-tips">{[['search', 'Ctrl K', 'Search projects and records'], ['plus-lg', 'Ctrl N', 'New record'], ['arrow-repeat', 'F5', 'Sync now']].map(([ic, k, t]) => <div key={k} className="well"><Icon name={ic} /><kbd>{k}</kbd><small>{t}</small></div>)}</div>
          </div>
        )}

        <div className="cf-actions su-actions">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}><Icon name="arrow-left" />Back</button>}
          <span className="flex-1" />
          {step < 2 ? <button className="btn btn-primary btn-lg" onClick={() => setStep(step + 1)} autoFocus>Continue<Icon name="arrow-right" /></button>
            : <button className="btn btn-primary btn-lg" onClick={() => finish(true)} autoFocus><Icon name="play-fill" />Start working</button>}
        </div>
      </div>
    </div>
  );
}
