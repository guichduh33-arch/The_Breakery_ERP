// apps/backoffice/src/routes/index.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import type { PermissionCode } from '@breakery/supabase';
import LoginPage from '@/pages/Login.js';
import DashboardPage from '@/pages/Dashboard.js';
import ProductsPage from '@/pages/Products.js';
import PromotionsPage from '@/pages/Promotions.js';
import LoyaltyPage from '@/pages/Loyalty.js';
import InventoryPage from '@/pages/Inventory.js';
import IncomingStockPage from '@/pages/IncomingStock.js';
import TransfersListPage from '@/pages/TransfersList.js';
import TransferFormPage from '@/pages/TransferForm.js';
import TransferDetailPage from '@/pages/TransferDetail.js';
import SuppliersPage from '@/pages/Suppliers.js';
import ComingSoonPage from '@/pages/ComingSoon.js';
import ProductionPage from '@/pages/inventory/ProductionPage.js';
import RecipeEditorPage from '@/pages/inventory/RecipeEditorPage.js';
import OpnameListPage from '@/pages/inventory/OpnameListPage.js';
import OpnameDetailPage from '@/pages/inventory/OpnameDetailPage.js';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import AlertsPage from '@/pages/inventory/AlertsPage.js';
import ProductDashboardPage from '@/pages/inventory/ProductDashboardPage.js';
import SectionsPage from '@/pages/inventory/SectionsPage.js';
import ReportsIndexPage from '@/pages/reports/ReportsIndexPage.js';
import SalesByHourPage from '@/pages/reports/SalesByHourPage.js';
import SalesByCategoryPage from '@/pages/reports/SalesByCategoryPage.js';
import SalesByStaffPage from '@/pages/reports/SalesByStaffPage.js';
import StockVariancePage from '@/pages/reports/StockVariancePage.js';
import AuditPage from '@/pages/reports/AuditPage.js';
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
          path="inventory/incoming"
          element={
            <PermissionGate required="inventory.receive">
              <IncomingStockPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/transfers"
          element={
            <PermissionGate required="inventory.read">
              <TransfersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/transfers/new"
          element={
            <PermissionGate required="inventory.transfer.create">
              <TransferFormPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/transfers/:id"
          element={
            <PermissionGate required="inventory.read">
              <TransferDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/production"
          element={
            <PermissionGate required="inventory.read">
              <ProductionPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/recipes"
          element={
            <PermissionGate required="inventory.read">
              <RecipeEditorPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/opname"
          element={
            <PermissionGate required="inventory.read">
              <OpnameListPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/opname/:id"
          element={
            <PermissionGate required="inventory.read">
              <OpnameDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/movements"
          element={
            <PermissionGate required="inventory.read">
              <StockMovementsPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/alerts"
          element={
            <PermissionGate required="inventory.read">
              <AlertsPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/sections"
          element={
            <PermissionGate required="inventory.read">
              <SectionsPage />
            </PermissionGate>
          }
        />
        <Route
          path="products/:productId/dashboard"
          element={
            <PermissionGate required="inventory.read">
              <ProductDashboardPage />
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
        <Route
          path="reports"
          element={
            <PermissionGate required="reports.read">
              <ReportsIndexPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/sales-by-hour"
          element={
            <PermissionGate required="reports.sales.read">
              <SalesByHourPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/sales-by-category"
          element={
            <PermissionGate required="reports.sales.read">
              <SalesByCategoryPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/sales-by-staff"
          element={
            <PermissionGate required="reports.sales.read">
              <SalesByStaffPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/stock-variance"
          element={
            <PermissionGate required="reports.inventory.read">
              <StockVariancePage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/audit"
          element={
            <PermissionGate required="reports.audit.read">
              <AuditPage />
            </PermissionGate>
          }
        />
        <Route path="settings" element={<ComingSoonPage module="Settings" />} />
      </Route>
      <Route path="*" element={<Navigate to="/backoffice" replace />} />
    </Routes>
  );
}
