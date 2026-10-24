import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useCooldown } from '../auth/useCooldown';
import { BookingFacts } from '../bookings/BookingFacts';
import { CancelDialog } from '../bookings/CancelDialog';
import { RefundList } from '../bookings/RefundList';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { OtpInput } from '../components/ui/OtpInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { Spinner } from '../components/ui/Spinner';
import { TextField } from '../components/ui/TextField';
import { apiGet, apiPost, ApiError } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { BookingJson, CancellationPreview, OtpSent, RefundJson } from '../lib/types';
import styles from './LookupPage.module.css';

const CANCELLABLE = new Set(['pending', 'confirmed']);

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; booking: BookingJson }
  | { status: 'not_found' }
  | { status: 'error'; error: unknown };

export function LookupPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const urlRef = (params.get('reference') ?? '').trim().toUpperCase();
  const urlPhone = params.get('phone') ?? '';
  const isNew = params.get('new') === '1';

  const [reference, setReference] = useState(urlRef);
  const [phone, setPhone] = useState(urlPhone);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [refunds, setRefunds] = useState<RefundJson[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelledAt, setCancelledAt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const query = `reference=${encodeURIComponent(urlRef)}&phone=${encodeURIComponent(urlPhone)}`;

  useEffect(() => {
    if (!urlRef || !urlPhone) {
      setState({ status: 'idle' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    setRefunds([]);
    apiGet<{ booking: BookingJson }>(`/bookings/lookup?reference=${encodeURIComponent(urlRef)}&phone=${encodeURIComponent(urlPhone)}`).then(
      (res) => live && setState({ status: 'ready', booking: res.booking }),
      (error) => live && setState(error instanceof ApiError && error.status === 404 ? { status: 'not_found' } : { status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [urlRef, urlPhone, attempt]);

  useEffect(() => {
    if (cancelledAt > 0) headingRef.current?.focus();
  }, [cancelledAt]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ref = reference.trim();
    if (!ref || !phone || state.status === 'loading') return;
    setParams({ reference: ref, phone }, { replace: true });
    setAttempt((n) => n + 1);
  };

  const booking = state.status === 'ready' ? state.booking : null;

  return (
    <main className={styles.page}>
      <h1 ref={headingRef} tabIndex={-1} className={[styles.title, isNew && booking ? styles.success : ''].filter(Boolean).join(' ')}>
        {isNew && booking ? t('booking.received') : t('lookup.title')}
      </h1>

      {!booking && (
        <>
          <p className={styles.intro}>{t('lookup.intro')}</p>
          <form className={styles.form} onSubmit={submit}>
            <TextField
              label={t('lookup.reference')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={reference}
              onChange={(e) => setReference(e.target.value.toUpperCase())}
            />
            <PhoneInput label={t('auth.phone.label')} value={phone} onChange={setPhone} />
            <Button type="submit" variant="brand" size="lg" block loading={state.status === 'loading'} disabled={!reference.trim() || !phone}>
              {t('lookup.submit')}
            </Button>
          </form>
        </>
      )}

      {state.status === 'loading' && (
        <div className={styles.loading}>
          <Spinner label={t('common.loading')} />
        </div>
      )}
      {state.status === 'not_found' && <Alert tone="danger">{t('lookup.notFound')}</Alert>}
      {state.status === 'error' && <Alert tone="danger">{state.error instanceof ApiError ? state.error.message : errorMessage(state.error, t)}</Alert>}

      {booking && (
        <>
          {isNew && <SaveReference reference={urlRef} phone={urlPhone} />}
          <BookingFacts booking={booking} />
          <RefundList refunds={refunds} />
          {booking.playerId !== null ? (
            <Alert tone="info">
              <span>{t('lookup.signInToManage')} </span>
              <Link to="/login">{t('lookup.signIn')}</Link>
            </Alert>
          ) : (
            CANCELLABLE.has(booking.status) && (
              <GuestCancel
                reference={urlRef}
                phone={urlPhone}
                query={query}
                open={cancelOpen}
                setOpen={setCancelOpen}
                onCancelled={(b, rs) => {
                  setState({ status: 'ready', booking: b });
                  setRefunds(rs);
                  setCancelOpen(false);
                  setCancelledAt((n) => n + 1);
                }}
              />
            )
          )}
        </>
      )}
    </main>
  );
}

function SaveReference({ reference, phone }: { reference: string; phone: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const available = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

  const copy = async () => {
    const link = `${window.location.origin}/lookup?reference=${encodeURIComponent(reference)}&phone=${encodeURIComponent(phone)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Alert tone="info">
      <div className={styles.save}>
        <p>{t('lookup.saveReference')}</p>
        {available && (
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            {t('lookup.copyLink')}
          </Button>
        )}
        <span className={styles.copied} aria-live="polite">
          {copied ? t('lookup.linkCopied') : ''}
        </span>
      </div>
    </Alert>
  );
}

type GuestCancelProps = {
  reference: string;
  phone: string;
  query: string;
  open: boolean;
  setOpen(open: boolean): void;
  onCancelled(b: BookingJson, refunds: RefundJson[]): void;
};

function GuestCancel({ reference, phone, query, open, setOpen, onCancelled }: GuestCancelProps) {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(60);

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await apiPost<OtpSent>('/bookings/lookup/otp', { reference, phone });
      setSent(true);
      setCode('');
      cooldown.start(res.resendInSec);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  };

  const extra = (
    <div className={styles.otp}>
      {error && <Alert tone="danger">{error}</Alert>}
      {!sent && <p className={styles.sent}>{t('lookup.codeNote')}</p>}
      {!sent && (
        <Button variant="secondary" size="lg" block loading={sending} disabled={cooldown.left > 0} onClick={() => void sendCode()}>
          {t('lookup.sendCode')}
        </Button>
      )}
      {sent && (
        <>
          <p className={styles.sent}>{t('auth.phone.sentTo', { phone })}</p>
          <OtpInput label={t('auth.phone.code')} value={code} onChange={setCode} />
          <Button variant="ghost" size="lg" block disabled={cooldown.left > 0 || sending} onClick={() => void sendCode()}>
            {cooldown.left > 0 ? <span className={styles.countdown}>{t('auth.phone.resendIn', { sec: cooldown.left })}</span> : t('auth.phone.resend')}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <>
      <Button variant="secondary" size="lg" block onClick={() => setOpen(true)}>
        {t('cancel.open')}
      </Button>
      <CancelDialog
        open={open}
        onClose={() => setOpen(false)}
        loadPreview={() => apiGet<{ preview: CancellationPreview }>(`/bookings/lookup/cancellation?${query}`).then((r) => r.preview)}
        cancel={(reason) =>
          apiPost<{ booking: BookingJson; refunds: RefundJson[] }>('/bookings/lookup/cancel', { reference, phone, otpCode: code, ...(reason ? { reason } : {}) })
        }
        onCancelled={onCancelled}
        extra={extra}
        canConfirm={sent && code.length === 6}
      />
    </>
  );
}
