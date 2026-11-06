/* ResearchHub "Vivid" theme \u2014 interactions & smart loading. Safe to remove. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Links that must never be prefetched or shown as page loads (side effects / downloads / external flows)
  var SKIP = /logout|\/verify\/|\/reset\/|\/auth\/oauth|\/invite\/|\/cron\/|export|download|save-template|\/data\/file\/|\/api\/|account\/2fa|manifest\.json|\.(csv|pdf|zip|xlsx|sav|dta|rds|json)(\?|$)/i;

  function sameSiteLink(a) {
    if (!a || !a.href || a.target === '_blank' || a.hasAttribute('download') || a.dataset.noPrefetch !== undefined) return false;
    var u; try { u = new URL(a.href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search && u.hash)) return false;
    if (a.getAttribute('href').charAt(0) === '#' || /^javascript:/i.test(a.getAttribute('href'))) return false;
    return !SKIP.test(u.pathname + u.search);
  }

  /* ---------- top progress bar ---------- */
  var bar = document.createElement('div'); bar.id = 'rhProgress';
  function barStart() { bar.classList.remove('done'); void bar.offsetWidth; bar.classList.add('run'); clearTimeout(bar._t); bar._t = setTimeout(barDone, 9000); }
  function barDone() { if (!bar.classList.contains('run')) return; bar.classList.remove('run'); bar.classList.add('done'); }
  window.RHProgress = { start: barStart, done: barDone };

  /* ---------- smart prefetch ---------- */
  function setupPrefetch() {
    var esc = function (s) { return s; };
    if (HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules')) {
      var s = document.createElement('script'); s.type = 'speculationrules';
      s.textContent = JSON.stringify({ prefetch: [{ source: 'document', eagerness: 'conservative', where: { and: [
        { href_matches: '/*' },
        { not: { href_matches: ['/*logout*', '/*verify/*', '/*reset/*', '/*auth/oauth*', '/*invite/*', '/*cron/*', '/*export*', '/*download*', '/*save-template*', '/*data/file/*', '/*api/*', '/*account/2fa*', '/*.csv', '/*.pdf', '/*.zip', '/*.json'].map(esc) } },
        { not: { selector_matches: '[download], [target=_blank], [data-no-prefetch]' } }
      ] } }] });
      document.head.appendChild(s);
      return;
    }
    var done = {}, timer;
    function pf(a) {
      if (!sameSiteLink(a) || done[a.href]) return;
      if (navigator.connection && (navigator.connection.saveData || /2g/.test(navigator.connection.effectiveType || ''))) return;
      done[a.href] = 1; var l = document.createElement('link'); l.rel = 'prefetch'; l.href = a.href; document.head.appendChild(l);
    }
    // only once the link is actually being pressed: a hover-prefetch would start a server session for a page the user never opens
    // (it ages flash messages and moves the "back" target of the next form)
    document.addEventListener('mousedown', function (e) { var a = e.target.closest && e.target.closest('a'); if (a && e.button === 0) pf(a); }, { passive: true });
    document.addEventListener('touchstart', function (e) { var a = e.target.closest && e.target.closest('a'); if (a) pf(a); }, { passive: true });
  }

  /* ---------- ripple on buttons ---------- */
  function ripple(e) {
    var b = e.target.closest && e.target.closest('.btn'); if (!b || reduce || b.disabled) return;
    var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height), s = document.createElement('span');
    s.className = 'rh-ripple'; s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px'; s.style.top = (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s); setTimeout(function () { s.remove(); }, 650);
  }

  /* ---------- count-up numbers ---------- */
  function countUp(el) {
    var txt = el.textContent.trim(), m = txt.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if (!m || reduce) return;
    var target = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, comma = m[2].indexOf(',') > -1;
    if (!isFinite(target) || Math.abs(target) < 2) return;
    var t0 = performance.now(), dur = 900;
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur), v = target * (1 - Math.pow(1 - p, 3));
      var s = v.toFixed(dec); if (comma) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      el.textContent = m[1] + s + m[3]; if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- sticky columns: a column scrolls with the page until its bottom shows, then stays put until the row (footer) ends ---------- */
  /* ---------- gradient-filled text (transparent letters) gets a drop shadow instead of a text-shadow (see brand.css) ---------- */
  function clipText(root) {
    var els = (root || document.body).querySelectorAll('h1, h2, h3, h4, b, strong, span, a, small, em, p, div');
    for (var i = 0; i < els.length; i++) {
      var e = els[i]; if (e._rhTs) continue; e._rhTs = 1;
      var c = getComputedStyle(e), clip = c.backgroundClip || c.webkitBackgroundClip || '', fill = c.webkitTextFillColor || '';
      if (/text/.test(clip) || /rgba\([^)]*,\s*0\)$/.test(fill)) e.classList.add('rh-ts-clip');
    }
  }
  function clipTextWatch() {
    clipText();
    if (!window.MutationObserver) return;
    var t; new MutationObserver(function (ms) {
      clearTimeout(t); t = setTimeout(function () { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && !n.closest('.ag-root-wrapper, .js-plotly-plot')) clipText(n.parentNode || n); }); }); }, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }
  function stickCols() {
    // .rh-stick = a wrapper inside a column; .rh-stick-row = every column of that row sticks (no wrapper needed).
    // The longest column sets the row height and scrolls normally; shorter ones stay in view (tall ones pin by their bottom edge).
    var wraps = [].slice.call(document.querySelectorAll('.rh-stick'));
    // columns may be Bootstrap .col-* or plain children of a grid (e.g. <section> + <aside>)
    var cols = [].slice.call(document.querySelectorAll('.rh-stick-row > :not(script):not(style):not(template)'));
    if (!wraps.length && !cols.length) return;
    var fit = function () {
      var vh = window.innerHeight, tb = document.querySelector('.rh-topbar'), g = (tb ? tb.offsetHeight : 58) + 16;
      cols.forEach(function (c) {
        var row = c.parentElement, side = c.getBoundingClientRect().width < row.getBoundingClientRect().width * 0.85; // columns are side by side
        c.classList.toggle('rh-stuck', side);
      });
      wraps.concat(cols).forEach(function (el) {
        // data-stick-under=".selector" on an ancestor: also clear that sticky bar (e.g. a filter toolbar)
        var top = g, host = el.closest('[data-stick-under]'), bar = host && document.querySelector(host.getAttribute('data-stick-under'));
        if (bar && bar.offsetHeight) top = Math.max(g, (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight + 12);
        var h = el.offsetHeight; el.style.setProperty('--rh-stick-top', (h + top + 16 > vh ? vh - h - 16 : top) + 'px');
      });
    };
    fit(); window.addEventListener('resize', fit);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(fit); wraps.concat(cols).forEach(function (e) { ro.observe(e); });
      [].slice.call(document.querySelectorAll('[data-stick-under]')).forEach(function (h) { var bar = document.querySelector(h.getAttribute('data-stick-under')); if (bar) ro.observe(bar); });
    }
  }
  /* ---------- reveal on scroll ---------- */
  function reveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in'); io.unobserve(en.target);
        en.target.querySelectorAll('.stat-tile .v').forEach(countUp); if (en.target.matches('.stat-tile')) en.target.querySelectorAll('.v').forEach(countUp);
      });
    }, { rootMargin: '0px 0px -40px 0px' });
    var cards = document.querySelectorAll('.rh-content .card, .rh-content .stat-tile');
    cards.forEach(function (c, i) {
      if (c.closest('.modal, .dropdown-menu') || (c.parentElement && c.parentElement.closest('.card'))) return;
      if (c.getBoundingClientRect().top < innerHeight) { c.querySelectorAll('.stat-tile .v').forEach(countUp); if (c.matches('.stat-tile')) c.querySelectorAll('.v').forEach(countUp); return; }
      c.style.setProperty('--d', (i % 4) * 0.06 + 's'); c.classList.add('rh-reveal'); io.observe(c);
    });
  }

  /* ---------- lazy media ---------- */
  function lazyMedia() {
    document.querySelectorAll('img:not([loading])').forEach(function (i) { i.loading = 'lazy'; i.decoding = 'async'; });
    document.querySelectorAll('iframe:not([loading])').forEach(function (f) { f.loading = 'lazy'; });
  }

  /* ---------- flash messages: auto-hide successes ---------- */
  function flashes() {
    document.querySelectorAll('.rh-content > .alert-success, .auth-form .alert-success').forEach(function (a) {
      setTimeout(function () { a.style.transition = 'opacity .5s, transform .5s, max-height .5s, margin .5s, padding .5s'; a.style.maxHeight = a.offsetHeight + 'px'; requestAnimationFrame(function () { a.style.opacity = 0; a.style.transform = 'translateY(-8px)'; a.style.maxHeight = 0; a.style.margin = 0; a.style.padding = 0; }); setTimeout(function () { a.remove(); }, 550); }, 6000);
    });
  }

  /* ---------- wire up ---------- */
  /* ---------- dark / light switch on pages that don't have one (public forms, installer, error pages) ---------- */
  function themeSwitch() {
    if (document.getElementById('themeToggle')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'themeToggle'; b.className = 'btn btn-light theme-toggle theme-toggle-float';
    b.title = 'Switch dark / light mode'; b.setAttribute('aria-label', 'Switch dark or light mode');
    b.innerHTML = '<i class="bi bi-moon-stars-fill tt-moon"></i><i class="bi bi-sun-fill tt-sun"></i>';
    b.addEventListener('click', function (e) {
      e.stopImmediatePropagation(); // app.js may also bind #themeToggle; toggle once
      var cur = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-bs-theme', cur);
      try { localStorage.setItem('rh-theme', cur); } catch (e) {}
    });
    document.body.appendChild(b);
  }

  /* ---------- user menu (bottom-left): opens on click/tap only (handled by Bootstrap) ---------- */
  function userMenu() {
    // wrap each menu label in a span (so it can hide when the sidebar is collapsed) and use it as a tooltip
    Array.prototype.forEach.call(document.querySelectorAll('.user-dropdown .dropdown-item'), function (a) {
      if (a.querySelector('.um-label')) return;
      Array.prototype.slice.call(a.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          var s = document.createElement('span'); s.className = 'um-label'; s.textContent = n.textContent.trim(); a.replaceChild(s, n);
          if (!a.title) a.title = s.textContent;
          if (!a.getAttribute('aria-label')) a.setAttribute('aria-label', s.textContent);
        }
      });
    });
    // collapsed menu (desktop): open the account menu beside the narrow rail, full width with labels,
    // instead of upwards inside it (where it covered the avatar and clipped the text)
    var btn = document.querySelector('#userMenu .user-menu-btn');
    if (btn && window.bootstrap && bootstrap.Dropdown) {
      bootstrap.Dropdown.getOrCreateInstance(btn, {
        offset: [0, 10],
        popperConfig: function (c) {
          var rail = window.matchMedia('(min-width: 992px)').matches && (document.body.classList.contains('sb-collapsed') || document.documentElement.classList.contains('sb-collapsed'));
          document.getElementById('userMenu').classList.toggle('um-side', rail);
          if (rail) {
            c.placement = 'right-end'; c.strategy = 'fixed';
            // measure free space against the window, not the (clipped) sidebar - otherwise it flips back over the rail
            c.modifiers = (c.modifiers || []).filter(function (m) { return m.name !== 'preventOverflow' && m.name !== 'flip'; })
              .concat([{ name: 'preventOverflow', options: { boundary: document.documentElement, padding: 8 } }, { name: 'flip', options: { boundary: document.documentElement, fallbackPlacements: ['right-start', 'top-start'] } },
                { name: 'computeStyles', options: { gpuAcceleration: false } }]); // top/left instead of transform: the open animation would reset a transform
          }
          // always position with top/left: the menu's open animation resets "transform", which Popper uses by default
          if (!rail) c.modifiers = (c.modifiers || []).filter(function (m) { return m.name !== 'computeStyles'; }).concat([{ name: 'computeStyles', options: { gpuAcceleration: false } }]);
          return c;
        }
      });
    }
  }

  /* ---------- top bar: switch buttons to icon-only when they don't fit on one line ---------- */
  function topbarFit() {
    var bar = document.querySelector('.rh-topbar'); if (!bar) return;
    // wrap each button's text in a span so it can be hidden, and keep the label as a tooltip
    bar.querySelectorAll('.btn').forEach(function (b) {
      if (!b.querySelector('i.bi')) return;
      Array.prototype.slice.call(b.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          var sp = document.createElement('span'); sp.className = 'tb-label'; sp.textContent = n.textContent; b.replaceChild(sp, n);
        }
      });
      var lbl = b.textContent.trim();
      if (lbl) { if (!b.title) b.title = lbl; if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', lbl); }
    });
    var crumbs = bar.querySelector('.crumbs');
    function fit() {
      bar.classList.remove('tb-compact');
      var tight = bar.scrollWidth > bar.clientWidth + 1;
      if (!tight) bar.querySelectorAll('.btn').forEach(function (b) { if (b.offsetHeight > 48) tight = true; });
      if (tight) bar.classList.add('tb-compact');
    }
    fit(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fit, 80); });
    if (window.ResizeObserver) new ResizeObserver(function () { clearTimeout(t); t = setTimeout(fit, 80); }).observe(bar);
  }

  /* ---------- calendars: branded date / time pickers (flatpickr) ---------- */
  function datePickers() {
    if (!window.flatpickr) return;
    var meta = document.querySelector('meta[name="date-format"]');
    var dfmt = (meta && meta.content) || 'd.m.Y';
    var SKIP = '.ag-root-wrapper, .ag-popup, [data-native-date]';
    function opts(el) {
      var t = el.getAttribute('type'), o = {
        allowInput: true, disableMobile: true, monthSelectorType: 'static', locale: { firstDayOfWeek: 1 },
        altInput: true, altInputClass: el.className + ' rh-date-alt',
        onReady: function (_, __, fp) { decorate(fp, el); },
        onChange: function () { ['input', 'change'].forEach(function (n) { el.dispatchEvent(new Event(n, { bubbles: true })); }); }
      };
      if (t === 'date') { o.dateFormat = 'Y-m-d'; o.altFormat = dfmt; }
      else if (t === 'datetime-local') { o.enableTime = true; o.time_24hr = true; o.dateFormat = 'Y-m-d\\TH:i'; o.altFormat = dfmt + ' H:i'; }
      else if (t === 'time') { o.enableTime = true; o.noCalendar = true; o.time_24hr = true; o.dateFormat = 'H:i'; o.altFormat = 'H:i'; }
      if (el.min) o.minDate = el.min; if (el.max) o.maxDate = el.max;
      if (el.disabled || el.readOnly) o.clickOpens = false;
      return o;
    }
    function decorate(fp, el) {
      var cal = fp.calendarContainer; if (!cal || cal.querySelector('.rh-cal-foot') || el.getAttribute('type') === 'time') return;
      var foot = document.createElement('div'); foot.className = 'rh-cal-foot';
      foot.innerHTML = '<button type="button" class="rh-cal-today"><i class="bi bi-calendar-check"></i> Today</button><button type="button" class="rh-cal-clear"><i class="bi bi-x-circle"></i> Clear</button>';
      foot.querySelector('.rh-cal-today').addEventListener('click', function () { fp.setDate(new Date(), true); if (!fp.config.enableTime) fp.close(); });
      foot.querySelector('.rh-cal-clear').addEventListener('click', function () { fp.clear(); fp.close(); });
      cal.appendChild(foot);
    }
    function enhance(root) {
      (root.querySelectorAll ? root : document).querySelectorAll('input[type=date], input[type=datetime-local], input[type=time]').forEach(function (el) {
        if (el._flatpickr || el.closest(SKIP)) return;
        var fp = window.flatpickr(el, opts(el));
        if (fp && fp.altInput) {
          if (el.required) fp.altInput.required = true;
          if (el.style.maxWidth) fp.altInput.style.maxWidth = el.style.maxWidth;
          if (el.disabled) fp.altInput.disabled = true;
          fp.altInput.setAttribute('aria-label', el.getAttribute('aria-label') || (el.id && document.querySelector('label[for="' + el.id + '"]') ? document.querySelector('label[for="' + el.id + '"]').textContent.trim() : 'Date'));
          var wrap = document.createElement('span'); wrap.className = 'rh-date-wrap rh-date-' + (el.getAttribute('type') === 'time' ? 'time' : 'date');
          if (el.style.maxWidth) wrap.style.maxWidth = el.style.maxWidth;
          fp.altInput.parentNode.insertBefore(wrap, fp.altInput); wrap.appendChild(fp.altInput);
        }
      });
    }
    enhance(document);
    if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) enhance(n.matches && n.matches('input') ? n.parentNode : n); }); }); }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- placeholders: add a helpful hint to any field that has none ---------- */
  function autoPlaceholders() {
    var SKIP = '.flatpickr-calendar, .ag-root-wrapper, .ag-popup, [data-no-placeholder]';
    var TYPES = /^(text|email|number|password|search|tel|url|textarea)$/;
    function labelFor(el) {
      var l = el.id && document.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]');
      if (!l) { var box = el.closest('.mb-1, .mb-2, .mb-3, [class*="col"], .rf-field, .form-group'); if (box) l = box.querySelector('label, .form-label'); }
      if (!l && el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      if (!l) return '';
      var t = l.cloneNode(true); t.querySelectorAll('.text-danger, .badge, .small, .text-muted, i').forEach(function (x) { x.remove(); });
      return t.textContent.replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
    }
    function fill(el) {
      if (el.placeholder || el.readOnly || el.disabled || el.type === 'hidden' || el.closest(SKIP)) return;
      var type = el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
      if (!TYPES.test(type)) return;
      var lab = labelFor(el), low = lab ? lab.charAt(0).toLowerCase() + lab.slice(1) : '';
      var ph = { email: 'Dr@gene.rw', url: 'https://', tel: 'e.g. +250 788 000 000', search: 'Search\u2026', password: lab ? 'Enter ' + low : 'Enter password' }[type];
      if (!ph && type === 'number') ph = 'Enter ' + (low || 'a number') + (el.min && el.max ? ' (' + el.min + '\u2013' + el.max + ')' : '');
      if (!ph && lab) ph = (type === 'textarea' ? 'Write ' : 'Enter ') + low;
      if (ph && ph.length < 90) el.placeholder = ph;
    }
    function scan(root) { (root.querySelectorAll ? root : document).querySelectorAll('input, textarea').forEach(fill); }
    scan(document);
    if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('input, textarea')) fill(n); else scan(n); } }); }); }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- fields: password eye + strength, textarea auto-grow + counter, required markers ---------- */
  function fieldEnhance() {
    function score(v) { var s = 0; if (v.length >= 6) s++; if (v.length >= 10) s++; if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++; return s; }
    function password(el) {
      if (el._rhPw || el.closest('.input-group, .flatpickr-calendar')) return; el._rhPw = 1;
      var wrap = document.createElement('span'); wrap.className = 'rh-pw'; el.parentNode.insertBefore(wrap, el); wrap.appendChild(el);
      var b = document.createElement('button'); b.type = 'button'; b.className = 'rh-pw-toggle'; b.tabIndex = -1; b.setAttribute('aria-label', 'Show password'); b.innerHTML = '<i class="bi bi-eye"></i>';
      b.addEventListener('click', function () { var show = el.type === 'password'; el.type = show ? 'text' : 'password'; b.innerHTML = '<i class="bi bi-eye' + (show ? '-slash' : '') + '"></i>'; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); el.focus(); });
      wrap.appendChild(b);
      if (/new|password$/.test(el.name || '') && !/confirm|current/.test(el.name || '') && el.closest('form') && !/login/.test(location.pathname)) {
        var bar = document.createElement('div'); bar.className = 'rh-pw-strength'; bar.innerHTML = '<span></span>'; wrap.after(bar);
        var C = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#0fb5a6'], L = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
        el.addEventListener('input', function () { var v = el.value, s = Math.max(0, Math.min(4, score(v) - (v.length < 6 ? 1 : 0))); bar.firstChild.style.width = v ? (s + 1) * 20 + '%' : 0; bar.firstChild.style.background = C[s]; bar.title = v ? L[s] : ''; });
      }
    }
    function textarea(el) {
      if (el._rhTa || el.closest('.flatpickr-calendar')) return; el._rhTa = 1;
      var grow = function () { if (el.offsetParent === null) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 480) + 'px'; };
      el.addEventListener('input', grow); setTimeout(grow, 0);
      var max = parseInt(el.getAttribute('maxlength'), 10);
      if (max > 0 && !el.hasAttribute('data-no-count')) { // data-no-count: the page shows its own counter
        var c = document.createElement('small'); c.className = 'rh-count'; el.after(c);
        var upd = function () { var n = el.value.length; c.textContent = n + ' / ' + max; c.className = 'rh-count' + (n >= max ? ' full' : n > max * .9 ? ' near' : ''); };
        el.addEventListener('input', upd); upd();
      }
    }
    function required(el) {
      if (!el.required || !el.id) return;
      var l = document.querySelector('label[for="' + el.id + '"]');
      if (l && l.classList.contains('form-label') && !l.querySelector('.text-danger') && !/\*\s*$/.test(l.textContent)) l.classList.add('rh-req');
    }
    function scan(root) {
      var r = root.querySelectorAll ? root : document;
      r.querySelectorAll('input[type=password].form-control').forEach(password);
      r.querySelectorAll('textarea.form-control').forEach(textarea);
      r.querySelectorAll('input[required], select[required], textarea[required]').forEach(required);
    }
    scan(document);
    if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && !n.classList.contains('rh-pw') && !n.classList.contains('rh-count') && !(n.closest && n.closest('.ag-root-wrapper, .flatpickr-calendar'))) scan(n.parentNode || n); }); }); }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- an icon in every field (chosen from the field's name, label and type) ---------- */
  function fieldIcons() {
    var RULES = [
      [/e-?mail|smtp_user|from_email/, 'envelope'], [/pass|pwd|secret/, 'lock'], [/orcid/, 'person-vcard'],
      [/username|^login$|login_?id/, 'person-badge'], [/full ?name|admin_name|^name$|your name|collector/, 'person'],
      [/institution|organi[sz]ation|hospital|affiliation/, 'building'], [/research_field|field of|speciali|discipline/, 'mortarboard'],
      [/ethic|irb|approval/, 'shield-check'], [/tag/, 'tags'], [/keyword/, 'key'], [/copyright/, 'c-circle'],
      [/announce/, 'megaphone'], [/home_title|site_title|site_name|platform/, 'window'], [/base_url|url|website|link/, 'link-45deg'],
      [/phone|tel|mobile/, 'telephone'], [/db_host|smtp_host|host/, 'hdd-network'], [/port/, 'ethernet'], [/db_name|database/, 'database'],
      [/db_user|user|member|owner/, 'person'], [/code|otp|2fa|token/, 'shield-lock'], [/filter/, 'funnel'], [/search|^q$|find/, 'search'],
      [/description|bio|about|summary|abstract|instruction|consent|note|comment|message|help/, 'text-paragraph'],
      [/title|label|question|heading/, 'type'], [/varname|var_name|variable|_name$|^name/, 'braces'], [/option|choice|list/, 'list-ul'],
      [/formula|calc|expression/, 'calculator'], [/weight/, 'speedometer'], [/height|length/, 'rulers'], [/age|year/, 'hourglass-split'],
      [/upload|size|_mb/, 'hdd'], [/retention|day|backup/, 'clock-history'], [/max|min|limit|count|number|^n$|qty|amount/, 'hash'],
      [/id$|_id|study_id|record/, 'upc'], [/unit/, 'rulers'], [/reason|reference/, 'journal-text'], [/address|city|country|location|gps|lat/, 'geo-alt'],
      [/recipient/, 'people'], [/status|state/, 'flag'], [/role/, 'person-gear'], [/type/, 'ui-radios'], [/format/, 'calendar3'],
      [/chart|bins|group|outcome|predictor|var/, 'bar-chart']
    ];
    var TYPE = { email: 'envelope', password: 'lock', search: 'search', url: 'link-45deg', tel: 'telephone', number: '123', textarea: 'text-paragraph', select: 'list-ul', text: 'input-cursor-text' };
    var SKIP = '.input-group, .flatpickr-calendar, .ag-root-wrapper, .ag-popup, .rh-date-wrap, .rh-ic, [data-no-icon]';
    function labelText(el) {
      var l = el.id && document.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]');
      if (!l) { var box = el.closest('.mb-1, .mb-2, .mb-3, [class*="col"], .rf-field, .form-group'); if (box) l = box.querySelector('label, .form-label'); }
      return ((l && l.textContent) || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || '');
    }
    function pick(el, type) {
      var keys = [(el.name || '').toLowerCase(), (el.id || '').replace(/^rf_/, '').toLowerCase()].filter(Boolean), lab = labelText(el).toLowerCase();
      if (TYPE[type] && /^(email|password|search|url|tel)$/.test(type)) return TYPE[type];
      for (var k = 0; k < keys.length; k++) for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(keys[k])) return RULES[i][1];
      for (var j = 0; j < RULES.length; j++) if (RULES[j][0].test(lab)) return RULES[j][1];
      return TYPE[type] || TYPE.text;
    }
    function add(el) {
      if (el.classList && el.classList.contains('rs-hidden')) { // custom select: put the icon around its wrapper
        var w = el.parentNode;
        if (el._rhIc || !w || (w.parentNode && w.parentNode.classList.contains('rh-ic')) || w.offsetParent === null || w.offsetWidth < 80) return;
        el._rhIc = 1;
        var ic = document.createElement('i'); ic.className = 'bi bi-' + pick(el, 'select') + ' rh-ic-i'; ic.setAttribute('aria-hidden', 'true');
        var hs = document.createElement('span'); hs.className = 'rh-ic' + (w.classList.contains('inline') ? ' inline' : '');
        ['mb-1', 'mb-2', 'mb-3', 'mt-1', 'mt-2', 'mt-3'].forEach(function (c) { if (w.classList.contains(c)) { w.classList.remove(c); hs.classList.add(c); } });
        w.parentNode.insertBefore(hs, w); hs.appendChild(w);
        hs.classList.add('rh-has-ic' + (el.classList.contains('form-select-sm') ? '-sm' : el.classList.contains('form-select-lg') ? '-lg' : ''));
        hs.insertBefore(ic, hs.firstChild);
        return;
      }
      if (el._rhIc || el.type === 'hidden' || el.closest(SKIP) && !el.parentNode.classList.contains('rh-pw')) return;
      if (/^(checkbox|radio|file|range|color|submit|button|date|time|datetime-local)$/.test(el.type)) return;
      if (el.classList.contains('flatpickr-input') && el.type === 'hidden') return;
      if (el.offsetParent === null || el.offsetWidth < 80) return;
      el._rhIc = 1;
      var type = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : (el.getAttribute('type') || 'text').toLowerCase();
      var i = document.createElement('i'); i.className = 'bi bi-' + pick(el, type) + ' rh-ic-i' + (type === 'textarea' ? ' top' : ''); i.setAttribute('aria-hidden', 'true');
      var host = el.parentNode.classList.contains('rh-pw') ? el.parentNode : null;
      if (!host) {
        host = document.createElement('span'); host.className = 'rh-ic';
        var cs = getComputedStyle(el);
        if (cs.display.indexOf('inline') === 0 || el.classList.contains('w-auto')) host.classList.add('inline');
        ['maxWidth', 'width', 'flex', 'flexGrow', 'flexBasis'].forEach(function (k) { if (el.style[k]) { host.style[k] = el.style[k]; } });
        if (el.style.maxWidth) el.style.maxWidth = '100%';
        if (getComputedStyle(el.parentNode).display.indexOf('flex') > -1 && !host.style.flex) host.style.flex = cs.flexGrow !== '0' ? '1 1 0%' : '0 1 auto';
        ['mb-1', 'mb-2', 'mb-3', 'mt-1', 'mt-2', 'mt-3'].forEach(function (c) { if (el.classList.contains(c)) { el.classList.remove(c); host.classList.add(c); } });
        el.parentNode.insertBefore(host, el); host.appendChild(el);
      }
      host.classList.add('rh-has-ic' + (el.classList.contains('form-control-sm') || el.classList.contains('form-select-sm') ? '-sm' : el.classList.contains('form-control-lg') ? '-lg' : ''));
      host.insertBefore(i, host.firstChild);
    }
    function scan(root) { (root.querySelectorAll ? root : document).querySelectorAll('input.form-control, textarea.form-control, select.form-select').forEach(add); }
    scan(document);
    document.addEventListener('shown.bs.modal', function (e) { scan(e.target); });
    document.addEventListener('shown.bs.tab', function () { scan(document); });
    var t; document.addEventListener('click', function () { clearTimeout(t); t = setTimeout(function () { scan(document); }, 200); }, true);
    if (window.MutationObserver) new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && !(n.closest && n.closest('.ag-root-wrapper, .flatpickr-calendar')) && !n.classList.contains('rh-ic-i')) setTimeout(function () { scan(n.parentNode || n); }, 0); }); }); }).observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- data-collection forms: tick each answered question ---------- */
  function rfAnswered() {
    function check(f) {
      if (!f || !f.matches('.rf-field[data-var]')) return;
      var done = false;
      f.querySelectorAll('input, textarea, select').forEach(function (e) {
        if (e.type === 'hidden' && !e.classList.contains('flatpickr-input')) return;
        if ((e.type === 'radio' || e.type === 'checkbox') ? e.checked : String(e.value || '').trim() !== '') done = true;
      });
      if (f.querySelector('.rf-stars')) done = done || !!f.querySelector('.rf-stars .on');
      var calc = f.querySelector('.rf-calc'); // auto-filled (calculated) value: ticked once it has a result
      if (calc) done = !calc.querySelector('.text-muted') && String(calc.textContent || '').trim() !== '';
      f.classList.toggle('rf-answered', done);
    }
    function all() { document.querySelectorAll('.rf-field[data-var]').forEach(check); }
    ['input', 'change', 'click'].forEach(function (ev) { document.addEventListener(ev, function (e) { var f = e.target.closest && e.target.closest('.rf-field'); if (f) setTimeout(function () { check(f); }, 0); }, true); });
    var root = document.getElementById('rfRoot') || document.querySelector('.rf-container');
    if (root && window.MutationObserver) new MutationObserver(function () { clearTimeout(root._t); root._t = setTimeout(all, 30); }).observe(root, { childList: true, subtree: true });
    all();
  }

  /* ---------- public pages: shadow under the top bar once the page scrolls ---------- */
  function pubTop() {
    var t = document.querySelector('.pub-top'); if (!t) return;
    var f = function () { t.classList.toggle('is-stuck', window.scrollY > 8); };
    window.addEventListener('scroll', f, { passive: true }); f();
  }

  /* ---------- public pages: always show the top bar (adds it if the page template doesn't have it) ---------- */
  function pubHeader() {
    var b = document.body;
    if (!b || document.querySelector('.rh-sidebar, .rh-topbar')) return; // signed-in app pages have their own bar
    if (!document.querySelector('.pub-top')) {
      var base = (document.querySelector('meta[name="base-url"]') || {}).content;
      if (!base) { var l = document.querySelector('link[href*="assets/css/"]'); base = l ? l.href.split('assets/css/')[0] : '/'; }
      if (base.slice(-1) !== '/') base += '/';
      var nm = document.querySelector('.brand-name, .auth-brand-name');
      var name = nm ? nm.textContent.trim() : (document.title.split('|').pop().trim() || location.hostname);
      var onLogin = /\/login\/?$/.test(location.pathname) || (!!document.querySelector('input[type=password]') && !document.querySelector('input[name=password_confirm], input[name=name]') && !/register|reset/.test(location.pathname));
      var btn = onLogin
        ? '<a class="btn pub-signin" href="' + base + 'register"><i class="bi bi-person-plus-fill"></i><span>Create account</span></a>'
        : '<a class="btn pub-signin" href="' + base + 'login"><i class="bi bi-box-arrow-in-right"></i><span>Sign in</span></a>';
      var h = document.createElement('header');
      h.className = 'pub-top';
      h.innerHTML = '<div class="pub-top-in"><a class="page-brand" href="' + base + '"><span class="logo"><i class="bi bi-bar-chart-steps"></i></span>'
        + '<span class="brand-text"><span class="brand-name"></span><span class="brand-tag">Research Data Platform</span></span></a>'
        + '<div class="pub-top-actions">' + btn + '</div></div>';
      h.querySelector('.brand-name').textContent = name;
      // remove the old centred logo / mobile brand, they are now in the bar
      Array.prototype.forEach.call(document.querySelectorAll('body > .text-center > .page-brand, .auth-mobile-brand'), function (x) {
        var p = x.parentNode, t = (p && p !== b && p.children.length === 1) ? p : x;
        if (t.parentNode) t.parentNode.removeChild(t);
      });
      b.insertBefore(h, b.firstChild);
    }
    var cls = document.querySelector('.auth-wrap') ? 'auth-page' : 'pub-page';
    if ((' ' + b.className + ' ').indexOf(' ' + cls + ' ') < 0) b.className += ' ' + cls;
    // put the dark-mode switch inside the bar (move the existing one so its click handler is kept)
    var acts = document.querySelector('.pub-top .pub-top-actions'), tg = document.getElementById('themeToggle');
    if (acts && !acts.contains(tg)) {
      if (!tg) {
        tg = document.createElement('button'); tg.type = 'button'; tg.id = 'themeToggle';
        tg.innerHTML = '<i class="bi bi-moon-stars-fill tt-moon"></i><i class="bi bi-sun-fill tt-sun"></i>';
        tg.addEventListener('click', function (e) {
          e.stopImmediatePropagation(); // app.js may also bind #themeToggle; toggle once
          var cur = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-bs-theme', cur);
          try { localStorage.setItem('rh-theme', cur); } catch (e) {}
        });
      }
      tg.className = 'btn btn-light theme-toggle pub-theme';
      tg.title = 'Switch dark / light mode'; tg.setAttribute('aria-label', 'Switch dark or light mode');
      acts.appendChild(tg);
    }
  }

  /* ---------- rich-text editor for textarea[data-rich] (project description) ---------- */
  function richEditors() {
    var areas = document.querySelectorAll('textarea[data-rich]');
    if (!areas.length || !document.execCommand) return;
    var esc = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var isHtml = function (t) { return /<(?:[a-z][a-z0-9]*|\/[a-z][a-z0-9]*)[\s>\/]/i.test(t); };
    var tools = [
      ['bold', 'type-bold', 'Bold (Ctrl+B)'], ['italic', 'type-italic', 'Italic (Ctrl+I)'], ['underline', 'type-underline', 'Underline (Ctrl+U)'], ['strikeThrough', 'type-strikethrough', 'Strikethrough'], '|',
      ['color', 'fonts', 'Text colour'], ['hilite', 'highlighter', 'Highlight colour'], '|',
      ['block', 'type-h1', 'Text style / heading level'], ['size', 'type', 'Font size'], ['blockquote', 'quote', 'Quote'], '|',
      ['insertUnorderedList', 'list-ul', 'Bullet list'], ['insertOrderedList', 'list-ol', 'Numbered list'], '|',
      ['link', 'link-45deg', 'Insert link'], ['unlink', 'link', 'Remove link'], '|',
      ['undo', 'arrow-counterclockwise', 'Undo'], ['redo', 'arrow-clockwise', 'Redo'], ['removeFormat', 'eraser', 'Clear formatting']
    ];
    Array.prototype.forEach.call(areas, function (ta) {
      if (ta.getAttribute('data-rich-ready')) return;
      ta.setAttribute('data-rich-ready', '1');
      var wrap = document.createElement('div'); wrap.className = 'rte';
      var bar = document.createElement('div'); bar.className = 'rte-bar'; bar.setAttribute('role', 'toolbar');
      var ed = document.createElement('div'); ed.className = 'rte-area'; ed.contentEditable = 'true';
      ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true');
      if (ta.placeholder) ed.setAttribute('data-placeholder', ta.placeholder);
      var v = ta.value || '';
      ed.innerHTML = isHtml(v) ? v : v.split(/\n{2,}/).map(function (p) { return p.trim() ? '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>' : ''; }).join('');
      tools.forEach(function (t) {
        if (t === '|') { var s = document.createElement('span'); s.className = 'rte-sep'; bar.appendChild(s); return; }
        var b = document.createElement('button'); b.type = 'button'; b.className = 'rte-btn'; b.title = t[2]; b.setAttribute('aria-label', t[2]); b.setAttribute('data-cmd', t[0]);
        if (t[0] === 'block' || t[0] === 'size') { b.className += ' rte-dd'; b.innerHTML = '<span class="rte-lbl">' + (t[0] === 'block' ? 'Normal' : 'Size') + '</span><i class="bi bi-chevron-down rte-caret"></i>'; }
        else b.innerHTML = '<i class="bi bi-' + t[1] + '"></i>' + (t[0] === 'color' || t[0] === 'hilite' ? '<span class="rte-swatch-bar"></span><i class="bi bi-caret-down-fill rte-caret"></i>' : '');
        b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the text selection
        b.addEventListener('click', function () {
          ed.focus();
          var c = t[0];
          if (c === 'color' || c === 'hilite') { colorMenu(b, c); return; }
          if (c === 'block' || c === 'size') { listMenu(b, c); return; }
          if (c === 'blockquote') document.execCommand('formatBlock', false, String(document.queryCommandValue('formatBlock')).toLowerCase() === 'blockquote' ? '<p>' : '<blockquote>');
          else if (c === 'link') {
            var url = window.prompt('Link address (https://\u2026)', 'https://');
            if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim());
          } else document.execCommand(c, false, null);
          sync(); state();
        });
        bar.appendChild(b);
      });
      var count = document.createElement('div'); count.className = 'rte-count';
      // ---- full screen: browser full screen when available, else the editor fills the window ----
      var fsBtn = document.createElement('button'); fsBtn.type = 'button'; fsBtn.className = 'rte-btn rte-fs';
      var lblEl = ta.id ? document.querySelector('label[for="' + ta.id + '"]') : null;
      var fsName = (lblEl && lblEl.textContent.trim()) || ta.getAttribute('aria-label') || (function () { var c = ta.closest('.sh-card, .card, .mb-3, section'); var t = c && c.querySelector('.sh-label, .form-label, label, h2, h3'); return t ? t.textContent.trim() : ''; })() || 'Text editor';
      var fsHead = document.createElement('div'); fsHead.className = 'rte-fs-hd';
      fsHead.innerHTML = '<span class="rte-fs-t"><i class="bi bi-pencil-square"></i><b></b></span><span class="rte-fs-hint">Esc to exit</span><button type="button" class="rte-fs-done"><i class="bi bi-fullscreen-exit"></i> Done</button>';
      fsHead.querySelector('b').textContent = fsName;
      if (!ed.getAttribute('aria-label')) ed.setAttribute('aria-label', fsName);
      function isFull() { return wrap.classList.contains('rte-full'); }
      // no browser full screen (e.g. iPhone): lift the editor to the top of the page (or of its window) so nothing clips it
      var mark = null;
      function fixedOn() {
        wrap.classList.add('rte-full-fixed');
        mark = document.createComment('rte'); wrap.parentNode.insertBefore(mark, wrap);
        (wrap.closest('.modal') || document.body).appendChild(wrap); ed.focus();
      }
      function fixedOff() {
        wrap.classList.remove('rte-full-fixed');
        if (mark && mark.parentNode) { mark.parentNode.insertBefore(wrap, mark); mark.remove(); } mark = null;
      }
      function paintFs() {
        var on = isFull();
        fsBtn.innerHTML = '<i class="bi bi-' + (on ? 'fullscreen-exit' : 'arrows-fullscreen') + '"></i>';
        fsBtn.title = on ? 'Exit full screen (Esc)' : 'Edit in full screen';
        fsBtn.setAttribute('aria-label', fsBtn.title); fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      function setFull(on) {
        if (on === isFull()) return;
        closeMenu();
        wrap.classList.toggle('rte-full', on);
        document.documentElement.classList.toggle('rte-full-open', on);
        if (on) {
          if (wrap.requestFullscreen && !document.fullscreenElement) { wrap.requestFullscreen().catch(function () { fixedOn(); }); }
          else if (!wrap.requestFullscreen) fixedOn();
        } else {
          fixedOff();
          if (document.fullscreenElement === wrap && document.exitFullscreen) document.exitFullscreen().catch(function () {});
        }
        paintFs(); ed.focus();
      }
      fsBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      fsBtn.addEventListener('click', function () { setFull(!isFull()); });
      fsHead.querySelector('.rte-fs-done').addEventListener('click', function () { setFull(false); });
      document.addEventListener('fullscreenchange', function () { if (isFull() && document.fullscreenElement !== wrap && !wrap.classList.contains('rte-full-fixed')) setFull(false); });
      wrap.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isFull() && !menu) { e.preventDefault(); e.stopPropagation(); setFull(false); } // the browser handles Esc itself in real full screen
      }, true);
      ed.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); setFull(!isFull()); } });
      paintFs(); bar.appendChild(fsBtn);
      // ---- colour pickers (text colour / highlight) ----
      var COLORS = { color: [['Default', ''], ['Red', '#dc2626'], ['Orange', '#ea580c'], ['Amber', '#b45309'], ['Green', '#16a34a'], ['Teal', '#0d9488'], ['Blue', '#2563eb'], ['Indigo', '#4f46e5'], ['Purple', '#9333ea'], ['Pink', '#db2777'], ['Grey', '#64748b'], ['Black', '#111827']],
        hilite: [['None', ''], ['Yellow', '#fef08a'], ['Green', '#bbf7d0'], ['Teal', '#99f6e4'], ['Blue', '#bfdbfe'], ['Purple', '#e9d5ff'], ['Pink', '#fbcfe8'], ['Orange', '#fed7aa'], ['Red', '#fecaca'], ['Grey', '#e2e8f0']] };
      var last = { color: '#dc2626', hilite: '#fef08a' }, saved = null, menu = null;
      function keepSel() { var s = window.getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); }
      function useSel() { if (!saved) return; ed.focus(); var s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
      function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener('mousedown', outside, true); } }
      function outside(e) { if (menu && !menu.contains(e.target) && !e.target.closest('.rte-btn[data-cmd=color],.rte-btn[data-cmd=hilite],.rte-btn[data-cmd=block],.rte-btn[data-cmd=size]')) closeMenu(); }
      function clearColor(kind) { // remove text colour / highlight from the selected text
        var s = window.getSelection(); if (!s.rangeCount) return;
        var r = s.getRangeAt(0), prop = kind === 'color' ? 'color' : 'backgroundColor';
        Array.prototype.slice.call(ed.querySelectorAll('span[style], font')).forEach(function (el) {
          if (!r.intersectsNode(el)) return;
          if (el.tagName === 'FONT') { if (kind === 'color') el.removeAttribute('color'); } else el.style[prop] = '';
          if (el.tagName === 'FONT' ? !el.attributes.length : !el.getAttribute('style')) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }
        });
      }
      function applyColor(kind, val) {
        useSel();
        if (!val) clearColor(kind);
        else {
          try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
          document.execCommand(kind === 'color' ? 'foreColor' : (document.queryCommandSupported && document.queryCommandSupported('hiliteColor') ? 'hiliteColor' : 'backColor'), false, val);
          try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
          last[kind] = val; paintBtns();
        }
        closeMenu(); sync(); state();
      }
      function paintBtns() {
        var c = bar.querySelector('[data-cmd=color] .rte-swatch-bar'), h = bar.querySelector('[data-cmd=hilite] .rte-swatch-bar');
        if (c) c.style.background = last.color; if (h) h.style.background = last.hilite;
      }
      // ---- heading levels & font size ----
      var BLOCKS = [['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4']];
      var SIZES = ['', 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
      function curBlock() { var v = ''; try { v = String(document.queryCommandValue('formatBlock')).toLowerCase().replace(/[<>]/g, ''); } catch (e) {} return /^h[1-4]$/.test(v) ? v : 'p'; }
      function curSize() {
        var s = window.getSelection(), n = s.rangeCount ? s.anchorNode : null;
        for (; n && n !== ed; n = n.parentNode) if (n.nodeType === 1 && n.style && n.style.fontSize) return parseInt(n.style.fontSize, 10) || '';
        return '';
      }
      function placeMenu(btn) {
        wrap.appendChild(menu);
        var br = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        menu.style.left = Math.max(4, Math.min(br.left - wr.left, wr.width - menu.offsetWidth - 4)) + 'px';
        menu.style.top = (br.bottom - wr.top + 6) + 'px';
        document.addEventListener('mousedown', outside, true);
      }
      function applyBlock(tag) { useSel(); document.execCommand('formatBlock', false, '<' + tag + '>'); closeMenu(); sync(); state(); }
      function applySize(px) {
        useSel();
        var s = window.getSelection(); if (!s.rangeCount) { closeMenu(); return; }
        if (s.isCollapsed) { // no selection: size the whole current paragraph
          var blk = s.anchorNode; while (blk && blk.parentNode !== ed) blk = blk.parentNode;
          if (blk && blk.nodeType === 1) { var r0 = document.createRange(); r0.selectNodeContents(blk); s.removeAllRanges(); s.addRange(r0); }
        }
        var r = s.getRangeAt(0);
        if (!px) Array.prototype.slice.call(ed.querySelectorAll('span[style]')).forEach(function (el) { // Default: drop sizes in the selection
          if (!r.intersectsNode(el) || !el.style.fontSize) return;
          el.style.fontSize = ''; if (!el.getAttribute('style')) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); }
        });
        if (px) {
          try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
          document.execCommand('fontSize', false, '7');
          var made = [];
          Array.prototype.slice.call(ed.querySelectorAll('font[size="7"]')).forEach(function (f) {
            var sp = document.createElement('span'); sp.style.fontSize = px + 'px';
            if (f.getAttribute('color')) sp.style.color = f.getAttribute('color');
            while (f.firstChild) sp.appendChild(f.firstChild);
            f.parentNode.replaceChild(sp, f);
            Array.prototype.forEach.call(sp.querySelectorAll('span[style]'), function (inner) { inner.style.fontSize = ''; });
            made.push(sp);
          });
          if (made.length) { var nr = document.createRange(); nr.setStart(made[0], 0); nr.setEnd(made[made.length - 1], made[made.length - 1].childNodes.length); s.removeAllRanges(); s.addRange(nr); }
          Array.prototype.forEach.call(ed.querySelectorAll('span[style=""], span:not([style])'), function (el) { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); });
        }
        closeMenu(); sync(); state();
      }
      function listMenu(btn, kind) {
        if (menu && menu._kind === kind) { closeMenu(); return; }
        closeMenu(); keepSel();
        var cur = kind === 'block' ? curBlock() : curSize();
        menu = document.createElement('div'); menu._kind = kind; menu.className = 'rte-pop rte-list ' + (kind === 'block' ? 'is-block' : 'is-size'); menu.setAttribute('role', 'menu');
        menu.innerHTML = '<div class="rte-pop-hd">' + (kind === 'block' ? 'Text style' : 'Font size') + '</div>' + (kind === 'block'
          ? BLOCKS.map(function (o) { return '<button type="button" role="menuitem" class="rte-opt' + (o[0] === cur ? ' on' : '') + '" data-v="' + o[0] + '"><' + (o[0] === 'p' ? 'span' : o[0]) + ' class="rte-opt-' + o[0] + '">' + o[1] + '</' + (o[0] === 'p' ? 'span' : o[0]) + '>' + (o[0] === 'p' ? '' : '<kbd>' + o[0].toUpperCase() + '</kbd>') + '</button>'; }).join('')
          : '<div class="rte-size-grid">' + SIZES.map(function (v) { return '<button type="button" role="menuitem" class="rte-opt' + (String(v) === String(cur) ? ' on' : '') + '" data-v="' + v + '">' + (v ? v : 'Default') + '</button>'; }).join('') + '</div>');
        menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
        Array.prototype.forEach.call(menu.querySelectorAll('.rte-opt'), function (o) { o.addEventListener('click', function () { var v = o.getAttribute('data-v'); if (kind === 'block') applyBlock(v); else applySize(v ? parseInt(v, 10) : 0); }); });
        placeMenu(btn);
      }
      function colorMenu(btn, kind) {
        if (menu && menu._kind === kind) { closeMenu(); return; }
        closeMenu(); keepSel();
        menu = document.createElement('div'); menu._kind = kind; menu.className = 'rte-pop'; menu.setAttribute('role', 'dialog');
        menu.innerHTML = '<div class="rte-pop-hd">' + (kind === 'color' ? 'Text colour' : 'Highlight') + '</div><div class="rte-pop-grid">' + COLORS[kind].map(function (c) {
          return '<button type="button" class="rte-sw' + (c[1] ? '' : ' none') + '" data-v="' + c[1] + '" title="' + c[0] + '" aria-label="' + c[0] + '" style="' + (c[1] ? '--sw:' + c[1] : '') + '">' + (c[1] ? '' : '<i class="bi bi-slash-circle"></i>') + '</button>';
        }).join('') + '</div><label class="rte-pop-custom"><input type="color" value="' + last[kind] + '"> <span>Custom colour\u2026</span></label>';
        menu.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
        Array.prototype.forEach.call(menu.querySelectorAll('.rte-sw'), function (sw) { sw.addEventListener('click', function () { applyColor(kind, sw.getAttribute('data-v')); }); });
        var ci = menu.querySelector('input[type=color]'); ci.addEventListener('change', function () { applyColor(kind, ci.value); });
        wrap.appendChild(menu);
        var br = btn.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        menu.style.left = Math.max(4, Math.min(br.left - wr.left, wr.width - menu.offsetWidth - 4)) + 'px';
        menu.style.top = (br.bottom - wr.top + 6) + 'px';
        document.addEventListener('mousedown', outside, true);
      }
      ed.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
      function sync() {
        var h = ed.innerHTML.trim(), nv = (ed.textContent.trim() === '' && !ed.querySelector('li')) ? '' : h;
        if (ta.value !== nv) {
          ta.value = nv;
          try { ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        }
        var w = ed.textContent.trim() ? ed.textContent.trim().split(/\s+/).length : 0;
        count.textContent = w + (w === 1 ? ' word' : ' words');
        wrap.classList.toggle('is-empty', ed.textContent.trim() === '' && !ed.querySelector('li'));
      }
      function state() {
        Array.prototype.forEach.call(bar.querySelectorAll('.rte-btn'), function (b) {
          var c = b.getAttribute('data-cmd'), on = false;
          try {
            if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].indexOf(c) > -1) on = document.queryCommandState(c);
            else if (c === 'blockquote') on = String(document.queryCommandValue('formatBlock')).toLowerCase().replace(/[<>]/g, '') === c;
            else if (c === 'block' && ed.contains(window.getSelection().anchorNode)) { var bv = curBlock(); b.querySelector('.rte-lbl').textContent = bv === 'p' ? 'Normal' : 'Heading ' + bv.slice(1); on = bv !== 'p'; }
            else if (c === 'size' && ed.contains(window.getSelection().anchorNode)) { var sv = curSize(); b.querySelector('.rte-lbl').textContent = sv ? sv + 'px' : 'Size'; on = !!sv; }
          } catch (e) {}
          b.classList.toggle('on', !!on);
        });
      }
      ed.addEventListener('input', sync);
      ed.addEventListener('keyup', state); ed.addEventListener('mouseup', state);
      ed.addEventListener('focus', function () { wrap.classList.add('focus'); });
      ed.addEventListener('blur', function () { wrap.classList.remove('focus'); sync(); });
      ed.addEventListener('paste', function (e) { // paste as clean text (keeps line breaks)
        var t = (e.clipboardData || window.clipboardData); if (!t) return;
        e.preventDefault();
        var txt = t.getData('text/plain') || '';
        document.execCommand('insertHTML', false, txt.split(/\r?\n/).map(esc).join('<br>'));
        sync();
      });
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch (e) {}
      if (ta.form) ta.form.addEventListener('submit', sync);
      ta.style.display = 'none';
      wrap.appendChild(fsHead); wrap.appendChild(bar); wrap.appendChild(ed); wrap.appendChild(count);
      ta.parentNode.insertBefore(wrap, ta);
      paintBtns();
      sync();
    });
  }

  /* ---------- custom select menus (styled list instead of the browser's plain option list) ---------- */
  function richSelects() {
    if (!window.MutationObserver || !document.body || !Object.getOwnPropertyDescriptor) return;
    var SKIP = '[multiple], [size]:not([size="1"]), [data-native], .ag-root-wrapper select, .flatpickr-calendar select, .rs-native';
    var desc = { value: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value'), selectedIndex: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex') };
    var open = null; // { sel, btn, panel }
    var uid = 0;
    function txt(o) { return o ? (o.label || o.textContent || '').trim() : ''; }
    function close(focusBtn) {
      if (!open) return;
      var o = open; open = null;
      o.panel.classList.remove('show'); o.btn.setAttribute('aria-expanded', 'false'); o.btn.classList.remove('open');
      setTimeout(function () { if (o.panel.parentNode && !o.panel.classList.contains('show')) o.panel.parentNode.removeChild(o.panel); }, 160);
      if (focusBtn) o.btn.focus();
    }
    function place(btn, panel) {
      var r = btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
      var below = vh - r.bottom - 12, above = r.top - 12;
      var up = below < 240 && above > below;
      var maxH = Math.max(160, Math.min(360, (up ? above : below) - 8));
      panel.style.width = 'auto';
      panel.style.minWidth = Math.min(Math.max(r.width, 240), vw - 16) + 'px';
      panel.style.maxWidth = Math.min(Math.max(r.width, 420), vw - 16) + 'px';
      var pw = panel.offsetWidth;
      panel.style.left = Math.max(8, Math.min(r.left, vw - pw - 8)) + 'px';
      panel.querySelector('.rs-list').style.maxHeight = maxH + 'px';
      panel.classList.toggle('up', up);
      if (up) { panel.style.top = ''; panel.style.bottom = (vh - r.top + 6) + 'px'; } else { panel.style.bottom = ''; panel.style.top = (r.bottom + 6) + 'px'; }
    }
    function refresh(sel) {
      var btn = sel._rsBtn; if (!btn) return;
      var o = sel.options[sel.selectedIndex];
      var lab = btn.querySelector('.rs-label');
      if (!lab) { btn.innerHTML = '<span class="rs-label"></span>'; lab = btn.firstChild; }
      var empty = !o || o.value === '';
      var sub = o && o.getAttribute('data-sub');
      if (sub) { // two-line option: label with a small code underneath
        lab.innerHTML = '<span class="rs-main"></span><small class="rs-sub"></small>';
        lab.firstChild.textContent = txt(o); lab.lastChild.textContent = sub;
      } else lab.textContent = o ? txt(o) || '\u00a0' : '\u00a0';
      btn.classList.toggle('rs-two', !!sub);
      btn.classList.toggle('rs-empty', empty);
      btn.disabled = sel.disabled;
      btn.title = o ? txt(o) + (sub ? ' (' + sub + ')' : '') : '';
    }
    function build(sel, panel, q) {
      var list = panel.querySelector('.rs-list'); list.innerHTML = '';
      q = (q || '').toLowerCase(); var any = false, idx = 0;
      Array.prototype.forEach.call(sel.children, function (node) {
        var group = node.tagName === 'OPTGROUP' ? node : null;
        var opts = group ? node.children : [node];
        var head = null;
        Array.prototype.forEach.call(opts, function (o) {
          if (o.tagName !== 'OPTION' || o.hidden) return;
          var t = txt(o), sb = o.getAttribute('data-sub') || ''; if (q && (t + ' ' + sb).toLowerCase().indexOf(q) < 0) return;
          if (group && !head) { head = document.createElement('div'); head.className = 'rs-group'; head.textContent = group.label; list.appendChild(head); }
          var it = document.createElement('div');
          it.className = 'rs-opt' + (o.selected ? ' sel' : '') + (o.disabled || (group && group.disabled) ? ' dis' : '') + (o.value === '' ? ' ph' : '');
          it.setAttribute('role', 'option'); it.setAttribute('aria-selected', o.selected ? 'true' : 'false');
          it.id = 'rs' + sel._rsId + '_' + (idx++); it._opt = o;
          it.innerHTML = '<span class="rs-t"></span><i class="bi bi-check2 rs-tick"></i>';
          it.querySelector('.rs-t').textContent = t || '\u00a0';
          if (sb) { it.classList.add('rs-two'); var sm = document.createElement('small'); sm.className = 'rs-sub'; sm.textContent = sb; it.querySelector('.rs-t').appendChild(sm); }
          list.appendChild(it); any = true;
        });
      });
      if (!any) { var n = document.createElement('div'); n.className = 'rs-none'; n.textContent = 'No matches'; list.appendChild(n); }
      var cur = list.querySelector('.rs-opt.sel') || list.querySelector('.rs-opt:not(.dis)');
      act(panel, cur, true);
    }
    function act(panel, it, scroll) {
      Array.prototype.forEach.call(panel.querySelectorAll('.rs-opt.act'), function (x) { x.classList.remove('act'); });
      if (!it) return; it.classList.add('act');
      panel.querySelector('.rs-list').setAttribute('aria-activedescendant', it.id);
      if (scroll) { // scroll only the list (never the page, which would close the menu)
        var l = panel.querySelector('.rs-list'), top = it.offsetTop - l.offsetTop;
        if (top < l.scrollTop) l.scrollTop = top; else if (top + it.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = top + it.offsetHeight - l.clientHeight;
      }
    }
    function choose(sel, it) {
      if (!it || it.classList.contains('dis')) return;
      var o = it._opt, changed = !o.selected;
      o.selected = true; refresh(sel); close(true);
      if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function openFor(sel) {
      if (sel.disabled) return;
      if (open && open.sel === sel) { close(true); return; }
      close(false);
      var btn = sel._rsBtn, panel = document.createElement('div');
      panel.className = 'rs-panel'; if (btn.closest('[data-bs-theme="dark"]')) panel.setAttribute('data-bs-theme', 'dark');
      var many = sel.options.length > 8;
      panel.innerHTML = (many ? '<div class="rs-search"><i class="bi bi-search"></i><input type="text" placeholder="Search\u2026" aria-label="Search options" autocomplete="off"></div>' : '') + '<div class="rs-list" role="listbox" tabindex="-1"></div>';
      document.body.appendChild(panel);
      build(sel, panel, '');
      place(btn, panel);
      open = { sel: sel, btn: btn, panel: panel };
      btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
      requestAnimationFrame(function () { if (open && open.panel === panel) panel.classList.add('show'); else if (panel.parentNode) panel.parentNode.removeChild(panel); });
      var s = panel.querySelector('.rs-search input');
      if (s) { s.addEventListener('input', function () { build(sel, panel, s.value); }); s.addEventListener('keydown', function (e) { keys(e, sel, panel); }); setTimeout(function () { s.focus(); }, 30); }
      panel.addEventListener('mousedown', function (e) { if (!e.target.closest('input')) e.preventDefault(); });
      panel.addEventListener('click', function (e) { var it = e.target.closest('.rs-opt'); if (it) choose(sel, it); });
      panel.addEventListener('mousemove', function (e) { var it = e.target.closest('.rs-opt:not(.dis)'); if (it && !it.classList.contains('act')) act(panel, it, false); });
    }
    function keys(e, sel, panel) {
      var items = Array.prototype.slice.call(panel.querySelectorAll('.rs-opt:not(.dis)')), cur = panel.querySelector('.rs-opt.act'), i = items.indexOf(cur);
      if (e.key === 'ArrowDown') { e.preventDefault(); act(panel, items[Math.min(items.length - 1, i + 1)] || items[0], true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act(panel, items[Math.max(0, i - 1)] || items[0], true); }
      else if (e.key === 'Home') { e.preventDefault(); act(panel, items[0], true); }
      else if (e.key === 'End') { e.preventDefault(); act(panel, items[items.length - 1], true); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel, cur); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { close(false); }
    }
    function enhance(sel) {
      if (sel._rsBtn || sel.matches(SKIP) || !sel.classList.contains('form-select') && !sel.closest('.rf-field')) return;
      sel._rsId = ++uid;
      var wrap = document.createElement('span'); wrap.className = 'rs-wrap';
      var btn = document.createElement('button'); btn.type = 'button';
      // only look-related classes go on the button (page scripts find selects by their own classes)
      btn.className = 'rs-btn form-select' + (sel.classList.contains('form-select-sm') ? ' form-select-sm' : '') + (sel.classList.contains('form-select-lg') ? ' form-select-lg' : '');
      btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
      var lbl = sel.id && document.querySelector('label[for="' + sel.id.replace(/"/g, '') + '"]');
      if (lbl) { if (!lbl.id) lbl.id = 'rsl' + sel._rsId; btn.setAttribute('aria-labelledby', lbl.id); }
      else if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
      btn.innerHTML = '<span class="rs-label"></span>';
      ['maxWidth', 'width', 'minWidth', 'flex'].forEach(function (k) { if (sel.style[k]) wrap.style[k] = sel.style[k]; });
      ['mb-1', 'mb-2', 'mb-3', 'mt-1', 'mt-2', 'mt-3', 'w-auto', 'w-100', 'd-inline-block'].forEach(function (c) { if (sel.classList.contains(c)) wrap.classList.add(c); });
      if (getComputedStyle(sel).display.indexOf('inline') === 0 || sel.classList.contains('w-auto')) wrap.classList.add('inline');
      sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel); wrap.appendChild(btn);
      sel.classList.add('rs-hidden'); sel.tabIndex = -1; sel._rsBtn = btn;
      // status selects (e.g. form Open / Draft / Closed): mirror the value so the box can be coloured
      if (sel.hasAttribute('data-status')) { var st = function () { sel.setAttribute('data-status', sel.value); wrap.setAttribute('data-status', sel.value); }; st(); sel.addEventListener('change', st); }
      btn.addEventListener('click', function () { openFor(sel); });
      btn.addEventListener('keydown', function (e) {
        if (open && open.sel === sel) { keys(e, sel, open.panel); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ' || e.key === 'Alt') { e.preventDefault(); openFor(sel); }
      });
      sel.addEventListener('focus', function () { btn.focus(); });
      sel.addEventListener('change', function () { refresh(sel); });
      sel.addEventListener('invalid', function () { btn.classList.add('is-invalid'); });
      ['value', 'selectedIndex'].forEach(function (k) {
        if (!desc[k]) return;
        try { Object.defineProperty(sel, k, { configurable: true, get: function () { return desc[k].get.call(this); }, set: function (v) { desc[k].set.call(this, v); refresh(this); } }); } catch (e) {}
      });
      new MutationObserver(function () { refresh(sel); if (open && open.sel === sel) build(sel, open.panel, ''); }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
      refresh(sel);
    }
    function scan(root) { Array.prototype.forEach.call((root && root.querySelectorAll ? root : document).querySelectorAll('select'), enhance); }
    scan(document);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') enhance(n); else if (n.querySelector && n.querySelector('select')) scan(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('mousedown', function (e) { if (open && !open.panel.contains(e.target) && !open.btn.contains(e.target)) close(false); }, true);
    window.addEventListener('resize', function () { close(false); });
    document.addEventListener('scroll', function (e) { // follow the field while the page scrolls; close if it leaves the screen
      if (!open || open.panel.contains(e.target)) return;
      var r = open.btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) close(false); else place(open.btn, open.panel);
    }, true);
    document.addEventListener('reset', function (e) { setTimeout(function () { Array.prototype.forEach.call(e.target.querySelectorAll('select'), refresh); }, 0); }, true);
  }

  function init() {
    try { pubHeader(); } catch (e) { if (window.console) console.warn('pubHeader', e); }
    themeSwitch();
    try { richEditors(); } catch (e) { if (window.console) console.warn('richEditors', e); }
    pubTop();
    fieldEnhance();
    fieldIcons();
    try { richSelects(); } catch (e) { if (window.console) console.warn('richSelects', e); }
    rfAnswered();
    datePickers();
    autoPlaceholders();
    topbarFit();
    if (window.bootstrap) userMenu(); else window.addEventListener('load', userMenu);
    document.body.appendChild(bar);
    setupPrefetch(); lazyMedia(); reveal(); flashes(); stickCols(); clipTextWatch();
    document.addEventListener('pointerdown', ripple, { passive: true });
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a'); if (!a || a.dataset.bsToggle || !sameSiteLink(a)) return;
      barStart();
    });
    document.addEventListener('submit', function (e) {
      var f = e.target; if (e.defaultPrevented || f.target === '_blank' || f.hasAttribute('data-no-loading')) return;
      var act = f.getAttribute('action') || ''; var isFile = SKIP.test(act) || f.querySelector('[name=format]');
      if (!isFile) barStart();
      var b = e.submitter || f.querySelector('button[type=submit], button:not([type])');
      if (b && b.classList.contains('btn') && !isFile) { b.classList.add('is-loading'); setTimeout(function () { b.classList.remove('is-loading'); }, 10000); }
    });
    window.addEventListener('pageshow', function () { barDone(); document.querySelectorAll('.btn.is-loading').forEach(function (b) { b.classList.remove('is-loading'); }); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();