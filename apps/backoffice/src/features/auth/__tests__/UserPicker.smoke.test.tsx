// apps/backoffice/src/features/auth/__tests__/UserPicker.smoke.test.tsx
//
// Vague 0 / Tâche 3 (S58) — smoke test for the BackOffice login picker.
//
// Covers the regression this ticket fixes: the picker used to be hardcoded
// to 2 seed accounts — an employee created via `UserFormDialog` was
// invisible here and could never sign in. It now consumes
// `useLoginUsers()` (→ `list_login_users_v1`), including loading/error/
// empty states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserPicker } from '../UserPicker.js';

const loginUsersState = {
  current: {
    data: [
      { id: 'u1', display_name: 'Mamat (Owner)', role: 'Super Admin' },
      { id: 'u2', display_name: 'New Hire', role: 'Cashier' },
    ] as Array<{ id: string; display_name: string; role: string }> | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
  },
  refetch: vi.fn(),
};

vi.mock('../hooks/useLoginUsers.js', () => ({
  useLoginUsers: () => ({
    data: loginUsersState.current.data,
    isLoading: loginUsersState.current.isLoading,
    isError: loginUsersState.current.isError,
    isFetching: loginUsersState.current.isFetching,
    refetch: loginUsersState.refetch,
  }),
}));

describe('BackOffice UserPicker — dynamic (S58 T3)', () => {
  beforeEach(() => {
    loginUsersState.refetch.mockReset();
    loginUsersState.current = {
      data: [
        { id: 'u1', display_name: 'Mamat (Owner)', role: 'Super Admin' },
        { id: 'u2', display_name: 'New Hire', role: 'Cashier' },
      ],
      isLoading: false,
      isError: false,
      isFetching: false,
    };
  });

  it('lists a newly-created employee (regression: used to be invisible)', () => {
    const onSelect = vi.fn();
    render(<UserPicker onSelect={onSelect} />);
    expect(screen.getByText('New Hire')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('user-picker-u2'));
    expect(onSelect).toHaveBeenCalledWith('u2');
  });

  it('shows a loading state instead of a blank picker', () => {
    loginUsersState.current = { data: undefined, isLoading: true, isError: false, isFetching: false };
    render(<UserPicker onSelect={vi.fn()} />);
    expect(screen.getByTestId('user-picker-loading')).toBeInTheDocument();
  });

  it('shows an error + retry affordance on fetch failure (offline)', () => {
    loginUsersState.current = { data: undefined, isLoading: false, isError: true, isFetching: false };
    render(<UserPicker onSelect={vi.fn()} />);
    expect(screen.getByTestId('user-picker-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(loginUsersState.refetch).toHaveBeenCalled();
  });

  it('shows an empty state when no active staff are returned', () => {
    loginUsersState.current = { data: [], isLoading: false, isError: false, isFetching: false };
    render(<UserPicker onSelect={vi.fn()} />);
    expect(screen.getByTestId('user-picker-empty')).toBeInTheDocument();
  });
});
