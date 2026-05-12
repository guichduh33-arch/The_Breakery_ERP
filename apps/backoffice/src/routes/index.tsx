// apps/backoffice/src/routes/index.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import type { PermissionCode } from '@breakery/supabase';
import LoginPage from '@/pages/Login.js';
import DashboardPage from '@/pages/Dashboard.js';
import ProductsPage from '@/pages/Products.js';
import PromotionsPage from '@/pages/Promotions.js';
import LoyaltyPage from '@/pages/Loyalty.js';
import InventoryPage from '@/pages/Inventory.js';
import SuppliersPage from '@/pages/Suppliers.js';
import ComingSoonPage from '@/pages/ComingSoon.js';
import { BackofficeLayout } from '@/layouts/BackofficeLayout.js';
import { useAuthStore } from '@/stores/authStore.js';

function Protected({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

function PermissionGate({
  required,
  children,
}: {
  required: PermissionCode;
  children: React.ReactNode;
}) {
  const has = useAuthStore((s) => s.hasPermission(required));
  return has ? <>{children}</> : <Navigate to="/backoffice" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/backoffice" element={<Protected><BackofficeLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="promotions"
          element={
            <PermissionGate required="promotions.read">
              <PromotionsPage />
            </PermissionGate>
          }
        />
        <Route
          path="loyalty"
          element={
            <PermissionGate required="loyalty.read">
              <LoyaltyPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory"
          element={
            <PermissionGate required="inventory.read">
              <InventoryPage />
            </PermissionGate>
          }
        />
        <Route
          path="suppliers"
          element={
            <PermissionGate required="suppliers.read">
              <SuppliersPage />
            </PermissionGate>
          }
        />
        <Route path="purchasing" element={<ComingSoonPage module="Purchasing" />} />
        <Route path="customers" element={<ComingSoonPage module="Customers" />} />
        <Route path="b2b" element={<ComingSoonPage module="B2B" />} />
        <Route path="accounting" element={<ComingSoonPage module="Accounting" />} />
        <Route path="reports" element={<ComingSoonPage module="Reports" />} />
        <Route path="settings" element={<ComingSoonPage module="Settings" />} />
      </Route>
      <Route path="*" element={<Navigate to="/backoffice" replace />} />
    </Routes>
  );
}
