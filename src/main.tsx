import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './providers/AppProvider';
import './styles.css';

// keep the app feeling native: no browser context menu except in text fields
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('input, textarea, .selectable')) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
