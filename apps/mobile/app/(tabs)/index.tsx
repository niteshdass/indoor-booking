import { useTranslation } from 'react-i18next';
import { Screen, Text } from '../../src/ui';

export default function FindScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Text variant="heading" tone="strong">
        {t('mobile.tabs.find')}
      </Text>
    </Screen>
  );
}
