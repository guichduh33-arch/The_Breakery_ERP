// apps/backoffice/src/routes/index.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import type { PermissionCode } from '@breakery/supabase';
import LoginPage from '@/pages/Login.js';
import DashboardPage from '@/pages/Dashboard.js';
import ProductsPage from '@/pages/Products.js';
import ProductDetailPage from '@/pages/products/ProductDetailPage.js';
import CombosPage from '@/pages/products/CombosPage.js';
import PromotionsPage from '@/pages/Promotions.js';
import LoyaltyPage from '@/pages/Loyalty.js';
import InventoryPage from '@/pages/Inventory.js';
import IncomingStockPage from '@/pages/IncomingStock.js';
import TransfersListPage from '@/pages/TransfersList.js';
import TransferFormPage from '@/pages/TransferForm.js';
import TransferDetailPage from '@/pages/TransferDetail.js';
import SuppliersPage from '@/pages/Suppliers.js';
import SupplierDetailPage from '@/pages/suppliers/SupplierDetailPage.js';
import ComingSoonPage from '@/pages/ComingSoon.js';
import ProductionPage from '@/pages/inventory/ProductionPage.js';
import RecipeEditorPage from '@/pages/inventory/RecipeEditorPage.js';
import OpnameListPage from '@/pages/inventory/OpnameListPage.js';
import OpnameDetailPage from '@/pages/inventory/OpnameDetailPage.js';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import AlertsPage from '@/pages/inventory/AlertsPage.js';
import ProductDashboardPage from '@/pages/inventory/ProductDashboardPage.js';
import SectionsPage from '@/pages/inventory/SectionsPage.js';
import PurchaseOrdersListPage from '@/pages/purchasing/PurchaseOrdersListPage.js';
import NewPurchaseOrderPage from '@/pages/purchasing/NewPurchaseOrderPage.js';
import PurchaseOrderDetailPage from '@/pages/purchasing/PurchaseOrderDetailPage.js';
import ExpensesListPage from '@/pages/expenses/ExpensesListPage.js';
import NewExpensePage from '@/pages/expenses/NewExpensePage.js';
import ExpenseDetailPage from '@/pages/expenses/ExpenseDetailPage.js';
import UsersListPage from '@/pages/users/UsersListPage.js';
import NewUserPage from '@/pages/users/NewUserPage.js';
import UserDetailPage from '@/pages/users/UserDetailPage.js';
import PermissionsMatrixPage from '@/pages/users/PermissionsMatrixPage.js';
import ReportsIndexPage from '@/pages/reports/ReportsIndexPage.js';
import SalesByHourPage from '@/pages/reports/SalesByHourPage.js';
import SalesByCategoryPage from '@/pages/reports/SalesByCategoryPage.js';
import SalesByStaffPage from '@/pages/reports/SalesByStaffPage.js';
import StockVariancePage from '@/pages/reports/StockVariancePage.js';
import AuditPage from '@/pages/reports/AuditPage.js';
import ProfitLossPage     from '@/pages/reports/ProfitLossPage.js';
import BalanceSheetPage   from '@/pages/reports/BalanceSheetPage.js';
import CashFlowPage       from '@/pages/reports/CashFlowPage.js';
import BasketAnalysisPage from '@/pages/reports/BasketAnalysisPage.js';
import SettingsHubPage              from '@/pages/settings/SettingsHubPage.js';
import SettingsGeneralPage          from '@/pages/settings/SettingsGeneralPage.js';
import SettingsHolidaysPage         from '@/pages/settings/SettingsHolidaysPage.js';
import SettingsEmailTemplatesPage   from '@/pages/settings/SettingsEmailTemplatesPage.js';
import SettingsReceiptTemplatesPage from '@/pages/settings/SettingsReceiptTemplatesPage.js';
import SettingsPermissionsPage      from '@/pages/settings/SettingsPermissionsPage.js';
import PrintQueuePage from '@/pages/print-queue/PrintQueuePage.js';
import LanDevicesPage from '@/pages/lan-devices/LanDevicesPage.js';
import CohortReportPage from '@/pages/marketing/CohortReportPage.js';
import SegmentsPage     from '@/pages/marketing/SegmentsPage.js';
import PromoRoiPage     from '@/pages/marketing/PromoRoiPage.js';
import BirthdayPage     from '@/pages/marketing/BirthdayPage.js';
import MappingsPage     from '@/pages/accounting/MappingsPage.js';
import CustomersListPage      from '@/pages/customers/CustomersListPage.js';
import CustomerCategoriesPage from '@/pages/customers/CustomerCategoriesPage.js';
import B2BDashboardPage      from '@/pages/btob/B2BDashboardPage.js';
import B2BPaymentsPage       from '@/pages/btob/B2BPaymentsPage.js';
import B2BSettingsPage       from '@/pages/btob/B2BSettingsPage.js';
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
        <Route path="products/combos" element={<CombosPage />} />
        <Route path="products/:productId" element={<ProductDetailPage />} />
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
        <Route
          path="suppliers/:id"
          element={
            <PermissionGate required="suppliers.read">
              <SupplierDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing"
          element={
            <PermissionGate required={'purchasing.po.read' as never}>
              <PurchaseOrdersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders"
          element={
            <PermissionGate required={'purchasing.po.read' as never}>
              <PurchaseOrdersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders/new"
          element={
            <PermissionGate required={'purchasing.po.create' as never}>
              <NewPurchaseOrderPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders/:id"
          element={
            <PermissionGate required={'purchasing.po.read' as never}>
              <PurchaseOrderDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="expenses"
          element={
            <PermissionGate required="expenses.read">
              <ExpensesListPage />
            </PermissionGate>
          }
        />
        <Route
          path="expenses/new"
          element={
            <PermissionGate required="expenses.create">
              <NewExpensePage />
            </PermissionGate>
          }
        />
        <Route
          path="expenses/:id"
          element={
            <PermissionGate required="expenses.read">
              <ExpenseDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="customers"
          element={
            <PermissionGate required="customers.read">
              <CustomersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="customers/categories"
          element={
            <PermissionGate required="customer_categories.read">
              <CustomerCategoriesPage />
            </PermissionGate>
          }
        />
        <Route
          path="b2b"
          element={
            <PermissionGate required="customers.read">
              <B2BDashboardPage />
            </PermissionGate>
          }
        />
        <Route
          path="b2b/payments"
          element={
            <PermissionGate required="customers.read">
              <B2BPaymentsPage />
            </PermissionGate>
          }
        />
        <Route
          path="b2b/settings"
          element={
            <PermissionGate required="settings.read">
              <B2BSettingsPage />
            </PermissionGate>
          }
        />
        <Route path="accounting" element={<ComingSoonPage module="Accounting" />} />
        <Route
          path="accounting/mappings"
          element={
            <PermissionGate required="accounting.read">
              <MappingsPage />
            </PermissionGate>
          }
        />
        <Route
          path="marketing/cohort"
          element={
            <PermissionGate required="reports.read">
              <CohortReportPage />
            </PermissionGate>
          }
        />
        <Route
          path="marketing/segments"
          element={
            <PermissionGate required="reports.read">
              <SegmentsPage />
            </PermissionGate>
          }
        />
        <Route
          path="marketing/promo-roi"
          element={
            <PermissionGate required="reports.read">
              <PromoRoiPage />
            </PermissionGate>
          }
        />
        <Route
          path="marketing/birthday"
          element={
            <PermissionGate required="reports.read">
              <BirthdayPage />
            </PermissionGate>
          }
        />
        <Route
          path="users"
          element={
            <PermissionGate required="users.read">
              <UsersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="users/new"
          element={
            <PermissionGate required="users.create">
              <NewUserPage />
            </PermissionGate>
          }
        />
        <Route
          path="users/permissions"
          element={
            <PermissionGate required="rbac.read">
              <PermissionsMatrixPage />
            </PermissionGate>
          }
        />
        <Route
          path="users/:id"
          element={
            <PermissionGate required="users.read">
              <UserDetailPage />
            </PermissionGate>
          }
        />
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
        <Route
          path="reports/profit-loss"
          element={
            <PermissionGate required="reports.financial.read">
              <ProfitLossPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/balance-sheet"
          element={
            <PermissionGate required="reports.financial.read">
              <BalanceSheetPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/cash-flow"
          element={
            <PermissionGate required="reports.financial.read">
              <CashFlowPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/basket-analysis"
          element={
            <PermissionGate required="reports.sales.read">
              <BasketAnalysisPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings"
          element={
            <PermissionGate required="settings.read">
              <SettingsHubPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/general"
          element={
            <PermissionGate required="settings.read">
              <SettingsGeneralPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/holidays"
          element={
            <PermissionGate required="settings.read">
              <SettingsHolidaysPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/templates/email"
          element={
            <PermissionGate required="settings.read">
              <SettingsEmailTemplatesPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/templates/receipt"
          element={
            <PermissionGate required="settings.read">
              <SettingsReceiptTemplatesPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/permissions"
          element={
            <PermissionGate required="settings.read">
              <SettingsPermissionsPage />
            </PermissionGate>
          }
        />
        <Route
          path="print-queue"
          element={
            <PermissionGate required="print_queue.read">
              <PrintQueuePage />
            </PermissionGate>
          }
        />
        <Route
          path="lan-devices"
          element={
            <PermissionGate required="lan.devices.read">
              <LanDevicesPage />
            </PermissionGate>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/backoffice" replace />} />
    </Routes>
  );
}
