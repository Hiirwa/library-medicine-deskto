import { StickyColumns } from '../components/StickyColumns';
import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { CardTitle, Empty, Icon, PageHead } from '../components/ui';
import { useSession } from '../providers/AppProvider';
import { SHORTCUTS } from './SettingsView';
import { HelpWebInfo } from '../components/HelpWebInfo';

const STEPS: [string, string, string][] = [
  ['arrow-repeat', 'Sync once while online', 'Your projects, forms, variables and records are downloaded to this computer.'],
  ['wifi-off', 'Work anywhere', 'Enter and edit records without internet. Everything is saved on this computer immediately.'],
  ['send', 'Changes go up by themselves', 'When the connection is back, the app sends your changes and receives everyone else’s.'],
  ['check2-circle', 'Check the Sync centre', 'See what is waiting, what was refused and the history of every sync.'],
];

const GUIDE: { id: string; icon: string; title: string; text: string; points: string[] }[] = [
  { id: 'project', icon: 'speedometer2', title: 'Project', text: 'Understand the project before collecting data.', points: ['Overview: status, data quality, health checklist and shortcuts.', 'Variables: the codebook with types, rules and answer options.', 'Forms: preview each form’s structure and fill it in.'] },
  { id: 'analysis', icon: 'graph-up-arrow', title: 'Analysis', text: 'Analyse the records stored on this computer.', points: ['Statistics: completeness, mean, SD, quartiles and distributions per variable.', 'Workbench: frequencies, cross-tabs with χ², group comparison with ANOVA, correlation.', 'Dashboard: live charts you can customise. Reports: print, save as HTML or Markdown.'] },
  { id: 'data', icon: 'database-gear', title: 'Data management', text: 'Look at, bring in and take out records.', points: ['Data view: search, sort, choose columns, select rows and export or delete them.', 'Import: CSV or JSON, with column matching and row-by-row checks before saving.', 'Export: CSV with labels or codes, JSON, codebook and a complete data package.'] },
];

const FAQ: { topic: string; q: string; a: string }[] = [
  { topic: 'Sync', q: 'What happens if two people change the same record?', a: 'The most recent change wins (it is compared by the time each change was saved). If the server copy is newer, it replaces yours and the app tells you.' },
  { topic: 'Sync', q: 'Why was my change refused?', a: 'The server checks permissions and the rules of the project (required questions, ranges, closed data collection…). Open the record from the Sync centre to see the reason, fix it and save again.' },
  { topic: 'Sync', q: 'Do imported records go to the server?', a: 'Yes. Imported records are queued like any other record and sent at the next sync.' },
  { topic: 'Data', q: 'Where are attachments stored?', a: 'In Documents\\Library Medicine on this computer. Files you attach offline are uploaded at the next sync.' },
  { topic: 'Data', q: 'How should my import file look?', a: 'The first row holds column names. Use “Download template” on the Import page for the exact names. Answers can be option labels or codes; dates as YYYY-MM-DD; multiple choices separated by ;' },
  { topic: 'Data', q: 'Can I change variables or forms here?', a: 'No — the design of a project is managed on the website. The desktop app downloads the latest version at every sync.' },
  { topic: 'Analysis', q: 'Are the statistics based on all records?', a: 'They use the records on this computer. Sync first so that records from other collectors are included. You can restrict an analysis to complete records.' },
  { topic: 'Analysis', q: 'How do I put results in a report?', a: 'Press “Pin to report” in Statistics or the Workbench, then open Reports and keep the “Pinned analyses” section switched on.' },
  { topic: 'Sharing', q: 'How do I share a form or invite a colleague?', a: 'Open Sharing in the project menu (owners and researchers). Forms & links lets you choose who can submit, copy the public link and show its QR code. Team lets you invite people by email, change roles and choose which forms a data collector can fill. It needs an internet connection.' },
  { topic: 'Sharing', q: 'Why can I not invite more people?', a: 'Each plan allows a number of owners, researchers, data collectors and viewers per project. Open invitations count too. The counters at the top of Sharing show what is used; upgrade your plan on the website to add more.' },
  { topic: 'Security', q: 'Is my data safe on this computer?', a: 'The API token is kept in the Windows Credential Manager. Signing out removes the token and the offline copy.' },
  { topic: 'Security', q: 'Who can see personal-data questions?', a: 'Only roles allowed by the project owner. If your role cannot see them, they are hidden in the data table, analysis, reports and exports.' },
];
const TOPICS = ['All', 'Sync', 'Data', 'Analysis', 'Sharing', 'Security'] as const;

