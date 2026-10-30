import { Suspense, lazy, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Empty, PageSkeleton } from '../components/ui';
import { useProjects } from '../components/Shell';
import * as store from '../lib/db';
import { useUi, type ProjectTab } from '../providers/UiProvider';
import { OverviewView } from './OverviewView';
import { AccessModal } from '../components/AccessModal';
import { checkAccess } from '../lib/access';
import { DataView } from './DataView';
import { VariablesView } from './VariablesView';
import { FilesView, FormsView } from './FormsFilesViews';
import type { Form, Project, Variable } from '../lib/types';

const load = {
  statistics: () => import('./StatisticsView'), workbench: () => import('./WorkbenchView'), dashboard: () => import('./DashboardView'),
  reports: () => import('./ReportsView'), import: () => import('./ImportView'), export: () => import('./ExportView'),
};
const StatisticsView = lazy(() => load.statistics().then((m) => ({ default: m.StatisticsView })));
const WorkbenchView = lazy(() => load.workbench().then((m) => ({ default: m.WorkbenchView })));
const DashboardView = lazy(() => load.dashboard().then((m) => ({ default: m.DashboardView })));
const ReportsView = lazy(() => load.reports().then((m) => ({ default: m.ReportsView })));
const ImportView = lazy(() => load.import().then((m) => ({ default: m.ImportView })));
const ExportView = lazy(() => load.export().then((m) => ({ default: m.ExportView })));

export type ProjectWithCounts = Project & { records: number; pending: number };
export interface ProjectCtx { project: ProjectWithCounts; vars: Variable[]; forms: Form[] }

export function ProjectView({ uuid, tab }: { uuid: string; tab: ProjectTab }) {
  const projects = useProjects();
  const { go } = useUi();
  const project = projects.data?.find((p) => p.uuid === uuid);
  const vars = useQuery({ queryKey: ['variables', uuid], queryFn: () => store.getVariables(uuid) });
  const forms = useQuery({ queryKey: ['forms', uuid], queryFn: () => store.listForms(uuid) });
  // warm up the other tabs while the app is idle so they open instantly
  useEffect(() => { const id = window.setTimeout(() => Object.values(load).forEach((f) => { f(); }), 1200); return () => window.clearTimeout(id); }, []);
  if (projects.isLoading) return <PageSkeleton />;
  if (!project) {
    return <div className="card"><Empty icon="folder-x" title="This project is not on this computer"><span>It may have been removed from your account. Sync to refresh the list.</span><button className="btn btn-primary mt-2" onClick={() => go({ page: 'home' })}>Back to my projects</button></Empty></div>;
  }
  if (!vars.data || !forms.data) return <PageSkeleton />;
  const ctx: ProjectCtx = { project, vars: vars.data, forms: forms.data };
  const access = checkAccess(tab, project);
  if (!access.ok) return <><OverviewView {...ctx} /><AccessModal access={access} project={project} tab={tab} /></>;
  return <Suspense fallback={<PageSkeleton />}>{render(tab, ctx)}</Suspense>;
}

function render(tab: ProjectTab, ctx: ProjectCtx) {
  switch (tab) {
    case 'data': return <DataView {...ctx} />;
    case 'variables': return <VariablesView {...ctx} />;
    case 'forms': return <FormsView {...ctx} />;
    case 'files': return <FilesView {...ctx} />;
    case 'statistics': return <StatisticsView {...ctx} />;
    case 'workbench': return <WorkbenchView {...ctx} />;
    case 'dashboard': return <DashboardView {...ctx} />;
    case 'reports': return <ReportsView {...ctx} />;
    case 'import': return <ImportView {...ctx} />;
    case 'export': return <ExportView {...ctx} />;
    default: return <OverviewView {...ctx} />;
  }
}
