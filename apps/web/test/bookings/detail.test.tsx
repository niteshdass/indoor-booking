import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import type { BookingJson, PublicUser } from '../../src/lib/types';

const pdf = vi.hoisted(() => vi.fn<(node: HTMLElement, fileName: string) => Promise<void>>());
vi.mock('../../src/bookings/receiptPdf', () => ({ downloadReceiptPdf: pdf }));

const player: PublicUser = {
  id: 'u1',
  name: 'Pat',
  email: 'p@x.com',
  emailVerified: true,
  phone: null,
  hasPassword: true,
  hasGoogle: false,
  platformAdmin: false,
};

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-11-03',
    // 2026-11-03 18:00-20:00 Asia/Dhaka (UTC+6) = 12:00-14:00Z
    slots: [
      { startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T13:00:00.000Z', price: 1000 },
      { startAt: '2026-11-03T13:00:00.000Z', endAt: '2026-11-03T14:00:00.000Z', price: 1000 },
    ],
    addons: [
      {
        addonId: 'a1',
        name: 'Bibs',
        pricingType: 'flat',
        unitPrice: 150,
        quantity: 1,
        minutes: null,
        total: 150,
      },
    ],
    currency: 'BDT',
    subtotal: 2000,
    addonsTotal: 150,
    total: 2150,
    advanceRequired: 1000,
    amountPaid: 1000,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'partially_paid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    venue: {
      slug: 'arena-one',
      name: 'Arena One',
      address: 'x',
      city: 'Dhaka',
      timezone: 'Asia/Dhaka',
    },
    turf: { name: 'Turf A' },
    ...over,
  }) as BookingJson;

