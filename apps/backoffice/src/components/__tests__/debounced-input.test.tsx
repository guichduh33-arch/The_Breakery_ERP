// apps/backoffice/src/components/__tests__/debounced-input.test.tsx
//
// S3-22 — le champ à commit différé partagé par la liste des commandes et la
// barre de filtres des rapports : commit après la pause, sur Entrée, sur blur ;
// valeur rognée ; resynchronisation sur un changement externe ; et l'écho de
// son propre commit n'écrase pas la frappe en cours.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { DebouncedInput, DEBOUNCED_COMMIT_MS } from '../DebouncedInput.js';

/** Parent qui tient la valeur commise, comme l'URL. */
function Controlled({ onCommit, initial = '' }: {
  onCommit: (v: string) => void; initial?: string;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DebouncedInput
        value={value}
        onCommit={(v) => { onCommit(v); setValue(v); }}
        aria-label="Field"
        data-testid="field"
      />
      <span data-testid="committed">{value}</span>
      <button type="button" onClick={() => { setValue('EXT'); }}>external</button>
    </>
  );
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('DebouncedInput', () => {
  it('commits after the pause, once, with the trimmed value', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: ' T' } });
    fireEvent.change(input, { target: { value: ' T-7 ' } });
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS - 1); });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('T-7');
  });

  it('commits immediately on Enter', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: 'A1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('A1');
    // Le timer en attente est annulé : pas de second commit.
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS * 2); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('commits immediately on blur', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: 'B2 ' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('B2');
  });

  it('does not commit a value equal to the committed one', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} initial="T-1" />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: 'T-1 ' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('resyncs the draft and cancels a pending commit when the value changes externally', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: 'typing' } });
    fireEvent.click(screen.getByRole('button', { name: 'external' }));
    expect(input).toHaveValue('EXT');
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS * 2); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId('committed')).toHaveTextContent('EXT');
  });

  it('the echo of its own commit does not overwrite typing in progress', () => {
    const onCommit = vi.fn();
    render(<Controlled onCommit={onCommit} />);
    const input = screen.getByTestId('field');
    fireEvent.change(input, { target: { value: 'T-1 ' } });
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS); });
    expect(screen.getByTestId('committed')).toHaveTextContent('T-1');
    // L'écho rogné « T-1 » ne remplace pas le brouillon « T-1 ».
    expect(input).toHaveValue('T-1 ');
    // Frappe reprise pendant que l'écho du commit revient.
    fireEvent.change(input, { target: { value: 'T-12' } });
    expect(input).toHaveValue('T-12');
    act(() => { vi.advanceTimersByTime(DEBOUNCED_COMMIT_MS); });
    expect(onCommit).toHaveBeenLastCalledWith('T-12');
    expect(input).toHaveValue('T-12');
  });
});
