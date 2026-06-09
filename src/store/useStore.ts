import { create } from 'zustand';
import {
  FabricItem,
  Customer,
  Supplier,
  Invoice,
  Expense,
  AccountInfo,
  Transaction,
  CategoryNode,
  Warehouse,
  CustomerOrder,
  CustomerOrderStatus,
  OrderTemplate,
} from '../types';

interface AppState {
  inventory: FabricItem[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  expenses: Expense[];
  accounts: AccountInfo[];
  transactions: Transaction[];
  categoryTree: CategoryNode[];
  warehouses: Warehouse[];
  customerOrders: CustomerOrder[];
  orderTemplates: OrderTemplate[];

  // Actions
  addFabric: (item: Omit<FabricItem, 'id' | 'qrCode'>) => void;
  importFabrics: (items: Omit<FabricItem, 'id' | 'qrCode'>[]) => void;
  updateFabric: (id: string, item: Partial<FabricItem>) => void;
  updateFabricPricesByMaterial: (updates: { materialName: string; costPrice: number; sellingPrice: number }[]) => void;

  addCustomer: (customer: Omit<Customer, 'id' | 'balance'>) => void;
  addSupplier: (supplier: Omit<Supplier, 'id' | 'balance'>) => void;

  createSaleInvoice: (invoice: Omit<Invoice, 'id' | 'type'>) => string;
  createPurchaseInvoice: (invoice: Omit<Invoice, 'id' | 'type'>) => string;
  importConfirmedPurchaseInvoice: (
    invoice: Omit<Invoice, 'id' | 'type'>,
    fabrics: Omit<FabricItem, 'id' | 'qrCode'>[],
  ) => void;

  addExpense: (expense: Omit<Expense, 'id'>) => void;

  addAccount: (account: Omit<AccountInfo, 'id'>) => void;
  addTransaction: (transaction: Omit<Transaction, 'id'>) => void;

  receiveCustomerPayment: (customerId: string, params: { amount: number; date: string; description: string }) => void;
  payCustomer: (customerId: string, params: { amount: number; date: string; description: string }) => void;
  paySupplier: (supplierId: string, params: { amount: number; date: string; description: string }) => void;

  setCategoryTree: (tree: CategoryNode[]) => void;
  addWarehouse: (warehouse: Omit<Warehouse, 'id'>) => void;
  updateWarehouse: (id: string, warehouse: Partial<Warehouse>) => void;
  deleteWarehouse: (id: string) => void;

  createCustomerOrder: (
    payload: Omit<CustomerOrder, 'id' | 'createdAt' | 'updatedAt' | 'orderNumber'> & { orderNumber?: string }
  ) => void;
  updateCustomerOrder: (id: string, patch: Partial<CustomerOrder>) => void;
  updateCustomerOrderStatus: (id: string, status: CustomerOrderStatus) => void;
  deleteCustomerOrder: (id: string) => void;
  addOrderTemplate: (template: Omit<OrderTemplate, 'id' | 'createdAt'>) => void;
  removeOrderTemplate: (id: string) => void;
}

/** حالة أولية فارغة — لا بيانات أعمال وهمية عند التشغيل */
const emptyInitialState = {
  warehouses: [] as Warehouse[],
  categoryTree: [] as CategoryNode[],
  inventory: [] as FabricItem[],
  customers: [] as Customer[],
  suppliers: [] as Supplier[],
  expenses: [] as Expense[],
  accounts: [] as AccountInfo[],
  invoices: [] as Invoice[],
  transactions: [] as Transaction[],
  customerOrders: [] as CustomerOrder[],
  orderTemplates: [] as OrderTemplate[],
};

const generateId = (prefix: string) => `${prefix}-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;

export const useStore = create<AppState>((set) => ({
  ...emptyInitialState,

  setCategoryTree: (tree) => set({ categoryTree: tree }),

  addFabric: (item) =>
    set((state) => {
      const id = generateId('F');
      return {
        inventory: [...state.inventory, { ...item, id, qrCode: `QR-${id}` }],
      };
    }),

  importFabrics: (items) =>
    set((state) => ({
      inventory: [
        ...state.inventory,
        ...items.map((item) => {
          const id = generateId('F');
          return { ...item, id, qrCode: `QR-${id}` };
        }),
      ],
    })),

  updateFabric: (id, itemUpdate) =>
    set((state) => ({
      inventory: state.inventory.map((f) => (f.id === id ? { ...f, ...itemUpdate } : f)),
    })),

  updateFabricPricesByMaterial: (updates) =>
    set((state) => {
      const updatesByMaterial = new Map(updates.map((update) => [update.materialName.trim(), update]));
      return {
        inventory: state.inventory.map((item) => {
          const update = updatesByMaterial.get(item.name.trim());
          return update ? { ...item, costPrice: update.costPrice, sellingPrice: update.sellingPrice } : item;
        }),
      };
    }),

  addCustomer: (customer) =>
    set((state) => ({
      customers: [...state.customers, { ...customer, id: generateId('C'), balance: 0 }],
    })),

  addSupplier: (supplier) =>
    set((state) => ({
      suppliers: [...state.suppliers, { ...supplier, id: generateId('S'), balance: 0 }],
    })),

  createSaleInvoice: (invoice) => {
    const newId = generateId('INV-S');
    set((state) => {
      const newInvoice = { ...invoice, id: newId, type: 'sale' as const };
      let newInventory = [...state.inventory];
      invoice.items.forEach((item) => {
        newInventory = newInventory.map((f) => {
          if (f.id === item.fabricId) {
            const qtyField = item.unitType === 'yard' ? 'yards' : 'meters';
            return { ...f, [qtyField]: f[qtyField] - item.quantity };
          }
          return f;
        });
      });

      const newCustomers = state.customers.map((c) =>
        c.id === invoice.partyId ? { ...c, balance: c.balance + invoice.remainingAmount } : c,
      );

      const tRec: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '1102',
        partyId: newInvoice.partyId,
        type: 'debit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مبيعات ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      const tRev: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '41',
        type: 'credit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مبيعات ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      let newTransactions = [...state.transactions, tRec, tRev];

      if (newInvoice.paidAmount > 0) {
        newTransactions.push({
          id: generateId('T'),
          date: newInvoice.date,
          accountId: '1101',
          type: 'debit',
          amount: newInvoice.paidAmount,
          description: `سداد جزئي/كلي للفاتورة ${newInvoice.id}`,
          referenceId: newInvoice.id,
        });
        newTransactions.push({
          id: generateId('T'),
          date: newInvoice.date,
          accountId: '1102',
          partyId: newInvoice.partyId,
          type: 'credit',
          amount: newInvoice.paidAmount,
          description: `سداد جزئي/كلي للفاتورة ${newInvoice.id}`,
          referenceId: newInvoice.id,
        });
      }

      return {
        invoices: [...state.invoices, newInvoice],
        inventory: newInventory,
        customers: newCustomers,
        transactions: newTransactions,
      };
    });
    return newId;
  },

  createPurchaseInvoice: (invoice) => {
    const newId = generateId('INV-P');
    set((state) => {
      const newInvoice = { ...invoice, id: newId, type: 'purchase' as const };

      let newInventory = [...state.inventory];
      invoice.items.forEach((item) => {
        newInventory = newInventory.map((f) => {
          if (f.id === item.fabricId) {
            const qtyField = item.unitType === 'yard' ? 'yards' : 'meters';
            return { ...f, [qtyField]: f[qtyField] + item.quantity };
          }
          return f;
        });
      });

      const newSuppliers = state.suppliers.map((s) =>
        s.id === invoice.partyId ? { ...s, balance: s.balance + invoice.remainingAmount } : s,
      );

      const tExp: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '51',
        type: 'debit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مشتريات ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      const tPay: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '2101',
        partyId: newInvoice.partyId,
        type: 'credit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مشتريات ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      let newTransactions = [...state.transactions, tExp, tPay];

      if (newInvoice.paidAmount > 0) {
        newTransactions.push({
          id: generateId('T'),
          date: newInvoice.date,
          accountId: '2101',
          partyId: newInvoice.partyId,
          type: 'debit',
          amount: newInvoice.paidAmount,
          description: `سداد جزئي/كلي للفاتورة ${newInvoice.id}`,
          referenceId: newInvoice.id,
        });
        newTransactions.push({
          id: generateId('T'),
          date: newInvoice.date,
          accountId: '1101',
          type: 'credit',
          amount: newInvoice.paidAmount,
          description: `سداد جزئي/كلي للفاتورة ${newInvoice.id}`,
          referenceId: newInvoice.id,
        });
      }

      return {
        invoices: [...state.invoices, newInvoice],
        inventory: newInventory,
        suppliers: newSuppliers,
        transactions: newTransactions,
      };
    });
    return newId;
  },

  importConfirmedPurchaseInvoice: (invoice, fabrics) =>
    set((state) => {
      const newInvoice = { ...invoice, id: generateId('INV-P'), type: 'purchase' as const };
      const importedInventory = fabrics.map((item) => {
        const id = generateId('F');
        return { ...item, id, qrCode: `QR-${id}` };
      });

      const newSuppliers = state.suppliers.map((s) =>
        s.id === invoice.partyId ? { ...s, balance: s.balance + invoice.remainingAmount } : s,
      );

      const tExp: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '51',
        type: 'debit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مشتريات مستوردة ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      const tPay: Transaction = {
        id: generateId('T'),
        date: newInvoice.date,
        accountId: '2101',
        partyId: newInvoice.partyId,
        type: 'credit',
        amount: newInvoice.totalAmount,
        description: `فاتورة مشتريات مستوردة ${newInvoice.id}`,
        referenceId: newInvoice.id,
      };

      return {
        invoices: [...state.invoices, newInvoice],
        inventory: [...state.inventory, ...importedInventory],
        suppliers: newSuppliers,
        transactions: [...state.transactions, tExp, tPay],
      };
    }),

  addExpense: (expense) =>
    set((state) => ({
      expenses: [...state.expenses, { ...expense, id: generateId('E') }],
    })),

  addAccount: (account) =>
    set((state) => ({
      accounts: [...state.accounts, { ...account, id: generateId('A') }],
    })),

  addTransaction: (transaction) =>
    set((state) => ({
      transactions: [...state.transactions, { ...transaction, id: generateId('T') }],
    })),

  receiveCustomerPayment: (customerId, params) =>
    set((state) => {
      const amount = Math.abs(params.amount);
      if (!amount || amount <= 0) return state;

      const refId = `REC-${Date.now().toString(36).toUpperCase()}`;
      const customer = state.customers.find((c) => c.id === customerId);
      const label = customer ? customer.name : customerId;

      const cashTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '1101',
        type: 'debit',
        amount,
        description: `استلام دفعة (${label})${params.description ? ` — ${params.description}` : ''}`,
        referenceId: refId,
      };

      const arTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '1102',
        partyId: customerId,
        type: 'credit',
        amount,
        description: `قبض ذمة عميل — ${label}`,
        referenceId: refId,
      };

      const id1 = generateId('T');
      const id2 = generateId('T');

      return {
        transactions: [...state.transactions, { ...cashTx, id: id1 }, { ...arTx, id: id2 }],
        customers: state.customers.map((c) =>
          c.id === customerId ? { ...c, balance: Math.max(0, c.balance - amount) } : c,
        ),
      };
    }),

  payCustomer: (customerId, params) =>
    set((state) => {
      const amount = Math.abs(params.amount);
      if (!amount || amount <= 0) return state;

      const refId = `PAY-C-${Date.now().toString(36).toUpperCase()}`;
      const customer = state.customers.find((c) => c.id === customerId);
      const label = customer ? customer.name : customerId;

      const arTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '1102',
        partyId: customerId,
        type: 'debit',
        amount,
        description: `سند دفع لعميل — ${label}${params.description ? ` — ${params.description}` : ''}`,
        referenceId: refId,
      };

      const cashTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '1101',
        type: 'credit',
        amount,
        description: `صرف من الصندوق — ${label}`,
        referenceId: refId,
      };

      const id1 = generateId('T');
      const id2 = generateId('T');

      return {
        transactions: [...state.transactions, { ...arTx, id: id1 }, { ...cashTx, id: id2 }],
        customers: state.customers.map((c) =>
          c.id === customerId ? { ...c, balance: c.balance + amount } : c,
        ),
      };
    }),

  paySupplier: (supplierId, params) =>
    set((state) => {
      const amount = Math.abs(params.amount);
      if (!amount || amount <= 0) return state;

      const refId = `PAY-${Date.now().toString(36).toUpperCase()}`;
      const supplier = state.suppliers.find((s) => s.id === supplierId);
      const label = supplier ? supplier.company : supplierId;

      const apTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '2101',
        partyId: supplierId,
        type: 'debit',
        amount,
        description: `سند دفع لمورد — ${label}${params.description ? ` — ${params.description}` : ''}`,
        referenceId: refId,
      };

      const cashTx: Omit<Transaction, 'id'> = {
        date: params.date,
        accountId: '1101',
        type: 'credit',
        amount,
        description: `صرف من الصندوق — ${label}`,
        referenceId: refId,
      };

      const id1 = generateId('T');
      const id2 = generateId('T');

      return {
        transactions: [...state.transactions, { ...apTx, id: id1 }, { ...cashTx, id: id2 }],
        suppliers: state.suppliers.map((s) =>
          s.id === supplierId ? { ...s, balance: Math.max(0, s.balance - amount) } : s,
        ),
      };
    }),

  addWarehouse: (warehouse) =>
    set((state) => ({
      warehouses: [...state.warehouses, { ...warehouse, id: generateId('WH') }],
    })),

  updateWarehouse: (id, itemUpdate) =>
    set((state) => ({
      warehouses: state.warehouses.map((w) => (w.id === id ? { ...w, ...itemUpdate } : w)),
    })),

  deleteWarehouse: (id) =>
    set((state) => ({
      warehouses: state.warehouses.filter((w) => w.id !== id),
    })),

  createCustomerOrder: (payload) =>
    set((state) => {
      const now = new Date().toISOString();
      const id = generateId('ORD');
      const orderNumber =
        payload.orderNumber?.trim() || `ORD-${Date.now().toString(36).toUpperCase().slice(-8)}`;
      const row: CustomerOrder = {
        ...payload,
        id,
        orderNumber,
        createdAt: now,
        updatedAt: now,
      };
      return { customerOrders: [row, ...state.customerOrders] };
    }),

  updateCustomerOrder: (id, patch) =>
    set((state) => ({
      customerOrders: state.customerOrders.map((o) =>
        o.id === id ? { ...o, ...patch, updatedAt: new Date().toISOString() } : o,
      ),
    })),

  updateCustomerOrderStatus: (id, status) =>
    set((state) => ({
      customerOrders: state.customerOrders.map((o) =>
        o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o,
      ),
    })),

  deleteCustomerOrder: (id) =>
    set((state) => ({
      customerOrders: state.customerOrders.filter((o) => o.id !== id),
    })),

  addOrderTemplate: (template) =>
    set((state) => ({
      orderTemplates: [
        ...state.orderTemplates,
        {
          ...template,
          id: generateId('OTPL'),
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  removeOrderTemplate: (id) =>
    set((state) => ({
      orderTemplates: state.orderTemplates.filter((t) => t.id !== id),
    })),
}));
