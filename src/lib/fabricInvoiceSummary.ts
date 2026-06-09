export const UNKNOWN_FABRIC_VALUE = 'غير محدد';

export interface FabricInvoiceSummaryLine {
  materialName?: string | null;
  fabricName?: string | null;
  designName?: string | null;
  designCode?: string | null;
  dsamNumber?: string | null;
  colorCode?: string | null;
  colorName?: string | null;
  rollNo?: string | null;
  rollNumber?: string | null;
  barcode?: string | null;
  lengthMeters?: number | string | null;
  length?: number | string | null;
  quantity?: number | string | null;
  weightKg?: number | string | null;
  weight?: number | string | null;
  pricePerMeter?: number | string | null;
  price?: number | string | null;
  unitPrice?: number | string | null;
  lineTotal?: number | string | null;
  total?: number | string | null;
}

export interface FabricInvoiceSummaryGroup {
  materialName: string;
  designCode: string;
  pricePerMeter: number;
  colorCount: number;
  rollCount: number;
  totalMeters: number;
  totalKg: number;
  totalAmount: number;
}

export interface FabricInvoiceSummary {
  groups: FabricInvoiceSummaryGroup[];
  totals: {
    groupCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
    totalAmount: number;
  };
}

const toNumber = (value: unknown): number => {
  const numberValue = typeof value === 'string' ? Number(value.trim()) : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const cleanText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeName = (value: unknown): string => cleanText(value) || UNKNOWN_FABRIC_VALUE;

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateFabricWeightKg(lengthMeters: number, widthCm: number, gsm: number): number {
  const safeLength = Math.max(0, toNumber(lengthMeters));
  const safeWidthMeters = Math.max(0, toNumber(widthCm)) / 100;
  const safeGsm = Math.max(0, toNumber(gsm));

  return roundMoney((safeLength * safeWidthMeters * safeGsm) / 1000);
}

export function calculateFabricInvoiceSummary(lines: FabricInvoiceSummaryLine[]): FabricInvoiceSummary {
  const groupsByKey = new Map<string, FabricInvoiceSummaryGroup & { colorKeys: Set<string> }>();

  lines.forEach((line) => {
    const materialName = normalizeName(line.materialName ?? line.fabricName);
    const designCode = normalizeName(line.designCode ?? line.designName ?? line.dsamNumber);
    const pricePerMeter = Math.max(0, toNumber(line.pricePerMeter ?? line.price ?? line.unitPrice));
    const totalMeters = Math.max(0, toNumber(line.lengthMeters ?? line.length ?? line.quantity));
    const totalKg = Math.max(0, toNumber(line.weightKg ?? line.weight));
    const explicitTotal = toNumber(line.lineTotal ?? line.total);
    const totalAmount = explicitTotal > 0 ? explicitTotal : totalMeters * pricePerMeter;
    const key = `${materialName}|||${designCode}|||${pricePerMeter}`;
    const group = groupsByKey.get(key) ?? {
      materialName,
      designCode,
      pricePerMeter,
      colorCount: 0,
      rollCount: 0,
      totalMeters: 0,
      totalKg: 0,
      totalAmount: 0,
      colorKeys: new Set<string>(),
    };

    group.rollCount += 1;
    group.totalMeters += totalMeters;
    group.totalKg += totalKg;
    group.totalAmount += totalAmount;

    const colorKey = cleanText(line.colorCode) || cleanText(line.colorName);
    if (colorKey) {
      group.colorKeys.add(colorKey.toLocaleLowerCase());
    }

    groupsByKey.set(key, group);
  });

  const groups = Array.from(groupsByKey.values()).map(({ colorKeys, ...group }) => ({
    ...group,
    colorCount: colorKeys.size,
    totalMeters: roundMoney(group.totalMeters),
    totalKg: roundMoney(group.totalKg),
    totalAmount: roundMoney(group.totalAmount),
  }));

  const totals = groups.reduce(
    (sum, group) => ({
      groupCount: sum.groupCount + 1,
      rollCount: sum.rollCount + group.rollCount,
      totalMeters: sum.totalMeters + group.totalMeters,
      totalKg: sum.totalKg + group.totalKg,
      totalAmount: sum.totalAmount + group.totalAmount,
    }),
    { groupCount: 0, rollCount: 0, totalMeters: 0, totalKg: 0, totalAmount: 0 },
  );

  return {
    groups,
    totals: {
      groupCount: totals.groupCount,
      rollCount: totals.rollCount,
      totalMeters: roundMoney(totals.totalMeters),
      totalKg: roundMoney(totals.totalKg),
      totalAmount: roundMoney(totals.totalAmount),
    },
  };
}
