export type ReservationItemStandard = {
  itemCode: string;
  nameAr: string;
  rodsPerTon: number;
};

export const RESERVATION_ITEM_STANDARDS: readonly ReservationItemStandard[] = [
  { itemCode: '230800105001', nameAr: 'حديد تركي 8', rodsPerTon: 200 },
  { itemCode: '230800105002', nameAr: 'حديد تركي 10', rodsPerTon: 130 },
  { itemCode: '230800105003', nameAr: 'حديد تركي 12', rodsPerTon: 90 },
  { itemCode: '230800105004', nameAr: 'حديد تركي 14', rodsPerTon: 66 },
  { itemCode: '230800105005', nameAr: 'حديد تركي 16', rodsPerTon: 50 },
  { itemCode: '230800105006', nameAr: 'حديد تركي 18', rodsPerTon: 40 },
  { itemCode: '230800405005', nameAr: 'حديد تركي 16 ضغط 60', rodsPerTon: 50 },
  { itemCode: '230800405006', nameAr: 'حديد تركي 18 ضغط 60', rodsPerTon: 40 },
  { itemCode: '230800405007', nameAr: 'حديد تركي 12 ضغط 60', rodsPerTon: 90 },
  { itemCode: '230800405008', nameAr: 'حديد تركي 14 ضغط 60', rodsPerTon: 66 },
] as const;

export const RESERVATION_ITEM_BY_CODE = new Map(
  RESERVATION_ITEM_STANDARDS.map((item) => [item.itemCode, item]),
);

export function rodsToTons(itemCode: string, rods: number): number | null {
  const standard = RESERVATION_ITEM_BY_CODE.get(itemCode);
  return standard ? rods / standard.rodsPerTon : null;
}