const api = (body: (n: number) => BookingJson) =>
  mockApi([
    {
      path: '/me/bookings/b1',
      body: (_c: unknown, n: number) => ({ booking: body(n), refunds: [] }),
    },
  ]);

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  pdf.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('booking detail', () => {
  it('download receipt makes a PDF of the receipt, then removes it', async () => {
    api(() => booking({ createdAt: '2026-10-27T04:00:00.000Z' }));
    let text = '';
    pdf.mockImplementation(async (node: HTMLElement) => {
      text = node.textContent ?? '';
    });
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: en.receipt.download }));
    await waitFor(() => expect(pdf).toHaveBeenCalledOnce());
    expect(pdf.mock.calls[0]![1]).toBe('Receipt-AB12CD.pdf');
    expect(text).toContain(en.receipt.title);
    expect(text).toContain('Pat');
    expect(text).toContain('Arena One');
    await waitFor(() => expect(screen.queryByText(en.receipt.title)).not.toBeInTheDocument());
  });

  it('a failed PDF says so', async () => {
    api(() => booking());
    pdf.mockRejectedValue(new Error('canvas'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = renderApp('/me/bookings/b1', { user: player });
    await user.click(await screen.findByRole('button', { name: en.receipt.download }));
    expect(await screen.findByText(en.receipt.failed)).toBeInTheDocument();
  });

  it('no receipt before anything is paid', async () => {
    api(() => booking({ status: 'pending', amountPaid: 0, paymentStatus: 'unpaid' }));
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('AB12CD')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.receipt.download })).not.toBeInTheDocument();
  });

  it('shows reference, venue-zone times and badges', async () => {
    api(() => booking());
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText('AB12CD')).toBeInTheDocument();
    expect(screen.getByText('18:00 – 20:00')).toBeInTheDocument();
    expect(screen.getByText(/^Tue, (3 Nov|Nov 3)$/)).toBeInTheDocument();
    expect(screen.getByText(en.status.confirmed)).toBeInTheDocument();
    expect(screen.getByText(en.paymentStatus.partially_paid)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Arena One' })).toHaveAttribute(
      'href',
      '/venues/arena-one',
    );
    expect(screen.getByText('Turf A')).toBeInTheDocument();
    expect(screen.getByText(/Bibs/)).toBeInTheDocument();
  });

  it('pending shows venue-will-confirm note', async () => {
    api(() => booking({ status: 'pending' }));
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText(en.booking.pendingNote)).toBeInTheDocument();
  });

  it('awaiting payment without paid flag offers pay now', async () => {
    const m = api(() =>
      booking({ status: 'awaiting_payment', paymentStatus: 'unpaid', amountPaid: 0 }),
    );
    renderApp('/me/bookings/b1?new=1', { user: player });
    expect(await screen.findByRole('heading', { name: en.booking.received })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.booking.payNow })).toHaveAttribute(
      'href',
      '/me/bookings/b1/pay',
    );
    expect(m.calls).toHaveLength(1);
  });

  it('polls until confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = api((n) =>
      booking(n < 2 ? { status: 'awaiting_payment', paymentStatus: 'unpaid' } : {}),
    );
    renderApp('/me/bookings/b1?paid=1', { user: player });
    expect(await screen.findByText(en.booking.processing)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.booking.paymentReceived })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(screen.getByText(en.booking.processing)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(await screen.findByText(en.status.confirmed)).toBeInTheDocument();
    expect(screen.queryByText(en.booking.processing)).not.toBeInTheDocument();
    expect(m.calls).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(m.calls).toHaveLength(3);
  });

  it('polling gives up after 60s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = api(() => booking({ status: 'awaiting_payment', paymentStatus: 'unpaid' }));
    const { user } = renderApp('/me/bookings/b1?paid=1', { user: player });
    await screen.findByText(en.booking.processing);
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.getByText(en.booking.processingSlow)).toBeInTheDocument();
    const n = m.calls.length;
    expect(n).toBeLessThanOrEqual(32);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(m.calls).toHaveLength(n);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: en.booking.refresh }));
    });
    expect(screen.queryByText(en.booking.processingSlow)).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(m.calls.length).toBeGreaterThan(n);
  });

  it('failed Stripe redirect shows an error, Pay now, and does not poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const m = api(() =>
      booking({ status: 'awaiting_payment', paymentStatus: 'unpaid', amountPaid: 0 }),
    );
    renderApp('/me/bookings/b1?paid=1&redirect_status=failed', { user: player });
    expect(await screen.findByText(en.payment.redirectFailed)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.booking.payNow })).toHaveAttribute(
      'href',
      '/me/bookings/b1/pay',
    );
    expect(screen.queryByText(en.booking.processing)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: en.booking.paymentReceived }),
    ).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(m.calls).toHaveLength(1);
  });

  it('canceled Stripe redirect is treated as a failure', async () => {
    api(() => booking({ status: 'awaiting_payment', paymentStatus: 'unpaid', amountPaid: 0 }));
    renderApp('/me/bookings/b1?paid=1&redirect_status=canceled', { user: player });
    expect(await screen.findByText(en.payment.redirectFailed)).toBeInTheDocument();
  });

  it('redirect_status=succeeded still polls with the received heading', async () => {
    api(() => booking({ status: 'awaiting_payment', paymentStatus: 'unpaid' }));
    renderApp('/me/bookings/b1?paid=1&redirect_status=succeeded', { user: player });
    expect(await screen.findByText(en.booking.processing)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.booking.paymentReceived })).toBeInTheDocument();
    expect(screen.queryByText(en.payment.redirectFailed)).not.toBeInTheDocument();
  });

  it('expired booking with ?paid=1 does not claim payment was received', async () => {
    api(() => booking({ status: 'expired', paymentStatus: 'unpaid', amountPaid: 0 }));
    renderApp('/me/bookings/b1?paid=1', { user: player });
    expect(await screen.findByText(en.status.expired)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: en.booking.paymentReceived }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: en.booking.title })).toBeInTheDocument();
  });

  it('slow polling state still offers Pay now', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api(() => booking({ status: 'awaiting_payment', paymentStatus: 'unpaid' }));
    renderApp('/me/bookings/b1?paid=1', { user: player });
    await screen.findByText(en.booking.processing);
    expect(screen.queryByRole('link', { name: en.booking.payNow })).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.getByText(en.booking.processingSlow)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.booking.payNow })).toBeInTheDocument();
  });

  it('russian status labels', async () => {
    await i18n.changeLanguage('ru');
    api(() =>
      booking({ status: 'no_show', paymentStatus: 'partially_refunded', amountRefunded: 500 }),
    );
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText(ru.status.no_show)).toBeInTheDocument();
    expect(screen.getByText(ru.paymentStatus.partially_refunded)).toBeInTheDocument();
  });

  it('404 shows not found', async () => {
    mockApi([
      {
        path: '/me/bookings/b1',
        status: 404,
        body: { error: { code: 'not_found', message: 'x', details: null } },
      },
    ]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText(en.notFound.title)).toBeInTheDocument();
  });

  it('copy button confirms and is hidden without clipboard', async () => {
    api(() => booking());
    const { user, unmount } = renderApp('/me/bookings/b1', { user: player });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(await screen.findByRole('button', { name: en.booking.copy }));
    expect(writeText).toHaveBeenCalledWith('AB12CD');
    expect(await screen.findByText(en.booking.copied)).toBeInTheDocument();
    unmount();
    renderApp('/me/bookings/b1', { user: player });
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined as never);
    await screen.findByText('AB12CD');
    expect(screen.queryByRole('button', { name: en.booking.copy })).not.toBeInTheDocument();
  });
});

