import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Text } from '../ui';

export interface PaymentLinkCardProps {
  url: string;
  /** Label of the main share button. */
  shareLabel: string;
}

/** A payment link the customer can scan or receive: QR, the URL, Copy and Share (web PaymentLinkDialog). */
export function PaymentLinkCard({ url, shareLabel }: PaymentLinkCardProps) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => {
    void Clipboard.setStringAsync(url)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  const share = () => {
    void Share.share({ message: url }).catch(() => undefined);
  };
  return (
    <View style={{ gap: t.space3 }}>
      {/* The library's own black-on-white palette is kept (as on web): a scanner needs that contrast in both themes. */}
      <View accessible accessibilityRole="image" accessibilityLabel={tr('owner.link.qr')} style={{ alignSelf: 'center', padding: t.space3, borderRadius: t.radiusMd, borderWidth: t.hairline, borderColor: t.borderSubtle }}>
        <QRCode value={url} size={t.qrSize} quietZone={t.space2} />
      </View>
      <View style={{ backgroundColor: t.bgSubtle, borderRadius: t.radiusMd, padding: t.space3, gap: t.space1 }}>
        <Text variant="caption" tone="muted">
          {tr('owner.link.url')}
        </Text>
        <Text selectable tone="strong">
          {url}
        </Text>
      </View>
      <Button label={shareLabel} onPress={share} />
      <Button label={copied ? tr('owner.link.copied') : tr('owner.link.copy')} variant="secondary" onPress={copy} accessibilityLiveRegion="polite" />
    </View>
  );
}
