import { Fragment, useMemo, useState } from 'react';
import { Empty, Icon, PageHead, Stat } from '../components/ui';
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
  const types = useMemo(() => [...new Set(vars.map((v) => v.type))].sort(), [vars]);
  const list = vars.filter((v) => (!type || v.type === type) && (!q.trim() || `${v.name} ${v.label ?? ''} ${v.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));

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
        <Stat icon="diagram-3" value={vars.length} label="Variables" />
        <Stat icon="asterisk" value={vars.filter((v) => v.required).length} label="Required" tone="k-danger" />
        <Stat icon="shield-lock" value={vars.filter((v) => v.is_pii).length} label="Personal data" tone="k-warn" />
        <Stat icon="calculator" value={vars.filter((v) => v.type === 'calculated').length} label="Calculated" tone="k-teal" />
        <Stat icon="ui-radios" value={vars.filter((v) => v.config?.options?.length).length} label="With options" tone="k-muted" />
      </div>
      <div className="toolbar">
        <div className="field-ic min-w-[16rem] flex-1"><Icon name="search" /><input id="search" className="field" placeholder="Search name, label or description…" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></div>
        <select className="field w-56" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
      </div>
      <div className="tbl-wrap anim-in">
        <table className="tbl">
          <thead><tr><th style={{ width: '3rem' }}>#</th><th>Name</th><th>Label</th><th>Type</th><th>Rules</th><th>Options</th><th style={{ width: '3rem' }} /></tr></thead>
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
                  <td className="muted">{v.config?.options?.length ? plural(v.config.options.length, 'option') : ''}</td>
                  <td><Icon name={open === v.name ? 'chevron-up' : 'chevron-down'} className="muted" /></td>
                </tr>
                {open === v.name && (
                  <tr><td colSpan={7} style={{ whiteSpace: 'normal', maxWidth: 'none', background: 'var(--rh-surface-2)' }}>
                    <div className="grid gap-4 py-2 selectable" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
                      <div><span className="label-cap">Description</span><p>{v.description || <span className="muted">—</span>}</p>{v.help_text && <><span className="label-cap mt-3">Help text</span><p>{v.help_text}</p></>}</div>
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
