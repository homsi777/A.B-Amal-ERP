/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

/**
 * In Electron production (file:// protocol), BrowserRouter cannot handle
 * history-based routing because there is no web server to serve sub-paths.
 * HashRouter uses /#/path format which works with file:// and survives app restarts.
 * In normal browser mode, BrowserRouter is used for clean URLs.
 */
const RouterComponent =
  typeof window !== 'undefined' && window.fabricApp?.isElectron
    ? HashRouter
    : BrowserRouter;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || target.isContentEditable
    || Boolean(target.closest('[contenteditable="true"]'))
  );
}

function hasOpenModal(): boolean {
  return Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]'));
}

function EscapeBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape'
        || event.repeat
        || event.defaultPrevented
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || location.pathname === '/login'
        || isEditableTarget(event.target)
        || hasOpenModal()
      ) {
        return;
      }

      event.preventDefault();
      if (window.history.length > 1) {
        navigate(-1);
      } else if (location.pathname !== '/') {
        navigate('/');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname, navigate]);

  return null;
}
import { DashboardLayout } from './layouts/DashboardLayout';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { CreateItem } from './pages/inventory/CreateItem';
import { InventorySettings } from './pages/inventory/InventorySettings';
import { StickerPrinting } from './pages/inventory/StickerPrinting';
import { CustomStickerPrinting } from './pages/inventory/CustomStickerPrinting';
import { BulkPricing } from './pages/inventory/BulkPricing';
import { Warehouses } from './pages/inventory/Warehouses';
import { Transfers } from './pages/inventory/Transfers';
import { Depreciation } from './pages/inventory/Depreciation';
import { Categories } from './pages/inventory/Categories';
import { FabricMasterData } from './pages/inventory/FabricMasterData';
import { CreateRoll } from './pages/inventory/CreateRoll';
import { RollDetails } from './pages/inventory/RollDetails';
import { ImportExcel } from './pages/purchases/ImportExcel';
import { ImportBatches } from './pages/purchases/ImportBatches';
import { PrintJobs } from './pages/inventory/PrintJobs';
import { Sales } from './pages/Sales';
import { Purchases } from './pages/Purchases';
import { ExchangeInvoices } from './pages/ExchangeInvoices';
import { ReturnInvoices } from './pages/ReturnInvoices';
import { InvoiceStatement } from './pages/invoices/InvoiceStatement';
import { InvoiceForm } from './pages/invoices/InvoiceForm';
import { Treasury } from './pages/Treasury';
import { Safes } from './pages/treasury/Safes';
import { TreasuryLog } from './pages/treasury/TreasuryLog';
import { TreasurySettings } from './pages/treasury/TreasurySettings';
import { ProfitDetails } from './pages/treasury/ProfitDetails';
import { PaymentBonds } from './pages/PaymentBonds';
import { CollectionBonds } from './pages/CollectionBonds';
import { BondRecords } from './pages/BondRecords';
import { BondDetails } from './pages/BondDetails';
import { Salaries } from './pages/Salaries';
import { ReportsCenter } from './pages/reports/ReportsCenter';
import { Customers } from './pages/Customers';
import { Suppliers } from './pages/Suppliers';
import { CustomersLog } from './pages/customers/CustomersLog';
import { SuppliersLog } from './pages/suppliers/SuppliersLog';
import { CustomerStatement } from './pages/customers/CustomerStatement';
import { SupplierStatement } from './pages/suppliers/SupplierStatement';
import { Expenses } from './pages/Expenses';
import { Accounting } from './pages/Accounting';
import { Journal } from './pages/Journal';
import { Manufacturing } from './pages/Manufacturing';
import { Partners } from './pages/Partners';
import { SystemSettings } from './pages/SystemSettings';
import { DesktopSettings } from './pages/settings/DesktopSettings';
import { CustomerOrdersPage } from './pages/orders/CustomerOrdersPage';
import { ThemeApplier } from './theme/ThemeApplier';
import { Login } from './pages/Login';
import { RequireAuth } from './components/RequireAuth';
import { RequireActivation } from './components/RequireActivation';
import { StartupConnectionBanner } from './components/electron/StartupConnectionBanner';

