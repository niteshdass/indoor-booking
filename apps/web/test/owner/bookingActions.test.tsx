import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import en from '../../src/i18n/locales/en.json';
import i18n from '../../src/i18n';
import { RowActions } from '../../src/owner/bookings/BookingActions';
import { OwnerProvider } from '../../src/owner/OwnerProvider';
import type { Action } from '../../src/owner/bookings/availableActions';
import type { OwnerBooking, Permission } from '../../src/owner/types';
import { mockApi } from '../helpers/api';
import { OWNER_ID, manualPayment, ownerBooking, ownerRoutes } from './fixtures';

const ALL: Permission[] = ['booking.view', 'booking.confirm', 'booking.cancel', 'booking.checkin', 'payment.mark_cash', 'booking.create'];

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

function renderRow(booking: OwnerBooking, primary: Action | null, permissions: Permission[] = ALL) {
  mockApi(ownerRoutes({ permissions }));
  const onDone = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/owner/${OWNER_ID}`]}>
        <Routes>
          <Route
            path="/owner/:ownerId"
            element={
              <OwnerProvider>
                <div data-testid="row">
                  <RowActions booking={booking} primary={primary} onDone={onDone} />
                </div>
              </OwnerProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
  return { ...view, onDone, user: userEvent.setup() };
}

const A = en.owner.bookings.actions;

describe('RowActions', () => {
  it('RowActions shows the primary as a button and the rest in More actions', async () => {
    const { user } = renderRow(ownerBooking({ status: 'pending' }), 'confirm');
    const row = await screen.findByTestId('row');
    expect(within(row).getByRole('button', { name: A.confirm })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: A.reject })).toBeNull();
    await user.click(within(row).getByRole('button', { name: en.booking.moreActions }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual([A.reject, A.cancel, A.markCash]);
  });

  it('RowActions leads with Verify payment and leaves confirm out while a wallet payment is pending', async () => {
    const { user } = renderRow(ownerBooking({ status: 'pending', manualPayment: manualPayment() }), 'verify', [...ALL, 'payment.verify']);
    const row = await screen.findByTestId('row');
    await user.click(await within(row).findByRole('button', { name: A.verify }));
    expect(await screen.findByRole('dialog', { name: en.owner.verify.title })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: A.confirm })).toBeNull();
  });

  it('RowActions opens the cash dialog from the menu', async () => {
    const { user } = renderRow(ownerBooking({ status: 'confirmed', amountPaid: 0 }), 'checkIn');
    const row = await screen.findByTestId('row');
    await user.click(within(row).getByRole('button', { name: en.booking.moreActions }));
    await user.click(screen.getByRole('menuitem', { name: A.markCash }));
    expect(await screen.findByRole('dialog', { name: en.owner.cash.title })).toBeTruthy();
  });

  it('RowActions renders nothing without permissions', async () => {
    renderRow(ownerBooking({ status: 'pending' }), 'confirm', ['booking.view']);
    const row = await screen.findByTestId('row');
    expect(row.innerHTML).toBe('');
  });
});
