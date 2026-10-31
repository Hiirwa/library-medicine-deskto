// CSV / TSV reader for the Import page: quotes, escaped quotes, BOM, CRLF, and comma / semicolon / tab detection.
export function parseDelimited(input: string): { rows: string[][]; delimiter: string } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => { let n = 0; let q = false; for (const c of firstLine) { if (c === '"') q = !q; else if (c === d && !q) n++; } return n; };
  const delimiter = ([',', ';', '\t'] as const).reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows: rows.filter((r) => r.some((x) => x.trim() !== '')), delimiter };
}

/** A JSON file holding a list of flat objects becomes a table like a CSV. */
export function jsonToRows(text: string): string[][] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown[] })?.records;
  if (!Array.isArray(list) || !list.length) throw new Error('The JSON file must hold a list of records.');
  const flat = list.map((x) => { const o = (x && typeof x === 'object' ? ((x as { data?: unknown }).data && typeof (x as { data?: unknown }).data === 'object' ? { ...(x as object), ...((x as { data: object }).data) } : x) : {}) as Record<string, unknown>; return o; });
  const head = [...new Set(flat.flatMap((o) => Object.keys(o)))].filter((k) => k !== 'data');
  return [head, ...flat.map((o) => head.map((k) => { const v = o[k]; return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : String(v); }))];
}
