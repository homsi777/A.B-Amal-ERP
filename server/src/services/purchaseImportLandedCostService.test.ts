import { describe, expect, it } from 'vitest';
import {
  allocateRollLandedCost,
  computeLandedCostSummary,
} from './purchaseImportLandedCostService.js';

describe('computeLandedCostSummary', () => {
  it('computes total landed cost and per-meter rate', () => {
    const s = computeLandedCostSummary({
      goodsValue: 50_000,
      shippingCost: 3_000,
      customsCost: 4_000,
      otherCost1: 300,
      otherCost2: 200,
      shipmentWeightKg: 4_200,
      totalLengthM: 10_172.4,
    });
    expect(s.additionalCostsTotal).toBe(7_500);
    expect(s.totalLandedCost).toBe(57_500);
    expect(s.landedCostPerMeter).toBeCloseTo(57_500 / 10_172.4, 4);
    expect(s.landedCostPerKg).toBeCloseTo(57_500 / 4_200, 4);
  });

  it('rejects zero goods value', () => {
    expect(() =>
      computeLandedCostSummary({
        goodsValue: 0,
        shippingCost: 0,
        customsCost: 0,
        otherCost1: 0,
        otherCost2: 0,
        shipmentWeightKg: 100,
        totalLengthM: 100,
      }),
    ).toThrow(/قيمة البضاعة/);
  });
});

describe('allocateRollLandedCost', () => {
  const perMeter = 57_500 / 10_172.4;

  it('allocates roll cost by meters and estimates weight from shipment total', () => {
    const roll = allocateRollLandedCost({
      lengthM: 63,
      totalLengthM: 10_172.4,
      landedCostPerMeter: perMeter,
      shipmentWeightKg: 4_200,
      excelActualWeightKg: null,
    });
    expect(roll.unitCostPerMeter).toBeCloseTo(perMeter, 4);
    expect(roll.rollLandedValue).toBeCloseTo(perMeter * 63, 2);
    expect(roll.estimatedWeightKg).toBeCloseTo((63 / 10_172.4) * 4_200, 2);
  });

  it('prefers excel weight when present', () => {
    const roll = allocateRollLandedCost({
      lengthM: 50,
      totalLengthM: 100,
      landedCostPerMeter: 10,
      shipmentWeightKg: 200,
      excelActualWeightKg: 12.5,
    });
    expect(roll.estimatedWeightKg).toBe(12.5);
  });
});
