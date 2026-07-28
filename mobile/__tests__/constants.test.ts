import { describe, it, expect } from '@jest/globals';
import {
  APP_VERSION, SYNC_INTERVAL_MS, GPS_INTERVAL_MS, MAX_IMAGE_SIZE_MB,
  IMAGE_COMPRESSION_QUALITY, MUTATION_MAX_RETRIES, generateIdempotencyKey,
  DB_SCHEMA_VERSION,
} from '../src/utils/constants';

describe('constants', () => {
  it('exports expected app version', () => {
    expect(APP_VERSION).toBe('1.1.0');
  });

  it('sync interval is 30 seconds', () => {
    expect(SYNC_INTERVAL_MS).toBe(30_000);
  });

  it('gps interval is 10 seconds', () => {
    expect(GPS_INTERVAL_MS).toBe(10_000);
  });

  it('max retries is 5', () => {
    expect(MUTATION_MAX_RETRIES).toBe(5);
  });

  it('schema version is 2', () => {
    expect(DB_SCHEMA_VERSION).toBe(2);
  });

  it('max image size is 10 MB', () => {
    expect(MAX_IMAGE_SIZE_MB).toBe(10);
  });

  it('compression quality is 0.7', () => {
    expect(IMAGE_COMPRESSION_QUALITY).toBe(0.7);
  });

  it('generateIdempotencyKey returns a string', () => {
    const key = generateIdempotencyKey();
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('generateIdempotencyKey returns unique values', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateIdempotencyKey()));
    expect(keys.size).toBe(100);
  });
});
