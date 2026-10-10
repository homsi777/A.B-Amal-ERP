export const UNKNOWN_FABRIC_VALUE = 'غير محدد';

export interface FabricInvoiceSummaryLine {
  /** 'kg' لسطور الخيط بالوزن — الكمية تُحسب بالكامل كوزن، لا كأمتار. */
  unit?: 'meter' | 'yard' | 'kg' | null;
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
  /** كمية هذا السطر المُرجَعة فعلياً (مرتجعات مؤكدة) — بنفس وحدة الكمية. */
  returnedQuantity?: number | string | null;
}

export interface FabricInvoiceSummaryGroup {
  materialName: string;
  designCode: string;
  pricePerMeter: number;
  colorCount: number;
  /** عدد الأتواب المباعة إجمالاً (قبل خصم المرتجع). */
  rollCount: number;
  /** عدد الأتواب المُرجَعة من ضمن rollCount. */
  returnedRollCount: number;
  /** عدد الأتواب الصافي بعد خصم المرتجع = rollCount - returnedRollCount. */
  netRollCount: number;
  totalMeters: number;
  /** أمتار مرتجَعة من ضمن totalMeters. */
  returnedMeters: number;
  /** أمتار صافية بعد خصم المرتجع = totalMeters - returnedMeters. */
  netMeters: number;
  totalKg: number;
  totalAmount: number;
}

export interface FabricInvoiceSummary {
  groups: FabricInvoiceSummaryGroup[];
  totals: {
    groupCount: number;
    rollCount: number;
    returnedRollCount: number;
    netRollCount: number;
    totalMeters: number;
    returnedMeters: number;
    netMeters: number;
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

/** سطر يُعتبر "مرتجعاً" بصرياً إذا أُرجع منه أي كمية تُذكر (حتى مرتجع جزئي). */
export const RETURN_EPSILON = 1e-4;

export function isLineReturned(returnedQuantity: number | string | null | undefined): boolean {
  return toNumber(returnedQuantity) > RETURN_EPSILON;
}

export function calculateFabricInvoiceSummary(lines: FabricInvoiceSummaryLine[]): FabricInvoiceSummary {
  const groupsByKey = new Map<string, FabricInvoiceSummaryGroup & { colorKeys: Set<string> }>();

  lines.forEach((line) => {
    const materialName = normalizeName(line.materialName ?? line.fabricName);
    const designCode = normalizeName(line.designCode ?? line.designName ?? line.dsamNumber);
    const isYarnLine = line.unit === 'kg';
    const pricePerMeter = Math.max(0, toNumber(line.pricePerMeter ?? line.price ?? line.unitPrice));
    const quantity = Math.max(0, toNumber(line.lengthMeters ?? line.length ?? line.quantity));
    const totalMeters = isYarnLine ? 0 : quantity;
    const totalKg = isYarnLine ? quantity : Math.max(0, toNumber(line.weightKg ?? line.weight));
    const explicitTotal = toNumber(line.lineTotal ?? line.total);
    const totalAmount = explicitTotal > 0 ? explicitTotal : quantity * pricePerMeter;
    const returnedQuantity = Math.min(quantity, Math.max(0, toNumber(line.returnedQuantity)));
    const returnedMeters = isYarnLine ? 0 : returnedQuantity;
    const lineReturned = isLineReturned(returnedQuantity);
    const key = `${materialName}|||${designCode}|||${pricePerMeter}`;
    const group = groupsByKey.get(key) ?? {
      materialName,
      designCode,
      pricePerMeter,
      colorCount: 0,
      rollCount: 0,
      returnedRollCount: 0,
      netRollCount: 0,
      totalMeters: 0,
      returnedMeters: 0,
      netMeters: 0,
      totalKg: 0,
      totalAmount: 0,
      colorKeys: new Set<string>(),
    };

    group.rollCount += 1;
    group.totalMeters += totalMeters;
    group.totalKg += totalKg;
    group.totalAmount += totalAmount;
    if (lineReturned) group.returnedRollCount += 1;
    group.returnedMeters += returnedMeters;

    const colorKey = cleanText(line.colorCode) || cleanText(line.colorName);
    if (colorKey) {
      group.colorKeys.add(colorKey.toLocaleLowerCase());
    }

    groupsByKey.set(key, group);
  });

  const groups = Array.from(groupsByKey.values()).map(({ colorKeys, ...group }) => ({
    ...group,
    colorCount: colorKeys.size,
    netRollCount: group.rollCount - group.returnedRollCount,
    totalMeters: roundMoney(group.totalMeters),
    returnedMeters: roundMoney(group.returnedMeters),
    netMeters: roundMoney(group.totalMeters - group.returnedMeters),
    totalKg: roundMoney(group.totalKg),
    totalAmount: roundMoney(group.totalAmount),
  }));

  const totals = groups.reduce(
    (sum, group) => ({
      groupCount: sum.groupCount + 1,
      rollCount: sum.rollCount + group.rollCount,
      returnedRollCount: sum.returnedRollCount + group.returnedRollCount,
      totalMeters: sum.totalMeters + group.totalMeters,
      returnedMeters: sum.returnedMeters + group.returnedMeters,
      totalKg: sum.totalKg + group.totalKg,
      totalAmount: sum.totalAmount + group.totalAmount,
    }),
    { groupCount: 0, rollCount: 0, returnedRollCount: 0, totalMeters: 0, returnedMeters: 0, totalKg: 0, totalAmount: 0 },
  );

  return {
    groups,
    totals: {
      groupCount: totals.groupCount,
      rollCount: totals.rollCount,
      returnedRollCount: totals.returnedRollCount,
      netRollCount: totals.rollCount - totals.returnedRollCount,
      totalMeters: roundMoney(totals.totalMeters),
      returnedMeters: roundMoney(totals.returnedMeters),
      netMeters: roundMoney(totals.totalMeters - totals.returnedMeters),
      totalKg: roundMoney(totals.totalKg),
      totalAmount: roundMoney(totals.totalAmount),
    },
  };
}
