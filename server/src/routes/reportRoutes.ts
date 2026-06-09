import type { FastifyPluginAsync } from 'fastify';
import { getPool } from '../db/pool.js';
import { authenticateRequest } from '../middleware/auth.js';
import {
  fetchExtendedDashboardSummary,
  reportCashboxMovements,
  reportCashboxes,
  reportImportBatches,
  reportImportRows,
  reportInventoryMovements,
  reportInventoryRolls,
  reportPartyActivity,
  reportPayrollSummary,
  reportPrintJobs,
  reportRollsByItemColor,
  reportRollsByWarehouse,
  reportVouchers,
} from '../services/reportService.js';
import {
  reportAccountActivity,
  reportCashFlow,
  reportCurrencyDifferences,
  reportExecutiveSummary,
  reportOperationalBalanceSummary,
  reportOperationalIncomeExpense,
  reportOperationalLedger,
  reportOperationalPosition,
  reportReceiptsPayments,
} from '../services/reportServiceExtended.js';
import {
  reportCustomersActivity,
  reportCustomersAging,
  reportCustomersByStatus,
  reportCustomersStatement,
  reportCustomersSummary,
  reportInventoryAging,
  reportInventoryBalances,
  reportInventoryBatchTracking,
  reportInventoryByColor,
  reportInventoryCuttingEfficiency,
  reportInventoryFabricTypes,
  reportInventoryNegativeStock,
  reportInventoryRemainingLengths,
  reportInventoryRollLevel,
  reportInventorySlowMoving,
  reportInventoryValuation,
  reportInventoryWasteAnalysis,
  reportPayrollEmployees,
  reportPayrollMonthlySummary,
  reportPayrollRunsList,
  reportPrintingPrintedLabels,
  reportPrintingUnprintedRolls,
  reportProfitDetails,
  reportPurchasesByBatch,
  reportPurchasesByItem,
  reportPurchasesBySupplier,
  reportPurchasesCostTrend,
  reportPurchasesDetails,
  reportPurchasesSummary,
  reportSalesByAgent,
  reportSalesByColor,
  reportSalesByCustomer,
  reportSalesByItem,
  reportSalesDetails,
  reportSalesMargins,
  reportSalesSummary,
  reportSuppliersActivity,
  reportSuppliersAging,
  reportSuppliersByStatus,
  reportSuppliersStatement,
  reportSuppliersSummary,
} from '../services/reportServiceMore.js';

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.get('/dashboard-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const data = await fetchExtendedDashboardSummary(companyId);
    return reply.send({ ok: true, data });
  });

  app.get('/inventory-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const rolls = await pool.query<{ total_m: string; n: string }>(
      `SELECT COALESCE(SUM(length_m), 0)::numeric AS total_m, COUNT(*)::int AS n
       FROM fabric_rolls WHERE company_id = $1`,
      [companyId],
    );
    const mov = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM inventory_movements WHERE company_id = $1`,
      [companyId],
    );
    return reply.send({
      ok: true,
      data: {
        rollsCount: parseInt(rolls.rows[0].n, 10),
        totalLengthM: rolls.rows[0].total_m,
        movementsCount: parseInt(mov.rows[0].n, 10),
      },
    });
  });

  app.get('/cashbox-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const boxes = await pool.query(
      `SELECT id, name, code, current_balance, currency_code FROM cashboxes
       WHERE company_id = $1 AND is_active = true ORDER BY is_default DESC, name`,
      [companyId],
    );
    const movN = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::int AS c FROM cashbox_movements WHERE company_id = $1`,
      [companyId],
    );
    return reply.send({
      ok: true,
      data: { cashboxes: boxes.rows, movementsCount: parseInt(movN.rows[0].c, 10) },
    });
  });

  app.get('/vouchers-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
         COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
         COALESCE(SUM(amount) FILTER (WHERE status = 'CONFIRMED' AND voucher_type = 'RECEIPT'), 0)::numeric AS confirmed_receipts,
         COALESCE(SUM(amount) FILTER (WHERE status = 'CONFIRMED' AND voucher_type = 'PAYMENT'), 0)::numeric AS confirmed_payments
       FROM vouchers WHERE company_id = $1`,
      [companyId],
    );
    return reply.send({ ok: true, data: r.rows[0] });
  });

  app.get('/payroll-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const { companyId } = req.user!;
    const pool = getPool();
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM payroll_employees WHERE company_id = $1 AND is_active) AS active_employees,
         (SELECT COUNT(*)::int FROM payroll_runs WHERE company_id = $1) AS payroll_runs_count,
         (SELECT COUNT(*)::int FROM payroll_runs WHERE company_id = $1 AND status = 'PAID') AS paid_runs`,
      [companyId],
    );
    return reply.send({ ok: true, data: r.rows[0] });
  });

  const q = (req: { query: unknown }) => req.query as Record<string, string | undefined>;

  app.get('/executive/summary-report', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportExecutiveSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/financial/operational-ledger', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportOperationalLedger(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/financial/operational-balance-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportOperationalBalanceSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/financial/operational-income-expense', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportOperationalIncomeExpense(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/financial/operational-position', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportOperationalPosition(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/financial/cash-flow', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCashFlow(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/financial/receipts-payments', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportReceiptsPayments(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/financial/account-activity', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportAccountActivity(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/financial/currency-differences', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCurrencyDifferences(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/financial/profit-details', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportProfitDetails(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/sales/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/sales/details', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesDetails(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/sales/by-item', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesByItem(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/sales/by-customer', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesByCustomer(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/sales/by-agent', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesByAgent();
    return reply.send({ ok: true, report });
  });
  app.get('/sales/by-color', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesByColor();
    return reply.send({ ok: true, report });
  });
  app.get('/sales/margins', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSalesMargins();
    return reply.send({ ok: true, report });
  });

  app.get('/purchases/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/purchases/details', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesDetails(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/purchases/by-supplier', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesBySupplier(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/purchases/by-item', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesByItem(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/purchases/by-batch', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesByBatch(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/purchases/cost-trend', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPurchasesCostTrend(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/inventory/balances', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryBalances(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/valuation', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryValuation(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/by-color', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryByColor(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/aging', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryAging(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/slow-moving', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventorySlowMoving(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/negative-stock', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryNegativeStock(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/roll-level', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryRollLevel(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/batch-tracking', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryBatchTracking(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/fabric-types', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryFabricTypes(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/waste-analysis', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryWasteAnalysis(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/cutting-efficiency', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryCuttingEfficiency();
    return reply.send({ ok: true, report });
  });
  app.get('/inventory/remaining-lengths', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryRemainingLengths(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/customers/activity', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCustomersActivity(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/customers/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCustomersStatement(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/customers/aging', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCustomersAging();
    return reply.send({ ok: true, report });
  });
  app.get('/customers/by-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCustomersByStatus(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/customers/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCustomersSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/suppliers/activity', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSuppliersActivity(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/suppliers/statement', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSuppliersStatement(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/suppliers/aging', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSuppliersAging();
    return reply.send({ ok: true, report });
  });
  app.get('/suppliers/by-status', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSuppliersByStatus(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/suppliers/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportSuppliersSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/payroll/employees', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPayrollEmployees(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/payroll/runs-list', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPayrollRunsList(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
  app.get('/payroll/monthly-summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPayrollMonthlySummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/printing/printed-labels', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPrintingPrintedLabels(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });
  app.get('/printing/unprinted-rolls', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPrintingUnprintedRolls(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/inventory/rolls', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryRolls(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/inventory/movements', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportInventoryMovements(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/inventory/by-warehouse', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportRollsByWarehouse(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/inventory/by-item-color', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportRollsByItemColor(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/purchases/import-batches', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportImportBatches(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/purchases/import-rows', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportImportRows(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/financial/cashboxes', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCashboxes(req.user!.companyId);
    return reply.send({ ok: true, report });
  });

  app.get('/financial/cashbox-movements', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportCashboxMovements(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/financial/vouchers', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportVouchers(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  /** @deprecated prefer GET /customers/activity — kept for older clients */
  app.get('/parties/activity', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPartyActivity(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/printing/jobs', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPrintJobs(req.user!.companyId, q(req));
    return reply.send({ ok: true, report });
  });

  app.get('/payroll/summary', { preHandler: authenticateRequest }, async (req, reply) => {
    const report = await reportPayrollSummary(req.user!.companyId);
    return reply.send({ ok: true, report });
  });
};
