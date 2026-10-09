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
    },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: ['common', 'dashboard', 'login', 'nav', 'invoices', 'terminology', 'inventory', 'settings', 'customers', 'createItem', 'returns', 'customerStatement', 'supplierStatement', 'purchaseImport', 'stockImport', 'stickerPrinting', 'externalJobs', 'suppliers', 'partiesLog', 'customerStatementImportModal', 'fabricMasterData', 'rollDetails', 'transfers', 'inventorySettings', 'warehouses', 'printJobs', 'yarnManagement', 'categories', 'createRoll', 'customStickerPrinting'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
