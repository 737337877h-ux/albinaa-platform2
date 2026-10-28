import { describe, it, expect } from '@jest/globals';
import { canRetryOnAlternateRoute } from '../src/api/route-retry';

describe('route retry safety', () => {
  it.each(['post','put','patch','delete','POST'])('does not replay %s after an ambiguous network failure', (method) => {
    expect(canRetryOnAlternateRoute(method)).toBe(false);
  });
  it.each(['get','head','options','GET',undefined])('allows a read-only retry for %s', (method) => {
    expect(canRetryOnAlternateRoute(method)).toBe(true);
  });
});
