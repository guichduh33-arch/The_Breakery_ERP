import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, type ReactNode } from 'react';
import LoginPage from '@/pages/Login';
import PosPage from '@/pages/Pos';
import { useAuthStore } from '@/stores/authStore';

const KdsPage = lazy(() => import('@/pages/Kds'));
const TabletLayout = lazy(() => import('@/pages/tablet/TabletLayout'));
const TabletOrderPage = lazy(() => import('@/pages/tablet/TabletOrderPage'));
const TabletOrdersPage = lazy(() => import('@/pages/tablet/TabletOrdersPage'));

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pos" element={<Protected><PosPage /></Protected>} />
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
