import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import { VirtualKeypadProvider } from '@breakery/ui';
import LoginPage from '@/pages/Login';
import PosPage from '@/pages/Pos';
import { useAuthStore } from '@/stores/authStore';

const KdsPage = lazy(() => import('@/pages/Kds'));
const TabletLayout = lazy(() => import('@/pages/tablet/TabletLayout'));
const TabletOrderPage = lazy(() => import('@/pages/tablet/TabletOrderPage'));
const TabletOrdersPage = lazy(() => import('@/pages/tablet/TabletOrdersPage'));
// Session 13 / Phase 4.C — D-4C-4 : `/display` route is publicly navigable.
// No <Protected> guard — kiosk JWT (issued via kiosk-issue-jwt EF) replaces
// the staff PIN session. Unpaired devices land on the pair-prompt UI.
const CustomerDisplayPage = lazy(
  () => import('@/features/display/CustomerDisplayPage'),
);

// Session 14 / Phase 2.D — POS auxiliary surfaces.
const POSStockView = lazy(() => import('@/features/stock/POSStockView'));
const POSReportsOverviewPage = lazy(() => import('@/features/reports/POSReportsOverviewPage'));
const POSPaymentsReportPage = lazy(() => import('@/features/reports/POSPaymentsReportPage'));
const POSProductsReportPage = lazy(() => import('@/features/reports/POSProductsReportPage'));
const POSActivityReportPage = lazy(() => import('@/features/reports/POSActivityReportPage'));
const POSSettingsPage = lazy(() => import('@/features/settings/POSSettingsPage'));
const CustomerDebtsPanel = lazy(() => import('@/features/customers/CustomerDebtsPanel'));

function Protected({ children }: { children: ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

function RouteFallback() {
  return (
    <div className="h-[100dvh] grid place-items-center bg-bg-base text-text-secondary text-sm">
      Loading…
    </div>
  );
}

function ProtectedLazy({ children }: { children: ReactNode }) {
  return (
    <Protected>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </Protected>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/pos"
        element={
          <Protected>
            <VirtualKeypadProvider>
              <PosPage />
            </VirtualKeypadProvider>
          </Protected>
        }
      />

      {/* Session 14 / Phase 2.D — auxiliary POS surfaces. */}
      <Route path="/pos/stock" element={<ProtectedLazy><POSStockView /></ProtectedLazy>} />
      <Route path="/pos/reports" element={<ProtectedLazy><POSReportsOverviewPage /></ProtectedLazy>} />
      <Route path="/pos/reports/payments" element={<ProtectedLazy><POSPaymentsReportPage /></ProtectedLazy>} />
      <Route path="/pos/reports/products" element={<ProtectedLazy><POSProductsReportPage /></ProtectedLazy>} />
      <Route path="/pos/reports/activity" element={<ProtectedLazy><POSActivityReportPage /></ProtectedLazy>} />
      <Route path="/pos/settings" element={<ProtectedLazy><POSSettingsPage /></ProtectedLazy>} />
      <Route path="/pos/debts" element={<ProtectedLazy><CustomerDebtsPanel /></ProtectedLazy>} />

      <Route
        path="/kds"
        element={
          <Protected>
            <Suspense fallback={<RouteFallback />}>
              <KdsPage />
            </Suspense>
          </Protected>
        }
      />
      <Route
        path="/display"
        element={
          <Suspense fallback={<RouteFallback />}>
            <CustomerDisplayPage />
          </Suspense>
        }
      />
      <Route
        path="/tablet"
        element={
          <Suspense fallback={<RouteFallback />}>
            <TabletLayout />
          </Suspense>
        }
      >
        <Route index element={<Navigate to="order" replace />} />
        <Route
          path="order"
          element={
            <Suspense fallback={<RouteFallback />}>
              <TabletOrderPage />
            </Suspense>
          }
        />
        <Route
          path="orders"
          element={
            <Suspense fallback={<RouteFallback />}>
              <TabletOrdersPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}
