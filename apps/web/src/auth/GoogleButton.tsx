import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse } from '../lib/types';
import { useTheme } from '../theme/ThemeProvider';
import styles from './auth.module.css';

const SRC = 'https://accounts.google.com/gsi/client';
let loading: Promise<void> | null = null;

/** Injects the Google Identity script at most once per page; rejects if it cannot load. */
function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error('google script failed to load'));
    };
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', fail);
  });
  return loading;
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function GoogleButton({ onSignedIn }: { onSignedIn(res: AuthResponse): void }) {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onSignedIn);
  handler.current = onSignedIn;
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    const el = box.current;
    let cancelled = false;
    loadGoogle().then(
      () => {
        const gid = window.google?.accounts?.id;
        if (cancelled || !gid || !el) return;
        gid.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            setError(null);
            apiPost<AuthResponse>('/auth/google', { idToken: credential }).then(
              (res) => handler.current(res),
              (err) => setError(errorMessage(err, t)),
            );
          },
        });
        gid.renderButton(el, {
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text: 'continue_with',
          locale: i18n.language,
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      el?.replaceChildren();
    };
  }, [clientId, dark, i18n.language, t]);

  if (!clientId || failed) return null;
  return (
    <>
      <div className={styles.divider} role="separator">
        <span>{t('auth.or')}</span>
      </div>
      <div ref={box} className={styles.google} />
      {error && <Alert tone="danger">{error}</Alert>}
    </>
  );
}
