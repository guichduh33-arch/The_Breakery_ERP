// apps/backoffice/src/layouts/Topbar.tsx
//
// Session 14 / Phase 4.A — Backoffice global topbar.
//
// Right-aligned cluster:
//   - Last-updated indicator (green dot + timestamp)
//   - Refresh action (manual reload of current view's data)
//   - User chip (full_name + role) with logout
//
// Greeting + page title live INSIDE the page (Dashboard.tsx) — the topbar is
// a slim chrome strip per the Dashboard.jpg reference.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';

interface TopbarProps {
  /** ISO timestamp of last data refresh, shown in the right-aligned chip. */
  lastUpdated?: string;
  /** Manual refresh hook — page-level handler. */
  onRefresh?: () => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export function Topbar({ lastUpdated, onRefresh }: TopbarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="h-14 px-6 flex items-center justify-end gap-3 border-b border-border-subtle bg-bg-elevated">
      {lastUpdated !== undefined && (
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-overlay text-xs text-text-secondary"
          aria-live="polite"
        >
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          <span>Last updated {formatTime(lastUpdated)}</span>
          {onRefresh !== undefined && (
            <button
              type="button"
              onClick={onRefresh}
              className="ml-1 text-text-secondary hover:text-text-primary"
              aria-label="Refresh data"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}

      {user !== null && (
        <div className="flex items-center gap-2 text-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold-soft text-gold font-semibold">
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="leading-tight">
            <div className="text-text-primary font-medium">{user.full_name}</div>
            <div className="text-[11px] text-text-secondary uppercase tracking-wider">
              {user.role_code}
            </div>
          </div>
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => { void handleLogout(); }}
        disabled={busy}
        aria-label="Logout"
      >
        <LogOut className="h-4 w-4 mr-2" aria-hidden /> Logout
      </Button>
    </header>
  );
}
