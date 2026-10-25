import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import '../src/i18n';
import { Button } from '../src/components/ui/Button';
import { Dialog } from '../src/components/ui/Dialog';
import { Tabs } from '../src/components/ui/Tabs';
import { Checkbox } from '../src/components/ui/Checkbox';
import { StatCard } from '../src/components/ui/StatCard';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hello">
        <p>body</p>
      </Dialog>
    </>
  );
}

describe('ui', () => {
  it('button with `to` renders a brand-styled router link', () => {
    render(
      <MemoryRouter>
        <Button to="/go?x=1" variant="brand" size="lg">Go</Button>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('href', '/go?x=1');
    expect(link.className).toMatch(/brand/);
    expect(link.className).toMatch(/lg/);
  });

  it('loading button is disabled, busy, shows a spinner and ignores clicks', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('dialog opens, closes on Escape and returns focus to opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByText('opener');
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Hello' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('tabs move selection with arrow keys', async () => {
    const user = userEvent.setup();
    function TabsHarness() {
      const [v, setV] = useState('a');
      return (
        <Tabs
          label="Sections"
          value={v}
          onChange={setV}
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
        />
      );
    }
    render(<TabsHarness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    alpha.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
  });

  it('checkbox reports its checked state', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Allow guests" hint="Anyone can book" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Allow guests' });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('Anyone can book');
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('statCard renders label and value', () => {
    render(<StatCard label="Revenue" value="$120.00" hint="Today" />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});
