import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import arCommon from '../locales/ar/common.json';
import arDashboard from '../locales/ar/dashboard.json';
import arLogin from '../locales/ar/login.json';
import arNav from '../locales/ar/nav.json';
import arInvoices from '../locales/ar/invoices.json';
import arTerminology from '../locales/ar/terminology.json';
import arInventory from '../locales/ar/inventory.json';
import arSettings from '../locales/ar/settings.json';
import arCustomers from '../locales/ar/customers.json';
import arCreateItem from '../locales/ar/createItem.json';
import arReturns from '../locales/ar/returns.json';
import arCustomerStatement from '../locales/ar/customerStatement.json';
import arSupplierStatement from '../locales/ar/supplierStatement.json';
import arPurchaseImport from '../locales/ar/purchaseImport.json';
import arStockImport from '../locales/ar/stockImport.json';
import arStickerPrinting from '../locales/ar/stickerPrinting.json';
import arExternalJobs from '../locales/ar/externalJobs.json';
import arSuppliers from '../locales/ar/suppliers.json';
import arPartiesLog from '../locales/ar/partiesLog.json';
import arCustomerStatementImportModal from '../locales/ar/customerStatementImportModal.json';
import arFabricMasterData from '../locales/ar/fabricMasterData.json';
import arRollDetails from '../locales/ar/rollDetails.json';
import arTransfers from '../locales/ar/transfers.json';
import arInventorySettings from '../locales/ar/inventorySettings.json';
import arWarehouses from '../locales/ar/warehouses.json';
import arPrintJobs from '../locales/ar/printJobs.json';
import arYarnManagement from '../locales/ar/yarnManagement.json';
import arCategories from '../locales/ar/categories.json';
import arCreateRoll from '../locales/ar/createRoll.json';
import arCustomStickerPrinting from '../locales/ar/customStickerPrinting.json';
import arDepreciation from '../locales/ar/depreciation.json';
import arBulkPricing from '../locales/ar/bulkPricing.json';
import arCartelaLabels from '../locales/ar/cartelaLabels.json';
import arExchangeInvoices from '../locales/ar/exchangeInvoices.json';
import arInvoiceStatement from '../locales/ar/invoiceStatement.json';
import arCustomerOrdersPage from '../locales/ar/customerOrdersPage.json';
import arOrderFormModal from '../locales/ar/orderFormModal.json';
import arTreasuryMain from '../locales/ar/treasuryMain.json';
import arTreasurySettings from '../locales/ar/treasurySettings.json';
import arPaymentBonds from '../locales/ar/paymentBonds.json';
import arCollectionBonds from '../locales/ar/collectionBonds.json';
import arSafes from '../locales/ar/safes.json';
import arTreasuryLog from '../locales/ar/treasuryLog.json';
import arBondRecords from '../locales/ar/bondRecords.json';
import arBondDetails from '../locales/ar/bondDetails.json';
import arExpenses from '../locales/ar/expenses.json';
import arProfitDetails from '../locales/ar/profitDetails.json';
import arPayrollSalaryLog from '../locales/ar/payrollSalaryLog.json';
import arSalaries from '../locales/ar/salaries.json';
import arReportsMain from '../locales/ar/reportsMain.json';
import arReportsCenter from '../locales/ar/reportsCenter.json';
import trCommon from '../locales/tr/common.json';
import trDashboard from '../locales/tr/dashboard.json';
import trLogin from '../locales/tr/login.json';
import trNav from '../locales/tr/nav.json';
import trInvoices from '../locales/tr/invoices.json';
import trTerminology from '../locales/tr/terminology.json';
import trInventory from '../locales/tr/inventory.json';
import trSettings from '../locales/tr/settings.json';
import trCustomers from '../locales/tr/customers.json';
import trCreateItem from '../locales/tr/createItem.json';
import trReturns from '../locales/tr/returns.json';
import trCustomerStatement from '../locales/tr/customerStatement.json';
import trSupplierStatement from '../locales/tr/supplierStatement.json';
import trPurchaseImport from '../locales/tr/purchaseImport.json';
import trStockImport from '../locales/tr/stockImport.json';
import trStickerPrinting from '../locales/tr/stickerPrinting.json';
import trExternalJobs from '../locales/tr/externalJobs.json';
import trSuppliers from '../locales/tr/suppliers.json';
import trPartiesLog from '../locales/tr/partiesLog.json';
import trCustomerStatementImportModal from '../locales/tr/customerStatementImportModal.json';
import trFabricMasterData from '../locales/tr/fabricMasterData.json';
import trRollDetails from '../locales/tr/rollDetails.json';
import trTransfers from '../locales/tr/transfers.json';
import trInventorySettings from '../locales/tr/inventorySettings.json';
import trWarehouses from '../locales/tr/warehouses.json';
import trPrintJobs from '../locales/tr/printJobs.json';
import trYarnManagement from '../locales/tr/yarnManagement.json';
import trCategories from '../locales/tr/categories.json';
import trCreateRoll from '../locales/tr/createRoll.json';
import trCustomStickerPrinting from '../locales/tr/customStickerPrinting.json';
import trDepreciation from '../locales/tr/depreciation.json';
import trBulkPricing from '../locales/tr/bulkPricing.json';
import trCartelaLabels from '../locales/tr/cartelaLabels.json';
import trExchangeInvoices from '../locales/tr/exchangeInvoices.json';
import trInvoiceStatement from '../locales/tr/invoiceStatement.json';
import trCustomerOrdersPage from '../locales/tr/customerOrdersPage.json';
import trOrderFormModal from '../locales/tr/orderFormModal.json';
import trTreasuryMain from '../locales/tr/treasuryMain.json';
import trTreasurySettings from '../locales/tr/treasurySettings.json';
import trPaymentBonds from '../locales/tr/paymentBonds.json';
import trCollectionBonds from '../locales/tr/collectionBonds.json';
import trSafes from '../locales/tr/safes.json';
import trTreasuryLog from '../locales/tr/treasuryLog.json';
import trBondRecords from '../locales/tr/bondRecords.json';
import trBondDetails from '../locales/tr/bondDetails.json';
import trExpenses from '../locales/tr/expenses.json';
import trProfitDetails from '../locales/tr/profitDetails.json';
import trPayrollSalaryLog from '../locales/tr/payrollSalaryLog.json';
import trSalaries from '../locales/tr/salaries.json';
import trReportsMain from '../locales/tr/reportsMain.json';
import trReportsCenter from '../locales/tr/reportsCenter.json';
import { applyDocumentLanguage, DEFAULT_LANGUAGE, readStoredLanguage } from './constants';

