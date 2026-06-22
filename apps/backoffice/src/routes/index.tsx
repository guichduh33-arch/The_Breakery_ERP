// apps/backoffice/src/routes/index.tsx
import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { PermissionCode } from '@breakery/supabase';
import LoginPage from '@/pages/Login.js';
import DashboardPage from '@/pages/Dashboard.js';
import ProductsPage from '@/pages/Products.js';
import ProductDetailPage from '@/pages/products/ProductDetailPage.js';
import ProductsImportExportPage from '@/pages/products/ProductsImportExportPage.js';
import CombosPage from '@/pages/products/CombosPage.js';
import ComboBuilderPageBase from '@/features/combos/components/ComboBuilderPage.js';
import CategoriesPage from '@/pages/categories/CategoriesPage.js';
import PromotionsPage from '@/pages/Promotions.js';
import LoyaltyPage from '@/pages/Loyalty.js';
import InventoryPage from '@/pages/Inventory.js';
import IncomingStockPage from '@/pages/IncomingStock.js';
import TransfersListPage from '@/pages/TransfersList.js';
import ExpiringStockPage from '@/features/inventory/pages/ExpiringStockPage.js';
import TransferFormPage from '@/pages/TransferForm.js';
import TransferDetailPage from '@/pages/TransferDetail.js';
import SuppliersPage from '@/pages/Suppliers.js';
import SupplierDetailPage from '@/pages/suppliers/SupplierDetailPage.js';
import ProductionPage from '@/pages/inventory/ProductionPage.js';
import BatchProductionPage from '@/pages/inventory/BatchProductionPage.js';
import ProductionSchedulePage from '@/pages/inventory/ProductionSchedulePage.js';
import MarginWatchPage from '@/pages/inventory/MarginWatchPage.js';
import OpnameListPage from '@/pages/inventory/OpnameListPage.js';
import OpnameDetailPage from '@/pages/inventory/OpnameDetailPage.js';
import StockMovementsPage from '@/pages/inventory/StockMovementsPage.js';
import DisplayStockPage from '@/pages/inventory/DisplayStockPage.js';
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
import ProductionYieldPage from '@/pages/reports/ProductionYieldPage.js';
import AuditPage from '@/pages/reports/AuditPage.js';
import ProfitLossPage     from '@/pages/reports/ProfitLossPage.js';
import BalanceSheetPage   from '@/pages/reports/BalanceSheetPage.js';
import CashFlowPage       from '@/pages/reports/CashFlowPage.js';
import BasketAnalysisPage    from '@/pages/reports/BasketAnalysisPage.js';
import RecipeCostOverviewPage from '@/pages/reports/RecipeCostOverviewPage.js';
import RecipeCostTimelinePage from '@/pages/reports/RecipeCostTimelinePage.js';
import WastagePage               from '@/pages/reports/WastagePage.js';
import PaymentByMethodPage       from '@/pages/reports/PaymentByMethodPage.js';
import Pb1ReportPage             from '@/pages/reports/Pb1ReportPage.js';
import StockMovementHistoryPage  from '@/pages/reports/StockMovementHistoryPage.js';
import PerishableTurnoverPage    from '@/pages/reports/PerishableTurnoverPage.js';
import DailySalesPage            from '@/pages/reports/DailySalesPage.js';
import StaffPerformancePage      from '@/pages/reports/StaffPerformancePage.js';
import PurchaseItemsPage         from '@/pages/reports/PurchaseItemsPage.js';
import PurchaseByDatePage        from '@/pages/reports/PurchaseByDatePage.js';
import PurchaseBySupplierPage    from '@/pages/reports/PurchaseBySupplierPage.js';
import ProductionReportPage      from '@/pages/reports/ProductionReportPage.js';
import ProductionEfficiencyPage  from '@/pages/reports/ProductionEfficiencyPage.js';
import PriceChangesPage          from '@/pages/reports/PriceChangesPage.js';
import PermissionChangesPage     from '@/pages/reports/PermissionChangesPage.js';
import SettingsHubPage              from '@/pages/settings/SettingsHubPage.js';
import SettingsGeneralPage          from '@/pages/settings/SettingsGeneralPage.js';
import SettingsHolidaysPage         from '@/pages/settings/SettingsHolidaysPage.js';
import SettingsEmailTemplatesPage   from '@/pages/settings/SettingsEmailTemplatesPage.js';
import SettingsReceiptTemplatesPage from '@/pages/settings/SettingsReceiptTemplatesPage.js';
import SettingsPermissionsPage      from '@/pages/settings/SettingsPermissionsPage.js';
import SecuritySettingsPage         from '@/pages/settings/security/SecuritySettingsPage.js';
import PrintQueuePage from '@/pages/print-queue/PrintQueuePage.js';
import LanDevicesPage from '@/pages/lan-devices/LanDevicesPage.js';
import CohortReportPage from '@/pages/marketing/CohortReportPage.js';
import SegmentsPage     from '@/pages/marketing/SegmentsPage.js';
import PromoRoiPage     from '@/pages/marketing/PromoRoiPage.js';
import BirthdayPage     from '@/pages/marketing/BirthdayPage.js';
import MappingsPage     from '@/pages/accounting/MappingsPage.js';
import AccountingIndexPage   from '@/features/accounting/pages/AccountingIndexPage.js';
import ChartOfAccountsPage   from '@/features/accounting/pages/ChartOfAccountsPage.js';
import JournalEntriesPage    from '@/features/accounting/pages/JournalEntriesPage.js';
import GeneralLedgerPage     from '@/features/accounting/pages/GeneralLedgerPage.js';
import TrialBalancePage      from '@/features/accounting/pages/TrialBalancePage.js';
import SettingsAccountingPage from '@/features/accounting/pages/SettingsAccountingPage.js';
import ExpenseThresholdsPage  from '@/features/settings/expense-thresholds/ExpenseThresholdsPage.js';
import ZReportsListPage       from '@/pages/cash-register/ZReportsListPage.js';
import CustomersListPage      from '@/pages/customers/CustomersListPage.js';
import { CustomerDetailPage } from '@/pages/customers/CustomerDetailPage.js';
import { OrderDetailPage }    from '@/pages/orders/OrderDetailPage.js';
import OrdersListPage         from '@/pages/orders/OrdersListPage.js';
import { RecipeDetailPage }   from '@/pages/recipes/RecipeDetailPage.js';
import CustomerCategoriesPage from '@/pages/customers/CustomerCategoriesPage.js';
import B2BDashboardPage      from '@/pages/btob/B2BDashboardPage.js';
import B2BPaymentsPage       from '@/pages/btob/B2BPaymentsPage.js';
import B2BSettingsPage       from '@/pages/btob/B2BSettingsPage.js';
import { BackofficeLayout } from '@/layouts/BackofficeLayout.js';
import { useAuthStore } from '@/stores/authStore.js';

