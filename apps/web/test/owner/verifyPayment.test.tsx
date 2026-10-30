import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '../../src/i18n/locales/en.json';
import ru from '../../src/i18n/locales/ru.json';
import i18n from '../../src/i18n';
import { VerifyPaymentDialog } from '../../src/owner/bookings/VerifyPaymentDialog';
import { OwnerProvider } from '../../src/owner/OwnerProvider';
import { money } from '../../src/lib/format';
import { mockApi } from '../helpers/api';
import { OWNER_ID, manualPayment, ownerBooking, ownerRoutes } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

const V = en.owner.verify;
const sp = (s: string) => s.replace(/\s/g, ' ');
const POST = `/owners/${OWNER_ID}/bookings/b1/payments/manual`;

function setup(routes: Parameters<typeof mockApi>[0] = []) {
  const api = mockApi([...ownerRoutes({ permissions: ['booking.view', 'payment.verify'] }), ...routes]);
  const onDone = vi.fn();
  const onConflict = vi.fn();
  const booking = ownerBooking({ manualPayment: manualPayment() });
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/owner/${OWNER_ID}`]}>
        <Routes>
          <Route
            path="/owner/:ownerId"
            element={
              <OwnerProvider>
                <VerifyPaymentDialog open booking={booking} onClose={() => {}} onDone={onDone} onConflict={onConflict} />
              </OwnerProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { api, onDone, onConflict, user: userEvent.setup() };
}

describe('VerifyPaymentDialog', () => {
  it('verify dialog confirms with the default amount', async () => {
    const { api, onDone, user } = setup([{ method: 'POST', path: `${POST}/verify`, body: { booking: ownerBooking({ status: 'confirmed' }) } }]);
    const dialog = await screen.findByRole('dialog', { name: V.title });
    expect(within(dialog).getByText('bKash')).toBeTruthy();
    expect(within(dialog).getByText('AB12CD34EF')).toBeTruthy();
    expect(within(dialog).getByText('+880 1812-345678')).toBeTruthy();
    expect((within(dialog).getByLabelText(V.amountReceived) as HTMLInputElement).value).toBe('10.00');
    await user.click(within(dialog).getByRole('button', { name: V.received }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.calls.find((c) => c.path === `${POST}/verify`)!.body).toEqual({});
  });

  it('verify dialog sends an edited amount and shows the shortfall hint', async () => {
    const { api, onDone, user } = setup([{ method: 'POST', path: `${POST}/verify`, body: { booking: ownerBooking() } }]);
    const dialog = await screen.findByRole('dialog', { name: V.title });
    const field = within(dialog).getByLabelText(V.amountReceived);
    await user.clear(field);
    await user.type(field, '6.00');
    expect(within(dialog).getByText(sp(i18n.t('owner.verify.shortfall', { rest: money(400, 'BDT', 'en') })))).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: V.received }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.calls.find((c) => c.path === `${POST}/verify`)!.body).toEqual({ amountReceived: 600 });
  });

  it('verify dialog shows the excess hint when more arrived', async () => {
    const { user } = setup();
    const dialog = await screen.findByRole('dialog', { name: V.title });
    const field = within(dialog).getByLabelText(V.amountReceived);
    await user.clear(field);
    await user.type(field, '12.50');
    expect(within(dialog).getByText(sp(i18n.t('owner.verify.excess', { extra: money(250, 'BDT', 'en') })))).toBeTruthy();
  });

  it('not received asks first, then rejects', async () => {
    const { api, onDone, user } = setup([{ method: 'POST', path: `${POST}/reject`, body: { booking: ownerBooking({ status: 'rejected' }) } }]);
    const dialog = await screen.findByRole('dialog', { name: V.title });
    await user.click(within(dialog).getByRole('button', { name: V.notReceived }));
    expect(within(dialog).getByText(V.notReceivedAsk)).toBeTruthy();
    expect(api.calls.some((c) => c.path.endsWith('/reject'))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: V.notReceivedConfirm }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.calls.find((c) => c.path === `${POST}/reject`)!.body).toEqual({});
  });

  it('a 409 reloads through onConflict and shows the error', async () => {
    const { onConflict, onDone, user } = setup([
      { method: 'POST', path: `${POST}/verify`, status: 409, body: { error: { code: 'invalid_transition', message: 'x' } } },
    ]);
    const dialog = await screen.findByRole('dialog', { name: V.title });
    await user.click(within(dialog).getByRole('button', { name: V.received }));
    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onDone).not.toHaveBeenCalled();
    expect(within(dialog).getByText(en.errors.invalid_transition)).toBeTruthy();
  });
});

describe('ru strings', () => {
  it('ru plural forms exist for paymentsToVerify', () => {
    for (const f of ['one', 'few', 'many', 'other']) {
      expect((ru.owner.today as unknown as Record<string, string>)[`paymentsToVerify_${f}`]).toBeTruthy();
    }
    expect(en.owner.today.paymentsToVerify_one).toBeTruthy();
    expect(en.owner.today.paymentsToVerify_other).toBeTruthy();
  });
});
