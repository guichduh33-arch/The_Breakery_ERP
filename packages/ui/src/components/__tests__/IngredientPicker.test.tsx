import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  IngredientPicker,
  type IngredientSearchResult,
} from '../IngredientPicker.js';

function row(
  id: string,
  name: string,
  kind: IngredientSearchResult['kind'] = 'raw',
): IngredientSearchResult {
  return {
    product_id:    id,
    sku:           `SKU-${id}`,
    name,
    unit:          'g',
    cost_price:    100,
    current_stock: 10,
    kind,
    has_recipe:    kind !== 'raw',
  };
}

describe('IngredientPicker', () => {
  it('affiche le choix avant validation, efface une sélection devenue ambiguë et se réinitialise après ajout', async () => {
    const flour = row('1', 'Bread flour');
    const searchFn = vi.fn().mockResolvedValue([flour]);
    function Form() {
      const [value, setValue] = useState<string | null>(null);
      return <><IngredientPicker value={value} onChange={setValue} searchFn={searchFn} />
        <button disabled={!value} onClick={() => setValue(null)}>Add ingredient</button></>;
    }
    render(<Form />);
    const input = screen.getByRole('textbox', { name: 'Search ingredient' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fl' } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Bread flour/ }));
    expect(input).toHaveValue('Bread flour');
    expect(screen.getByRole('button', { name: 'Add ingredient' })).toBeEnabled();
    fireEvent.change(input, { target: { value: 'su' } });
    expect(input).toHaveValue('su');
    expect(screen.getByRole('button', { name: 'Add ingredient' })).toBeDisabled();
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Bread flour/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));
    expect(input).toHaveValue('');
  });

  it('renders the search input with the supplied placeholder', () => {
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
        placeholder="Pick an ingredient"
      />,
    );
    expect(screen.getByPlaceholderText('Pick an ingredient')).toBeInTheDocument();
  });

  it('shows "No results" when query >= 2 chars returns empty', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
      />,
    );

    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'xx' } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
  });

  it('debounces — does not fire the keyed search before 200ms', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([row('1', 'Flour')]);
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
      />,
    );

    // Drain the initial empty-query mount call (debounce + microtask).
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    searchFn.mockClear();

    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fl' } });
    expect(searchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(searchFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn).toHaveBeenCalledWith('fl', 'all');

    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Flour')).toBeInTheDocument());
  });

  it('does not call searchFn for single-char queries (>= 2 chars rule)', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
      />,
    );

    // Drain initial empty-query mount call.
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    searchFn.mockClear();

    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'f' } });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(searchFn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Arrow Down + Enter selects the highlighted row', async () => {
    vi.useFakeTimers();
    const rows = [row('1', 'Apples'), row('2', 'Bananas'), row('3', 'Cherries')];
    const searchFn = vi.fn().mockResolvedValue(rows);
    const onChange = vi.fn();

    render(
      <IngredientPicker
        value={null}
        onChange={onChange}
        searchFn={searchFn}
      />,
    );

    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fr' } });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Bananas')).toBeInTheDocument());

    // After search settles highlight is at idx 0 (Apples). One ArrowDown → idx 1 (Bananas).
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('2', rows[1]);
  });

  it('Escape clears the query (no clear of value when query already empty results in no-op for null value)', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([row('1', 'Flour')]);
    const onChange = vi.fn();

    render(
      <IngredientPicker
        value={null}
        onChange={onChange}
        searchFn={searchFn}
      />,
    );
    const input = screen.getByPlaceholderText<HTMLInputElement>('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fl' } });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(input.value).toBe('fl');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    // Escape on empty query with null value should NOT fire onChange.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('hides kind tabs when showKindTabs=false', () => {
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
        kind="raw"
        showKindTabs={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /Raw/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Semi-finished/ })).not.toBeInTheDocument();
  });

  it('renders kind tabs by default with All/Raw/Semi/Sub', () => {
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
      />,
    );
    expect(screen.getByRole('button', { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Raw/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Semi-finished/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sub-recipe/ })).toBeInTheDocument();
  });

  it('clicking a kind tab triggers a new search with that kind', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
      />,
    );
    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fl' } });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(searchFn).toHaveBeenLastCalledWith('fl', 'all');

    // Switch tab → another searchFn call with kind=raw.
    fireEvent.click(screen.getByRole('button', { name: /^Raw/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchFn).toHaveBeenLastCalledWith('fl', 'raw');
    vi.useRealTimers();
  });

  it('excludeIds removes filtered rows from results', async () => {
    vi.useFakeTimers();
    const rows = [row('1', 'Apples'), row('2', 'Bananas')];
    const searchFn = vi.fn().mockResolvedValue(rows);
    render(
      <IngredientPicker
        value={null}
        onChange={vi.fn()}
        searchFn={searchFn}
        excludeIds={['1']}
      />,
    );
    const input = screen.getByPlaceholderText('Search ingredient or sub-recipe…');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'fr' } });
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Bananas')).toBeInTheDocument());
    expect(screen.queryByText('Apples')).not.toBeInTheDocument();
  });
});
