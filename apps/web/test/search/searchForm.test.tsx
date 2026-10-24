import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { SearchForm } from '../../src/search/SearchForm';
import { EMPTY_CRITERIA, type Criteria } from '../../src/search/searchParams';

const s = en.search;

function setup(value: Criteria = EMPTY_CRITERIA, currencies: string[] = ['USD']) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <SearchForm value={value} onChange={onChange} currencies={currencies} />
    </I18nextProvider>,
  );
  const rerender = (v: Criteria) =>
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <SearchForm value={v} onChange={onChange} currencies={currencies} />
      </I18nextProvider>,
    );
  return { onChange, user, rerender, unmount: view.unmount };
}

function stubGeo(impl: (ok: PositionCallback, err: PositionErrorCallback, o?: PositionOptions) => void) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: impl } });
}

afterEach(() => {
  // @ts-expect-error remove the stub
  delete navigator.geolocation;
  void i18n.changeLanguage('en');
});

describe('SearchForm', () => {
  it('geolocation fills near', async () => {
    stubGeo((ok) => ok({ coords: { latitude: 23.81234, longitude: 90.41234 } } as GeolocationPosition));
    const { onChange, user } = setup();
    await user.click(screen.getByRole('button', { name: s.useMyLocation }));
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ near: { lat: 23.8123, lng: 90.4123 } }));
    expect(screen.getByRole('button', { name: s.clearLocation })).toBeInTheDocument();
  });

  it('geolocation denied shows message', async () => {
    stubGeo((_ok, err) => err({ code: 1 } as GeolocationPositionError));
    const { onChange, user } = setup();
    await user.click(screen.getByRole('button', { name: s.useMyLocation }));
    expect(await screen.findByText(s.locationDenied)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ near: null }));
  });

  it('missing geolocation is treated as denied', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: s.useMyLocation }));
    expect(await screen.findByText(s.locationDenied)).toBeInTheDocument();
  });

  it('shows a pending state while locating', async () => {
    let finish: PositionCallback = () => {};
    stubGeo((ok) => {
      finish = ok;
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: s.useMyLocation }));
    const btn = screen.getByRole('button', { name: new RegExp(s.useMyLocation) });
    expect(btn).toBeDisabled();
    finish({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
    await waitFor(() => expect(screen.getByRole('button', { name: s.clearLocation })).toBeInTheDocument());
  });

  it('radius disabled without location', () => {
    setup();
    expect(screen.getByLabelText(s.radius)).toBeDisabled();
    expect(screen.getByText(s.radiusNeedsLocation)).toBeInTheDocument();
  });

  it('custom radius 45 gives radiusKm 45', async () => {
    const { onChange, user } = setup({ ...EMPTY_CRITERIA, near: { lat: 1, lng: 2 } });
    await user.selectOptions(screen.getByLabelText(s.radius), 'custom');
    await user.type(screen.getByLabelText(s.customRadius), '45');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ radiusKm: 45 }));
  });

  it('custom radius out of range is an inline error', async () => {
    const { onChange, user } = setup({ ...EMPTY_CRITERIA, near: { lat: 1, lng: 2 } });
    await user.selectOptions(screen.getByLabelText(s.radius), 'custom');
    await user.type(screen.getByLabelText(s.customRadius), '501');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a distance from 1 to 500 km.')).toBeInTheDocument();
  });

  it('price parsed to minor units', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '12.50');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD', minPrice: 1250, maxPrice: null }));
  });

  it('invalid price shows an error and does not submit', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '12.505');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(s.priceInvalid)).toBeInTheDocument();
  });

  it('price hidden when no currencies', async () => {
    setup(EMPTY_CRITERIA, []);
    await userEvent.click(screen.getByText(s.moreFilters));
    expect(screen.queryByLabelText(s.minPrice)).not.toBeInTheDocument();
  });

  it('time range with one end set is an inline error', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.timeFrom), '18:00');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(s.timeInvalid)).toBeInTheDocument();
    await user.type(screen.getByLabelText(s.timeTo), '20:00');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from: '18:00', to: '20:00' }));
  });

  it('time range with from equal to is an inline error', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.timeFrom), '18:00');
    await user.type(screen.getByLabelText(s.timeTo), '18:00');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(s.timeInvalid)).toBeInTheDocument();
  });

  it('keeps the URL price filter when currencies is empty', async () => {
    const { onChange, user } = setup({ ...EMPTY_CRITERIA, currency: 'USD', minPrice: 1000 }, []);
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD', minPrice: 1000, maxPrice: null }));
  });

  it('keeps a URL currency that is not in the results list', async () => {
    const { onChange, user } = setup({ ...EMPTY_CRITERIA, currency: 'JPY', minPrice: 1000 }, ['USD']);
    expect(screen.getByLabelText(s.minPrice)).toHaveValue('1000');
    expect(screen.getByLabelText(s.currency)).toHaveValue('JPY');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'JPY', minPrice: 1000 }));
  });

  it('a chosen currency without prices is emitted', async () => {
    const { onChange, user } = setup(EMPTY_CRITERIA, ['USD', 'EUR']);
    await user.click(screen.getByText(s.moreFilters));
    await user.selectOptions(screen.getByLabelText(s.currency), 'EUR');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR', minPrice: null, maxPrice: null }));
  });

  it('accepts a comma decimal', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '12,50');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ minPrice: 1250 }));
  });

  it('geolocation error clears pending and passes a timeout', async () => {
    let opts: PositionOptions | undefined;
    stubGeo((_ok, err, o) => {
      opts = o;
      err({ code: 3 } as GeolocationPositionError);
    });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: s.useMyLocation }));
    expect(opts).toEqual({ timeout: 10000 });
    expect(await screen.findByText(s.locationDenied)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.useMyLocation })).toBeEnabled();
  });

  it('opens the collapsed filters to show a time error', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.timeFrom), '18:00');
    await user.click(screen.getByText(s.moreFilters));
    const details = document.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(details.open).toBe(true);
    expect(screen.getByText(s.timeInvalid)).toBeVisible();
    expect(screen.getByLabelText(s.timeTo)).toHaveFocus();
  });

  it('opens the collapsed filters to show a price error', async () => {
    const { user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '1.234');
    await user.click(screen.getByText(s.moreFilters));
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(document.querySelector('details')!.open).toBe(true);
    expect(screen.getByText(s.priceInvalid)).toBeVisible();
  });

  it('a half range with only to set is an error', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.timeTo), '20:00');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(s.timeInvalid)).toBeInTheDocument();
  });

  it('does not invent a currency when amounts are typed then cleared', async () => {
    const { onChange, user } = setup();
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '5');
    await user.clear(screen.getByLabelText(s.minPrice));
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: null, minPrice: null, maxPrice: null }));
  });

  it('switching currency clears typed amounts', async () => {
    const { onChange, user } = setup(EMPTY_CRITERIA, ['USD', 'EUR']);
    await user.click(screen.getByText(s.moreFilters));
    await user.type(screen.getByLabelText(s.minPrice), '12.50');
    await user.selectOptions(screen.getByLabelText(s.currency), 'EUR');
    expect(screen.getByLabelText(s.minPrice)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: 'EUR', minPrice: null }));
  });

  it('re-syncs the draft when value changes', () => {
    const { rerender } = setup();
    rerender({ ...EMPTY_CRITERIA, sport: 'padel', available: true });
    expect(screen.getByLabelText(s.sport)).toHaveValue('padel');
    expect(screen.getByLabelText(s.availableOnly)).toBeChecked();
  });

  it('does not call onChange until submit', async () => {
    const { onChange, user } = setup();
    await user.selectOptions(screen.getByLabelText(s.sport), 'tennis');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: s.submit }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sport: 'tennis' }));
  });
});
