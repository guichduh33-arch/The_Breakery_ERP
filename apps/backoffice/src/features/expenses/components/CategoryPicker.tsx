// apps/backoffice/src/features/expenses/components/CategoryPicker.tsx
import { Select } from '@breakery/ui';
import { useExpenseCategories } from '../hooks/useExpensesList.js';

export interface CategoryPickerProps {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  /* Forwardés au <Select> pour que FormField puisse câbler le champ. */
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

export function CategoryPicker({
  value, onChange, disabled, id,
  required, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby,
}: CategoryPickerProps): JSX.Element {
  const { data, isLoading, error } = useExpenseCategories();

  if (isLoading === true) {
    return <div className="text-xs text-text-secondary">Loading categories…</div>;
  }
  if (error !== null && error !== undefined) {
    return <div className="text-xs text-red">Failed to load categories.</div>;
  }
  return (
    <Select
      id={id}
      value={value}
      disabled={disabled === true}
      required={required}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedby}
      onChange={(e) => onChange(e.target.value)}
      className="w-full"
    >
      <option value="">Select a category…</option>
      {(data ?? []).map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.name}
        </option>
      ))}
    </Select>
  );
}
