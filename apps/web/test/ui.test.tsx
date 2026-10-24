import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import '../src/i18n';
import { Button } from '../src/components/ui/Button';
import { Dialog } from '../src/components/ui/Dialog';

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
});
