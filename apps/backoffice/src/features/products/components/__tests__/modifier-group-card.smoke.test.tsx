import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { EditableModifierGroup } from '@breakery/domain';

vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({ data: [], isLoading: false }),
}));

import { ModifierGroupCard } from '../ModifierGroupCard.js';

afterEach(cleanup);

const GROUP: EditableModifierGroup = {
  group_name: 'Milk',
  group_type: 'single_select',
  group_required: true,
  group_sort_order: 0,
  options: [
    { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
    { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
  ],
};

describe('ModifierGroupCard', () => {
  it('renders the group name and options', () => {
    render(<ModifierGroupCard group={GROUP} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fresh')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Oat')).toBeInTheDocument();
  });

  it('bubbles a group name edit', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('Milk'), { target: { value: 'Milk type' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ group_name: 'Milk type' }));
  });

  it('adds an option', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    const next = onChange.mock.calls[0][0] as EditableModifierGroup;
    expect(next.options).toHaveLength(3);
  });

  it('switching default in single-select makes exactly one default', () => {
    const onChange = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={onChange} onRemove={() => {}} />);
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // make "Oat" the default
    const next = onChange.mock.calls[0][0] as EditableModifierGroup;
    expect(next.options.filter((o) => o.is_default).map((o) => o.option_label)).toEqual(['Oat']);
  });

  it('removes the group', () => {
    const onRemove = vi.fn();
    render(<ModifierGroupCard group={GROUP} onChange={() => {}} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove (variant type|group)/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
