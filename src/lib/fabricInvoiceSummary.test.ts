import assert from 'node:assert/strict';
import { calculateFabricInvoiceSummary, calculateFabricWeightKg, UNKNOWN_FABRIC_VALUE } from './fabricInvoiceSummary';

assert.equal(calculateFabricWeightKg(100, 150, 150), 22.5);

const summary = calculateFabricInvoiceSummary([
  {
    materialName: 'LONDRA',
    designCode: 'KL-131',
    colorCode: 'RED',
    rollNo: 'R-1',
    lengthMeters: 300,
    weightKg: 45,
    pricePerMeter: 2,
  },
  {
    materialName: 'LONDRA',
    designCode: 'KL-131',
    colorCode: 'BLUE',
    rollNo: 'R-2',
    lengthMeters: 350,
    weightKg: 50,
    pricePerMeter: 2,
  },
  {
    materialName: 'LONDRA',
    designCode: 'KL-131',
    colorName: 'RED',
    rollNo: 'R-3',
    lengthMeters: 312.7,
    weightKg: 47.5,
    pricePerMeter: 2,
  },
  {
    materialName: 'SOFIA',
    designCode: 'SF-008',
    colorName: 'Black',
    rollNo: 'R-4',
    lengthMeters: 125,
    weightKg: 18,
    pricePerMeter: 3.5,
  },
  {
    materialName: 'MILANO',
    designCode: 'ML-220',
    colorCode: 'GOLD',
    rollNo: 'R-5',
    lengthMeters: 75,
    weightKg: '',
    pricePerMeter: 4,
  },
  {
    materialName: '',
    designCode: '',
    colorCode: '',
    rollNo: 'R-6',
    lengthMeters: 10,
    weightKg: -2,
    pricePerMeter: -1,
  },
]);

assert.equal(summary.groups.length, 4);

const londra = summary.groups.find((group) => group.materialName === 'LONDRA');
assert.ok(londra);
assert.equal(londra.designCode, 'KL-131');
assert.equal(londra.colorCount, 2);
assert.equal(londra.rollCount, 3);
assert.equal(londra.totalMeters, 962.7);
assert.equal(londra.totalKg, 142.5);
assert.equal(londra.totalAmount, 1925.4);

const unknown = summary.groups.find((group) => group.materialName === UNKNOWN_FABRIC_VALUE);
assert.ok(unknown);
assert.equal(unknown.designCode, UNKNOWN_FABRIC_VALUE);
assert.equal(unknown.colorCount, 0);
assert.equal(unknown.rollCount, 1);
assert.equal(unknown.totalKg, 0);
assert.equal(unknown.totalAmount, 0);

assert.deepEqual(summary.totals, {
  groupCount: 4,
  rollCount: 6,
  totalMeters: 1172.7,
  totalKg: 160.5,
  totalAmount: 2662.9,
});

console.log('fabricInvoiceSummary tests passed');
