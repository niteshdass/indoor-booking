import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../src/i18n';
import { Stars } from '../../src/components/ui/Stars';
import { StarInput } from '../../src/components/ui/StarInput';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Stars', () => {
  it('announces its value', () => {
    render(<Stars value={4.5} />);
    expect(screen.getByRole('img', { name: '4.5 out of 5' })).toBeInTheDocument();
  });
});

describe('StarInput', () => {
  it('is a radio group that reports the chosen value', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<StarInput value={2} onChange={onChange} name="rating" legend="Your rating" />);
    expect(screen.getByRole('group', { name: 'Your rating' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '2 stars' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    expect(onChange).toHaveBeenCalledWith(4);
    rerender(<StarInput value={4} onChange={onChange} name="rating" legend="Your rating" />);
    expect(screen.getByRole('radio', { name: '4 stars' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '2 stars' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
  });

  it('labels read in Russian', async () => {
    await i18n.changeLanguage('ru');
    render(<StarInput value={null} onChange={() => {}} name="rating" legend="Оценка" />);
    expect(screen.getByRole('radio', { name: '5 звёзд' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '2 звезды' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 звезда' })).toBeInTheDocument();
  });
});