export function HelpView() {
  const { server } = useSession();
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>('All');
  const [guide, setGuide] = useState('analysis');
  const faq = useMemo(() => FAQ.filter((f) => (topic === 'All' || f.topic === topic) && (!q.trim() || `${f.q} ${f.a}`.toLowerCase().includes(q.trim().toLowerCase()))), [q, topic]);
  const g = GUIDE.find((x) => x.id === guide)!;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHead icon="book" tone="teal" title="Help & documentation" sub="How the desktop app works">
        <button className="btn btn-primary" onClick={() => openUrl(`${server}/docs`)}><Icon name="box-arrow-up-right" />Full documentation</button>
      </PageHead>
      <section className="card p-5 anim-in">
        <CardTitle icon="signpost-split" title="Working offline in four steps" />
        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
          {STEPS.map(([ic, t, d], i) => (
            <div key={t} className="well p-4"><div className="flex items-center gap-2"><span className="count" style={{ background: 'var(--rh-brand)' }}>{i + 1}</span><Icon name={ic} className="text-lg" /></div><b className="mt-2 block ink">{t}</b><p className="muted mt-1 text-sm">{d}</p></div>
          ))}
        </div>
      </section>
      <section className="card p-5 anim-in">
        <CardTitle icon="compass" tone="k-teal" title="Tour of a project" sub="Pick an area to see what it offers" />
        <div className="seg mt-4">{GUIDE.map((x) => <button key={x.id} className={guide === x.id ? 'on' : ''} onClick={() => setGuide(x.id)}><Icon name={x.icon} />{x.title}</button>)}</div>
        <div className="well mt-3 p-4" key={g.id}><b className="ink block">{g.text}</b><ul className="mt-2 space-y-2">{g.points.map((p) => <li key={p} className="flex gap-2 text-sm"><Icon name="check-circle-fill" className="mt-0.5 text-[var(--rh-teal)]" /><span>{p}</span></li>)}</ul></div>
      </section>
      <StickyColumns className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 22rem' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="question-circle" title="Questions and answers" />
          <div className="toolbar mt-3" style={{ boxShadow: 'none', padding: 0, background: 'transparent' }}>
            <div className="field-ic min-w-[12rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search the help…" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></div>
            <div className="seg">{TOPICS.map((t) => <button key={t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>{t}</button>)}</div>
          </div>
          <div className="mt-3 space-y-2">
            {faq.map((f) => (
              <details key={f.q} className="well px-4 py-3"><summary className="cursor-pointer font-bold ink">{f.q} <span className="chip ml-1">{f.topic}</span></summary><p className="muted mt-2 text-sm selectable">{f.a}</p></details>
            ))}
            {!faq.length && <Empty icon="search" title="No answer found"><span>Try other words or contact support.</span></Empty>}
          </div>
        </section>
        <div className="space-y-4">
        <section className="card p-5 anim-in">
            <CardTitle icon="keyboard" title="Shortcuts" />
            <div className="mt-3 space-y-2">
              {SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="flex-1">{d}</span>{k.split(' / ').map((x) => <kbd key={x}>{x}</kbd>)}</div>)}
            </div>
            <button className="btn mt-5 w-full" onClick={() => openUrl(`${server}/contact`)}><Icon name="envelope" />Contact support</button>
          </section>
          <HelpWebInfo />
        </div>
      </StickyColumns>
    </div>
  );
}
