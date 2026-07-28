export const API_BASE_URL = __DEV__
  ? 'http://localhost:3000'
  : 'https://api.albinaa.com';

export const SYNC_INTERVAL_MS = 30_000;
export const GPS_INTERVAL_MS = 10_000;
export const GPS_BACKGROUND_INTERVAL_MS = 600_000;
export const MAX_IMAGE_SIZE_MB = 10;
export const IMAGE_COMPRESSION_QUALITY = 0.7;
export const APP_VERSION = '1.1.0';
export const DB_SCHEMA_VERSION = 2;
export const MUTATION_MAX_RETRIES = 5;

export function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
