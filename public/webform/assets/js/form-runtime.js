/* Form runtime: renders a form layout, applies skip logic & formulas, validates, submits, works offline.
 * The same file runs in the Library Medicine desktop app (public/webform/), so forms look and behave the same on
 * both. Optional hooks used there: save(body, form) instead of posting to submitUrl, pickFile(variable) instead of the
 * browser file input, openFile(uuid) / fileLabel(uuid) for attached files, onChange(form) after every answer. */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // form description: plain text keeps its line breaks; formatted text (from the editor) is re-sanitised before display
  const richDesc = (d) => { const r = richInner(d); return r.rich ? `<div class="text-muted rt-content rf-desc">${r.html}</div>` : `<div class="text-muted" style="white-space:pre-line">${r.html}</div>`; };
  // Sanitised rich text: {rich: true, html} for editor HTML, {rich: false, html} (escaped) for plain text.
  const richInner = (d) => {
    d = String(d ?? '');
    if (!/<(?:[a-z][a-z0-9]*|\/[a-z][a-z0-9]*)[\s>\/]/i.test(d) || typeof DOMParser === 'undefined') return { rich: false, html: esc(d) };
    const ok = ['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'A', 'DIV', 'SPAN'];
    const doc = new DOMParser().parseFromString(`<div>${d}</div>`, 'text/html');
    const walk = (n) => {
      [...n.childNodes].forEach((c) => {
        if (c.nodeType === 8) { c.remove(); return; }
        if (c.nodeType !== 1) return;
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|SVG|MATH|TEMPLATE|FORM|INPUT|TEXTAREA|SELECT|BUTTON|IMG|VIDEO|AUDIO|LINK|META)$/.test(c.tagName)) { c.remove(); return; }
        walk(c);
        // colour: keep only safe colour / highlight styles (and turn <font color> into a span)
        const okc = (v) => (/^\s*(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))\s*$/i.test(v || '') ? v.trim() : null);
        let css = '';
        if (c.tagName === 'FONT' || c.tagName === 'SPAN') {
          if (c.tagName === 'FONT' && okc(c.getAttribute('color'))) css += 'color: ' + okc(c.getAttribute('color')) + ';';
          String(c.getAttribute('style') || '').split(';').forEach((d) => { const i = d.indexOf(':'); if (i < 0) return; const k = d.slice(0, i).trim().toLowerCase(), v = okc(d.slice(i + 1)); if ((k === 'color' || k === 'background-color') && v) css += k + ': ' + v + ';'; if (k === 'font-size') { const m = /^\s*(\d{1,2}(?:\.\d+)?)px\s*$/i.exec(d.slice(i + 1)); if (m && +m[1] >= 8 && +m[1] <= 72) css += 'font-size: ' + (+m[1]) + 'px;'; } });
          if (c.tagName === 'FONT') { const sp = doc.createElement('span'); sp.append(...c.childNodes); c.replaceWith(sp); c = sp; }
        }
        if (!ok.includes(c.tagName)) { c.replaceWith(...c.childNodes); return; }
        const href = c.tagName === 'A' ? (c.getAttribute('href') || '').trim() : '';
        [...c.attributes].forEach((a) => c.removeAttribute(a.name));
        if (css) c.setAttribute('style', css);
        if (c.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer nofollow'); }
      });
    };
    const root = doc.body.firstChild; walk(root);
    return { rich: true, html: root.innerHTML };
  };
  const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  // Calculated text results with categories: store the code, show the label (the formula may return either).
  const calcOpts = (v) => (v.config && v.config.result_type === 'text' && Array.isArray(v.config.options)) ? v.config.options : [];
  const calcCode = (v, val) => { const o = calcOpts(v); if (o.some((x) => String(x.value) === val)) return val; const m = o.find((x) => String(x.label || '').trim().toLowerCase() === val.trim().toLowerCase()); return m ? String(m.value) : val; };
  const calcLabel = (v, val) => { const m = calcOpts(v).find((x) => String(x.value) === String(val)); return m ? m.label : val; };
  // Severity words at the start of a category label (Severe / Moderate) are shown in red.
  const calcHtml = (v, val) => esc(calcLabel(v, val)).replace(/^(Severe|Moderate)\b/i, '<span class="rf-sev">$1</span>');
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

  // ------------------------------------------------------------------ offline queue (IndexedDB)
  const Offline = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
        const r = indexedDB.open('researchhub', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'id' }); };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async add(item) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').put(item); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async all() { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); },
    async remove(id) { const db = await this.open(); return new Promise((res) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').delete(id); tx.oncomplete = res; }); },
    syncing: false,
    async flush(onStatus) {
      if (this.syncing || !navigator.onLine) return;
      this.syncing = true;
      let ok = 0, failed = 0;
      try {
        for (const item of await this.all()) {
          try {
            const payload = JSON.parse(JSON.stringify(item.payload));
            for (const f of item.files || []) {
              const fd = new FormData(); fd.append('file', f.blob, f.name); fd.append('variable', f.variable);
              const r = await postForm(item.uploadUrl, fd, item.auth);
              if (f.repeat) payload.data[f.repeat][f.row][f.variable] = r.uuid; else payload.data[f.variable] = r.uuid;
            }
            await postJson(item.url, payload, item.auth);
            await this.remove(item.id); ok++;
          } catch (e) {
            if (e.status === 422 || e.status === 409) { item.error = e.message; await this.add(item); }
            failed++;
          }
        }
      } finally { this.syncing = false; }
      if (onStatus) onStatus(ok, failed);
      return { ok, failed };
    },
  };
  window.RHOffline = Offline;

  function csrfHeaders(auth) {
    const h = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
    if (auth) { const m = document.querySelector('meta[name="csrf-hash"]'); if (m) h['X-CSRF-TOKEN'] = m.content; }
    return h;
  }
  async function handle(res) {
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : { error: await res.text() };
    if (!res.ok) { const e = new Error(data.error || ('Request failed (' + res.status + ')')); e.status = res.status; e.data = data; throw e; }
    return data;
  }
  async function postJson(url, body, auth) {
    const h = csrfHeaders(auth); h['Content-Type'] = 'application/json';
    return handle(await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body), credentials: 'same-origin' }));
  }
  async function postForm(url, fd, auth) {
    if (auth) { const n = document.querySelector('meta[name="csrf-name"]'), m = document.querySelector('meta[name="csrf-hash"]'); if (n && m) fd.append(n.content, m.content); }
    return handle(await fetch(url, { method: 'POST', headers: csrfHeaders(auth), body: fd, credentials: 'same-origin' }));
  }

  // ------------------------------------------------------------------ form runtime
  class RHForm {
    constructor(el, opts) {
      this.el = el; this.o = opts;
      this.vars = {}; (opts.variables || []).forEach((v) => { this.vars[v.name] = v; });
      this.layout = (opts.form && opts.form.layout) || { pages: [] };
      this.pages = (this.layout.pages || []).filter((p) => (p.sections || []).length);
      this.settings = (opts.form && opts.form.settings) || {};
      this.data = Object.assign({}, opts.data || {});
      this.pending = {}; // pending file blobs when offline: key -> {blob,name}
      this.errors = {};
      this.pageIdx = 0; this.history = []; this.secPos = 0;
      this.stepping = (opts.mode === 'fill' || opts.mode === 'preview') && this.settings.section_steps !== false;
      this.consent = !(opts.consent && opts.consent.required);
      this.started = new Date().toISOString();
      this.draftKey = opts.draftKey || null;
      if (opts.mode !== 'edit' && opts.mode !== 'preview') this.applyDefaults();
      if (this.draftKey && opts.mode === 'fill') this.restoreDraft();
      this.recalc();
      this.render();
    }

    applyDefaults() {
      Object.values(this.vars).forEach((v) => {
        if (v.default !== null && v.default !== undefined && v.default !== '' && blank(this.data[v.name])) {
          let d = v.default;
          if (d === 'today' && v.type === 'date') d = today();
          if (v.type === 'checkbox') d = String(d).split(',').map((s) => s.trim());
          this.data[v.name] = d;
        }
      });
    }
    restoreDraft() {
      try { const d = JSON.parse(localStorage.getItem(this.draftKey) || 'null'); if (d && d.data) { this.data = Object.assign(this.data, d.data); this.restoredDraft = true; } } catch (e) { /* ignore */ }
    }
    saveDraft() { if (this.o.onChange) try { this.o.onChange(this); } catch (e) { /* host page */ } if (!this.draftKey || this.o.mode !== 'fill') return; try { localStorage.setItem(this.draftKey, JSON.stringify({ data: this.data, at: Date.now() })); } catch (e) { /* ignore */ } }
    clearDraft() { if (this.draftKey) try { localStorage.removeItem(this.draftKey); } catch (e) { /* ignore */ } }

    // ---- calculations & visibility
    calcOrder() {
      if (this._calcOrder) return this._calcOrder;
      const calc = Object.values(this.vars).filter((v) => v.type === 'calculated');
      const deps = {}; calc.forEach((v) => { try { deps[v.name] = RHFormula.references(v.config.formula || ''); } catch (e) { deps[v.name] = []; } });
      const order = [], state = {};
      const visit = (n) => { if (state[n]) return; state[n] = 1; (deps[n] || []).forEach((d) => { if (deps[d]) visit(d); }); order.push(this.vars[n]); };
      Object.keys(deps).forEach(visit);
      return (this._calcOrder = order);
    }
    computeInto(ctx, onlyNames) {
      for (const v of this.calcOrder()) {
        if (onlyNames && !onlyNames.includes(v.name)) continue;
        let val = RHFormula.tryEvaluate(v.config.formula || '', ctx);
        const rt = v.config.result_type || 'number';
        if (val === null || val === '' || (typeof val === 'number' && !Number.isFinite(val))) val = null;
        else if (rt === 'number') {
          if (typeof val === 'boolean') val = val ? 1 : 0;
          const n = Number(val);
          if (Number.isNaN(n)) val = null; else { const d = v.config.decimals ?? 2; const f = Math.pow(10, +d); val = Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f; }
        } else if (rt === 'text') val = calcCode(v, typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val));
        if (val === null) delete ctx[v.name]; else ctx[v.name] = val;
      }
      return ctx;
    }
    recalc() { this.computeInto(this.data); }
    visible(v, ctx) { return RHConditions.evaluate(v.condition, ctx || this.data); }

    pageVisitPath() {
      const idx = {}; this.pages.forEach((p, i) => { idx[p.id] = i; });
      return { idx };
    }
    nextPageIndex(i) {
      const p = this.pages[i];
      if (!p) return null;
      for (const j of p.jumps || []) {
        if (RHConditions.evaluate(j.condition, this.data)) {
          if (j.target === 'end') return null;
          const t = this.pages.findIndex((x) => x.id === j.target);
          if (t > i) return t;
        }
      }
      return i + 1 < this.pages.length ? i + 1 : null;
    }

    // ---- rendering

    // principal investigator, ethics approval and study period under the form title
    metaHtml() {
      const m = this.o.meta; if (!m) return '';
      const st = { active: ['Ongoing', 'on'], upcoming: ['Upcoming', 'soon'], closed: ['Completed', 'end'] }[m.state] || null;
      const per = (m.start || m.end) ? `${esc(m.start || 'open')} \u2192 ${esc(m.end || 'open')}` : '';
      const day = (iso) => { const p = String(iso || '').split('-').map(Number); return p.length === 3 && p[0] ? Date.UTC(p[0], p[1] - 1, p[2]) / 864e5 : null; };
      const card = (cls, ic, label, val, extra = '', tag = 'div', attrs = '') => `<${tag} class="rf-mi ${cls}" ${attrs}><span class="rf-mi-ic"><i class="bi bi-${ic}"></i></span><span class="rf-mi-bd"><small>${label}</small><b>${val}</b>${extra}</span></${tag}>`;
      let h = '';
      if (m.pi) {
        const ini = String(m.pi).trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
        h += card('rf-mi-pi', 'person-badge', 'Principal investigator', esc(m.pi)) .replace('<i class="bi bi-person-badge"></i>', ini ? `<em class="rf-av">${esc(ini)}</em>` : '<i class="bi bi-person-badge"></i>');
      }
      if (per) {
        let prog = '';
        const s0 = day(m.start_iso), e0 = day(m.end_iso), t0 = Math.floor(Date.now() / 864e5);
        if (s0 !== null && e0 !== null && e0 > s0 && m.state) {
          const pct = Math.max(0, Math.min(100, Math.round(((t0 - s0) / (e0 - s0)) * 100)));
          const left = Math.max(0, e0 - t0), to = Math.max(0, s0 - t0);
          const fmt = (n) => n >= 60 ? `${Math.round(n / 30.44)} mo` : `${n} d`;
          const note = m.state === 'upcoming' ? `Starts in ${fmt(to)}` : m.state === 'closed' ? 'Ended' : `${pct}% \u00b7 ${fmt(left)} left`;
          prog = `<span class="rf-prog"><span class="rf-bar" style="--p:${m.state === 'upcoming' ? 0 : pct}%"><i></i></span><span class="rf-mi-sub">${note}</span></span>`;
        }
        h += card('rf-mi-per', 'calendar-range', 'Collecting data...', `<span class="rf-row"><span class="rf-dates">${per}</span>${st ? `<span class="rf-st ${st[1]}">${st[0]}</span>` : ''}${prog}</span>`);
      }
      return h ? `<div class="rf-meta">${h}</div>` : '';
    }

    render() {
      const f = this.o.form || {};
      const total = this.pages.length;
      const page = this.pages[this.pageIdx];
      const isLast = this.nextPageIndex(this.pageIdx) === null;
      let h = '';
      if (this.o.mode !== 'edit') {
        h += `<div class="rf-header"><h1 class="h3 fw-bold mb-1">${esc(f.title || 'Form')}</h1>${this.pageIdx === 0 ? this.metaHtml() : ''}${f.description ? `<div class="rf-intro${this.pageIdx === 0 ? '' : ' rf-step-off'}">${richDesc(f.description)}</div>` : ''}
          ${this.o.mode === 'preview' ? '<div class="badge text-bg-warning mt-2">Preview: submissions are not saved</div>' : ''}
          ${this.restoredDraft ? '<div class="small text-success mt-2"><i class="bi bi-arrow-counterclockwise"></i> Restored your unsent answers. <a href="#" data-act="discard">Start over</a></div>' : ''}
          ${this.settings.show_progress !== false && (total > 1 || this.stepping) ? `<div class="d-flex align-items-center gap-2 mt-3 small text-muted rf-prog-wrap"><div class="progress rf-progress flex-grow-1"><div class="progress-bar bg-primary" style="width:${Math.round(((this.pageIdx + 1) / total) * 100)}%"></div></div><span class="rf-prog-txt">Page ${this.pageIdx + 1} of ${total}</span></div>` : ''}
        </div>`;
      }
      if (this.pageIdx === 0 && this.o.consent && this.o.consent.required && this.o.mode === 'fill') {
        h += `<div class="rf-section rf-consent${this.consent ? ' agreed' : ''}">
          <div class="rfc-head"><span class="rfc-ic"><i class="bi bi-shield-check"></i></span><div class="rfc-tt"><h3>Informed consent</h3><div class="rfc-sub">Please read this information carefully before you begin.</div></div><span class="rfc-badge">Required</span></div>
          ${(this.o.consent.text || '').trim() ? `<div class="rfc-doc" tabindex="0">${((r) => `<div class="rfc-text${r.rich ? ' rt-content is-rich' : ''}">${r.html}</div>`)(richInner(this.o.consent.text))}</div>` : ''}
          <div class="rfc-points"><span><i class="bi bi-hand-thumbs-up"></i>Participation is voluntary</span><span><i class="bi bi-box-arrow-left"></i>You may withdraw at any time</span><span><i class="bi bi-lock"></i>Your answers are kept confidential</span></div>
          <label class="rfc-agree" for="rfConsent"><input class="form-check-input" type="checkbox" id="rfConsent" ${this.consent ? 'checked' : ''}><span class="rfc-agree-t"><strong>I have read the information above and agree to take part.</strong><small>Your consent is recorded with the date and time of your response.</small></span></label>
          ${this.errors._consent ? `<div class="err rf-field">${esc(this.errors._consent)}</div>` : ''}</div>`;
      }
      if (!page) h += '<div class="rf-section text-muted">This form has no questions yet.</div>';
      else {
        if (total > 1 && (page.title || page.description)) h += `<div class="mb-2 px-1 rf-page-head"><h2 class="h5 fw-bold mb-0">${esc(page.title || '')}</h2>${page.description ? `<div class="text-muted small">${esc(page.description)}</div>` : ''}</div>`;
        (page.sections || []).forEach((s) => { h += this.sectionHtml(s); });
      }
      h += `<input type="text" name="website" class="d-none" tabindex="-1" autocomplete="off" aria-hidden="true">`;
      const backBtn = '<button class="btn btn-light" data-act="back"><i class="bi bi-arrow-left"></i> Previous</button>';
      const submitBtn = `<button class="btn btn-primary btn-lg" data-act="submit">${this.o.mode === 'edit' ? '<i class="bi bi-check2"></i> Save changes' : '<i class="bi bi-send"></i> Submit'}</button>`;
      const nextBtn = '<button class="btn btn-primary btn-lg" data-act="next">Next <i class="bi bi-arrow-right"></i></button>';
      h += `<div class="d-flex justify-content-between align-items-center mb-5 gap-2 rf-nav">
        <div>${this.stepping || this.history.length ? backBtn : ''}</div>
        <div class="d-flex gap-2 align-items-center">${this.errors._form ? `<span class="text-danger small">${esc(this.errors._form)}</span>` : ''}
        ${this.stepping ? nextBtn + submitBtn : (isLast ? submitBtn : nextBtn)}</div></div>`;
      this.el.innerHTML = h;
      this.bind();
      this.refreshVisibility();
      if (this.jumpToError) { this.jumpToError = false; this.gotoErrorSection(); }
      this.applyStep();
    }

    sectionHtml(s) {
      const items = s.items || [];
      if (!items.length && !s.title && !s.description) return '';
      if (s.repeat && s.key) {
        const rows = Array.isArray(this.data[s.key]) ? this.data[s.key] : (this.data[s.key] = []);
        if (!rows.length && (+s.repeat_min || 0) > 0) for (let i = 0; i < +s.repeat_min; i++) rows.push({});
        return `<div class="rf-section" data-section="${esc(s.id)}"><h3>${esc(s.title || '')}</h3>${s.description ? `<p class="text-muted small">${esc(s.description)}</p>` : ''}
          ${rows.map((row, ri) => `<div class="rf-repeat-row" data-repeat="${esc(s.key)}" data-row="${ri}">
              <div class="d-flex justify-content-between align-items-center mb-1"><strong class="small text-muted">${esc(s.item_label || 'Entry')} ${ri + 1}</strong>
              <button type="button" class="btn btn-sm btn-link text-danger" data-act="rm-row" data-key="${esc(s.key)}" data-row="${ri}"><i class="bi bi-x-lg"></i> Remove</button></div>
              ${this.gridWrap(s, items.map((it) => this.itemHtml(it, { key: s.key, row: ri })).join(''))}</div>`).join('')}
          ${this.errors[s.key] ? `<div class="err small text-danger mb-2">${esc(this.errors[s.key])}</div>` : ''}
          ${!s.repeat_max || rows.length < +s.repeat_max ? `<button type="button" class="btn btn-sm btn-outline-primary" data-act="add-row" data-key="${esc(s.key)}"><i class="bi bi-plus"></i> Add ${esc((s.item_label || 'entry').toLowerCase())}</button>` : ''}
        </div>`;
      }
      return `<div class="rf-section" data-section="${esc(s.id)}">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${s.description ? `<p class="text-muted small mb-2">${esc(s.description)}</p>` : ''}${this.gridWrap(s, items.map((it) => this.itemHtml(it)).join(''))}</div>`;
    }
    gridWrap(s, html) { const n = +s.columns || 1; return n > 1 ? `<div class="rf-grid" style="--cols:${n}">${html}</div>` : html;
    }

    fid(name, rep) { return 'rf_' + (rep ? `${rep.key}_${rep.row}_` : '') + name; }

    itemHtml(it, rep) {
      if (it.type === 'note') return `<div class="rf-field ${it.width === 'auto' ? '' : 'rf-span'}"><div class="rf-note" style="white-space:pre-line">${esc(it.text || '')}</div></div>`;
      if (it.type === 'heading') return `<div class="rf-field ${it.width === 'auto' ? '' : 'rf-span'}"><h5 class="mb-0">${esc(it.text || '')}</h5></div>`;
      const v = this.vars[it.var];
      if (!v || v.visibility === 'hidden') return '';
      const val = rep ? (this.data[rep.key][rep.row] || {})[v.name] : this.data[v.name];
      const id = this.fid(v.name, rep);
      const errKey = rep ? `${rep.key}.${rep.row}.${v.name}` : v.name;
      const err = this.errors[errKey];
      const ro = v.visibility === 'readonly' || this.o.mode === 'readonly';
      const label = it.label || v.label;
      return `<div class="rf-field ${err ? 'has-error' : ''} ${it.width === 'full' ? 'rf-span' : ''}" data-var="${esc(v.name)}" ${rep ? `data-rkey="${esc(rep.key)}" data-rrow="${rep.row}"` : ''}>
        <label class="rf-label" for="${id}">${esc(label)}${v.required && v.type !== 'calculated' ? '<span class="req">*</span>' : ''}</label>
        ${this.inputHtml(v, val, id, ro)}
        ${v.help_text ? `<div class="help">${esc(v.help_text)}</div>` : ''}
        <div class="err">${err ? esc(err) : ''}</div></div>`;
    }

    inputHtml(v, val, id, ro) {
      const c = v.config || {}, dis = ro ? 'disabled' : '';
      const units = c.units ? `<span class="input-group-text">${esc(c.units)}</span>` : '';
      const opts = (c.options || []);
      const has = (x) => x !== undefined && x !== null && x !== '';
      const range = has(c.min) && has(c.max) ? ` between ${c.min} and ${c.max}` : has(c.min) ? ` (min ${c.min})` : has(c.max) ? ` (max ${c.max})` : '';
      const autoPh = { text: 'Type your answer', textarea: 'Type your answer here' + '\u2026',
        integer: 'Enter a whole number' + range, decimal: 'Enter a number' + range,
        date: 'Select a date', time: 'Select a time', datetime: 'Select date and time' }[v.type] || '';
      const ph = (c.placeholder || autoPh) ? `placeholder="${esc(c.placeholder || autoPh)}"` : '';
      const other = (cur) => c.allow_other ? `<input class="form-control form-control-sm mt-1 rf-other" data-for="${id}" placeholder="Other (specify)" value="${esc(cur)}" ${dis}>` : '';
      const resolve = (b) => (b === 'today' ? today() : (b || ''));
      switch (v.type) {
        case 'text': return `<input class="form-control" id="${id}" value="${esc(val)}" ${ph} ${c.max_length ? `maxlength="${+c.max_length}"` : ''} ${dis}>`;
        case 'textarea': return `<textarea class="form-control" id="${id}" rows="${+c.rows || 3}" ${ph} ${dis}>${esc(val)}</textarea>`;
        case 'integer': case 'decimal':
          return `<div class="input-group" style="max-width:320px"><input type="number" inputmode="${v.type === 'integer' ? 'numeric' : 'decimal'}" class="form-control" id="${id}" value="${esc(val)}" step="${v.type === 'integer' ? 1 : 'any'}" ${c.min !== undefined && c.min !== '' ? `min="${esc(c.min)}"` : ''} ${c.max !== undefined && c.max !== '' ? `max="${esc(c.max)}"` : ''} ${ph} ${dis}>${units}</div>`;
        case 'date': return `<input type="date" class="form-control" style="max-width:220px" id="${id}" ${ph} value="${esc(val)}" min="${esc(resolve(c.min))}" max="${esc(resolve(c.max))}" ${dis}>`;
        case 'time': return `<input type="time" class="form-control" style="max-width:160px" id="${id}" ${ph} value="${esc(val)}" ${dis}>`;
        case 'datetime': return `<input type="datetime-local" class="form-control" style="max-width:260px" id="${id}" ${ph} value="${esc(String(val || '').replace(' ', 'T'))}" ${dis}>`;
        case 'boolean': {
          const cls = c.inline !== false ? 'form-check-inline' : '';
          return [['1', c.true_label || 'Yes'], ['0', c.false_label || 'No']].map(([k, l]) => `<div class="form-check ${cls}"><input class="form-check-input" type="radio" name="${id}" id="${id}_${k}" value="${k}" ${String(val) === k ? 'checked' : ''} ${dis}><label class="form-check-label" for="${id}_${k}">${esc(l)}</label></div>`).join('');
        }
        case 'radio': {
          const known = opts.some((o) => String(o.value) === String(val));
          const cls = c.inline ? 'form-check-inline' : '';
          return opts.map((o, i) => `<div class="form-check ${cls}"><input class="form-check-input" type="radio" name="${id}" id="${id}_${i}" value="${esc(o.value)}" ${String(val) === String(o.value) ? 'checked' : ''} ${dis}><label class="form-check-label" for="${id}_${i}">${esc(o.label)}</label></div>`).join('') + other(!known && !blank(val) ? val : '');
        }
        case 'dropdown': {
          const known = opts.some((o) => String(o.value) === String(val));
          return `<select class="form-select" id="${id}" style="max-width:480px" ${dis}><option value="">Select option</option>${opts.map((o) => `<option value="${esc(o.value)}" ${String(val) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` + other(!known && !blank(val) ? val : '');
        }
        case 'checkbox': {
          const arr = Array.isArray(val) ? val.map(String) : [];
          const extra = arr.filter((x) => !opts.some((o) => String(o.value) === x));
          const cls = c.inline ? 'form-check-inline' : '';
          return opts.map((o, i) => `<div class="form-check ${cls}"><input class="form-check-input rf-cb" type="checkbox" data-group="${id}" id="${id}_${i}" value="${esc(o.value)}" ${arr.includes(String(o.value)) ? 'checked' : ''} ${dis}><label class="form-check-label" for="${id}_${i}">${esc(o.label)}</label></div>`).join('') + other(extra.join(', '));
        }
        case 'likert':
          return `<div class="rf-likert">${opts.map((o, i) => `<label for="${id}_${i}"><input type="radio" name="${id}" id="${id}_${i}" value="${esc(o.value)}" ${String(val) === String(o.value) ? 'checked' : ''} ${dis}><span>${esc(o.label)}</span></label>`).join('')}</div>`;
        case 'rating': {
          const max = +c.max || 5;
          if (c.style === 'slider') return `<div class="d-flex align-items-center gap-3" style="max-width:480px">${c.min_label ? `<span class="small text-muted">${esc(c.min_label)}</span>` : ''}<input type="range" class="form-range" id="${id}" min="0" max="${max}" step="${+c.step || 1}" value="${blank(val) ? 0 : esc(val)}" ${dis}><span class="badge text-bg-primary fs-6 rf-range-val">${blank(val) ? '\u2013' : esc(val)}</span></div>`;
          return `<div class="rf-stars" id="${id}" data-max="${max}" ${ro ? 'data-ro="1"' : ''}>${Array.from({ length: max }, (_, i) => `<i class="bi bi-star-fill ${+val >= i + 1 ? 'on' : ''}" data-v="${i + 1}"></i>`).join('')}</div>${!ro ? ` <button type="button" class="btn btn-sm btn-link rf-clear-stars" data-for="${id}">clear</button>` : ''}`;
        }
        case 'file': {
          const acc = (c.accept || []).includes('any') ? '' : (c.accept || []).map((a) => ({ image: 'image/*', pdf: '.pdf,application/pdf', csv: '.csv,.xlsx,.xls,text/csv' }[a])).filter(Boolean).join(',');
          const pend = this.pending[id];
          return `<input type="file" class="form-control" id="${id}" accept="${acc}" ${dis} style="max-width:420px">
            <div class="small mt-1 rf-file-status">${val ? `<i class="bi bi-paperclip"></i> ${esc((this.o.fileLabel && this.o.fileLabel(val)) || 'File attached')}${this.o.openFile ? ` \u00B7 <a href="#" class="rf-file-open" data-uuid="${esc(val)}">open</a>` : (this.o.fileUrl ? ` \u00B7 <a href="${this.o.fileUrl}/${esc(val)}" target="_blank">open</a>` : '')} \u00B7 <a href="#" class="rf-file-clear" data-for="${id}">remove</a>` : (pend ? `<i class="bi bi-cloud-slash"></i> ${esc(pend.name)}: will upload when online` : '')}</div>`;
        }
        case 'gps': {
          const g = val && typeof val === 'object' ? val : null;
          return `<div class="d-flex flex-wrap gap-2 align-items-center"><button type="button" class="btn btn-outline-primary btn-sm rf-gps" data-for="${id}" ${dis}><i class="bi bi-crosshair"></i> Capture location</button>
            <input class="form-control form-control-sm mono" style="max-width:260px" id="${id}" placeholder="lat, lng" value="${g ? esc(g.lat + ', ' + g.lng) : ''}" ${dis}>
            ${g && g.acc ? `<span class="small text-muted">\u00B1${esc(g.acc)} m</span>` : ''}</div>`;
        }
        case 'calculated': {
          const show = blank(val) ? '<span class="text-muted fw-normal rf-calc-wait">Calculating\u2026</span>' : calcHtml(v, val);
          return `<div class="rf-calc-wrap${c.units ? ' has-unit' : ''}"><span class="rf-calc" id="${id}">${show}</span>${c.units ? `<span class="rf-calc-unit">${esc(c.units)}</span>` : ''}</div>`;
        }
      }
      return '';
    }

    // ---- read values from inputs
    setVal(name, rep, value) {
      if (rep) { const rows = this.data[rep.key]; rows[rep.row] = rows[rep.row] || {}; if (blank(value)) delete rows[rep.row][name]; else rows[rep.row][name] = value; }
      else if (blank(value)) delete this.data[name]; else this.data[name] = value;
    }
    readField(wrap) {
      const name = wrap.dataset.var, v = this.vars[name];
      const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null;
      const id = this.fid(name, rep), el = document.getElementById(id);
      let val;
      switch (v.type) {
        case 'boolean': case 'radio': case 'likert': {
          const r = wrap.querySelector(`input[name="${id}"]:checked`); val = r ? r.value : '';
          const oth = wrap.querySelector('.rf-other'); if (oth && oth.value.trim() && !r) val = oth.value.trim();
          break;
        }
        case 'dropdown': { val = el.value; const oth = wrap.querySelector('.rf-other'); if (oth && oth.value.trim() && !val) val = oth.value.trim(); break; }
        case 'checkbox': {
          val = [...wrap.querySelectorAll('.rf-cb:checked')].map((x) => x.value);
          const oth = wrap.querySelector('.rf-other'); if (oth && oth.value.trim()) oth.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => val.push(s));
          break;
        }
        case 'datetime': val = el.value ? el.value.replace('T', ' ').slice(0, 16) : ''; break;
        case 'integer': case 'decimal': val = el.value === '' ? '' : Number(el.value); if (Number.isNaN(val)) val = el.value; break;
        case 'rating': if (v.config.style === 'slider') val = el.value === '' ? '' : Number(el.value); else return; break;
        case 'gps': {
          const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(el.value);
          const prev = rep ? (this.data[rep.key][rep.row] || {})[name] : this.data[name];
          val = m ? { lat: +m[1], lng: +m[2], ...(prev && prev.acc && prev.lat === +m[1] ? { acc: prev.acc } : {}) } : (el.value.trim() ? el.value : '');
          break;
        }
        case 'file': case 'calculated': return;
        default: val = el ? el.value : '';
      }
      this.setVal(name, rep, val);
    }

    onChange(wrap) {
      this.readField(wrap);
      const name = wrap.dataset.var;
      if (this.errors[name]) { delete this.errors[name]; wrap.classList.remove('has-error'); wrap.querySelector('.err').textContent = ''; }
      this.recalc();
      this.refreshVisibility();
      this.saveDraft();
    }

    refreshVisibility() {
      this.el.querySelectorAll('.rf-field[data-var]').forEach((wrap) => {
        const v = this.vars[wrap.dataset.var];
        let ctx = this.data;
        if (wrap.dataset.rkey !== undefined) {
          const row = (this.data[wrap.dataset.rkey] || [])[+wrap.dataset.rrow] || {};
          ctx = this.computeInto(Object.assign({}, this.data, row));
          if (v.type === 'calculated') { const rr = this.data[wrap.dataset.rkey][+wrap.dataset.rrow]; if (!blank(ctx[v.name])) rr[v.name] = ctx[v.name]; else delete rr[v.name]; }
        }
        const show = this.visible(v, ctx);
        wrap.style.display = show ? '' : 'none';
        if (v.type === 'calculated') {
          const el = wrap.querySelector('.rf-calc'); const val = ctx[v.name];
          if (el) el.innerHTML = blank(val) ? '<span class="text-muted fw-normal rf-calc-wait">Calculating\u2026</span>' : calcHtml(v, val);
        }
      });
      // hide sections with no visible fields
      this.el.querySelectorAll('.rf-section[data-section]').forEach((s) => {
        const fields = s.querySelectorAll('.rf-field[data-var]');
        if (!fields.length || s.querySelector('[data-repeat]') || s.querySelector('[data-act="add-row"]')) return;
        s.style.display = [...fields].some((f) => f.style.display !== 'none') || s.querySelector('.rf-note') ? '' : 'none';
      });
      if (this.stepApplied) this.applyStep();
    }

    // ---- section-by-section steps (Previous / Next inside a page)
    stepSecs() { return [...this.el.querySelectorAll('.rf-section[data-section]')].filter((x) => x.style.display !== 'none'); }
    hasConsentStep() { return this.stepping && this.pageIdx === 0 && !!this.el.querySelector('.rf-consent'); }
    steps() { const c = this.hasConsentStep() ? [this.el.querySelector('.rf-consent')] : []; return c.concat(this.stepSecs()); }
    totalSteps() {
      const n = (p) => (p.sections || []).filter((x) => (x.items || []).length || x.title || x.description).length || 1;
      let before = 0; for (let i = 0; i < this.pageIdx; i++) before += n(this.pages[i]);
      let all = 0; this.pages.forEach((p) => { all += n(p); });
      if (this.o.mode === 'fill' && this.o.consent && this.o.consent.required) { all += 1; if (this.pageIdx > 0) before += 1; }
      return { before, all };
    }
    applyStep() {
      this.stepApplied = true;
      const secs = this.steps();
      const nav = this.el.querySelector('.rf-nav'); if (!nav) return;
      const bBack = nav.querySelector('[data-act="back"]'), bNext = nav.querySelector('[data-act="next"]'), bSub = nav.querySelector('[data-act="submit"]');
      const pageLast = this.nextPageIndex(this.pageIdx) === null;
      if (this.stepping) {
        if (this.secPos >= secs.length) this.secPos = Math.max(0, secs.length - 1);
        if (this.secPos < 0) this.secPos = 0;
        this.el.querySelectorAll('.rf-section[data-section], .rf-consent').forEach((x) => x.classList.toggle('rf-step-off', secs[this.secPos] !== x));
        const firstSec = this.hasConsentStep() ? 1 : 0;
        const pageHead = this.el.querySelector('.rf-page-head'); if (pageHead) pageHead.classList.toggle('rf-step-off', this.secPos !== firstSec);
        // the form description is an introduction: shown on the first screen only
        const intro = this.el.querySelector('.rf-intro'); if (intro) intro.classList.toggle('rf-step-off', !(this.pageIdx === 0 && this.secPos === 0));
        const lastStep = pageLast && this.secPos >= secs.length - 1;
        if (bNext) bNext.classList.toggle('d-none', lastStep);
        if (bSub) bSub.classList.toggle('d-none', !lastStep);
        if (bBack) bBack.classList.toggle('d-none', !(this.secPos > 0 || this.history.length));
        const t = this.totalSteps(), cur = Math.min(t.all, t.before + this.secPos + 1), all = Math.max(t.all, cur);
        const bar = this.el.querySelector('.rf-progress .progress-bar'); if (bar) bar.style.width = Math.round((cur / all) * 100) + '%';
        const txt = this.el.querySelector('.rf-prog-txt'); if (txt) txt.textContent = `Section ${cur} of ${all}`;
        const pw = this.el.querySelector('.rf-prog-wrap'); if (pw) pw.classList.toggle('d-none', all < 2);
      }
      // informed consent not accepted yet: every navigation button stays inactive
      const locked = this.o.mode === 'fill' && this.o.consent && this.o.consent.required && !this.consent;
      [bBack, bNext, bSub].forEach((b) => { if (b) { b.disabled = !!locked; b.classList.toggle('rf-locked', !!locked); b.title = locked ? 'Please accept the informed consent first' : ''; } });
      nav.classList.toggle('rf-nav-locked', !!locked);
    }
    gotoErrorSection() {
      if (!this.stepping) return;
      const secs = this.steps();
      if (this.errors._consent) { this.secPos = 0; return; }
      const i = secs.findIndex((x) => !x.classList.contains('rf-consent') && x.querySelector('.has-error, .err:not(:empty)'));
      if (i >= 0) this.secPos = i;
    }
    scrollTopOfForm() { const top = this.el.getBoundingClientRect().top + window.scrollY - 90; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); }

    bind() {
      const root = this.el;
      root.querySelectorAll('.rf-field[data-var]').forEach((wrap) => {
        const v = this.vars[wrap.dataset.var];
        const handler = () => this.onChange(wrap);
        wrap.querySelectorAll('input:not([type=file]), select, textarea').forEach((el) => {
          el.addEventListener(el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', handler);
          if (el.type === 'range') el.addEventListener('input', () => { const b = wrap.querySelector('.rf-range-val'); if (b) b.textContent = el.value; });
        });
        if (v.type === 'checkbox' && (v.config.exclusive || []).length) {
          wrap.querySelectorAll('.rf-cb').forEach((cb) => cb.addEventListener('change', () => {
            if (!cb.checked) return;
            const ex = v.config.exclusive.map(String);
            wrap.querySelectorAll('.rf-cb').forEach((o) => { if (o !== cb && (ex.includes(cb.value) || ex.includes(o.value))) o.checked = false; });
            this.onChange(wrap);
          }));
        }
        if (v.type === 'radio' || v.type === 'dropdown') {
          const oth = wrap.querySelector('.rf-other');
          if (oth) oth.addEventListener('input', () => { if (oth.value.trim()) { wrap.querySelectorAll('input[type=radio]').forEach((r) => { r.checked = false; }); const s = wrap.querySelector('select'); if (s) s.value = ''; } this.onChange(wrap); });
        }
        if (v.type === 'rating' && v.config.style !== 'slider') {
          const stars = wrap.querySelector('.rf-stars');
          if (stars && !stars.dataset.ro) {
            stars.querySelectorAll('i').forEach((s) => s.addEventListener('click', () => {
              const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null;
              this.setVal(v.name, rep, +s.dataset.v); stars.querySelectorAll('i').forEach((x) => x.classList.toggle('on', +x.dataset.v <= +s.dataset.v));
              this.recalc(); this.refreshVisibility(); this.saveDraft();
            }));
            const clr = wrap.querySelector('.rf-clear-stars');
            if (clr) clr.addEventListener('click', () => { const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null; this.setVal(v.name, rep, ''); stars.querySelectorAll('i').forEach((x) => x.classList.remove('on')); this.recalc(); this.refreshVisibility(); });
          }
        }
        if (v.type === 'file') {
          const inp = wrap.querySelector('input[type=file]');
          if (inp) inp.addEventListener('change', () => this.uploadFile(wrap, inp));
          if (inp && this.o.pickFile) inp.addEventListener('click', async (e) => { // desktop app: the computer's own file picker
            e.preventDefault();
            const r = await this.o.pickFile(v.name); if (!r) return;
            const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null;
            this.setVal(v.name, rep, r.uuid);
            wrap.querySelector('.rf-file-status').innerHTML = `<i class="bi bi-check-circle text-success"></i> ${esc(r.name)} attached`;
            this.onChange(wrap);
          });
          const opn = wrap.querySelector('.rf-file-open');
          if (opn) opn.addEventListener('click', (e) => { e.preventDefault(); this.o.openFile(opn.dataset.uuid); });
          const clr = wrap.querySelector('.rf-file-clear');
          if (clr) clr.addEventListener('click', (e) => { e.preventDefault(); const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null; this.setVal(v.name, rep, ''); delete this.pending[inp.id]; wrap.querySelector('.rf-file-status').innerHTML = ''; inp.value = ''; });
        }
        if (v.type === 'gps') {
          const b = wrap.querySelector('.rf-gps');
          if (b) b.addEventListener('click', () => {
            if (!navigator.geolocation) { RHFormToast('Location is not available on this device.'); return; }
            b.disabled = true; b.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Locating\u2026';
            navigator.geolocation.getCurrentPosition((pos) => {
              const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null;
              const g = { lat: +pos.coords.latitude.toFixed(7), lng: +pos.coords.longitude.toFixed(7), acc: Math.round(pos.coords.accuracy * 10) / 10 };
              this.setVal(v.name, rep, g); wrap.querySelector('input.mono').value = g.lat + ', ' + g.lng;
              b.disabled = false; b.innerHTML = '<i class="bi bi-check2"></i> Captured (\u00B1' + g.acc + ' m)'; this.saveDraft();
            }, (err) => { b.disabled = false; b.innerHTML = '<i class="bi bi-crosshair"></i> Capture location'; RHFormToast('Could not get location: ' + err.message); }, { enableHighAccuracy: true, timeout: 20000 });
          });
        }
      });
      const consent = root.querySelector('#rfConsent');
      if (consent) consent.addEventListener('change', () => { this.consent = consent.checked; delete this.errors._consent; const box = consent.closest('.rf-consent'); if (box) { box.classList.toggle('agreed', consent.checked); const er = box.querySelector('.err'); if (er && consent.checked) er.remove(); } this.applyStep(); });
      root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        const a = b.dataset.act;
        if (a === 'next') this.next();
        if (a === 'back') this.back();
        if (a === 'submit') this.submit();
        if (a === 'discard') { this.clearDraft(); this.data = {}; this.restoredDraft = false; this.applyDefaults(); this.recalc(); this.render(); }
        if (a === 'add-row') { this.collectPage(); (this.data[b.dataset.key] = this.data[b.dataset.key] || []).push({}); this.render(); }
        if (a === 'rm-row') { this.collectPage(); this.data[b.dataset.key].splice(+b.dataset.row, 1); this.recalc(); this.render(); }
      }));
    }

    async uploadFile(wrap, inp) {
      const file = inp.files[0]; if (!file) return;
      const v = this.vars[wrap.dataset.var];
      const max = (+v.config.max_mb || 10) * 1048576;
      const st = wrap.querySelector('.rf-file-status');
      if (file.size > max) { st.innerHTML = `<span class="text-danger">File is larger than ${v.config.max_mb || 10} MB.</span>`; inp.value = ''; return; }
      const rep = wrap.dataset.rkey !== undefined ? { key: wrap.dataset.rkey, row: +wrap.dataset.rrow } : null;
      if (!navigator.onLine || !this.o.uploadUrl) {
        this.pending[inp.id] = { blob: file, name: file.name, variable: v.name, repeat: rep ? rep.key : null, row: rep ? rep.row : null };
        st.innerHTML = `<i class="bi bi-cloud-slash"></i> ${esc(file.name)}: will upload when online`;
        return;
      }
      st.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Uploading\u2026';
      try {
        const fd = new FormData(); fd.append('file', file); fd.append('variable', v.name);
        const r = await postForm(this.o.uploadUrl, fd, this.o.auth);
        this.setVal(v.name, rep, r.uuid); delete this.pending[inp.id];
        st.innerHTML = `<i class="bi bi-check-circle text-success"></i> ${esc(file.name)} uploaded`;
        this.saveDraft();
      } catch (e) {
        if (!e.status) { this.pending[inp.id] = { blob: file, name: file.name, variable: v.name, repeat: rep ? rep.key : null, row: rep ? rep.row : null }; st.innerHTML = `<i class="bi bi-cloud-slash"></i> ${esc(file.name)}: will upload when online`; } else st.innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
      }
    }

    collectPage() { this.el.querySelectorAll('.rf-field[data-var]').forEach((w) => this.readField(w)); this.recalc(); }

    validatePage(onlySec) {
      this.collectPage();
      const errs = {};
      const page = this.pages[this.pageIdx];
      const check = (v, val, key, ctx) => {
        if (!this.visible(v, ctx) || v.type === 'calculated' || v.visibility !== 'visible') return;
        const c = v.config || {};
        if (blank(val)) { if (v.required) errs[key] = 'This field is required.'; return; }
        if ((v.type === 'integer' || v.type === 'decimal' || v.type === 'rating') && typeof val === 'number') {
          if (v.type === 'integer' && !Number.isInteger(val)) errs[key] = 'Must be a whole number.';
          if (c.min !== undefined && c.min !== '' && val < +c.min) errs[key] = `Must be \u2265 ${c.min}.`;
          if (c.max !== undefined && c.max !== '' && val > +c.max) errs[key] = `Must be \u2264 ${c.max}.`;
        } else if (v.type === 'integer' || v.type === 'decimal') errs[key] = 'Must be a number.';
        if (v.type === 'text' || v.type === 'textarea') {
          if (c.min_length && String(val).length < +c.min_length) errs[key] = `Must be at least ${c.min_length} characters.`;
          if (c.regex) { try { if (!new RegExp(c.regex, 'u').test(String(val))) errs[key] = c.regex_message || 'Invalid format.'; } catch (e) { /* server validates */ } }
        }
        if (v.type === 'checkbox' && Array.isArray(val)) {
          if (c.min_select && val.length < +c.min_select) errs[key] = `Select at least ${c.min_select}.`;
          if (c.max_select && val.length > +c.max_select) errs[key] = `Select at most ${c.max_select}.`;
        }
        if (v.type === 'gps' && typeof val !== 'object') errs[key] = 'Enter coordinates as "latitude, longitude".';
        if (v.type === 'date') {
          const mn = c.min === 'today' ? today() : c.min, mx = c.max === 'today' ? today() : c.max;
          if (mn && val < mn) errs[key] = `Date must be on or after ${mn}.`;
          if (mx && val > mx) errs[key] = `Date must be on or before ${mx}.`;
        }
      };
      (page.sections || []).forEach((s) => {
        if (onlySec && s.id !== onlySec) return;
        if (s.repeat && s.key) {
          const rows = this.data[s.key] || [];
          rows.forEach((row, ri) => {
            const ctx = this.computeInto(Object.assign({}, this.data, row));
            (s.items || []).filter((i) => i.type === 'variable' && this.vars[i.var]).forEach((i) => check(this.vars[i.var], row[i.var], `${s.key}.${ri}.${i.var}`, ctx));
          });
          if (+s.repeat_min && rows.length < +s.repeat_min) errs[s.key] = `Add at least ${s.repeat_min}.`;
        } else (s.items || []).filter((i) => i.type === 'variable' && this.vars[i.var]).forEach((i) => check(this.vars[i.var], this.data[i.var], i.var, this.data));
      });
      if (!onlySec && this.pageIdx === 0 && this.o.consent && this.o.consent.required && this.o.mode === 'fill' && !this.consent) errs._consent = 'Consent is required to continue.';
      this.errors = errs;
      return !Object.keys(errs).length;
    }

    scrollToError() { const el = this.el.querySelector('.has-error, .err:not(:empty)'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    next() {
      if (this.o.mode === 'fill' && this.o.consent && this.o.consent.required && !this.consent) { this.validatePage(); this.secPos = 0; this.render(); this.scrollToError(); return; }
      if (this.stepping) {
        const secs = this.steps();
        if (this.secPos < secs.length - 1) {
          if (secs[this.secPos].classList.contains('rf-consent')) { this.collectPage(); this.errors = {}; this.secPos++; this.render(); this.scrollTopOfForm(); return; }
          const id = secs[this.secPos].dataset.section;
          if (!this.validatePage(id)) { this.render(); this.scrollToError(); return; }
          this.secPos++; this.errors = {}; this.render(); this.scrollTopOfForm(); this.saveDraft && this.saveDraft();
          return;
        }
      }
      if (!this.validatePage()) { this.jumpToError = true; this.render(); this.scrollToError(); return; }
      const n = this.nextPageIndex(this.pageIdx);
      if (n === null) return this.submit();
      this.history.push(this.pageIdx); this.pageIdx = n; this.secPos = 0; this.render(); this.scrollTopOfForm();
    }
    back() {
      this.collectPage(); this.errors = {};
      if (this.stepping && this.secPos > 0) { this.secPos--; this.render(); this.scrollTopOfForm(); return; }
      if (!this.history.length) return;
      this.pageIdx = this.history.pop() ?? 0; this.secPos = 9999; this.render(); this.scrollTopOfForm();
    }

    payload() {
      // Drop answers on pages that were skipped by logic jumps
      const visited = new Set([...this.history, this.pageIdx]);
      const data = JSON.parse(JSON.stringify(this.data));
      this.pages.forEach((p, i) => {
        if (visited.has(i)) return;
        (p.sections || []).forEach((s) => { if (s.repeat && s.key) delete data[s.key]; (s.items || []).forEach((it) => { if (it.var) delete data[it.var]; }); });
      });
      return { data, consent: this.consent, client_uuid: this.clientUuid || (this.clientUuid = uuid()), started_at: this.started, website: (this.el.querySelector('input[name=website]') || {}).value || '' };
    }

    async submit() {
      if (!this.validatePage()) { this.jumpToError = true; this.render(); this.scrollToError(); return; }
      if (this.o.mode === 'preview') { this.done({ preview: true }); return; }
      const btn = this.el.querySelector('[data-act="submit"]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving\u2026'; }
      const body = this.payload();
      const files = Object.values(this.pending);
      const queue = async () => {
        await Offline.add({ id: body.client_uuid, url: this.o.submitUrl, uploadUrl: this.o.uploadUrl, auth: !!this.o.auth, payload: body, files, form: (this.o.form || {}).title, created: Date.now() });
        this.clearDraft(); this.done({ offline: true });
      };
      try {
        if (this.o.save) { // desktop app: saved on the computer, sent with the next sync
          const res = await this.o.save(body, this);
          this.pending = {}; this.clearDraft(); this.done(res || {});
          return;
        }
        if (!navigator.onLine && this.o.offline) return await queue();
        for (const f of files) {
          const fd = new FormData(); fd.append('file', f.blob, f.name); fd.append('variable', f.variable);
          const r = await postForm(this.o.uploadUrl, fd, this.o.auth);
          if (f.repeat) body.data[f.repeat][f.row][f.variable] = r.uuid; else body.data[f.variable] = r.uuid;
        }
        const res = await postJson(this.o.submitUrl, body, this.o.auth);
        this.pending = {};
        this.clearDraft(); this.done(res);
      } catch (e) {
        if (!e.status && this.o.offline) return await queue();
        if (e.status === 422 && e.data && e.data.errors) {
          this.errors = e.data.errors;
          const errNames = Object.keys(this.errors).map((k) => k.split('.')[0]);
          const pi = this.pages.findIndex((p) => (p.sections || []).some((s) => (s.repeat && errNames.includes(s.key)) || (s.items || []).some((it) => errNames.includes(it.var))));
          if (pi >= 0 && pi !== this.pageIdx) { this.history = this.history.filter((h) => h < pi); this.pageIdx = pi; }
          this.errors._form = e.message;
          this.jumpToError = true; this.render(); this.scrollToError();
          return;
        }
        this.errors = { _form: e.message }; this.render();
      }
    }

    done(res) {
      if (this.o.onDone) return this.o.onDone(res, this);
      const msg = res.offline ? 'Saved on this device. It will be sent automatically when you are back online.' : (res.preview ? 'Preview complete. Nothing was saved.' : (this.settings.submit_message || 'Thank you! Your response has been recorded.'));
      this.el.innerHTML = `<div class="rf-section text-center py-5"><i class="bi ${res.offline ? 'bi-cloud-arrow-up text-warning' : 'bi-check-circle text-success'}" style="font-size:3rem"></i>
        <h2 class="h4 mt-2">${res.offline ? 'Saved offline' : 'Submitted'}</h2>${((r) => r.rich ? `<div class="text-muted rt-content rf-done-msg mx-auto mb-3">${r.html}</div>` : `<p class="text-muted" style="white-space:pre-line">${r.html}</p>`)(richInner(msg))}
        ${res.duplicate_of ? '<p class="small text-warning">This response looks like a duplicate of an existing record and was flagged for review.</p>' : ''}
        ${this.o.mode !== 'edit' && this.settings.allow_multiple !== false ? '<button class="btn btn-primary" data-act="again"><i class="bi bi-plus-lg"></i> Submit another response</button>' : ''}
        ${this.o.afterLinks || ''}</div>`;
      const again = this.el.querySelector('[data-act="again"]');
      if (again) again.addEventListener('click', () => { this.data = {}; this.pending = {}; this.errors = {}; this.pageIdx = 0; this.history = []; this.secPos = 0; this.clientUuid = null; this.restoredDraft = false; this.applyDefaults(); this.recalc(); this.render(); window.scrollTo(0, 0); });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (this.o.onAfterDone) this.o.onAfterDone(res);
    }
  }

  function RHFormToast(msg) { if (window.RH && RH.toast) RH.toast(msg, 'warning'); else alert(msg); }

  // click-to-copy on the ethics approval card (delegated, so it survives re-renders)
  document.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('.rf-mi-copy') : null; if (!b) return;
    const v = b.getAttribute('data-copy') || '';
    const done = () => { b.classList.add('copied'); const sub = b.querySelector('.rf-mi-sub'); const was = sub ? sub.innerHTML : ''; if (sub) sub.innerHTML = '<i class="bi bi-check2-circle"></i> Copied'; if (window.RH && RH.toast) RH.toast('Ethics number copied', 'success', 1800); setTimeout(() => { b.classList.remove('copied'); if (sub) sub.innerHTML = was; }, 1800); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(done, () => {}); else { const t = document.createElement('textarea'); t.value = v; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (x) {} t.remove(); }
  });

  // ------------------------------------------------------------------ offline banner
  function initOfflineBanner() {
    let el = document.getElementById('offlineBanner');
    if (!el) { el = document.createElement('div'); el.id = 'offlineBanner'; el.className = 'offline-banner'; document.body.appendChild(el); }
    const paint = async () => {
      let n = 0; try { n = (await Offline.all()).length; } catch (e) { /* ignore */ }
      const off = !navigator.onLine;
      if (!off && !n) { el.innerHTML = ''; return; }
      el.innerHTML = `<div class="alert ${off ? 'alert-warning' : 'alert-info'} shadow py-2 px-3 mb-0 d-flex align-items-center gap-2 small">
        <i class="bi ${off ? 'bi-wifi-off' : 'bi-cloud-arrow-up'}"></i>
        ${off ? 'You are offline. Responses will be saved on this device.' : ''} ${n ? `<strong>${n}</strong> response${n > 1 ? 's' : ''} waiting to sync.` : ''}
        ${!off && n ? '<button class="btn btn-sm btn-primary ms-2" id="syncNow">Sync now</button>' : ''}</div>`;
      const b = document.getElementById('syncNow');
      if (b) b.addEventListener('click', sync);
    };
    const sync = async () => {
      const r = await Offline.flush();
      if (r && r.ok) RHFormToast(`${r.ok} offline response(s) synced.`);
      if (r && r.failed) RHFormToast(`${r.failed} response(s) could not be synced yet.`);
      paint();
    };
    window.addEventListener('online', () => { paint(); sync(); });
    window.addEventListener('offline', paint);
    window.addEventListener('rh:sync', sync);
    paint(); if (navigator.onLine) sync();
    setInterval(paint, 15000);
  }

  window.RHForm = RHForm;
  window.RHForm.initOffline = initOfflineBanner;
})();