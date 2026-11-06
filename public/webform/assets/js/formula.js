/* Formula evaluator + condition engine \u2014 mirror of app/Libraries/Formula.php & Conditions.php */
(function (root) {
  'use strict';
  const FUNCS = ['if', 'round', 'floor', 'ceil', 'abs', 'sqrt', 'pow', 'log', 'ln', 'exp', 'min', 'max', 'sum', 'mean', 'coalesce', 'isblank', 'len', 'concat', 'upper', 'lower', 'today', 'now', 'datediff', 'year', 'month', 'day', 'contains', 'count', 'number', 'text', 'between', 'who_zscore'];

  // ---- WHO growth z-scores (mirror of app/Libraries/WhoGrowth.php); tables in assets/js/who-growth.js (window.RH_WHO)
  function whoSex(s) {
    if (s === null || s === undefined || s === '') return null;
    if (typeof s === 'number' || /^\s*\d+(\.0+)?\s*$/.test(String(s))) { const n = parseInt(s, 10); return n === 1 || n === 2 ? n : null; }
    s = String(s).trim().toLowerCase();
    if (['m', 'male', 'boy', 'man', 'masculin', 'gabo'].includes(s)) return 1;
    if (['f', 'female', 'girl', 'woman', 'feminin', 'féminin', 'gore'].includes(s)) return 2;
    return null;
  }
  function whoZraw(y, l, m, s) { return Math.abs(l) < 1e-12 ? Math.log(y / m) / s : (Math.pow(y / m, l) - 1) / (s * l); }
  function whoZadj(y, l, m, s) {
    let z = whoZraw(y, l, m, s); const sd = (k) => m * Math.pow(1 + l * s * k, 1 / l);
    if (z > 3) z = 3 + (y - sd(3)) / (sd(3) - sd(2)); else if (z < -3) z = -3 + (y - sd(-3)) / (sd(-2) - sd(-3));
    return z;
  }
  function whoRound(z) { return Math.round(z * 100 + (z >= 0 ? 1e-9 : -1e-9)) / 100; }
  function whoRow(tab, sx, i) { const T = root.RH_WHO; const t = T && T[tab] && T[tab][String(sx)]; if (!t) return null; return t.v[i - t.start] || null; }
  function whoLerp(a, b, f) { return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]; }
  function whoZ(ind, sex, ageDays, weight, height, oedema) {
    if (!root.RH_WHO) return null;
    ind = String(ind || '').trim().toLowerCase();
    ind = ({ waz: 'wfa', weight: 'wfa', haz: 'hfa', lfa: 'hfa', lhfa: 'hfa', height: 'hfa', whz: 'wfh', wfl: 'wfh', wlz: 'wfh', baz: 'bfa', bmi: 'bfa', bmiz: 'bfa' })[ind] || ind;
    const sx = whoSex(sex);
    if (!sx || !['wfa', 'hfa', 'wfh', 'bfa'].includes(ind)) return null;
    const num = (x) => (x === null || x === undefined || x === '' || isNaN(+x) ? null : +x);
    const w = num(weight) > 0 ? num(weight) : null, h = num(height) > 0 ? num(height) : null, ad = num(ageDays);
    if (ad !== null && ad < 0) return null;
    const oe = typeof oedema === 'string' ? ['1', 'y', 'yes', 'true', 'oui'].includes(oedema.trim().toLowerCase()) : !!oedema;
    if (oe && ind !== 'hfa') return null;
    const months = ad === null ? null : ad / 30.4375;
    if (ind === 'wfh') {
      if (w === null || h === null || (months !== null && months >= 60)) return null;
      const useL = ad !== null ? Math.floor(ad + 0.5) < 731 : h < 87;
      const [tab, lo, hi] = useL ? ['wfl', 45, 110] : ['wfh', 65, 120];
      if (h < lo || h > hi) return null;
      const t = root.RH_WHO[tab][String(sx)], base = Math.round(t.start * 10);
      const i10 = Math.floor(h * 10 + 1e-9), f = h * 10 - i10;
      let a = t.v[i10 - base]; if (!a) return null;
      if (f > 1e-9) { const b = t.v[i10 + 1 - base]; if (!b) return null; a = whoLerp(a, b, f); }
      return whoRound(whoZadj(w, a[0], a[1], a[2]));
    }
    if (ad === null) return null;
    const y = ind === 'wfa' ? w : ind === 'hfa' ? h : (w !== null && h !== null ? w / Math.pow(h / 100, 2) : null);
    if (y === null) return null;
    if (months < 60) {
      const r = whoRow(ind, sx, Math.floor(ad + 0.5)); if (!r) return null;
      return whoRound(ind === 'hfa' ? whoZraw(y, r[0], r[1], r[2]) : whoZadj(y, r[0], r[1], r[2]));
    }
    if (months >= (ind === 'wfa' ? 121 : 229)) return null;
    const low = Math.floor(months), f = months - low;
    let a = whoRow(ind + '07', sx, low); if (!a) return null;
    if (f > 0) { const b = whoRow(ind + '07', sx, low + 1); if (!b) return null; a = whoLerp(a, b, f); }
    return whoRound(ind === 'hfa' ? whoZraw(y, a[0], a[1], a[2]) : whoZadj(y, a[0], a[1], a[2]));
  }

  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1] || ''))) {
        const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i)); t.push(['num', parseFloat(m[0])]); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, buf = '';
        while (j < s.length && s[j] !== c) { if (s[j] === '\\' && j + 1 < s.length) j++; buf += s[j]; j++; }
        if (j >= s.length) throw new Error('Unterminated string');
        t.push(['str', buf]); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))[0]; const lw = w.toLowerCase(); i += w.length;
        if (['and', 'or', 'not'].includes(lw)) t.push(['op', lw]);
        else if (lw === 'true' || lw === 'false') t.push(['bool', lw === 'true']);
        else if (lw === 'null') t.push(['null', null]);
        else t.push(['id', w]);
        continue;
      }
      const two = s.substr(i, 2);
      if (['<=', '>=', '!=', '<>', '==', '&&', '||'].includes(two)) {
        t.push(['op', ({ '&&': 'and', '||': 'or', '==': '=', '<>': '!=' })[two] || two]); i += 2; continue;
      }
      if ('+-*/%^&=<>!(),'.includes(c)) {
        if (c === '!') t.push(['op', 'not']); else if ('(),'.includes(c)) t.push([c, c]); else t.push(['op', c]);
        i++; continue;
      }
      throw new Error("Unexpected character '" + c + "'");
    }
    t.push(['eof', null]); return t;
  }

  function parse(expr) {
    const tk = tokenize(expr); let p = 0;
    const peek = () => tk[p], next = () => tk[p++], isOp = (o) => tk[p][0] === 'op' && tk[p][1] === o;
    function or() { let l = and(); while (isOp('or')) { next(); l = ['bin', 'or', l, and()]; } return l; }
    function and() { let l = not(); while (isOp('and')) { next(); l = ['bin', 'and', l, not()]; } return l; }
    function not() { if (isOp('not')) { next(); return ['un', 'not', not()]; } return cmp(); }
    function cmp() { let l = add(); for (;;) { const t = peek(); if (t[0] === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(t[1])) { next(); l = ['bin', t[1], l, add()]; } else return l; } }
    function add() { let l = mul(); for (;;) { const t = peek(); if (t[0] === 'op' && ['+', '-', '&'].includes(t[1])) { next(); l = ['bin', t[1], l, mul()]; } else return l; } }
    function mul() { let l = unary(); for (;;) { const t = peek(); if (t[0] === 'op' && ['*', '/', '%'].includes(t[1])) { next(); l = ['bin', t[1], l, unary()]; } else return l; } }
    function unary() { if (isOp('-')) { next(); return ['un', '-', unary()]; } if (isOp('+')) { next(); return unary(); } return pow(); }
    function pow() { const b = primary(); if (isOp('^')) { next(); return ['bin', '^', b, unary()]; } return b; }
    function primary() {
      const t = next();
      switch (t[0]) {
        case 'num': case 'str': case 'bool': case 'null': return ['lit', t[1]];
        case '(': { const e = or(); if (next()[0] !== ')') throw new Error('Missing )'); return e; }
        case 'id':
          if (peek()[0] === '(') {
            next(); const fn = t[1].toLowerCase();
            if (!FUNCS.includes(fn)) throw new Error('Unknown function ' + t[1] + '()');
            const args = [];
            if (peek()[0] !== ')') { args.push(or()); while (peek()[0] === ',') { next(); args.push(or()); } }
            if (next()[0] !== ')') throw new Error('Missing ) after ' + fn + '(');
            return ['call', fn, args];
          }
          return ['var', t[1]];
      }
      throw new Error('Unexpected token');
    }
    const n = or();
    if (peek()[0] !== 'eof') throw new Error('Unexpected token near position ' + p);
    return n;
  }

  const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  const num = (v) => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.trim()))) return Number(v.trim());
    return null;
  };
  const truthy = (v) => typeof v === 'string' ? (v !== '' && v !== '0' && v.toLowerCase() !== 'false') : !!v && !(Array.isArray(v) && !v.length);
  const toDate = (v) => {
    if (typeof v !== 'string' || !v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  };
  const strv = (v) => typeof v === 'boolean' ? (v ? '1' : '0') : String(v);

  function cmp(a, b, op) {
    if (op === '=' || op === '!=') {
      let eq;
      if (Array.isArray(a) || Array.isArray(b)) eq = JSON.stringify(a) === JSON.stringify(b);
      else if (blank(a) && blank(b)) eq = true;
      else if (num(a) !== null && num(b) !== null) eq = num(a) === num(b);
      else eq = !blank(a) && !blank(b) && strv(a) === strv(b);
      return op === '=' ? eq : !eq;
    }
    if (blank(a) || blank(b)) return false;
    let x = num(a), y = num(b);
    if (x === null || y === null) { x = String(a); y = String(b); }
    return { '<': x < y, '<=': x <= y, '>': x > y, '>=': x >= y }[op];
  }

  function evalNode(n, vars) {
    switch (n[0]) {
      case 'lit': return n[1];
      case 'var': { const v = vars[n[1]]; return v === '' || v === undefined ? null : v; }
      case 'un': { const v = evalNode(n[2], vars); if (n[1] === 'not') return !truthy(v); const x = num(v); return x === null ? null : -x; }
      case 'bin': {
        const op = n[1];
        if (op === 'and') return truthy(evalNode(n[2], vars)) && truthy(evalNode(n[3], vars));
        if (op === 'or') return truthy(evalNode(n[2], vars)) || truthy(evalNode(n[3], vars));
        const a = evalNode(n[2], vars), b = evalNode(n[3], vars);
        if (['=', '!=', '<', '<=', '>', '>='].includes(op)) return cmp(a, b, op);
        if (op === '&') return (blank(a) ? '' : String(a)) + (blank(b) ? '' : String(b));
        const x = num(a), y = num(b);
        if (x === null || y === null) return null;
        switch (op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y;
          case '/': return y === 0 ? null : x / y; case '%': return y === 0 ? null : x % y; case '^': return Math.pow(x, y);
        }
        return null;
      }
      case 'call': return call(n[1], n[2], vars);
    }
    return null;
  }

  function roundHalfUp(x, d) { const f = Math.pow(10, d); return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f * (x < 0 && false ? -1 : 1); }
  function phpRound(x, d) { const f = Math.pow(10, d); const v = Math.abs(x) * f; return Math.sign(x) * Math.round(v + 1e-9) / f; }

  function monthsBetween(s, e) {
    let m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
    const sd = s.getUTCDate() * 86400 + s.getUTCHours() * 3600 + s.getUTCMinutes() * 60;
    const ed = e.getUTCDate() * 86400 + e.getUTCHours() * 3600 + e.getUTCMinutes() * 60;
    if (ed < sd) m -= 1;
    return m;
  }

  function call(fn, argNodes, vars) {
    if (fn === 'if') {
      const c = evalNode(argNodes[0] || ['lit', null], vars);
      return truthy(c) ? evalNode(argNodes[1] || ['lit', null], vars) : (argNodes[2] ? evalNode(argNodes[2], vars) : null);
    }
    const a = argNodes.map((x) => evalNode(x, vars));
    const n = (i) => num(a[i]);
    switch (fn) {
      case 'round': return n(0) === null ? null : phpRound(n(0), n(1) || 0);
      case 'floor': return n(0) === null ? null : Math.floor(n(0));
      case 'ceil': return n(0) === null ? null : Math.ceil(n(0));
      case 'abs': return n(0) === null ? null : Math.abs(n(0));
      case 'sqrt': return n(0) === null || n(0) < 0 ? null : Math.sqrt(n(0));
      case 'pow': return n(0) === null || n(1) === null ? null : Math.pow(n(0), n(1));
      case 'log': return n(0) === null || n(0) <= 0 ? null : Math.log10(n(0));
      case 'ln': return n(0) === null || n(0) <= 0 ? null : Math.log(n(0));
      case 'exp': return n(0) === null ? null : Math.exp(n(0));
      case 'min': case 'max': case 'sum': case 'mean': {
        const nums = [];
        a.forEach((v) => (Array.isArray(v) ? v : [v]).forEach((vv) => { const x = num(vv); if (x !== null) nums.push(x); }));
        if (!nums.length) return fn === 'sum' ? 0 : null;
        if (fn === 'min') return Math.min(...nums); if (fn === 'max') return Math.max(...nums);
        const s = nums.reduce((p, c) => p + c, 0); return fn === 'sum' ? s : s / nums.length;
      }
      case 'coalesce': for (const v of a) if (!blank(v)) return v; return null;
      case 'isblank': return blank(a[0]);
      case 'len': return blank(a[0]) ? 0 : (Array.isArray(a[0]) ? a[0].length : String(a[0]).length);
      case 'count': return Array.isArray(a[0]) ? a[0].length : (blank(a[0]) ? 0 : 1);
      case 'concat': return a.map((v) => blank(v) ? '' : (Array.isArray(v) ? v.join(',') : String(v))).join('');
      case 'upper': return blank(a[0]) ? null : String(a[0]).toUpperCase();
      case 'lower': return blank(a[0]) ? null : String(a[0]).toLowerCase();
      case 'number': return num(a[0]);
      case 'text': return blank(a[0]) ? null : String(a[0]);
      case 'between': return n(0) !== null && n(1) !== null && n(2) !== null && n(0) >= n(1) && n(0) <= n(2);
      case 'contains': {
        const hay = a[0], nd = a[1];
        if (Array.isArray(hay)) return hay.map(String).includes(String(nd));
        return !blank(hay) && !blank(nd) && String(hay).includes(String(nd));
      }
      case 'today': return new Date().toISOString().slice(0, 10);
      case 'now': return new Date().toISOString().slice(0, 16).replace('T', ' ');
      case 'year': case 'month': case 'day': {
        const d = toDate(a[0]); if (!d) return null;
        return fn === 'year' ? d.getUTCFullYear() : fn === 'month' ? d.getUTCMonth() + 1 : d.getUTCDate();
      }
      case 'who_zscore': return whoZ(a[0], a[1], a[2], a[3], a[4], a[5]);
      case 'datediff': {
        const d1 = toDate(a[0]), d2 = toDate(a[1]); if (!d1 || !d2) return null;
        const unit = String(a[2] || 'days').toLowerCase();
        const secs = (d2 - d1) / 1000, sign = secs < 0 ? -1 : 1;
        if (unit === 'hours') return phpRound(secs / 3600, 2);
        if (unit === 'minutes') return phpRound(secs / 60, 2);
        if (unit === 'weeks') return phpRound(secs / 604800, 2);
        if (unit === 'months' || unit === 'years') {
          const [s, e] = sign > 0 ? [d1, d2] : [d2, d1];
          const m = monthsBetween(s, e);
          return sign * (unit === 'months' ? m : Math.floor(m / 12));
        }
        return sign * Math.floor(Math.abs(secs) / 86400);
      }
    }
    return null;
  }

  function references(expr) {
    const out = new Set();
    const walk = (n) => {
      if (!Array.isArray(n)) return;
      if (n[0] === 'var') out.add(n[1]);
      if (n[0] === 'bin') { walk(n[2]); walk(n[3]); }
      if (n[0] === 'un') walk(n[2]);
      if (n[0] === 'call') n[2].forEach(walk);
    };
    walk(parse(expr)); return [...out];
  }

  // ------------------------------------------------------------------ conditions
  function rule(r, v) {
    const op = r.op || 'eq', c = r.value ?? '';
    if (typeof v === 'boolean') v = v ? '1' : '0';
    switch (op) {
      case 'empty': return blank(v);
      case 'not_empty': return !blank(v);
      case 'contains': return Array.isArray(v) ? v.map(String).includes(String(c)) : (!blank(v) && String(v).toLowerCase().includes(String(c).toLowerCase()));
      case 'not_contains': return !rule({ op: 'contains', value: c }, v);
      case 'in': return !blank(v) && String(c).split(',').map((s) => s.trim()).includes(String(v));
      case 'eq': case 'neq': {
        let eq;
        if (Array.isArray(v)) eq = v.map(String).includes(String(c));
        else if (!blank(v) && v !== null && !isNaN(Number(v)) && String(c) !== '' && !isNaN(Number(c))) eq = Number(v) === Number(c);
        else eq = String(v ?? '') === String(c);
        return op === 'eq' ? eq : !eq;
      }
      default: {
        if (blank(v) || (isNaN(Number(v)) && !/^\d{4}-\d{2}-\d{2}/.test(String(v)))) return false;
        let a = v, b = c;
        if (!isNaN(Number(v)) && !isNaN(Number(c))) { a = Number(v); b = Number(c); } else { a = String(v); b = String(c); }
        return { gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[op] ?? false;
      }
    }
  }
  function evaluateCondition(cond, data) {
    if (!cond || !cond.rules || !cond.rules.length) return true;
    const res = cond.rules.filter((r) => r.var).map((r) => rule(r, data[r.var]));
    if (!res.length) return true;
    return cond.logic === 'any' ? res.includes(true) : !res.includes(false);
  }

  root.RHFormula = {
    FUNCS, parse, references,
    evaluate(expr, vars) { return evalNode(parse(expr), vars); },
    tryEvaluate(expr, vars) { try { return evalNode(parse(expr), vars); } catch (e) { return null; } },
  };
  root.RHConditions = { evaluate: evaluateCondition, blank };
})(typeof window !== 'undefined' ? window : globalThis);
