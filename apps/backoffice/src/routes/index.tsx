// apps/backoffice/src/routes/index.tsx
import { useEffect, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { PermissionCode } from '@breakery/supabase';
// Eager: pre-auth first paint + always-mounted shell. Everything else is
// route-split via React.lazy so the initial bundle no longer carries recharts,
// xlsx, and all ~90 page modules (see <Suspense> boundary in BackofficeLayout).
import LoginPage from '@/pages/Login.js';
import { BackofficeLayout } from '@/layouts/BackofficeLayout.js';
import { useAuthStore } from '@/stores/authStore.js';

const DashboardPage = lazy(() => import('@/pages/Dashboard.js'));
const ProductsPage = lazy(() => import('@/pages/Products.js'));
const ProductDetailPage = lazy(() => import('@/pages/products/ProductDetailPage.js'));
const ProductsImportExportPage = lazy(() => import('@/pages/products/ProductsImportExportPage.js'));
const CombosPage = lazy(() => import('@/pages/products/CombosPage.js'));
const ComboBuilderPageBase = lazy(() => import('@/features/combos/components/ComboBuilderPage.js'));
const CategoriesPage = lazy(() => import('@/pages/categories/CategoriesPage.js'));
const PromotionsPage = lazy(() => import('@/pages/Promotions.js'));
const LoyaltyPage = lazy(() => import('@/pages/Loyalty.js'));
const InventoryPage = lazy(() => import('@/pages/Inventory.js'));
const IncomingStockPage = lazy(() => import('@/pages/IncomingStock.js'));
const TransfersListPage = lazy(() => import('@/pages/TransfersList.js'));
const TransferFormPage = lazy(() => import('@/pages/TransferForm.js'));
const TransferDetailPage = lazy(() => import('@/pages/TransferDetail.js'));
const SuppliersPage = lazy(() => import('@/pages/Suppliers.js'));
const SupplierDetailPage = lazy(() => import('@/pages/suppliers/SupplierDetailPage.js'));
const ProductionPage = lazy(() => import('@/pages/inventory/ProductionPage.js'));
const BatchProductionPage = lazy(() => import('@/pages/inventory/BatchProductionPage.js'));
const ProductionSchedulePage = lazy(() => import('@/pages/inventory/ProductionSchedulePage.js'));
const MarginWatchPage = lazy(() => import('@/pages/inventory/MarginWatchPage.js'));
const OpnameListPage = lazy(() => import('@/pages/inventory/OpnameListPage.js'));
const OpnameDetailPage = lazy(() => import('@/pages/inventory/OpnameDetailPage.js'));
const StockMovementsPage = lazy(() => import('@/pages/inventory/StockMovementsPage.js'));
const DisplayStockPage = lazy(() => import('@/pages/inventory/DisplayStockPage.js'));
const AlertsPage = lazy(() => import('@/pages/inventory/AlertsPage.js'));
const ProductDashboardPage = lazy(() => import('@/pages/inventory/ProductDashboardPage.js'));
const ProductStockPage = lazy(() => import('@/pages/inventory/ProductStockPage.js'));
const SectionsPage = lazy(() => import('@/pages/inventory/SectionsPage.js'));
const PurchaseOrdersListPage = lazy(() => import('@/pages/purchasing/PurchaseOrdersListPage.js'));
const NewPurchaseOrderPage = lazy(() => import('@/pages/purchasing/NewPurchaseOrderPage.js'));
const PurchaseOrderDetailPage = lazy(() => import('@/pages/purchasing/PurchaseOrderDetailPage.js'));
const ExpensesListPage = lazy(() => import('@/pages/expenses/ExpensesListPage.js'));
const NewExpensePage = lazy(() => import('@/pages/expenses/NewExpensePage.js'));
const ExpenseDetailPage = lazy(() => import('@/pages/expenses/ExpenseDetailPage.js'));
const UsersListPage = lazy(() => import('@/pages/users/UsersListPage.js'));
const NewUserPage = lazy(() => import('@/pages/users/NewUserPage.js'));
const UserDetailPage = lazy(() => import('@/pages/users/UserDetailPage.js'));
const PermissionsMatrixPage = lazy(() => import('@/pages/users/PermissionsMatrixPage.js'));
const ReportsIndexPage = lazy(() => import('@/pages/reports/ReportsIndexPage.js'));
const SalesByHourPage = lazy(() => import('@/pages/reports/SalesByHourPage.js'));
const SalesByCategoryPage = lazy(() => import('@/pages/reports/SalesByCategoryPage.js'));
const SalesByStaffPage = lazy(() => import('@/pages/reports/SalesByStaffPage.js'));
const CashierVariancePage = lazy(() => import('@/pages/reports/CashierVariancePage.js'));
const StockVariancePage = lazy(() => import('@/pages/reports/StockVariancePage.js'));
const ProductionYieldPage = lazy(() => import('@/pages/reports/ProductionYieldPage.js'));
const AuditPage = lazy(() => import('@/pages/reports/AuditPage.js'));
const ProfitLossPage = lazy(() => import('@/pages/reports/ProfitLossPage.js'));
const GrossMarginPage = lazy(() => import('@/pages/reports/GrossMarginPage.js'));
const BalanceSheetPage = lazy(() => import('@/pages/reports/BalanceSheetPage.js'));
const CashFlowPage = lazy(() => import('@/pages/reports/CashFlowPage.js'));
const BasketAnalysisPage = lazy(() => import('@/pages/reports/BasketAnalysisPage.js'));
const RecipeCostOverviewPage = lazy(() => import('@/pages/reports/RecipeCostOverviewPage.js'));
const RecipeCostTimelinePage = lazy(() => import('@/pages/reports/RecipeCostTimelinePage.js'));
const WastagePage = lazy(() => import('@/pages/reports/WastagePage.js'));
const PaymentByMethodPage = lazy(() => import('@/pages/reports/PaymentByMethodPage.js'));
const Pb1ReportPage = lazy(() => import('@/pages/reports/Pb1ReportPage.js'));
const StockMovementHistoryPage = lazy(() => import('@/pages/reports/StockMovementHistoryPage.js'));
const DailySalesPage = lazy(() => import('@/pages/reports/DailySalesPage.js'));
const StaffPerformancePage = lazy(() => import('@/pages/reports/StaffPerformancePage.js'));
const PurchaseItemsPage = lazy(() => import('@/pages/reports/PurchaseItemsPage.js'));
const PurchaseByDatePage = lazy(() => import('@/pages/reports/PurchaseByDatePage.js'));
const PurchaseBySupplierPage = lazy(() => import('@/pages/reports/PurchaseBySupplierPage.js'));
const ProductionReportPage = lazy(() => import('@/pages/reports/ProductionReportPage.js'));
const ProductionEfficiencyPage = lazy(() => import('@/pages/reports/ProductionEfficiencyPage.js'));
const PriceChangesPage = lazy(() => import('@/pages/reports/PriceChangesPage.js'));
const PermissionChangesPage = lazy(() => import('@/pages/reports/PermissionChangesPage.js'));
const CostSpendAnalyticsPage = lazy(() => import('@/pages/reports/CostSpendAnalyticsPage.js'));
const OperatingExpensesPage = lazy(() => import('@/pages/reports/OperatingExpensesPage.js'));
const SettingsHubPage = lazy(() => import('@/pages/settings/SettingsHubPage.js'));
const SettingsGeneralPage = lazy(() => import('@/pages/settings/SettingsGeneralPage.js'));
const SettingsInventoryPage = lazy(() => import('@/pages/settings/SettingsInventoryPage.js'));
const SettingsPaymentMethodsPage = lazy(() => import('@/pages/settings/SettingsPaymentMethodsPage.js'));
const SettingsCustomerDisplayPage = lazy(() => import('@/pages/settings/SettingsCustomerDisplayPage.js'));
const SettingsKdsConfigPage = lazy(() => import('@/pages/settings/SettingsKdsConfigPage.js'));
const SettingsFloorPlanPage = lazy(() => import('@/pages/settings/SettingsFloorPlanPage.js'));
const SettingsPrintingPage = lazy(() => import('@/pages/settings/SettingsPrintingPage.js'));
const SettingsPosConfigPage = lazy(() => import('@/pages/settings/SettingsPosConfigPage.js'));
const SettingsHolidaysPage = lazy(() => import('@/pages/settings/SettingsHolidaysPage.js'));
const SettingsEmailTemplatesPage = lazy(() => import('@/pages/settings/SettingsEmailTemplatesPage.js'));
const SettingsNotificationsPage = lazy(() => import('@/pages/settings/SettingsNotificationsPage.js'));
const SettingsReceiptTemplatesPage = lazy(() => import('@/pages/settings/SettingsReceiptTemplatesPage.js'));
const SettingsPermissionsPage = lazy(() => import('@/pages/settings/SettingsPermissionsPage.js'));
const SecuritySettingsPage = lazy(() => import('@/pages/settings/security/SecuritySettingsPage.js'));
const LanDevicesPage = lazy(() => import('@/pages/lan-devices/LanDevicesPage.js'));
const CohortReportPage = lazy(() => import('@/pages/marketing/CohortReportPage.js'));
const SegmentsPage = lazy(() => import('@/pages/marketing/SegmentsPage.js'));
const PromoRoiPage = lazy(() => import('@/pages/marketing/PromoRoiPage.js'));
const BirthdayPage = lazy(() => import('@/pages/marketing/BirthdayPage.js'));
const MappingsPage = lazy(() => import('@/pages/accounting/MappingsPage.js'));
const AccountingIndexPage = lazy(() => import('@/features/accounting/pages/AccountingIndexPage.js'));
const ChartOfAccountsPage = lazy(() => import('@/features/accounting/pages/ChartOfAccountsPage.js'));
const JournalEntriesPage = lazy(() => import('@/features/accounting/pages/JournalEntriesPage.js'));
const GeneralLedgerPage = lazy(() => import('@/features/accounting/pages/GeneralLedgerPage.js'));
const TrialBalancePage = lazy(() => import('@/features/accounting/pages/TrialBalancePage.js'));
const CashTreasuryPage = lazy(() => import('@/features/accounting/pages/CashTreasuryPage.js'));
const SettingsAccountingPage = lazy(() => import('@/features/accounting/pages/SettingsAccountingPage.js'));
const ExpenseThresholdsPage = lazy(() => import('@/features/settings/expense-thresholds/ExpenseThresholdsPage.js'));
const ZReportsListPage = lazy(() => import('@/pages/cash-register/ZReportsListPage.js'));
const CustomersListPage = lazy(() => import('@/pages/customers/CustomersListPage.js'));
const CustomerDetailPage = lazy(() =>
  import('@/pages/customers/CustomerDetailPage.js').then((m) => ({ default: m.CustomerDetailPage })),
);
const OrderDetailPage = lazy(() =>
  import('@/pages/orders/OrderDetailPage.js').then((m) => ({ default: m.OrderDetailPage })),
);
const OrdersListPage = lazy(() => import('@/pages/orders/OrdersListPage.js'));
const RecipeDetailPage = lazy(() =>
  import('@/pages/recipes/RecipeDetailPage.js').then((m) => ({ default: m.RecipeDetailPage })),
);
const CustomerCategoriesPage = lazy(() => import('@/pages/customers/CustomerCategoriesPage.js'));
const B2BDashboardPage = lazy(() => import('@/pages/btob/B2BDashboardPage.js'));
const B2BPaymentsPage = lazy(() => import('@/pages/btob/B2BPaymentsPage.js'));
const B2BSettingsPage = lazy(() => import('@/pages/btob/B2BSettingsPage.js'));

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
        <Route
          path="products"
          element={
            <PermissionGate required="products.read">
              <ProductsPage />
            </PermissionGate>
          }
        />
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
        <Route
          path="products/:productId"
          element={
            <PermissionGate required="products.read">
              <ProductDetailPage />
            </PermissionGate>
          }
        />
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
          path="inventory/:productId"
          element={
            <PermissionGate required="inventory.read">
              <ProductStockPage />
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
            <PermissionGate required="b2b.read">
              <B2BDashboardPage />
            </PermissionGate>
          }
        />
        <Route
          path="b2b/payments"
          element={
            <PermissionGate required="b2b.read">
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
        <Route
          path="accounting"
          element={
            <PermissionGate required="accounting.read">
              <AccountingIndexPage />
            </PermissionGate>
          }
        />
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
          path="accounting/cash"
          element={
            <PermissionGate required="accounting.cash.read">
              <CashTreasuryPage />
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
          path="reports/cashier-variance"
          element={
            <PermissionGate required="reports.read">
              <CashierVariancePage />
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
          path="reports/gross-margin"
          element={
            <PermissionGate required="reports.financial.read">
              <GrossMarginPage />
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
          path="reports/cost-spend"
          element={
            <PermissionGate required="reports.financial.read">
              <CostSpendAnalyticsPage />
            </PermissionGate>
          }
        />
        <Route
          path="reports/operating-expenses"
          element={
            <PermissionGate required="reports.financial.read">
              <OperatingExpensesPage />
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
          path="settings/inventory"
          element={
            <PermissionGate required="settings.read">
              <SettingsInventoryPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/payment-methods"
          element={
            <PermissionGate required="settings.read">
              <SettingsPaymentMethodsPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/customer-display"
          element={
            <PermissionGate required="settings.read">
              <SettingsCustomerDisplayPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/kds"
          element={
            <PermissionGate required="settings.read">
              <SettingsKdsConfigPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/floor-plan"
          element={
            <PermissionGate required="tables.update">
              <SettingsFloorPlanPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/printing"
          element={
            <PermissionGate required="settings.read">
              <SettingsPrintingPage />
            </PermissionGate>
          }
        />
        <Route
          path="settings/pos"
          element={
            <PermissionGate required="settings.read">
              <SettingsPosConfigPage />
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
          path="settings/notifications"
          element={
            <PermissionGate required="settings.read">
              <SettingsNotificationsPage />
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
            <PermissionGate required="settings.security.manage">
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
