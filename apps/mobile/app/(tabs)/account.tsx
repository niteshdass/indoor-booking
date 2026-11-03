import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PublicUser } from '@booking/shared';
import { requireSignIn } from '../../src/auth/requireSignIn';
import { useAuth } from '../../src/auth/useAuth';
import { setLanguage, SUPPORTED_LANGUAGES } from '../../src/i18n';
import { apiPatch } from '../../src/lib/api';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Card, Field, Screen, Text } from '../../src/ui';

function InfoRow({ label, value }: { label: string; value: string }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: t.space1 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text tone="strong">{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const { t: tr, i18n } = useTranslation();
  const { t } = useTheme();
  const router = useRouter();
  const { status, user, setUser, signOut } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <Screen>
        <Text variant="heading" tone="strong" accessibilityRole="header">
          {tr('mobile.tabs.account')}
        </Text>
        {status === 'signedOut' ? (
          <>
            <Text tone="muted">{tr('mobile.account.signedOut')}</Text>
            <Button label={tr('mobile.account.signedOutCta')} onPress={() => requireSignIn(router, '/account')} />
          </>
        ) : null}
      </Screen>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiPatch<{ user: PublicUser }>('/me', { name: name.trim() });
      setUser(res.user);
      setName(res.user.name);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err, tr));
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () =>
    Alert.alert(tr('profile.signOutConfirm.title'), tr('profile.signOutConfirm.body'), [
      { text: tr('profile.signOutConfirm.cancel'), style: 'cancel' },
      {
        text: tr('profile.signOut'),
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);

  return (
    <Screen scroll>
      <Text variant="heading" tone="strong" accessibilityRole="header">
        {tr('mobile.tabs.account')}
      </Text>

      <Card>
        <Text variant="title" tone="strong">
          {tr('profile.details')}
        </Text>
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {saved ? <Text tone="success">{tr('profile.saved')}</Text> : null}
        <Field
          label={tr('profile.name')}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setSaved(false);
          }}
          autoComplete="name"
          maxLength={80}
        />
        <Button label={tr('profile.save')} loading={busy} disabled={!name.trim() || name.trim() === user.name} onPress={() => void save()} />
      </Card>

      <Card>
        <Text variant="title" tone="strong">
          {tr('profile.signInMethods')}
        </Text>
        <InfoRow label={tr('profile.email')} value={user.email ?? tr('profile.notSet')} />
        <InfoRow label={tr('profile.phone')} value={user.phone ?? tr('profile.notSet')} />
      </Card>

      <Card>
        <Text variant="title" tone="strong">
          {tr('language.label')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space2 }}>
          {SUPPORTED_LANGUAGES.map((lng) => (
            <Button
              key={lng}
              label={tr(`language.${lng}`)}
              variant={i18n.language === lng ? 'primary' : 'secondary'}
              accessibilityState={{ selected: i18n.language === lng }}
              onPress={() => void setLanguage(lng)}
            />
          ))}
        </View>
        <Text variant="caption" tone="muted">
          {tr('mobile.account.themeNote')}
        </Text>
      </Card>

      <Button label={tr('profile.signOut')} variant="secondary" tone="danger" onPress={confirmSignOut} />
    </Screen>
  );
}
