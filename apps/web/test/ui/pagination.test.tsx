import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../src/i18n';
import en from '../../src/i18n/locales/en.json';
import { Paged, pageList } from '../../src/components/ui/Pagination';

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function List({ count, pageSize, resetKey }: { count: number; pageSize?: number; resetKey?: unknown }) {
  return (
    <Paged items={nums(count)} pageSize={pageSize} resetKey={resetKey}>
      {(rows) => (
        <ul>
          {rows.map((n) => (
            <li key={n}>row {n}</li>
          ))}
        </ul>
      )}
    </Paged>
  );
}

const shown = () => screen.getAllByRole('listitem').filter((li) => li.textContent?.startsWith('row')).map((li) => li.textContent);

describe('pagination', () => {
  it('lists the first, last and nearby pages with gaps', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageList(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageList(3, 10)).toEqual([1, 2, 3, 4, null, 10]);
    expect(pageList(10, 10)).toEqual([1, null, 9, 10]);
  });

  it('hides the pager when one page holds everything', () => {
    render(<List count={25} />);
    expect(shown()).toHaveLength(25);
    expect(screen.queryByRole('navigation', { name: en.pagination.label })).toBeNull();
  });

  it('pages 25 rows at a time with previous, numbers and next', async () => {
    const user = userEvent.setup();
    render(<List count={60} />);
    expect(shown()).toHaveLength(25);
    expect(screen.getByText('1–25 of 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: en.pagination.previous }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page');

    await user.click(screen.getByRole('button', { name: en.pagination.next }));
    expect(shown()[0]).toBe('row 26');
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(shown()).toEqual(['row 51', 'row 52', 'row 53', 'row 54', 'row 55', 'row 56', 'row 57', 'row 58', 'row 59', 'row 60']);
    expect(screen.getByText('51–60 of 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: en.pagination.next }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back to page 1 when the reset key changes and clamps a shrunk list', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [key, setKey] = useState('a');
      const [count, setCount] = useState(30);
      return (
        <>
          <button onClick={() => setKey('b')}>filter</button>
          <button onClick={() => setCount(12)}>shrink</button>
          <List count={count} pageSize={10} resetKey={key} />
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(shown()[0]).toBe('row 21');
    await user.click(screen.getByRole('button', { name: 'filter' }));
    expect(shown()[0]).toBe('row 1');
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    await user.click(screen.getByRole('button', { name: 'shrink' }));
    expect(shown()).toEqual(['row 11', 'row 12']);
  });
});
