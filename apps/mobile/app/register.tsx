import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { returnAfterSignIn } from '../src/auth/returnAfterSignIn';
import { safeNext } from '../src/auth/safeNext';
import { useAuth, type NativeAuthResponse } from '../src/auth/useAuth';
import { useCooldown } from '../src/auth/useCooldown';
import { ApiError, apiPost } from '../src/lib/api';
import { errorMessage } from '../src/lib/errors';
import { BackButton, Button, Field, Screen, Text } from '../src/ui';

type OtpSent = { expiresInSec: number; resendInSec: number };

/** The number is verified with a code first, then the account details are filled in (same as the web). */
export default function RegisterScreen() {
  const { t: tr } = useTranslation();
  const router = useRouter();
  const { signIn } = useAuth();
  const { next: rawNext } = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(rawNext);
  const query = rawNext ? `?next=${encodeURIComponent(next)}` : '';

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; inUse: boolean } | null>(null);
  const cooldown = useCooldown(60);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const inUse = err instanceof ApiError && (err.code === 'email_in_use' || err.code === 'phone_in_use');
      setError({ message: errorMessage(err, tr), inUse });
    } finally {
      setBusy(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      const sent = await apiPost<OtpSent>('/auth/register/otp/request', { phone });
      setCode('');
      setCodeSent(true);
      cooldown.start(sent.resendInSec);
    });

  const submit = () =>
    run(async () => {
      const res = await apiPost<NativeAuthResponse>('/auth/register', { name, email, password, phone, code });
      await signIn(res);
      returnAfterSignIn(router, rawNext);
    });

  return (
    <Screen scroll>
      <>
        <BackButton />
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('auth.register.titlePhone')}
        </Text>
        {error ? (
          <>
            <Text tone="danger" accessibilityRole="alert">
              {error.message}
            </Text>
            {error.inUse ? (
              <Button label={tr('auth.register.toLogin')} variant="secondary" onPress={() => router.replace(`/sign-in${query}` as never)} />
            ) : null}
          </>
        ) : null}

        {!codeSent ? (
          <>
            <Text tone="muted">{tr('auth.register.phoneFirst')}</Text>
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
            <Field label={tr('auth.name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} />
            <Field
              label={tr('auth.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <Field
              label={tr('auth.password')}
              hint={tr('auth.register.passwordHint')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
            />
            <Button
              label={tr('auth.register.submit')}
              loading={busy}
              disabled={code.length !== 6 || !name.trim() || !email || password.length < 8}
              onPress={() => void submit()}
            />
          </>
        )}

        <Button label={tr('auth.register.haveAccount')} variant="ghost" onPress={() => router.replace(`/sign-in${query}` as never)} />
      </>
    </Screen>
  );
}