function ComboBuilderNewPage() { return <ComboBuilderPageBase mode="create" />; }
function ComboBuilderEditPage() { return <ComboBuilderPageBase mode="edit" />; }

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
  // P1 #4 — surface an explicit "access denied" toast instead of bouncing the
  // user back to the dashboard with no explanation. By the time a PermissionGate
  // renders, boot rehydration is done (see <BootGate>), so a `false` here is a
  // genuine permission denial, not a not-yet-loaded state.
  useEffect(() => {
    if (!has) toast.error("Accès refusé : vous n'avez pas la permission requise pour cette page.");
  }, [has]);
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
          path="products/combos"
          element={
            <PermissionGate required="combos.read">
              <CombosPage />
            </PermissionGate>
          }
        />
        <Route
          path="products/combos/new"
          element={
            <PermissionGate required="combos.create">
              <ComboBuilderNewPage />
            </PermissionGate>
          }
        />
        <Route
          path="products/combos/:comboId/edit"
          element={
            <PermissionGate required="combos.update">
              <ComboBuilderEditPage />
            </PermissionGate>
          }
        />
        <Route
          path="products/import-export"
          element={
            <PermissionGate required="catalog.import">
              <ProductsImportExportPage />
            </PermissionGate>
          }
        />
        <Route path="products/:productId" element={<ProductDetailPage />} />
        <Route
          path="categories"
          element={
            <PermissionGate required="categories.read">
              <CategoriesPage />
            </PermissionGate>
          }
        />
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
          path="inventory/expiring"
          element={
            <PermissionGate required="inventory.read">
              <ExpiringStockPage />
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
          path="inventory/production/batch"
          element={
            <PermissionGate required="inventory.production.create">
              <BatchProductionPage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/production/schedule"
          element={
            <PermissionGate required="inventory.production.schedule">
              <ProductionSchedulePage />
            </PermissionGate>
          }
        />
        <Route
          path="inventory/production/margin-watch"
          element={
            <PermissionGate required="reports.inventory.read">
              <MarginWatchPage />
            </PermissionGate>
          }
        />
        <Route path="inventory/recipes" element={<Navigate to="/backoffice/products" replace />} />
        <Route
          path="inventory/recipes/:productId"
          element={
            <PermissionGate required="reports.inventory.read">
              <RecipeDetailPage />
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
          path="inventory/display"
          element={
            <PermissionGate required="display.read">
              <DisplayStockPage />
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
            <PermissionGate required={'purchasing.po.read'}>
              <PurchaseOrdersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders"
          element={
            <PermissionGate required={'purchasing.po.read'}>
              <PurchaseOrdersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders/new"
          element={
            <PermissionGate required={'purchasing.po.create'}>
              <NewPurchaseOrderPage />
            </PermissionGate>
          }
        />
        <Route
          path="purchasing/purchase-orders/:id"
          element={
            <PermissionGate required={'purchasing.po.read'}>
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
          path="cash-register/zreports"
          element={
            <PermissionGate required={'zreports.read'}>
              <ZReportsListPage />
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
          path="customers/:id"
          element={
            <PermissionGate required="customers.read">
              <CustomerDetailPage />
            </PermissionGate>
          }
        />
        <Route
          path="orders"
          element={
            <PermissionGate required="orders.read">
              <OrdersListPage />
            </PermissionGate>
          }
        />
        <Route
          path="orders/:id"
          element={
            <PermissionGate required="orders.read">
              <OrderDetailPage />
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
        <Route path="accounting" element={<AccountingIndexPage />} />
        <Route
          path="accounting/chart-of-accounts"
          element={
            <PermissionGate required="accounting.coa.read">
              <ChartOfAccountsPage />
            </PermissionGate>
          }
        />
        <Route
          path="accounting/journal-entries"
          element={
            <PermissionGate required="accounting.gl.read">
              <JournalEntriesPage />
            </PermissionGate>
          }
        />
        <Route
          path="accounting/general-ledger"
          element={
            <PermissionGate required="accounting.gl.read">
              <GeneralLedgerPage />
            </PermissionGate>
          }
        />
        <Route
          path="accounting/trial-balance"
          element={
            <PermissionGate required="accounting.tb.read">
              <TrialBalancePage />
            </PermissionGate>
          }
        />
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
          path="reports/production-yield"
          element={
            <PermissionGate required="inventory.read">
              <ProductionYieldPage />
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
          path="reports/recipe-cost"
          element={
            <PermissionGate required="reports.financial.read">
              <RecipeCostOverviewPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/recipe-cost/:productId"
          element={
            <PermissionGate required="reports.financial.read">
              <RecipeCostTimelinePage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/wastage"
          element={
            <PermissionGate required="reports.inventory.read">
              <WastagePage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/payment-by-method"
          element={
            <PermissionGate required="reports.financial.read">
              <PaymentByMethodPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/pb1"
          element={
            <PermissionGate required="reports.financial.read">
              <Pb1ReportPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/stock-movements"
          element={
            <PermissionGate required="reports.inventory.read">
              <StockMovementHistoryPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/perishable-turnover"
          element={
            <PermissionGate required="reports.inventory.read">
              <PerishableTurnoverPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/daily-sales"
          element={
            <PermissionGate required="reports.sales.read">
              <DailySalesPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/staff-performance"
          element={
            <PermissionGate required="reports.sales.read">
              <StaffPerformancePage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/purchase-items"
          element={
            <PermissionGate required="reports.inventory.read">
              <PurchaseItemsPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/purchase-by-date"
          element={
            <PermissionGate required="reports.inventory.read">
              <PurchaseByDatePage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/purchase-by-supplier"
          element={
            <PermissionGate required="reports.inventory.read">
              <PurchaseBySupplierPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/production-report"
          element={
            <PermissionGate required="reports.inventory.read">
              <ProductionReportPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/production-efficiency"
          element={
            <PermissionGate required="reports.inventory.read">
              <ProductionEfficiencyPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/price-changes"
          element={
            <PermissionGate required="reports.financial.read">
              <PriceChangesPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/permission-changes"
          element={
            <PermissionGate required="reports.audit.read">
              <PermissionChangesPage />
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
          path="settings/security"
          element={
            <PermissionGate required="settings.read">
              <SecuritySettingsPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/accounting"
          element={
            <PermissionGate required="accounting.period.close">
              <SettingsAccountingPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/expense-thresholds"
          element={
            <PermissionGate required="expenses.thresholds.read">
              <ExpenseThresholdsPage />
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
