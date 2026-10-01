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
    },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: ['common', 'dashboard', 'login', 'nav', 'invoices', 'terminology', 'inventory', 'settings', 'customers', 'createItem', 'returns', 'customerStatement', 'supplierStatement'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
