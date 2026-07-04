// apps/pos/src/features/auth/UserPicker.tsx
// Vague 0 / Tâche 3b — dynamic picker via `list_login_users_v1` (was
// hardcoded to 2 seed accounts — any employee created in the BackOffice
// used to be invisible at login).
import { Button } from '@breakery/ui';
import { useLoginUsers } from './hooks/useLoginUsers';

export interface UserPickerProps {
  onSelect: (userId: string) => void;
}

export function UserPicker({ onSelect }: UserPickerProps) {
  const { data, isLoading, isError, refetch, isFetching } = useLoginUsers();

  if (isLoading) {
    return (
      <div className="space-y-3 w-full max-w-xs text-center" data-testid="user-picker-loading">
        <h2 className="text-text-secondary text-sm uppercase tracking-wide">Select user</h2>
        <p className="text-text-secondary text-sm">Loading staff…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-3 w-full max-w-xs text-center" data-testid="user-picker-error">
        <h2 className="text-text-secondary text-sm uppercase tracking-wide">Select user</h2>
        <p className="text-danger text-sm">Could not load staff list. Check your connection.</p>
        <Button
          variant="secondary"
          size="md"
          onClick={() => { void refetch(); }}
          disabled={isFetching}
        >
          {isFetching ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  const users = data ?? [];

  if (users.length === 0) {
    return (
      <div className="space-y-3 w-full max-w-xs text-center" data-testid="user-picker-empty">
        <h2 className="text-text-secondary text-sm uppercase tracking-wide">Select user</h2>
        <p className="text-text-secondary text-sm">No active staff found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full max-w-xs">
      <h2 className="text-text-secondary text-sm uppercase tracking-wide text-center">Select user</h2>
      {users.map((u) => (
        <Button
          key={u.id}
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => onSelect(u.id)}
        >
          {u.display_name}
        </Button>
      ))}
    </div>
  );
}
