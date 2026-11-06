// Bridge between the desktop app and the website's form runtime.
// RH.toast is what the website's pages provide; here it forwards to the desktop app's toasts.
window.RH = window.RH || {};
window.mountForm = function (opts) {
  window.RH.toast = function (msg, kind) { if (opts.toast) opts.toast(msg, kind); };
  var root = document.getElementById('rfRoot');
  root.innerHTML = '';
  window.rhForm = new RHForm(root, opts);
  return window.rhForm;
};
window.setTheme = function (dark) { document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light'); };
window.dispatchEvent(new Event('lm-form-ready'));
