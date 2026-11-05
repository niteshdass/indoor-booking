import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { PaymentLinkCard } from '../../src/owner/PaymentLinkCard';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

const URL = 'https://bookaturf.test/pay/abc123';

describe('PaymentLinkCard', () => {
  it('shows the QR, the link, and copies it with feedback', async () => {
    await render(
      <ThemeProvider>
        <PaymentLinkCard url={URL} shareLabel="Share link" />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('QR code for the payment link')).toBeTruthy();
    expect(screen.getByTestId('qr').props.accessibilityHint).toBe(URL);
    expect(screen.getByText(URL)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(URL);
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeTruthy();
  });

  it('shares the link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await render(
      <ThemeProvider>
        <PaymentLinkCard url={URL} shareLabel="Share link" />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Share link' }));
    expect(share).toHaveBeenCalledWith({ message: URL });
  });
});
