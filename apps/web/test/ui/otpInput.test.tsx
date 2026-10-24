import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../src/i18n';
import { OtpInput } from '../../src/components/ui/OtpInput';

function Harness({ onChange }: { onChange(v: string): void }) {
  const [v, setV] = useState('');
  return (
    <OtpInput
      label="Code"
      value={v}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

describe('OtpInput', () => {
  it('is a labelled group of six boxes', () => {
    render(<Harness onChange={() => {}} />);
    expect(screen.getByRole('group', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('paste fills six boxes', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.paste('123456');
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(boxes.map((b) => (b as HTMLInputElement).value).join('')).toBe('123456');
  });

  it('typing advances focus', async () => {
    render(<Harness onChange={() => {}} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('12');
    expect(boxes[2]).toHaveFocus();
  });

  it('backspace on empty box moves back', async () => {
    render(<Harness onChange={() => {}} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('1');
    expect(boxes[1]).toHaveFocus();
    await userEvent.keyboard('{Backspace}');
    expect(boxes[0]).toHaveFocus();
  });

  it('letters ignored', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const boxes = screen.getAllByRole('textbox');
    await userEvent.click(boxes[0]!);
    await userEvent.keyboard('a');
    expect(onChange).not.toHaveBeenCalled();
    expect(boxes[0]).toHaveFocus();
  });
});
