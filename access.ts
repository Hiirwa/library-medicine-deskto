// Who may open which project page. These lists mirror the website's permission matrix (app/Libraries/Permissions.php):
//   analysis.view / charts.manage → owner, researcher, viewer      reports.manage, data.export, data.import, members.manage → owner, researcher
// The server stays the final authority: a request it refuses is refused here too (see AccessModal's "Open on the website").
import type { Project } from './types';
import type { ProjectTab } from '../providers/UiProvider';

const OWNER_RESEARCHER = ['owner', 'researcher'];
const ANALYSIS = ['owner', 'researcher', 'viewer'];

/** Roles allowed on each page; pages not listed are open to every role of the project. */
export const TAB_ROLES: Partial<Record<ProjectTab, { roles: string[]; why: string; need: string }>> = {
  statistics: { roles: ANALYSIS, why: 'Statistics shows analysis of everyone’s records, so it is available to owners, researchers and viewers.', need: 'Owner, Researcher or Viewer' },
  workbench: { roles: ANALYSIS, why: 'The workbench analyses everyone’s records, so it is available to owners, researchers and viewers.', need: 'Owner, Researcher or Viewer' },
  dashboard: { roles: ANALYSIS, why: 'The dashboard charts everyone’s records, so it is available to owners, researchers and viewers.', need: 'Owner, Researcher or Viewer' },
  reports: { roles: OWNER_RESEARCHER, why: 'Reports are built and shared by the project’s owners and researchers.', need: 'Owner or Researcher' },
  export: { roles: OWNER_RESEARCHER, why: 'Exporting data is limited to the project’s owners and researchers.', need: 'Owner or Researcher' },
  sharing: { roles: OWNER_RESEARCHER, why: 'Sharing and the team are managed by the project’s owners and researchers.', need: 'Owner or Researcher' },
};

/** Page of the same name on librarymedicine.online (path after /p/<project>/). */
export const WEB_PATH: Partial<Record<ProjectTab, string>> = { overview: '', statistics: 'analysis', workbench: 'workbench', dashboard: 'dashboard', reports: 'reports', data: 'data', variables: 'variables', forms: 'forms', sharing: 'members', import: 'import', export: 'export' };
export const webUrl = (server: string, project: string, tab: ProjectTab) => `${server.replace(/\/$/, '')}/p/${project}/${WEB_PATH[tab] ?? ''}`.replace(/\/$/, '');

const LABEL: Partial<Record<ProjectTab, string>> = { statistics: 'Statistics', workbench: 'Workbench', dashboard: 'Dashboard', reports: 'Reports', import: 'Import', export: 'Export', sharing: 'Sharing' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Access = { ok: true } | { ok: false; feature: string; title: string; reason: string; need: string; web: boolean };

export function checkAccess(tab: ProjectTab, p: Project): Access {
  const feature = LABEL[tab] ?? cap(tab);
  const rule = TAB_ROLES[tab];
  if (rule && !rule.roles.includes(p.role)) {
    return { ok: false, feature, title: `${feature} is not available to your role`, reason: `You are a ${cap(p.role)} in this project. ${rule.why}`, need: rule.need, web: true };
  }
  if (tab === 'import') {
    if (!OWNER_RESEARCHER.includes(p.role)) return { ok: false, feature, title: 'Import is not available to your role', reason: `You are a ${cap(p.role)} in this project. Importing data is limited to the project’s owners and researchers.`, need: 'Owner or Researcher', web: true };
    if (p.status !== 'active') return { ok: false, feature, title: 'This project is archived', reason: 'Records cannot be imported into an archived project. You can still read and export its data.', need: 'An active project', web: false };
    if (!p.can.add) return { ok: false, feature, title: 'You cannot add records here', reason: `Importing creates new records, and your role (${cap(p.role)}) is not allowed to add records to this project.`, need: 'Permission to add records', web: false };
  }
  return { ok: true };
}
