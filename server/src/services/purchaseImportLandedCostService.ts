/**
 * Landed cost for purchase Excel import.
 * Allocates merchandise value + import charges to rolls by length (meters),
 * per textile industry practice when line-level prices are absent.
 */

export interface LandedCostInput {
  goodsValue: number;
  shippingCost: number;
  customsCost: number;
  otherCost1: number;
  otherCost2: number;
  shipmentWeightKg: number | null;
  totalLengthM: number;
}

export interface LandedCostSummary extends LandedCostInput {
  additionalCostsTotal: number;
  totalLandedCost: number;
  landedCostPerMeter: number;
  landedCostPerKg: number | null;
}

export interface RollLandedAllocation {
  unitCostPerMeter: number;
  rollLandedValue: number;
  estimatedWeightKg: number | null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundUnitCost(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function roundWeight(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeLandedCostSummary(input: LandedCostInput): LandedCostSummary {
  const goodsValue = roundMoney(Math.max(0, input.goodsValue));
  const shippingCost = roundMoney(Math.max(0, input.shippingCost));
  const customsCost = roundMoney(Math.max(0, input.customsCost));
  const otherCost1 = roundMoney(Math.max(0, input.otherCost1));
  const otherCost2 = roundMoney(Math.max(0, input.otherCost2));
  const additionalCostsTotal = roundMoney(shippingCost + customsCost + otherCost1 + otherCost2);
  const totalLandedCost = roundMoney(goodsValue + additionalCostsTotal);
  const totalLengthM = input.totalLengthM;

  if (!Number.isFinite(totalLengthM) || totalLengthM <= 0) {
    throw new Error('إجمالي الأمتار يجب أن يكون أكبر من صفر لحساب التكلفة المستلمة');
  }
  if (goodsValue <= 0) {
    throw new Error('قيمة البضاعة مطلوبة لحساب التكلفة المستلمة');
  }

  const landedCostPerMeter = roundUnitCost(totalLandedCost / totalLengthM);
  const shipmentWeightKg =
    input.shipmentWeightKg != null && Number.isFinite(input.shipmentWeightKg) && input.shipmentWeightKg > 0
      ? input.shipmentWeightKg
      : null;
  const landedCostPerKg =
    shipmentWeightKg != null ? roundUnitCost(totalLandedCost / shipmentWeightKg) : null;

  return {
    goodsValue,
    shippingCost,
    customsCost,
    otherCost1,
    otherCost2,
    shipmentWeightKg,
    totalLengthM,
    additionalCostsTotal,
    totalLandedCost,
    landedCostPerMeter,
    landedCostPerKg,
  };
}

/** Pro-rate landed cost to a roll by its meter share (standard for packing-list imports). */
export function allocateRollLandedCost(params: {
  lengthM: number;
  totalLengthM: number;
  landedCostPerMeter: number;
  shipmentWeightKg: number | null;
  excelActualWeightKg: number | null;
}): RollLandedAllocation {
  const lengthM = params.lengthM;
  if (!Number.isFinite(lengthM) || lengthM <= 0) {
    throw new Error('طول الثوب يجب أن يكون أكبر من صفر');
  }

  const unitCostPerMeter = roundUnitCost(params.landedCostPerMeter);
  const rollLandedValue = roundMoney(unitCostPerMeter * lengthM);

  let estimatedWeightKg: number | null = null;
  const excelWt = params.excelActualWeightKg;
  if (excelWt != null && Number.isFinite(excelWt) && excelWt > 0) {
    estimatedWeightKg = roundWeight(excelWt);
  } else if (
    params.shipmentWeightKg != null
    && params.shipmentWeightKg > 0
    && params.totalLengthM > 0
  ) {
    estimatedWeightKg = roundWeight((lengthM / params.totalLengthM) * params.shipmentWeightKg);
  }

  return { unitCostPerMeter, rollLandedValue, estimatedWeightKg };
}

export function formatLandedCostInvoiceNotes(summary: LandedCostSummary, currencyCode: string): string {
  const ccy = currencyCode.trim().toUpperCase() || 'USD';
  const fmt = (n: number) => n.toFixed(2);
  const fmtM = (n: number) => n.toFixed(4);
  const lines = [
    '── التكلفة المستلمة (Landed Cost) ──',
    `قيمة البضاعة: ${fmt(summary.goodsValue)} ${ccy}`,
    `أجور شحن: ${fmt(summary.shippingCost)} ${ccy}`,
    `جمارك: ${fmt(summary.customsCost)} ${ccy}`,
    `أخرى 1: ${fmt(summary.otherCost1)} ${ccy}`,
    `أخرى 2: ${fmt(summary.otherCost2)} ${ccy}`,
    `الإجمالي: ${fmt(summary.totalLandedCost)} ${ccy}`,
    `تكلفة المتر: ${fmtM(summary.landedCostPerMeter)} ${ccy}/م`,
  ];
  if (summary.shipmentWeightKg != null && summary.landedCostPerKg != null) {
    lines.push(`وزن الشحنة: ${summary.shipmentWeightKg.toFixed(3)} كغ`);
    lines.push(`تكلفة الكيلو: ${fmtM(summary.landedCostPerKg)} ${ccy}/كغ`);
  }
  lines.push('توزيع المصاريف: حسب الأمتار (pro-rata by length)');
  return lines.join('\n');
}

export function landedCostBreakdownMetadata(summary: LandedCostSummary): Record<string, unknown> {
  return {
    goodsValue: summary.goodsValue,
    shippingCost: summary.shippingCost,
    customsCost: summary.customsCost,
    otherCost1: summary.otherCost1,
    otherCost2: summary.otherCost2,
    additionalCostsTotal: summary.additionalCostsTotal,
    totalLandedCost: summary.totalLandedCost,
    landedCostPerMeter: summary.landedCostPerMeter,
    landedCostPerKg: summary.landedCostPerKg,
    shipmentWeightKg: summary.shipmentWeightKg,
    allocationMethod: 'BY_LENGTH_METERS',
  };
}
