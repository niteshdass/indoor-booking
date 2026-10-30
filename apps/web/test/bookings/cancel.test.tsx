import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelDialog } from '../../src/bookings/CancelDialog';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { mockApi } from '../helpers/api';
import { setAccessToken } from '../../src/lib/apiClient';
import { renderApp } from '../helpers/render';
import { money } from '../../src/lib/format';
import type { BookingJson, CancellationPreview, PublicUser } from '../../src/lib/types';

const player: PublicUser = { id: 'u1', name: 'Pat', email: 'p@x.com', emailVerified: true, phone: null, hasPassword: true, hasGoogle: false, platformAdmin: false };

const booking = (over: Partial<BookingJson> = {}) =>
  ({
    id: 'b1',
    reference: 'AB12CD',
    venueId: 'v1',
    turfId: 't1',
    businessDate: '2026-11-03',
    slots: [{ startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T13:00:00.000Z', price: 1150 }],
    addons: [],
    currency: 'BDT',
    subtotal: 1150,
    addonsTotal: 0,
    total: 1150,
    advanceRequired: 1150,
    amountPaid: 1150,
    amountRefunded: 0,
    status: 'confirmed',
    paymentStatus: 'paid',
    holdExpiresAt: null,
    source: 'online',
    playerId: 'u1',
    guest: null,
    venue: { slug: 'arena-one', name: 'Arena One', address: 'x', city: 'Dhaka', timezone: 'Asia/Dhaka' },
    turf: { name: 'Turf A' },
    ...over,
  }) as BookingJson;

const preview = (over: Partial<CancellationPreview> = {}): CancellationPreview => ({
  percent: 50,
  amount: 575,
  rule: { minHoursBefore: 24, percent: 50 },
  amountPaid: 1150,
  amountRefunded: 0,
  currency: 'BDT',
  card: 575,
  wallet: 0,
  cash: 0,
  ...over,
});

const setup = (opts: { preview?: unknown; previewStatus?: number; cancelStatus?: number; cancelBody?: unknown } = {}) =>
  mockApi([
    {
      path: '/me/bookings/b1/cancellation',
      status: opts.previewStatus,
      body: opts.preview ?? { preview: preview() },
    },
    {
      method: 'POST',
      path: '/me/bookings/b1/cancel',
      status: opts.cancelStatus,
      body:
        opts.cancelBody ?? {
          booking: booking({ status: 'cancelled', paymentStatus: 'partially_refunded', amountRefunded: 575 }),
          refunds: [
            { id: 'r1', paymentId: 'p1', method: 'card', amount: 575, currency: 'BDT', reason: 'cancellation', ruleApplied: null, status: 'pending', failureCode: null, retryOf: null, createdAt: '2026-10-25T00:00:00Z' },
          ],
        },
    },
    { path: '/me/bookings/b1', body: { booking: booking(), refunds: [] } },
  ]);

async function openDialog() {
  const view = renderApp('/me/bookings/b1', { user: player });
  await view.user.click(await screen.findByRole('button', { name: en.booking.moreActions }));
  await view.user.click(screen.getByRole('menuitem', { name: en.cancel.open }));
  const dialog = await screen.findByRole('dialog');
  return { ...view, dialog };
}

const sp = (s: string) => s.replace(/\s/g, ' ');
const errBody = (code: string) => ({ error: { code, message: code } });

beforeEach(() => {
  setAccessToken(null);
  return i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cancel dialog', () => {
  it('preview shows percent, amount and rule', async () => {
    setup();
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(sp(money(575, 'BDT', 'en')))).toBeInTheDocument();
    expect(within(dialog).getAllByText(/50%/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(sp(i18n.t('cancel.rule', { hours: 24, percent: 50 })))).toBeInTheDocument();
    expect(within(dialog).getByText(sp(money(1150, 'BDT', 'en')))).toBeInTheDocument();
    expect(within(dialog).getByText(sp(i18n.t('cancel.toCard', { amount: sp(money(575, 'BDT', 'en')) })))).toBeInTheDocument();
  });

  it('cash part explained', async () => {
    setup({ preview: { preview: preview({ card: 275, cash: 300 }) } });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(sp(i18n.t('cancel.cashAtVenue', { amount: sp(money(300, 'BDT', 'en')) })))).toBeInTheDocument();
    expect(within(dialog).getByText(sp(i18n.t('cancel.toCard', { amount: sp(money(275, 'BDT', 'en')) })))).toBeInTheDocument();
  });

  it('zero refund says no refund', async () => {
    setup({ preview: { preview: preview({ percent: 0, amount: 0, rule: null, card: 0, cash: 0 }) } });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(en.cancel.noRefund)).toBeInTheDocument();
    expect(within(dialog).getByText(en.cancel.noRule)).toBeInTheDocument();
  });

  it('too_late hides confirm', async () => {
    setup({ previewStatus: 409, preview: errBody('too_late') });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(en.errors.too_late)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: en.cancel.confirm })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: en.cancel.keep })).toBeInTheDocument();
  });

  it('confirm cancels with reason and shows cancelled badge', async () => {
    const m = setup();
    const { dialog, user } = await openDialog();
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.type(within(dialog).getByRole('textbox'), '  Rain ');
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    expect(await screen.findByText(en.status.cancelled)).toBeInTheDocument();
    expect(m.calls.find((c) => c.method === 'POST')?.body).toEqual({ reason: 'Rain' });
    expect(screen.getByText(en.cancel.refundsTitle)).toBeInTheDocument();
    expect(screen.getByText(en.cancel.refundStatus.pending, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.booking.moreActions })).not.toBeInTheDocument();
  });

  it('omits empty reason', async () => {
    const m = setup();
    const { dialog, user } = await openDialog();
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    await screen.findByText(en.status.cancelled);
    expect(m.calls.find((c) => c.method === 'POST')?.body).toEqual({});
  });

  it('cancel error stays in dialog', async () => {
    setup({ cancelStatus: 500, cancelBody: errBody('internal') });
    const { dialog, user } = await openDialog();
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    expect(await within(dialog).findByText(en.errors.generic)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: en.cancel.confirm })).toBeEnabled();
  });

  it('keep booking closes without calling cancel', async () => {
    const m = setup();
    const { dialog, user } = await openDialog();
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.click(within(dialog).getByRole('button', { name: en.cancel.keep }));
    expect(m.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(dialog).not.toHaveAttribute('open');
  });

  it('nothing paid shows only a short note', async () => {
    setup({ preview: { preview: preview({ percent: 0, amount: 0, rule: null, amountPaid: 0, card: 0, cash: 0 }) } });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(en.cancel.nothingPaid)).toBeInTheDocument();
    expect(within(dialog).queryByText(en.cancel.noRefund)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(en.cancel.noRule)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(en.cancel.paid)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: en.cancel.confirm })).toBeInTheDocument();
  });

  it('paid so far subtracts earlier refunds', async () => {
    setup({ preview: { preview: preview({ amountRefunded: 200, amount: 475, card: 475 }) } });
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText(sp(money(950, 'BDT', 'en')))).toBeInTheDocument();
    expect(within(dialog).queryByText(sp(money(1150, 'BDT', 'en')))).not.toBeInTheDocument();
  });

  it('focus moves to the heading after cancelling', async () => {
    setup();
    const { dialog, user } = await openDialog();
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    await screen.findByText(en.status.cancelled);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });
});