export default function App() {
  return (
    <ThemeApplier>
      <StartupConnectionBanner />
      <RouterComponent>
        <EscapeBackNavigation />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <RequireActivation>
                  <DashboardLayout />
                </RequireActivation>
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />

            {/* Inventory routes */}
            <Route path="inventory" element={<Inventory />} />
            <Route path="inventory/create" element={<CreateItem />} />
            <Route path="inventory/edit/:id" element={<CreateItem />} />
            <Route path="inventory/settings" element={<InventorySettings />} />
            <Route path="inventory/labels" element={<StickerPrinting />} />
            <Route path="inventory/custom-label" element={<CustomStickerPrinting />} />
            <Route path="inventory/bulk-pricing" element={<BulkPricing />} />
            <Route path="inventory/warehouses" element={<Warehouses />} />
            <Route path="inventory/transfers" element={<Transfers />} />
            <Route path="inventory/depreciation" element={<Depreciation />} />
            <Route path="inventory/categories" element={<Categories />} />
            {/* "تعريفات الأقمشة" — hidden from main navigation but reachable by direct URL */}
            <Route path="inventory/fabric-master-data" element={<FabricMasterData />} />
            <Route path="inventory/rolls/new" element={<CreateRoll />} />
            <Route path="inventory/rolls/:id" element={<RollDetails />} />
            <Route path="inventory/rolls/:id/edit" element={<RollDetails />} />
            <Route path="inventory/rolls/:id/move" element={<RollDetails />} />

            {/* Purchase import routes */}
            <Route path="purchases/import-excel" element={<ImportExcel />} />
            <Route path="purchases/import-batches" element={<ImportBatches />} />

            {/* Label printing routes */}
            <Route path="inventory/print-jobs" element={<PrintJobs />} />

            <Route path="invoices/sales" element={<Sales />} />
            <Route path="invoices/sales/new" element={<InvoiceForm />} />
            <Route path="invoices/sales/:id/edit" element={<InvoiceForm />} />
            <Route path="invoices/purchases" element={<Purchases />} />
            <Route path="invoices/purchases/new" element={<InvoiceForm />} />
            <Route path="invoices/purchases/:id/edit" element={<InvoiceForm />} />
            <Route path="invoices/exchange" element={<ExchangeInvoices />} />
            <Route path="invoices/returns" element={<ReturnInvoices />} />
            <Route path="invoices/statement" element={<InvoiceStatement />} />
            <Route path="invoices/statement/:id" element={<InvoiceStatement />} />

            <Route path="orders" element={<CustomerOrdersPage />} />

            <Route path="treasury" element={<Safes />} />
            <Route path="treasury/safes" element={<Safes />} />
            <Route path="treasury/log" element={<TreasuryLog />} />
            <Route path="treasury/profit-details" element={<ProfitDetails />} />
            <Route path="treasury/settings" element={<TreasurySettings />} />

            <Route path="bonds/payment" element={<PaymentBonds />} />
            <Route path="bonds/collection" element={<CollectionBonds />} />
            <Route path="bonds/records" element={<BondRecords />} />
            <Route path="bonds/records/:id" element={<BondDetails />} />

            <Route path="salaries" element={<Salaries />} />
            <Route path="reports" element={<ReportsCenter />} />

            <Route path="customers" element={<Customers />} />
            <Route path="customers/log" element={<CustomersLog />} />
            <Route path="customers/statement" element={<CustomerStatement />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="suppliers/log" element={<SuppliersLog />} />
            <Route path="suppliers/statement" element={<SupplierStatement />} />

            <Route path="expenses" element={<Expenses />} />

            <Route path="chart-of-accounts" element={<Accounting />} />
            <Route path="journal" element={<Journal />} />
            <Route path="manufacturing" element={<Manufacturing />} />
            <Route path="partners" element={<Partners />} />
            <Route path="settings" element={<SystemSettings />} />
            <Route path="settings/desktop" element={<DesktopSettings />} />
          </Route>
        </Routes>
      </RouterComponent>
    </ThemeApplier>
  );
}