const initialLanguage = readStoredLanguage();
applyDocumentLanguage(initialLanguage);

void i18n.use(initReactI18next).init({
  resources: {
    ar: {
      common: arCommon,
      dashboard: arDashboard,
      login: arLogin,
      nav: arNav,
      invoices: arInvoices,
      terminology: arTerminology,
      inventory: arInventory,
      settings: arSettings,
      customers: arCustomers,
      createItem: arCreateItem,
      returns: arReturns,
      customerStatement: arCustomerStatement,
      supplierStatement: arSupplierStatement,
      purchaseImport: arPurchaseImport,
      stockImport: arStockImport,
      stickerPrinting: arStickerPrinting,
      externalJobs: arExternalJobs,
      suppliers: arSuppliers,
      partiesLog: arPartiesLog,
      customerStatementImportModal: arCustomerStatementImportModal,
      fabricMasterData: arFabricMasterData,
      rollDetails: arRollDetails,
      transfers: arTransfers,
      inventorySettings: arInventorySettings,
      warehouses: arWarehouses,
      printJobs: arPrintJobs,
      yarnManagement: arYarnManagement,
      categories: arCategories,
      createRoll: arCreateRoll,
      customStickerPrinting: arCustomStickerPrinting,
      depreciation: arDepreciation,
      bulkPricing: arBulkPricing,
      cartelaLabels: arCartelaLabels,
      exchangeInvoices: arExchangeInvoices,
      invoiceStatement: arInvoiceStatement,
      customerOrdersPage: arCustomerOrdersPage,
      orderFormModal: arOrderFormModal,
      treasuryMain: arTreasuryMain,
      treasurySettings: arTreasurySettings,
      paymentBonds: arPaymentBonds,
      collectionBonds: arCollectionBonds,
      safes: arSafes,
      treasuryLog: arTreasuryLog,
      bondRecords: arBondRecords,
      bondDetails: arBondDetails,
      expenses: arExpenses,
      profitDetails: arProfitDetails,
      payrollSalaryLog: arPayrollSalaryLog,
      salaries: arSalaries,
      reportsMain: arReportsMain,
      reportsCenter: arReportsCenter,
    },
    tr: {
      common: trCommon,
      dashboard: trDashboard,
      login: trLogin,
      nav: trNav,
      invoices: trInvoices,
      terminology: trTerminology,
      inventory: trInventory,
      settings: trSettings,
      customers: trCustomers,
      createItem: trCreateItem,
      returns: trReturns,
      customerStatement: trCustomerStatement,
      supplierStatement: trSupplierStatement,
      purchaseImport: trPurchaseImport,
      stockImport: trStockImport,
      stickerPrinting: trStickerPrinting,
      externalJobs: trExternalJobs,
      suppliers: trSuppliers,
      partiesLog: trPartiesLog,
      customerStatementImportModal: trCustomerStatementImportModal,
      fabricMasterData: trFabricMasterData,
      rollDetails: trRollDetails,
      transfers: trTransfers,
      inventorySettings: trInventorySettings,
      warehouses: trWarehouses,
      printJobs: trPrintJobs,
      yarnManagement: trYarnManagement,
      categories: trCategories,
      createRoll: trCreateRoll,
      customStickerPrinting: trCustomStickerPrinting,
      depreciation: trDepreciation,
      bulkPricing: trBulkPricing,
      cartelaLabels: trCartelaLabels,
      exchangeInvoices: trExchangeInvoices,
      invoiceStatement: trInvoiceStatement,
      customerOrdersPage: trCustomerOrdersPage,
      orderFormModal: trOrderFormModal,
      treasuryMain: trTreasuryMain,
      treasurySettings: trTreasurySettings,
      paymentBonds: trPaymentBonds,
      collectionBonds: trCollectionBonds,
      safes: trSafes,
      treasuryLog: trTreasuryLog,
      bondRecords: trBondRecords,
      bondDetails: trBondDetails,
      expenses: trExpenses,
      profitDetails: trProfitDetails,
      payrollSalaryLog: trPayrollSalaryLog,
      salaries: trSalaries,
      reportsMain: trReportsMain,
      reportsCenter: trReportsCenter,
    },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: ['common', 'dashboard', 'login', 'nav', 'invoices', 'terminology', 'inventory', 'settings', 'customers', 'createItem', 'returns', 'customerStatement', 'supplierStatement', 'purchaseImport', 'stockImport', 'stickerPrinting', 'externalJobs', 'suppliers', 'partiesLog', 'customerStatementImportModal', 'fabricMasterData', 'rollDetails', 'transfers', 'inventorySettings', 'warehouses', 'printJobs', 'yarnManagement', 'categories', 'createRoll', 'customStickerPrinting', 'depreciation', 'bulkPricing', 'cartelaLabels', 'exchangeInvoices', 'invoiceStatement', 'customerOrdersPage', 'orderFormModal', 'treasuryMain', 'treasurySettings', 'paymentBonds', 'collectionBonds', 'safes', 'treasuryLog', 'bondRecords', 'bondDetails', 'expenses', 'profitDetails', 'payrollSalaryLog', 'salaries', 'reportsMain', 'reportsCenter'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
