// Apply the saved theme before the app renders, so dark mode never flashes white.
try {
  var t = localStorage.getItem('lm_theme');
  if (t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-vivid', localStorage.getItem('lm_vivid') === '0' ? '0' : '1');
} catch (e) { document.documentElement.setAttribute('data-vivid', '1'); }
