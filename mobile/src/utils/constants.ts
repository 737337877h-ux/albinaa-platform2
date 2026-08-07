// عنوان الـ API يُدار من mobile/src/config/api.ts (مع شاشة إعدادات)
// لا تستورد process.env.EXPO_PUBLIC_API_URL في الشاشات أو الخدمات.

// Full snapshots can contain thousands of customers. Five minutes keeps the
// device fresh without continuously rewriting SQLite; foregrounding the app
// and the manual button still trigger an immediate sync.
export const SYNC_INTERVAL_MS = 300_000;
export const GPS_INTERVAL_MS = 10_000;
export const GPS_BACKGROUND_INTERVAL_MS = 600_000;
export const MAX_IMAGE_SIZE_MB = 10;
export const IMAGE_COMPRESSION_QUALITY = 0.7;
export const APP_VERSION = '1.3.1';
export const DB_SCHEMA_VERSION = 6;
// Compatibility value for older diagnostics. Retriable operations are no
// longer deleted at this threshold; they remain queued with capped backoff.
export const MUTATION_MAX_RETRIES = 5;

export function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
