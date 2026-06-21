// apps/backoffice/src/layouts/BackofficeLayout.tsx
//
// Session 14 / Phase 4.A — Backoffice global shell.
//
// Composes the Sidebar (extracted) + Topbar (extracted) with the routed
// <Outlet/>. The shell is desktop-first: the sidebar is fixed-left at
// w-60 (240px) and retractable — a Topbar toggle collapses it to w-0 so the
// content area can use the full width. The collapsed state is persisted in
// localStorage (`bo:sidebar:collapsed`) so it survives reloads.

import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '@breakery/ui';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';

const SIDEBAR_COLLAPSED_KEY = 'bo:sidebar:collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function BackofficeLayout() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* private mode / quota — fail silent */
    }
  }, [collapsed]);

  return (
    <div className="h-screen flex bg-bg-base text-text-primary theme-backoffice">
      {/* Retractable rail: an overflow-hidden flex wrapper animates its width
       * between w-60 and w-0 while the inner <aside> keeps its 240px layout and
       * is clipped. `invisible` when collapsed drops the hidden links out of the
       * tab order (a11y). The animation is skipped under prefers-reduced-motion. */}
      <div
        className={cn(
          'flex shrink-0 overflow-hidden transition-[width] duration-300 ease-out motion-reduce:transition-none',
          collapsed ? 'w-0 invisible' : 'w-60',
        )}
      >
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar
          sidebarCollapsed={collapsed}
          onToggleSidebar={() => setCollapsed((c) => !c)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-6"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
