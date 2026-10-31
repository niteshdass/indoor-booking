import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCooldown } from '../auth/useCooldown';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { OtpInput } from '../components/ui/OtpInput';
import { PhoneInput } from '../components/ui/PhoneInput';
import { TextField } from '../components/ui/TextField';
import { apiPost } from '../lib/apiClient';
import { errorMessage } from '../lib/errors';
import type { OtpSent } from '../lib/types';
import styles from './GuestForm.module.css';

export type GuestInput = { name: string; phone: string; otpCode?: string };

type Props = {
  otpRequired: boolean;
  onSubmit(guest: GuestInput): void;
  pending: boolean;
  slug: string;
  /** Submit label. */
  label: string;
  /** Disables submit from outside, e.g. while the quote is refreshing. */
  disabled?: boolean;
  /** Changing this value clears the typed code (after a rejected code). */
  codeResetSignal?: number;
};

export function GuestForm({ otpRequired, onSubmit, pending, slug, label, disabled = false, codeResetSignal = 0 }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(60);

  useEffect(() => setCode(''), [codeResetSignal]);

  const sent = sentTo !== null && sentTo === phone;
  const ready = name.trim() !== '' && phone !== '' && (!otpRequired || (sent && code.length === 6));

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await apiPost<OtpSent>(`/venues/${encodeURIComponent(slug)}/bookings/otp`, { phone });
      setSentTo(phone);
      setCode('');
      cooldown.start(res.resendInSec);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || pending || disabled) return;
    setError(null);
    onSubmit({ name: name.trim(), phone, ...(otpRequired ? { otpCode: code } : {}) });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <TextField icon="person" label={t('checkout.guestName')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      <PhoneInput label={t('auth.phone.label')} value={phone} onChange={(v) => {
          if (v === phone) return;
          setPhone(v);
          setCode('');
          setSentTo(null);
        }}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {otpRequired && !sent && (
        <Button variant="secondary" size="lg" icon="send" block loading={sending} disabled={!phone || cooldown.left > 0} onClick={() => void sendCode()}>
          {t('checkout.sendCode')}
        </Button>
      )}
      {otpRequired && sent && (
        <>
          <p className={styles.sent}>{t('auth.phone.sentTo', { phone })}</p>
          <OtpInput label={t('auth.phone.code')} value={code} onChange={setCode} />
          <Button variant="ghost" size="lg" icon="send" block disabled={cooldown.left > 0 || sending} onClick={() => void sendCode()}>
            {cooldown.left > 0 ? (
              <span className={styles.countdown}>{t('auth.phone.resendIn', { sec: cooldown.left })}</span>
            ) : (
              t('auth.phone.resend')
            )}
          </Button>
        </>
      )}
      <Button type="submit" variant="brand" size="lg" icon="calendarCheck" block loading={pending} disabled={!ready || disabled}>
        {label}
      </Button>
    </form>
  );
}
