import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import { i18nReady } from './i18n';
import { App } from './App';
import { initErrorReporting } from './lib/errorReporting';

void initErrorReporting();

// A failed locale fetch still renders (in English) rather than leaving a blank page.
void i18nReady.finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
