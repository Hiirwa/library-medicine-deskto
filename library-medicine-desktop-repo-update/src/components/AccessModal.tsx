import { useEffect } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Icon } from './ui';
import { webUrl, type Access } from '../lib/access';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import type { Project } from '../lib/types';
import type { ProjectTab } from '../providers/UiProvider';

/** Shown instead of a page the person has no access to: says why, who can use it, and what to do next. */
export function AccessModal({ access, project, tab }: { access: Extract<Access, { ok: false }>; project: Project; tab: ProjectTab }) {
  const { server, online, toast } = useSession();
  const { go } = useUi();
  const back = () => go({ page: 'project', project: project.uuid, tab: 'overview' });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) back(); }}>
      <div className="dialog access" role="alertdialog" aria-modal="true" aria-labelledby="acc-t" aria-describedby="acc-d">
        <span className="acc-ic"><Icon name="lock-fill" /></span>
        <h2 id="acc-t">{access.title}</h2>
        <p id="acc-d" className="muted">{access.reason}</p>
        <div className="well acc-meta">
          <div><span className="label-cap">Page</span><b className="ink">{access.feature}</b></div>
          <div><span className="label-cap">Your role</span><b className="ink capitalize">{project.role}</b></div>
          <div><span className="label-cap">Needed</span><b className="ink">{access.need}</b></div>
        </div>
        <div className="acc-actions">
          {access.web && <button className="btn" disabled={!online} title={online ? '' : 'Connect to the internet first'} onClick={() => openUrl(webUrl(server, project.uuid, tab)).catch(() => toast('Could not open the website.', 'error'))}><Icon name="box-arrow-up-right" />Open on the website</button>}
          <button className="btn btn-primary" autoFocus onClick={back}><Icon name="arrow-left" />Back to Overview</button>
        </div>
        <p className="help">Ask the project owner to change your role if you need this page.</p>
      </div>
    </div>
  );
}
