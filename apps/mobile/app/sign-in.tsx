import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { safeNext } from '../src/auth/safeNext';
import { useAuth, type NativeAuthResponse } from '../src/auth/useAuth';
import { useCooldown } from '../src/auth/useCooldown';
import { apiPost } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';
import { Button, Field, Screen, Text } from '../src/ui';

type OtpSent = { expiresInSec: number; resendInSec: number };

/** Phone OTP sign-in: request a code, then verify it. Email and password live one tap away. */
export default function SignInScreen() {
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { signIn } = useAuth();
  const { next: rawNext } = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(rawNext);
  const query = rawNext ? `?next=${encodeURIComponent(next)}` : '';

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(60);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, tr));
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      const sent = await apiPost<OtpSent>('/auth/otp/request', { phone });
      setCode('');
      setCodeSent(true);
      cooldown.start(sent.resendInSec);
    });

  const verify = () =>
    run(async () => {
      const res = await apiPost<NativeAuthResponse>('/auth/otp/verify', { phone, code });
      await signIn(res);
      router.replace(next as never);
    });

  return (
    <Screen scroll>
      <>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('auth.login.titlePhone')}
        </Text>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        {!codeSent ? (
          <>
            <Field
              label={tr('auth.phone.label')}
              hint={tr('mobile.auth.phoneHint')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
            <Button label={tr('auth.phone.sendCode')} loading={busy} disabled={!phone} onPress={() => void requestCode()} />
          </>
        ) : (
          <>
            <Text tone="muted">{tr('auth.phone.sentTo', { phone })}</Text>
            <Field
              label={tr('auth.phone.code')}
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
            />
            <Button label={tr('auth.phone.verify')} loading={busy} disabled={code.length !== 6} onPress={() => void verify()} />
            <Button
              label={cooldown.left > 0 ? tr('auth.phone.resendIn', { sec: cooldown.left }) : tr('auth.phone.resend')}
              variant="secondary"
              disabled={cooldown.left > 0 || busy}
              onPress={() => void requestCode()}
            />
            <Button
              label={tr('auth.phone.change')}
              variant="ghost"
              onPress={() => {
                setCodeSent(false);
                setCode('');
                setError(null);
              }}
            />
          </>
        )}

        <Button label={tr('auth.login.withEmail')} variant="ghost" onPress={() => router.push(`/sign-in/email${query}` as never)} />
        <Button label={tr('auth.login.toRegister')} variant="ghost" onPress={() => router.push(`/register${query}` as never)} />
      </>
    </Screen>
  );
}
