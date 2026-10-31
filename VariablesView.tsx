import { Fragment, useMemo, useState } from 'react';
import { Ring } from '../components/charts';
import { Rich } from '../components/Rich';
import { htmlToText } from '../lib/html';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
import { HBars } from '../components/charts';
import { useRecords } from '../lib/hooks';
import { isAnswered } from '../lib/format';
import { codebookTable, saveCsv } from '../lib/csv';
import { plural, TYPE_ICON, TYPE_LABEL } from '../lib/format';
import { useSession } from '../providers/AppProvider';
import type { ProjectCtx } from './ProjectView';

/** Codebook: every variable with its type, rules and answer options — searchable and exportable. */
export function VariablesView({ project, vars }: ProjectCtx) {
  const { toast } = useSession();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [flag, setFlag] = useState<'' | 'required' | 'pii' | 'calculated' | 'options'>('');
  const records = useRecords(project.uuid);
  const total = records.data?.length ?? 0;
  const filled = useMemo(() => { const m = new Map<string, number>(); for (const r of records.data ?? []) for (const v of vars) if (isAnswered(r.data[v.name])) m.set(v.name, (m.get(v.name) ?? 0) + 1); return m; }, [records.data, vars]);
  const typeCounts = useMemo(() => { const m = new Map<string, number>(); for (const v of vars) m.set(v.type, (m.get(v.type) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t, n]) => ({ label: TYPE_LABEL[t] ?? t, value: n })); }, [vars]);
  const hasFlag = (v: (typeof vars)[number]) => !flag || (flag === 'required' ? v.required : flag === 'pii' ? v.is_pii : flag === 'calculated' ? v.type === 'calculated' : !!v.config?.options?.length);
  const types = useMemo(() => [...new Set(vars.map((v) => v.type))].sort(), [vars]);
  const list = vars.filter((v) => hasFlag(v) && (!type || v.type === type) && (!q.trim() || `${v.name} ${v.label ?? ''} ${v.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));

  async function exportCodebook() {
    try {
      const path = await saveCsv(`${project.title} - codebook`, codebookTable(vars));
      if (path) toast(`Codebook saved to ${path}`);
    } catch (e) { toast(`Export failed: ${String(e)}`, 'error'); }
  }

  return (
    <div className="space-y-4">
      <PageHead icon="diagram-3" title="Variables" sub={<>{plural(vars.length, 'variable')} · schema v{project.schema_version} · read-only on the desktop</>}>
        <button className="btn" onClick={exportCodebook}><Icon name="filetype-csv" />Export codebook</button>
      </PageHead>
      <div className="stats">
        <Stat icon="diagram-3" value={vars.length} label="Variables" active={flag === ''} onClick={() => setFlag('')} />
        <Stat icon="asterisk" value={vars.filter((v) => v.required).length} label="Required" tone="k-danger" active={flag === 'required'} onClick={() => setFlag(flag === 'required' ? '' : 'required')} />
        <Stat icon="shield-lock" value={vars.filter((v) => v.is_pii).length} label="Personal data" tone="k-warn" active={flag === 'pii'} onClick={() => setFlag(flag === 'pii' ? '' : 'pii')} />
        <Stat icon="calculator" value={vars.filter((v) => v.type === 'calculated').length} label="Calculated" tone="k-teal" active={flag === 'calculated'} onClick={() => setFlag(flag === 'calculated' ? '' : 'calculated')} />
        <Stat icon="ui-radios" value={vars.filter((v) => v.config?.options?.length).length} label="With options" tone="k-muted" active={flag === 'options'} onClick={() => setFlag(flag === 'options' ? '' : 'options')} />
      </div>
      <section className="card p-5 anim-in"><span className="label-cap">Question types</span><HBars data={typeCounts} /></section>
      <div className="toolbar">
        <div className="field-ic min-w-[16rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search name, label or description…" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></div>
        <div className="seg"><button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Icon name="table" />Table</button><button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}><Icon name="grid-3x3-gap" />Cards</button></div>
        <select className="field w-56" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
      </div>
      {view === 'cards' && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}>
          {list.map((v) => (
            <button key={v.name} type="button" className={`vcard anim-in ${open === v.name ? 'open' : ''}`} onClick={() => setOpen(open === v.name ? null : v.name)}>
              <span className="flex items-center gap-3"><span className="pk-ic"><Icon name={TYPE_ICON[v.type] ?? 'dot'} /></span><span className="min-w-0 flex-1"><b className="ink block truncate">{v.label || v.name}</b><small className="muted selectable">{v.name}</small></span>{total > 0 && <Ring size={46} value={((filled.get(v.name) ?? 0) / total) * 100} label="" />}</span>
              <span className="flex flex-wrap gap-1.5"><span className="chip chip-brand">{TYPE_LABEL[v.type] ?? v.type}</span>{v.required && <span className="chip chip-danger">Required</span>}{v.is_pii && <span className="chip chip-warn"><Icon name="shield-lock" />PII</span>}{!!v.config?.options?.length && <span className="chip">{plural(v.config.options.length, 'option')}</span>}</span>
              {open === v.name && <span className="well block p-3 text-sm selectable">{htmlToText(v.description || v.help_text) || 'No description.'}{!!v.config?.options?.length && <span className="mt-2 flex flex-wrap gap-1.5">{v.config.options.map((o) => <span key={o.value} className="chip"><b className="ink">{o.value}</b> = {o.label}</span>)}</span>}</span>}
            </button>
          ))}
          {!list.length && <Empty icon="search" title="No variable matches" />}
        </div>
      )}
      <div className={`tbl-wrap anim-in ${view === 'cards' ? 'hidden' : ''}`}>
        <table className="tbl">
          <thead><tr><th style={{ width: '3rem' }}>#</th><th>Name</th><th>Label</th><th>Type</th><th>Rules</th><th>Answered</th><th>Options</th><th style={{ width: '3rem' }} /></tr></thead>
          <tbody>
            {list.map((v) => (
              <Fragment key={v.name}>
                <tr className="click" onClick={() => setOpen(open === v.name ? null : v.name)}>
                  <td className="muted num">{vars.indexOf(v) + 1}</td>
                  <td className="link selectable">{v.name}</td>
                  <td title={v.label ?? ''}>{v.label}</td>
                  <td><span className="chip chip-brand"><Icon name={TYPE_ICON[v.type] ?? 'dot'} />{TYPE_LABEL[v.type] ?? v.type}</span></td>
                  <td><span className="flex gap-1">
                    {v.required && <span className="chip chip-danger">Required</span>}
                    {v.is_pii && <span className="chip chip-warn"><Icon name="shield-lock" />PII</span>}
                    {v.visibility === 'hidden' && <span className="chip">Hidden</span>}
                    {(v.config?.min !== undefined || v.config?.max !== undefined) && <span className="chip">{v.config.min ?? '…'}–{v.config.max ?? '…'}</span>}
                  </span></td>
                  <td style={{ minWidth: '7rem' }}>{total && v.type !== 'note' ? <div className="flex items-center gap-2 k-brand"><div className="bar flex-1"><i style={{ width: `${((filled.get(v.name) ?? 0) / total) * 100}%` }} /></div><b className="num text-sm">{Math.round(((filled.get(v.name) ?? 0) / total) * 100)}%</b></div> : <span className="muted">—</span>}</td>
                  <td className="muted">{v.config?.options?.length ? plural(v.config.options.length, 'option') : ''}</td>
                  <td><Icon name={open === v.name ? 'chevron-up' : 'chevron-down'} className="muted" /></td>
                </tr>
                {open === v.name && (
                  <tr><td colSpan={8} style={{ whiteSpace: 'normal', maxWidth: 'none', background: 'var(--rh-surface-2)' }}>
                    <div className="grid gap-4 py-2 selectable" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
                      <div><button className="btn btn-sm mb-3" onClick={() => { navigator.clipboard?.writeText(v.name); toast(`Copied ${v.name}`); }}><Icon name="clipboard" />Copy name</button><span className="label-cap">Description</span>{v.description ? <Rich html={v.description} /> : <p className="muted">—</p>}{v.help_text && <><span className="label-cap mt-3">Help text</span><Rich html={v.help_text} /></>}</div>
                      {!!v.config?.options?.length && (
                        <div><span className="label-cap">Answer options (code = label)</span>
                          <div className="flex flex-wrap gap-1.5">{v.config.options.map((o) => <span key={o.value} className="chip"><b className="ink">{o.value}</b> = {o.label}</span>)}</div>
                        </div>
                      )}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty icon="search" title="No variable matches" />}
      </div>
    </div>
  );
}
