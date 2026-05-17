// apps/backoffice/src/pages/users/UserDetailPage.tsx
// Session 13 / Phase 5.D — User detail page.

import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, KeyRound, Trash2, UserCog } from 'lucide-react';
import { Button } from '@breakery/ui';
import { evaluatePinStrength, type PinWeakReason } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useUserDetail } from '@/features/users/hooks/useUsersList.js';
import { useRolesList } from '@/features/users/hooks/useRolesList.js';
import { useResetUserPin } from '@/features/users/hooks/useResetUserPin.js';
import { RoleChangeDialog } from '@/features/users/components/RoleChangeDialog.js';
import { DeleteUserDialog } from '@/features/users/components/DeleteUserDialog.js';

export default function UserDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';

  const canUpdate = hasPermission('users.update');

  const user  = useUserDetail(id);
  const roles = useRolesList();
  const pinReset = useResetUserPin();

  const [showRole,      setShowRole]      = useState<boolean>(false);
  const [showDelete,    setShowDelete]    = useState<boolean>(false);
  const [pinDraft,      setPinDraft]      = useState<string>('');
  const [pinError,      setPinError]      = useState<string | null>(null);
  const [pinSuccess,    setPinSuccess]    = useState<boolean>(false);
  const [pinWeak,       setPinWeak]       = useState<boolean>(false);
  const [pinWeakReason, setPinWeakReason] = useState<PinWeakReason>(null);

  const isSelf = user.data?.id === currentUserId;
  const canResetPin = canUpdate || isSelf;

  function handleResetPin() {
    if (id === undefined) return;
    if (!/^[0-9]{6}$/.test(pinDraft)) {
      setPinError('PIN must be exactly 6 digits.');
      setPinSuccess(false);
      return;
    }
    setPinError(null);
    pinReset.mutate(
      { user_id: id, new_pin: pinDraft },
      {
        onSuccess: (response: { ok: true; weak?: boolean; weak_reason?: PinWeakReason }) => {
          setPinDraft('');
          setPinSuccess(true);
          if (response.weak === true) {
            setPinWeak(true);
            setPinWeakReason(response.weak_reason ?? null);
          } else {
            setPinWeak(false);
            setPinWeakReason(null);
          }
        },
        onError:   (e) => { setPinError(e.message); setPinSuccess(false); },
      },
    );
  }

  if (user.isLoading) return <div className="text-sm text-text-secondary">Loading user…</div>;
  if (user.error != null) {
    return <div className="text-sm text-rose-600">Failed: {user.error.message}</div>;
  }
  if (user.data === null || user.data === undefined) {
    return <div className="text-sm text-text-secondary">User not found.</div>;
  }
  const u = user.data;
  const isDeleted = u.deleted_at !== null;

  return (
    <div className="space-y-4">
      <Link to="/backoffice/users" className="text-xs text-text-secondary inline-flex items-center hover:text-gold">
        <ChevronLeft className="h-3.5 w-3.5 mr-0.5" aria-hidden />
        Back to users
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-serif text-text-primary">{u.full_name}</h1>
          <p className="text-sm text-text-secondary">
            <span className="font-mono mr-3">{u.employee_code}</span>
            <span className="uppercase tracking-wider text-xs">{u.role_code}</span>
            {isDeleted && (
              <span className="ml-3 text-xs text-rose-600">(deleted)</span>
            )}
          </p>
        </div>
        {canUpdate && !isDeleted && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowRole(true); }}>
              <UserCog className="h-4 w-4 mr-1.5" aria-hidden /> Change role
            </Button>
            <Button
              variant="ghost"
              onClick={() => { setShowDelete(true); }}
              className="text-rose-600 hover:text-rose-700"
            >
              <Trash2 className="h-4 w-4 mr-1.5" aria-hidden /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm bg-bg-elevated rounded p-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Status</div>
          <div>
            {isDeleted
              ? <span className="text-rose-600">Deleted</span>
              : u.is_active ? <span className="text-emerald-600">Active</span>
                            : <span>Inactive</span>}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Last login</div>
          <div>{u.last_login_at !== null ? new Date(u.last_login_at).toLocaleString() : '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Failed attempts</div>
          <div>{u.failed_login_attempts}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Locked until</div>
          <div>{u.locked_until !== null ? new Date(u.locked_until).toLocaleString() : '—'}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Created</div>
          <div>{new Date(u.created_at).toLocaleDateString()}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-text-secondary">Updated</div>
          <div>{new Date(u.updated_at).toLocaleDateString()}</div>
        </div>
      </div>

      {canResetPin && !isDeleted && (
        <div className="bg-bg-elevated rounded p-4 space-y-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-text-secondary" aria-hidden />
            <h2 className="text-sm font-semibold">Reset PIN</h2>
          </div>
          <p className="text-xs text-text-secondary">
            {isSelf
              ? 'Pick a new PIN for yourself. It is bcrypt-hashed server-side.'
              : 'Reset this user\'s PIN. They will be locked out until you communicate the new PIN.'}
          </p>
          <div className="flex items-center gap-2">
            <input
              aria-label="New PIN"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinDraft}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '');
                setPinDraft(v);
                if (v.length >= 6) {
                  const s = evaluatePinStrength(v);
                  setPinWeak(s.weak);
                  setPinWeakReason(s.reason);
                } else {
                  setPinWeak(false);
                  setPinWeakReason(null);
                }
              }}
              placeholder="6 digits"
              className="w-40 px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded font-mono"
            />
            <Button onClick={handleResetPin} disabled={pinReset.isPending || pinDraft === ''} data-testid="reset-pin-button">
              {pinReset.isPending ? 'Resetting…' : 'Reset PIN'}
            </Button>
          </div>
          {pinWeak && !pinSuccess && (
            <p className="text-xs italic text-amber-600" data-testid="pin-weak-hint">
              ⚠ Weak PIN ({pinWeakReason})
            </p>
          )}
          {pinError !== null && (
            <div className="text-xs text-rose-600">{pinError}</div>
          )}
          {pinSuccess && (
            <div className="text-xs text-emerald-600" data-testid="pin-reset-success">PIN updated. The lockout (if any) is also cleared.</div>
          )}
          {pinSuccess && pinWeak && (
            <div
              role="alert"
              className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              data-testid="pin-weak-banner"
            >
              ⚠ This PIN is weak ({pinWeakReason}). Consider a stronger PIN next time.
            </div>
          )}
        </div>
      )}

      {showRole && (
        <RoleChangeDialog
          userId={u.id}
          currentRole={u.role_code}
          fullName={u.full_name}
          roles={(roles.data ?? []).map((r) => ({ code: r.code, name: r.name }))}
          onClose={() => { setShowRole(false); }}
        />
      )}

      {showDelete && (
        <DeleteUserDialog
          userId={u.id}
          fullName={u.full_name}
          onClose={() => {
            setShowDelete(false);
            navigate('/backoffice/users');
          }}
        />
      )}
    </div>
  );
}
