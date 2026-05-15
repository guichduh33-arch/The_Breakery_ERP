// apps/backoffice/src/layouts/BackofficeLayout.tsx
//
// Session 14 / Phase 4.A — Backoffice global shell.
//
// Composes the Sidebar (extracted) + Topbar (extracted) with the routed
// <Outlet/>. The shell is desktop-first: the sidebar is fixed-left at
// w-60 (240px), the topbar is a thin chrome strip, and the content area
// scrolls vertically.

import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';
import { Topbar } from './Topbar.js';

export function BackofficeLayout() {
  return (
    <div className="h-screen flex bg-bg-base text-text-primary theme-backoffice">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
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
