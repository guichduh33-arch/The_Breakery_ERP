import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComboLineRow } from '../ComboLineRow.js';

const baseComboItem = {
  id: 'combo-1',
  product_id: 'prod-combo-001',
  name: 'Breakfast Set',
  sku: 'COMBO-001',
  quantity: 1,
  unit_price: 75000,
  line_total: 75000,
};

const baseComponents = [
  { name: 'Americano', quantity: 1 },
  { name: 'Croissant', quantity: 1 },
];

describe('ComboLineRow', () => {
  it('renders combo name and components', () => {
    render(<ComboLineRow comboItem={baseComboItem} components={baseComponents} />);
    expect(screen.getByText('Breakfast Set')).toBeInTheDocument();
    expect(screen.getByText(/Americano/)).toBeInTheDocument();
    expect(screen.getByText(/Croissant/)).toBeInTheDocument();
  });

  it('renders component sub-lines with correct format', () => {
    render(<ComboLineRow comboItem={baseComboItem} components={baseComponents} />);
    expect(screen.getByText('+ 1× Americano')).toBeInTheDocument();
    expect(screen.getByText('+ 1× Croissant')).toBeInTheDocument();
  });

  it('fires onRemove with item id when remove button clicked', () => {
    const onRemove = vi.fn();
    render(
      <ComboLineRow comboItem={baseComboItem} components={baseComponents} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove combo item' }));
    expect(onRemove).toHaveBeenCalledWith('combo-1');
  });

  it('hides remove button when onRemove is not provided', () => {
    render(<ComboLineRow comboItem={baseComboItem} components={baseComponents} />);
    expect(screen.queryByRole('button', { name: 'Remove combo item' })).not.toBeInTheDocument();
  });

  it('hides remove button when isLocked is true', () => {
    const onRemove = vi.fn();
    render(
      <ComboLineRow
        comboItem={baseComboItem}
        components={baseComponents}
        onRemove={onRemove}
        isLocked
      />,
    );
    expect(screen.queryByRole('button', { name: 'Remove combo item' })).not.toBeInTheDocument();
  });

  it('disables qty stepper interaction when isLocked', () => {
    render(
      <ComboLineRow comboItem={baseComboItem} components={baseComponents} isLocked />,
    );
    const stepperWrapper = screen
      .getByRole('button', { name: 'Decrease' })
      .closest('div')?.parentElement;
    expect(stepperWrapper).toHaveClass('pointer-events-none');
  });

  it('fires onQuantityChange with correct id and qty', () => {
    const onQuantityChange = vi.fn();
    render(
      <ComboLineRow
        comboItem={baseComboItem}
        components={baseComponents}
        onQuantityChange={onQuantityChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onQuantityChange).toHaveBeenCalledWith('combo-1', 2);
  });

  it('renders SKU prefix when sku is provided', () => {
    render(<ComboLineRow comboItem={baseComboItem} components={baseComponents} />);
    expect(screen.getByText('COMBO-001')).toBeInTheDocument();
  });

  it('renders correctly with no components', () => {
    render(<ComboLineRow comboItem={baseComboItem} components={[]} />);
    expect(screen.getByText('Breakfast Set')).toBeInTheDocument();
    expect(screen.queryByText(/Americano/)).not.toBeInTheDocument();
  });
});
