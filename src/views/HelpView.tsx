import { openUrl } from '@tauri-apps/plugin-opener';
import { CardTitle, Icon, PageHead } from '../components/ui';
import { useSession } from '../providers/AppProvider';
import { SHORTCUTS } from './SettingsView';

const STEPS: [string, string, string][] = [
  ['arrow-repeat', 'Sync once while online', 'Your projects, forms, variables and records are downloaded to this computer.'],
  ['wifi-off', 'Work anywhere', 'Enter and edit records without internet. Everything is saved on this computer immediately.'],
  ['send', 'Changes go up by themselves', 'When the connection is back, the app sends your changes and receives everyone else’s.'],
  ['check2-circle', 'Check the Sync centre', 'See what is waiting, what was refused and the history of every sync.'],
];

const FAQ: [string, string][] = [
  ['What happens if two people change the same record?', 'The most recent change wins (it is compared by the time each change was saved). If the server copy is newer, it replaces yours and the app tells you.'],
  ['Why was my change refused?', 'The server checks permissions and the rules of the project (required questions, ranges, closed data collection…). Open the record from the Sync centre to see the reason, fix it and save again.'],
  ['Where are attachments stored?', 'In Documents\\Library Medicine on this computer. Files you attach offline are uploaded at the next sync.'],
  ['Can I change variables or forms here?', 'No — the design of a project is managed on the website. The desktop app downloads the latest version at every sync.'],
  ['Is my data safe on this computer?', 'The API token is kept in the Windows Credential Manager. Signing out removes the token and the offline copy.'],
];

export function HelpView() {
  const { server } = useSession();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHead icon="book" tone="teal" title="Help & documentation" sub="How the desktop app works">
        <button className="btn btn-primary" onClick={() => openUrl(`${server}/docs`)}><Icon name="box-arrow-up-right" />Full documentation</button>
      </PageHead>
      <section className="card p-5 anim-in">
        <CardTitle icon="signpost-split" title="Working offline in four steps" />
        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
          {STEPS.map(([ic, t, d], i) => (
            <div key={t} className="well p-4">
              <div className="flex items-center gap-2"><span className="count" style={{ background: 'var(--rh-brand)' }}>{i + 1}</span><Icon name={ic} className="text-lg" /></div>
              <b className="mt-2 block ink">{t}</b><p className="muted mt-1 text-sm">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0, 1fr) 22rem' }}>
        <section className="card p-5 anim-in">
          <CardTitle icon="question-circle" title="Questions and answers" />
          <div className="mt-3 space-y-2">
            {FAQ.map(([q, a]) => (
              <details key={q} className="well px-4 py-3">
                <summary className="cursor-pointer font-bold ink">{q}</summary>
                <p className="muted mt-2 text-sm selectable">{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="card p-5 anim-in">
          <CardTitle icon="keyboard" title="Shortcuts" />
          <div className="mt-3 space-y-2">
            {SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="flex-1">{d}</span>{k.split(' / ').map((x) => <kbd key={x}>{x}</kbd>)}</div>)}
          </div>
          <button className="btn mt-5 w-full" onClick={() => openUrl(`${server}/contact`)}><Icon name="envelope" />Contact support</button>
        </section>
      </div>
    </div>
  );
}
