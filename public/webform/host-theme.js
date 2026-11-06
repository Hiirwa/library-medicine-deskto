// Light or dark before the form draws (the desktop app passes ?theme=). External file: the app's CSP allows no inline script.
(function () {
  try {
    var t = new URLSearchParams(location.search).get('theme');
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-bs-theme', t);
  } catch (e) { /* ignore */ }
})();
