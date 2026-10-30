// Who may open which project page. Edit the lists below to match the website's rules.
// The server stays the final authority: a request it refuses is refused here too (see AccessModal's "Open on the website").
import type { Project } from './types';
import type { ProjectTab } from '../providers/UiProvider';

/** Roles allowed to open the analysis pages (Statistics, Workbench, Dashboard, Reports). */
export const ANALYSIS_ROLES = ['owner', 'researcher'];

/** Page of the same name on librarymedicine.online (path after /p/<project>/). */
export const WEB_PATH: Partial<Record<ProjectTab, string>> = { overview: '', statistics: 'analysis', workbench: 'workbench', dashboard: 'dashboard', reports: 'reports', data: 'data', variables: 'variables', forms: 'forms' };
export const webUrl = (server: string, project: string, tab: ProjectTab) => `${server.replace(/\/$/, '')}/p/${project}/${WEB_PATH[tab] ?? ''}`.replace(/\/$/, '');

const LABEL: Partial<Record<ProjectTab, string>> = { statistics: 'Statistics', workbench: 'Workbench', dashboard: 'Dashboard', reports: 'Reports', import: 'Import' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Access = { ok: true } | { ok: false; feature: string; title: string; reason: string; need: string; web: boolean };

export function checkAccess(tab: ProjectTab, p: Project): Access {
  const feature = LABEL[tab] ?? cap(tab);
  if (['statistics', 'workbench', 'dashboard', 'reports'].includes(tab) && !ANALYSIS_ROLES.includes(p.role)) {
    return { ok: false, feature, title: `${feature} is not available to your role`, reason: `You are a ${cap(p.role)} in this project. ${feature} shows analysis of everyone’s records, so it is limited to the project’s owners and researchers.`, need: 'Owner or Researcher', web: true };
  }
  if (tab === 'import') {
    if (p.status !== 'active') return { ok: false, feature, title: 'This project is archived', reason: 'Records cannot be imported into an archived project. You can still read and export its data.', need: 'An active project', web: false };
    if (!p.can.add) return { ok: false, feature, title: 'You cannot add records here', reason: `Importing creates new records, and your role (${cap(p.role)}) is not allowed to add records to this project.`, need: 'Permission to add records', web: false };
  }
  return { ok: true };
}
