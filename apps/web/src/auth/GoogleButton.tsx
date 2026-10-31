import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import type { AuthProvidersJson } from '@booking/shared';
import { apiGet, apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { AuthResponse } from '../lib/types';
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

let providers: Promise<string | null> | null = null;

/** The Google client ID set in the admin dashboard (or the server env), fetched once per page; null hides the button. */
function googleClientId(): Promise<string | null> {
  providers ??= apiGet<AuthProvidersJson>('/auth/providers').then(
    (p) => p.googleClientId,
    () => {
      providers = null; // try again on the next mount
      return null;
    },
  );
  return providers;
}

/** Tests: forget the cached client ID. */
export function resetGoogleClientId(): void {
  providers = null;
}

/**
 * Google's own button with an "or" rule under it; renders nothing when Google is not configured or fails to load.
 * Google draws the label itself, so `text` picks one of its presets: "Sign in with Google" or "Sign up with Google".
 */
export function GoogleButton({ text, onSignedIn }: { text: 'signin_with' | 'signup_with'; onSignedIn(res: AuthResponse): void }) {
  const { t, i18n } = useTranslation();
  const [clientId, setClientId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onSignedIn);
  handler.current = onSignedIn;
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void googleClientId().then((id) => {
      if (!cancelled) setClientId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
          // Filled blue stands out from the grey phone / email buttons in light and dark mode alike.
          theme: 'filled_blue',
          size: 'large',
          shape: 'rectangular',
          text,
          locale: i18n.language,
          // Google caps the button at 400px; fill the card up to that.
          ...(el.clientWidth ? { width: Math.min(el.clientWidth, 400) } : {}),
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
  }, [clientId, text, i18n.language, t]);

  if (!clientId || failed) return null;
  return (
    <>
      <div ref={box} className={styles.google} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={styles.divider} role="separator">
        <span>{t('auth.or')}</span>
      </div>
    </>
  );
}
