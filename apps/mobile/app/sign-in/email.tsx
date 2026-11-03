import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { safeNext } from '../../src/auth/safeNext';
import { useAuth, type NativeAuthResponse } from '../../src/auth/useAuth';
import { apiPost } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { Button, Field, Screen, Text } from '../../src/ui';
import { useTheme } from '../../src/theme/ThemeProvider';

// The password reset flow lives on the web; the app only opens it.
const WEB_URL: string = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:5173';

export default function EmailSignInScreen() {
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const { signIn } = useAuth();
  const { next: rawNext } = useLocalSearchParams<{ next?: string }>();
  const next = safeNext(rawNext);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<NativeAuthResponse>('/auth/login', { email, password });
      await signIn(res);
      router.replace(next as never);
    } catch (err) {
      setError(errorMessage(err, tr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ gap: t.space4 }}>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('auth.login.titleEmail')}
        </Text>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
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
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
        />
        <Button label={tr('auth.login.submit')} loading={busy} disabled={!email || !password} onPress={() => void submit()} />
        <Button
          label={tr('auth.login.forgot')}
          variant="ghost"
          onPress={() => void WebBrowser.openBrowserAsync(`${WEB_URL}/forgot-password`)}
        />
        <Button label={tr('auth.login.otherOptions')} variant="ghost" onPress={() => router.back()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
