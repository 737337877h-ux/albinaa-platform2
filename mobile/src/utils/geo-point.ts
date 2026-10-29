export type GeoPoint = { latitude: number; longitude: number };
export function parseGeoPoint(latitude: unknown, longitude: unknown): GeoPoint | null {
  const parse = (value: unknown) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return NaN;
    return Number(String(value).trim().replace(',', '.'));
  };
  const lat = parse(latitude), lng = parse(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { latitude: lat, longitude: lng };
}