describe('cancel dialog (standalone)', () => {
  const base = () => ({
    open: true,
    onClose: vi.fn(),
    loadPreview: () => Promise.resolve(preview()),
    onCancelled: vi.fn(),
  });

  it('ignores Escape and Keep while submitting', async () => {
    let resolve!: (v: { booking: BookingJson; refunds: [] }) => void;
    const cancel = vi.fn(() => new Promise<{ booking: BookingJson; refunds: [] }>((r) => (resolve = r)));
    const props = base();
    const user = userEvent.setup();
    render(<CancelDialog {...props} cancel={cancel} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    await user.click(within(dialog).getByRole('button', { name: en.cancel.confirm }));
    expect(cancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: en.cancel.keep })).toBeDisabled();
    resolve({ booking: booking({ status: 'cancelled' }), refunds: [] });
    await vi.waitFor(() => expect(props.onCancelled).toHaveBeenCalled());
  });

  it('canConfirm false disables confirm; counter is described', async () => {
    const props = base();
    render(<CancelDialog {...props} cancel={vi.fn()} canConfirm={false} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(sp(money(575, 'BDT', 'en')));
    expect(within(dialog).getByRole('button', { name: en.cancel.confirm })).toBeDisabled();
    const ta = within(dialog).getByRole('textbox');
    const id = ta.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)).toHaveTextContent('0 / 300');
  });
});
