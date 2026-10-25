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

describe('shape, not colour alone', () => {
  it('Stars draws empty stars with an outline glyph and filled ones with a solid glyph', () => {
    const { container } = render(<Stars value={2} />);
    const stars = Array.from(container.querySelectorAll('[aria-hidden="true"]'));
    expect(stars).toHaveLength(5);
    const base = (el: Element) => el.firstChild?.textContent;
    const overlay = (el: Element) => el.querySelector('span')?.textContent;
    expect(base(stars[0]!)).toBe('☆');
    expect(overlay(stars[0]!)).toBe('★');
    expect(base(stars[0]!)).not.toBe(overlay(stars[0]!));
    expect(screen.getByRole('img', { name: '2 out of 5' })).toBeInTheDocument();
  });

  it('StarInput shows a solid glyph up to the value and an outline glyph after it', () => {
    const { container } = render(<StarInput value={2} onChange={() => {}} name="rating" legend="Your rating" />);
    const glyphs = Array.from(container.querySelectorAll('[aria-hidden="true"]')).map((g) => g.textContent);
    expect(glyphs).toEqual(['★', '★', '☆', '☆', '☆']);
    expect(screen.getByRole('radio', { name: '2 stars' })).toBeChecked();
  });
});
