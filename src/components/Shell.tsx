import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ask } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Brand } from './Brand';
import { Dropdown, Icon } from './ui';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { ago, shortDate } from '../lib/time';
import { initials } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import { useUi, type ProjectTab, type Route } from '../providers/UiProvider';

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: store.listProjects });

const TAB_LABEL: Record<ProjectTab, string> = { overview: 'Overview', data: 'Data', variables: 'Variables', forms: 'Forms', files: 'Files' };
const PAGE_LABEL: Record<string, string> = { home: 'My projects', sync: 'Sync centre', settings: 'Settings', help: 'Help & documentation' };

function NavItem({ icon, label, active, onClick, end, title }: { icon: string; label: string; active?: boolean; onClick: () => void; end?: ReactNode; title?: string }) {
  return (
    <button type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} title={title ?? label} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} /><span className="txt">{label}</span>{end && <span className="nav-end">{end}</span>}
    </button>
  );
}

function Sidebar() {
  const { route, go, collapsed, currentProject } = useUi();
  const { user, server, signOut, sync } = useSession();
  const projects = useProjects();
  const pending = useQuery({ queryKey: ['pending'], queryFn: store.outboxCount });
  const pid = route.page === 'project' ? route.project : currentProject;
  const project = projects.data?.find((p) => p.uuid === pid) ?? null;
  const stats = useQuery({ queryKey: ['pstats', project?.uuid], queryFn: () => store.projectStats(project!.uuid), enabled: !!project });
  const forms = useQuery({ queryKey: ['forms', project?.uuid], queryFn: () => store.listForms(project!.uuid), enabled: !!project });
  const tab = route.page === 'project' ? route.tab : null;
  const toProject = (t: ProjectTab) => project && go({ page: 'project', project: project.uuid, tab: t });

  async function doSignOut() {
    const n = pending.data ?? 0;
    if (n > 0) {
      const first = await ask(`${n} record${n === 1 ? ' has' : 's have'} not been sent yet. Signing out now would lose ${n === 1 ? 'it' : 'them'}. Sync first?`, { title: 'Unsent changes', kind: 'warning', okLabel: 'Sync first', cancelLabel: 'Sign out anyway' });
      if (first) { await sync(); return; }
    } else if (!(await ask('Sign out and remove the offline copy of your data from this computer?', { title: 'Sign out', kind: 'info', okLabel: 'Sign out' }))) return;
    await signOut();
  }

  return (
    <aside className={`sb ${collapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
      <div className="sb-brand" onClick={() => go({ page: 'home' })} title="My projects"><Brand /></div>
      <div className="sb-scroll">
        <NavItem icon="grid-1x2" label="My projects" active={route.page === 'home'} onClick={() => go({ page: 'home' })} />
        <NavItem icon="arrow-repeat" label="Sync centre" active={route.page === 'sync'} onClick={() => go({ page: 'sync' })}
          end={pending.data ? <span className="count" title={`${pending.data} waiting to send`}>{pending.data}</span> : undefined} />

        {project && (
          <>
            <div className="sb-project anim-in">
              <Dropdown align="left" width="100%" button={(_o, toggle) => (
                <div className="pc-head" onClick={toggle} title="Switch project">
                  <span className="pc-ic"><Icon name="clipboard2-pulse" /></span>
                  <div className="min-w-0 flex-1"><div className="pc-title">{project.title}</div><div className="pc-kind">Research project</div></div>
                  <Icon name="chevron-down" className="mt-1 text-sm" />
                </div>
              )}>
                {(close) => (
                  <>
                    <div className="mh">Switch project</div>
                    {projects.data?.map((p) => (
                      <button key={p.uuid} onClick={() => { close(); go({ page: 'project', project: p.uuid, tab: tab ?? 'overview' }); }}>
                        <Icon name={p.uuid === project.uuid ? 'check2' : 'folder2'} /><span className="truncate">{p.title}</span>
                      </button>
                    ))}
                  </>
                )}
              </Dropdown>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip chip-brand"><Icon name="person-badge" />{project.role.charAt(0).toUpperCase() + project.role.slice(1)}</span>
                {project.status !== 'active' && <span className="chip chip-warn"><Icon name="archive" />Archived</span>}
              </div>
              <div className="pc-stats">
                <button className="pc-stat" onClick={() => toProject('data')} title="Records on this computer">
                  <Icon name="database-fill" /><b>{stats.data?.total ?? '–'}</b><small>Records</small>{!!stats.data?.today && <em>+{stats.data.today}</em>}
                </button>
                <button className="pc-stat" onClick={() => go({ page: 'sync' })} title="Changes waiting to be sent">
                  <Icon name="send-fill" /><b>{stats.data?.toSend ?? 0}</b><small>To send</small>{!!stats.data?.refused && <em className="warn">!{stats.data.refused}</em>}
                </button>
                <button className="pc-stat" onClick={() => toProject('forms')} title="Data-entry forms">
                  <Icon name="ui-checks-grid" /><b>{forms.data?.length ?? 0}</b><small>Forms</small>
                </button>
              </div>
            </div>
            <div className="nav-label">Project</div>
            <NavItem icon="speedometer2" label="Overview" active={tab === 'overview'} onClick={() => toProject('overview')} />
            <NavItem icon="diagram-3" label="Variables" active={tab === 'variables'} onClick={() => toProject('variables')} />
            <NavItem icon="ui-checks-grid" label="Forms" active={tab === 'forms'} onClick={() => toProject('forms')} />
            <div className="nav-label">Data</div>
            <NavItem icon="table" label="Data" active={tab === 'data'} onClick={() => toProject('data')} />
            <NavItem icon="paperclip" label="Files" active={tab === 'files'} onClick={() => toProject('files')} />
          </>
        )}
        <div className="h-3" />
        <NavItem icon="gear" label="Settings" active={route.page === 'settings'} onClick={() => go({ page: 'settings' })} />
        <NavItem icon="book" label="Help & documentation" active={route.page === 'help'} onClick={() => go({ page: 'help' })} />
      </div>
      <Dropdown style={{ left: '.8rem', right: '.8rem', bottom: 'calc(100% + .4rem)' }} button={(open, toggle) => (
        <button type="button" className="sb-user" onClick={toggle} aria-expanded={open}>
          <span className="avatar">{initials(user?.name || user?.email)}</span>
          <span className="u-txt min-w-0 flex-1"><b className="block truncate" style={{ color: 'var(--rh-brand)' }}>{user?.name || user?.email}</b><span className="muted block truncate text-xs">{user?.email}</span></span>
          <Icon name={open ? 'chevron-down' : 'chevron-up'} className="muted" />
        </button>
      )}>
        {(close) => (
          <>
            <div className="mh">Signed in to {new URL(server).host}</div>
            <button onClick={() => { close(); native.revealLocal(); }}><Icon name="folder2-open" />Open workspace folder</button>
            <button onClick={() => { close(); openUrl(server); }}><Icon name="box-arrow-up-right" />Open the website</button>
            <button onClick={() => { close(); go({ page: 'settings' }); }}><Icon name="gear" />Settings</button>
            <hr />
            <button className="danger" onClick={() => { close(); doSignOut(); }}><Icon name="box-arrow-right" />Sign out</button>
          </>
        )}
      </Dropdown>
    </aside>
  );
}

function Topbar() {
  const { route, go, toggleSidebar, dark, setTheme, setPalette } = useUi();
  const { online, syncing, sync, server } = useSession();
  const projects = useProjects();
  const project = route.page === 'project' ? projects.data?.find((p) => p.uuid === route.project) : null;
  return (
    <header className="tb">
      <button className="btn btn-icon btn-sm" onClick={toggleSidebar} title="Show or hide the menu (Ctrl+B)" aria-label="Toggle menu"><Icon name="layout-sidebar" /></button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <button onClick={() => go({ page: 'home' })}>Projects</button>
        {route.page === 'project' ? (
          <>
            <span className="sep">|</span>
            <button onClick={() => go({ page: 'project', project: route.project, tab: 'overview' })} title={project?.title}>{project?.title ?? 'Project'}</button>
            {route.tab !== 'overview' && <><span className="sep">|</span><span className="here">{TAB_LABEL[route.tab]}</span></>}
          </>
        ) : (
          <><span className="sep">|</span><span className="here">{PAGE_LABEL[route.page]}</span></>
        )}
      </nav>
      <button className="btn btn-sm btn-soft" onClick={() => setPalette(true)} title="Search projects, records and pages (Ctrl+K)"><Icon name="search" /><span>Search</span><kbd>Ctrl K</kbd></button>
      <span className={`netpill ${online ? 'on' : 'off'}`} title={online ? `Connected to ${server}` : `Cannot reach ${server}. Changes are saved on this computer.`}>
        <span className="dot" />{online ? 'Online' : 'Offline'}
      </span>
      <button className="btn btn-primary" onClick={() => sync()} disabled={!online || syncing} title={online ? 'Send and receive changes (F5)' : 'Connect to the internet to sync'}>
        <Icon name="arrow-repeat" className={syncing ? 'spin' : ''} />{syncing ? 'Syncing…' : 'Sync now'}
      </button>
      <button className="btn btn-icon" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Light theme' : 'Dark theme'} aria-label="Toggle theme"><Icon name={dark ? 'sun' : 'moon-stars'} /></button>
    </header>
  );
}

function StatusBar() {
  const { lastSync, lastResult, settings } = useSession();
  const pending = useQuery({ queryKey: ['pending'], queryFn: store.outboxCount });
  const fstats = useQuery({ queryKey: ['fstats'], queryFn: store.fileStats });
  const log = useQuery({ queryKey: ['synclog'], queryFn: () => store.syncLog(20) });
  return (
    <footer className="statusbar">
      <span><Icon name="clock-history" />Last sync <b>{ago(lastSync)}</b>{lastResult && !lastResult.ok && <span style={{ color: 'var(--rh-danger)' }}> · {lastResult.error ?? 'some changes refused'}</span>}</span>
      <span><Icon name="send" />Waiting to send <b style={pending.data ? { color: 'var(--rh-warning)' } : undefined}>{pending.data ?? 0}</b></span>
      <span><Icon name="paperclip" />Files offline <b>{fstats.data?.offline ?? 0}/{fstats.data?.total ?? 0}</b>{fstats.data?.waiting ? ` · ${fstats.data.waiting} to upload` : ''}</span>
      <span><Icon name="stopwatch" />Auto-sync <b>{settings.autoSyncMin ? `every ${settings.autoSyncMin} min` : 'off'}</b></span>
      <span className="flex-1" />
      {log.data?.[0] && <span className="truncate" title={log.data.map((l) => `${shortDate(l.at)} — ${l.summary}`).join('\n')}>{log.data[0].summary}</span>}
    </footer>
  );
}

/** Keyboard shortcuts for the whole app. */
function useShortcuts() {
  const { route, go, back, toggleSidebar, setPalette, openEditor, editor, palette } = useUi();
  const { sync, online } = useSession();
  const projects = useProjects();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'F5' || (ctrl && k === 'r')) { e.preventDefault(); if (online) sync(); return; } // never reload the window
      if (ctrl && k === 'k') { e.preventDefault(); setPalette(!palette); return; }
      if (editor || palette) return;
      if (ctrl && k === 'b') { e.preventDefault(); toggleSidebar(); return; }
      if (ctrl && e.key === ',') { e.preventDefault(); go({ page: 'settings' }); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); return; }
      if (ctrl && k === 'n' && route.page === 'project') {
        e.preventDefault();
        const p = projects.data?.find((x) => x.uuid === route.project);
        if (p?.can.add && p.status === 'active') openEditor({ project: p.uuid, record: null, form: null });
        return;
      }
      if (!typing && (e.key === '/' || (ctrl && k === 'f'))) {
        const s = document.getElementById('search') as HTMLInputElement | null;
        if (s) { e.preventDefault(); s.focus(); s.select(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, go, back, toggleSidebar, setPalette, openEditor, editor, palette, sync, online, projects.data]);
}

export function Shell({ children }: { children: ReactNode }) {
  useShortcuts();
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Topbar />
        {children}
        <StatusBar />
      </div>
    </div>
  );
}

export type { Route };
