import {describe,it,expect} from '@jest/globals';
import { SessionGate, sessionExpired, IDLE_TIMEOUT_MS } from '../src/utils/session-lock';
describe('15 minute device session', () => {
 it('expires at the exact idle deadline and rejects missing/future activity', () => {
  expect(sessionExpired(1000, 1000+IDLE_TIMEOUT_MS-1)).toBe(false);
  expect(sessionExpired(1000, 1000+IDLE_TIMEOUT_MS)).toBe(true);
  expect(sessionExpired(0,1000)).toBe(true); expect(sessionExpired(2000,1000)).toBe(true);
 });
 it('never lets an in-flight refresh reopen a locked or replaced session', () => {
  const gate=new SessionGate();gate.open(1000);const version=gate.version;
  expect(gate.accepts(version,2000)).toBe(true);gate.close();
  expect(gate.accepts(version,2000)).toBe(false);gate.open(3000);
  expect(gate.accepts(version,3000)).toBe(false);
 });
});
