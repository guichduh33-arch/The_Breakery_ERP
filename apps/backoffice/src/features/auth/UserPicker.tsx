// apps/backoffice/src/features/auth/UserPicker.tsx
import { Button } from '@breakery/ui';

const SEED_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Mamat (Owner)' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Test Cashier' },
];

export interface UserPickerProps {
  onSelect: (userId: string) => void;
}

export function UserPicker({ onSelect }: UserPickerProps) {
  return (
    <div className="space-y-3 w-full max-w-xs">
      <h2 className="text-text-secondary text-sm uppercase tracking-wide text-center">Select user</h2>
      {SEED_USERS.map((u) => (
        <Button
          key={u.id}
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => onSelect(u.id)}
        >
          {u.name}
        </Button>
      ))}
    </div>
  );
}