describe('booking detail, wallet payment', () => {
  const manual = { provider: 'bkash', trxId: '9A1B2C3D4E', amount: 1000, status: 'pending', submittedAt: '2026-11-01T10:00:00.000Z' } as const;

  it('shows waiting for the venue while a manual payment is pending', async () => {
    api(() => booking({ status: 'awaiting_payment', manualPayment: manual }));
    renderApp('/me/bookings/b1?submitted=1', { user: player });
    expect(await screen.findByText('Waiting for the venue to check your payment (bKash 9A1B2C3D4E)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.booking.payNow })).not.toBeInTheDocument();
  });

  it('reopening an expired booking with a waiting payment still says the times were taken', async () => {
    api(() => booking({ status: 'expired', manualPayment: manual }));
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByText(en.booking.manualLate)).toBeInTheDocument();
    expect(screen.queryByText('Waiting for the venue to check your payment (bKash 9A1B2C3D4E)')).not.toBeInTheDocument();
  });

  /** An expired hold for a game that has not been played yet. */
  const lapsed = (over: Partial<BookingJson> = {}) => {
    const start = Date.now() + 86_400_000;
    return booking({
      status: 'expired',
      paymentStatus: 'unpaid',
      amountPaid: 0,
      manualPayment: null,
      holdExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      slots: [{ startAt: new Date(start).toISOString(), endAt: new Date(start + 3_600_000).toISOString(), price: 1000 }],
      ...over,
    });
  };
  const withOptions = (b: BookingJson, wallets: unknown[]) =>
    mockApi([
      { path: '/me/bookings/b1', body: { booking: b, refunds: [] } },
      { path: '/bookings/b1/payment-options', body: { wallets, card: true, amount: 1000, currency: 'BDT', holdExpiresAt: b.holdExpiresAt } },
    ]);
  const BKASH = { provider: 'bkash', number: '+8801712345678', accountType: 'personal' };

  it('an expired booking with no wallet payment links to enter the Transaction ID', async () => {
    withOptions(lapsed(), [BKASH]);
    renderApp('/me/bookings/b1', { user: player });
    expect(await screen.findByRole('link', { name: en.booking.lateEntry })).toHaveAttribute('href', '/me/bookings/b1/pay');
    expect(screen.queryByRole('link', { name: en.booking.payNow })).not.toBeInTheDocument();
  });

  it('no Transaction ID link when the venue takes no wallets or a payment was already sent', async () => {
    const m = withOptions(lapsed(), []);
    renderApp('/me/bookings/b1', { user: player });
    await waitFor(() => expect(m.calls.some((c) => c.path === '/bookings/b1/payment-options')).toBe(true));
    await screen.findByText('AB12CD');
    expect(screen.queryByRole('link', { name: en.booking.lateEntry })).not.toBeInTheDocument();
  });

  it('no Transaction ID link once the game is over', async () => {
    const m = withOptions(lapsed({ slots: [{ startAt: '2020-01-01T10:00:00.000Z', endAt: '2020-01-01T11:00:00.000Z', price: 1000 }] }), [BKASH]);
    renderApp('/me/bookings/b1', { user: player });
    await screen.findByText('AB12CD');
    expect(screen.queryByRole('link', { name: en.booking.lateEntry })).not.toBeInTheDocument();
    expect(m.calls.some((c) => c.path === '/bookings/b1/payment-options')).toBe(false);
  });

  it('says the times were taken on a late submit', async () => {
    api(() => booking({ status: 'expired', manualPayment: manual }));
    renderApp('/me/bookings/b1?submitted=1&late=1', { user: player });
    expect(await screen.findByText(en.booking.manualLate)).toBeInTheDocument();
  });
});
