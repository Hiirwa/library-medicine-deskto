// Descriptions written on the website can contain HTML (headings, lists, bold…). They are shown formatted, never as raw tags,
// and only a small safe set of tags is kept: no scripts, styles, event handlers or inline attributes.
const ALLOWED = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'A', 'BLOCKQUOTE', 'SUB', 'SUP', 'HR', 'CODE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

const LOOKS_HTML = /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i;

/** Text that was saved with its tags escaped (&lt;h3&gt;) is decoded first. */
function unescapeIfNeeded(src: string): string {
  if (LOOKS_HTML.test(src) || !/&lt;\/?[a-z]/i.test(src)) return src;
  const t = document.createElement('textarea');
  t.innerHTML = src;
  return t.value;
}

export const hasMarkup = (src: string | null | undefined) => !!src && LOOKS_HTML.test(unescapeIfNeeded(src));

function clean(node: Node, out: Node, doc: Document) {
  node.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) { out.appendChild(doc.createTextNode(n.textContent ?? '')); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (DROP.has(el.tagName)) return;
    if (!ALLOWED.has(el.tagName)) { clean(el, out, doc); return; } // unknown tag: keep its text
    const c = doc.createElement(el.tagName.toLowerCase());
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) { c.setAttribute('href', href); c.setAttribute('data-ext', '1'); c.setAttribute('rel', 'noopener noreferrer'); }
    }
    clean(el, c, doc);
    out.appendChild(c);
  });
}

/** Safe HTML string for innerHTML. */
export function sanitizeHtml(src: string | null | undefined): string {
  if (!src) return '';
  const text = unescapeIfNeeded(src);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const box = document.createElement('div');
  if (!LOOKS_HTML.test(text)) { // plain text: keep line breaks
    text.split(/\n{2,}/).forEach((para) => { const p = document.createElement('p'); p.textContent = para.trim(); if (p.textContent) box.appendChild(p); });
    return box.innerHTML;
  }
  clean(doc.body, box, document);
  // an empty <span> split like "<span>To ide</span><span>ntify" must stay joined: spans are inline, so nothing to do
  return box.innerHTML;
}

/** Plain text (for cards and tooltips): tags removed, blocks separated by spaces. */
export function htmlToText(src: string | null | undefined): string {
  if (!src) return '';
  const text = unescapeIfNeeded(src);
  if (!LOOKS_HTML.test(text)) return text.replace(/\s+/g, ' ').trim();
  const doc = new DOMParser().parseFromString(text.replace(/<\/(p|div|li|h[1-6]|ul|ol|blockquote)>|<br\s*\/?>/gi, ' $&'), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
