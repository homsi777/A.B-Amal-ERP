import cors from '@fastify/cors';
import Fastify from 'fastify';
import { getCorsOrigins, getEnv } from './config/env.js';
import { globalErrorHandler } from './middleware/errorHandler.js';
import { verifyAuthToken } from './middleware/auth.js';
import { requireActiveActivation } from './services/activationService.js';
import { authRoutes } from './routes/authRoutes.js';
import { activationRoutes } from './routes/activationRoutes.js';
import { customerRoutes } from './routes/customerRoutes.js';
import { fabricCategoryRoutes } from './routes/fabricCategoryRoutes.js';
import { fabricColorRoutes } from './routes/fabricColorRoutes.js';
import { fabricItemRoutes } from './routes/fabricItemRoutes.js';
import { fabricRollRoutes } from './routes/fabricRollRoutes.js';
import { inventoryTransferRoutes } from './routes/inventoryTransferRoutes.js';
import { inventoryWasteRoutes } from './routes/inventoryWasteRoutes.js';
import { stockImportRoutes } from './routes/stockImportRoutes.js';
import { purchaseImportRoutes } from './routes/purchaseImportRoutes.js';
import { labelPrintRoutes } from './routes/labelPrintRoutes.js';
import { fabricVariantRoutes } from './routes/fabricVariantRoutes.js';
import { fabricClassificationRoutes } from './routes/fabricClassificationRoutes.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { supplierRoutes } from './routes/supplierRoutes.js';
import { systemRoutes } from './routes/systemRoutes.js';
import { telegramRoutes } from './routes/telegramRoutes.js';
import { warehouseLocationRoutes, warehouseRoutes } from './routes/warehouseRoutes.js';
import { returnInvoiceRoutes } from './routes/returnInvoiceRoutes.js';
import { partyActivityLogRoutes } from './routes/partyActivityLogRoutes.js';
import { cashboxRoutes } from './routes/cashboxRoutes.js';
import { cashboxTransferRoutes } from './routes/cashboxTransferRoutes.js';
import { exchangeRateRoutes } from './routes/exchangeRateRoutes.js';
import { voucherRoutes } from './routes/voucherRoutes.js';
import { payrollRoutes } from './routes/payrollRoutes.js';
import { reportRoutes } from './routes/reportRoutes.js';
import { financeRoutes } from './routes/financeRoutes.js';
import { salesInvoiceRoutes } from './routes/salesInvoiceRoutes.js';
import { purchaseInvoiceRoutes } from './routes/purchaseInvoiceRoutes.js';
import { customerOrderRoutes } from './routes/customerOrderRoutes.js';
import { financialAuditRoutes } from './routes/financialAuditRoutes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // CORS — strict allow-list in production, permissive for any local
  // dev origin (localhost / 127.0.0.1 on any port) so the desktop shell
  // and the browser can both hit the API regardless of how the user
  // resolves "localhost" on their machine.
  const isDev = getEnv().NODE_ENV !== 'production';
  const allowList = new Set(getCorsOrigins());
  await app.register(cors, {
    // In development reflect any local Vite/Electron origin — avoids false CORS blocks.
    origin: isDev
      ? true
      : (origin, cb) => {
          if (!origin) return cb(null, true);
          if (origin === 'null') return cb(null, true);
          if (allowList.has(origin)) return cb(null, true);
          cb(new Error(`Origin not allowed: ${origin}`), false);
        },
    credentials: true,
  });

  app.setErrorHandler(globalErrorHandler);

  app.addHook('onRequest', async (request, reply) => {
    if (!getEnv().ACTIVATION_REQUIRE_ACTIVE) return;
    const url = request.url.split('?')[0];
    const allowed =
      url === '/api/health' ||
      url === '/api/health/live' ||
      url === '/api/info' ||
      url.startsWith('/api/activation') ||
      url.startsWith('/api/auth/login') ||
      url.startsWith('/api/auth/logout') ||
      url.startsWith('/api/auth/me');
    if (allowed || !url.startsWith('/api/')) return;

    let companyId: string | undefined;
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        companyId = verifyAuthToken(header.slice('Bearer '.length).trim()).companyId;
      } catch {
        companyId = undefined;
      }
    }

    const active = await requireActiveActivation(companyId);
    if (!active) {
      return reply.status(403).send({
        ok: false,
        code: 'SYSTEM_NOT_ACTIVATED',
        message: 'النظام غير مفعّل. يرجى إدخال مفتاح التفعيل.',
      });
    }
  });

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api/system' });
  await app.register(telegramRoutes, { prefix: '/api/telegram' });
  await app.register(activationRoutes, { prefix: '/api/activation' });
  await app.register(authRoutes, { prefix: '/api/auth' });

  // Master data routes
  await app.register(supplierRoutes, { prefix: '/api/suppliers' });
  await app.register(customerRoutes, { prefix: '/api/customers' });
  await app.register(warehouseRoutes, { prefix: '/api/warehouses' });
  await app.register(warehouseLocationRoutes, { prefix: '/api/warehouse-locations' });
  await app.register(fabricCategoryRoutes, { prefix: '/api/fabric/categories' });
  await app.register(fabricItemRoutes, { prefix: '/api/fabric/items' });
  await app.register(fabricColorRoutes, { prefix: '/api/fabric/colors' });
  await app.register(fabricVariantRoutes, { prefix: '/api/fabric/variants' });
  await app.register(fabricClassificationRoutes, { prefix: '/api/inventory/fabric-classification' });

  // Inventory rolls engine
  await app.register(fabricRollRoutes, { prefix: '/api/inventory/rolls' });
  await app.register(inventoryTransferRoutes, { prefix: '/api/inventory/transfers' });
  await app.register(inventoryWasteRoutes, { prefix: '/api/inventory/waste' });
  await app.register(stockImportRoutes, { prefix: '/api/inventory/stock-import' });

  // Purchase Excel import engine
  await app.register(purchaseImportRoutes, { prefix: '/api/purchases/import' });

  // Label printing engine
  await app.register(labelPrintRoutes, { prefix: '/api/labels' });

  // Financial / logs / payroll / reports (MVP cloud entities)
  await app.register(returnInvoiceRoutes, { prefix: '/api/returns' });
  await app.register(partyActivityLogRoutes, { prefix: '/api/party-logs' });
  await app.register(cashboxRoutes, { prefix: '/api/cashboxes' });
  await app.register(cashboxTransferRoutes, { prefix: '/api/cashbox-transfers' });
  await app.register(exchangeRateRoutes, { prefix: '/api/exchange-rates' });
  await app.register(voucherRoutes, { prefix: '/api/vouchers' });
  await app.register(payrollRoutes, { prefix: '/api/payroll' });
  await app.register(reportRoutes, { prefix: '/api/reports' });
  await app.register(financeRoutes, { prefix: '/api/finance' });
  await app.register(salesInvoiceRoutes, { prefix: '/api/sales-invoices' });
  await app.register(purchaseInvoiceRoutes, { prefix: '/api/purchase-invoices' });
  await app.register(customerOrderRoutes, { prefix: '/api/customer-orders' });
  await app.register(financialAuditRoutes, { prefix: '/api/financial-audit' });

  return app;
}
