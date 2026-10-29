export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export function sessionExpired(lastActivity: number, now = Date.now()) {
  return !Number.isFinite(lastActivity) || lastActivity <= 0 || now < lastActivity || now - lastActivity >= IDLE_TIMEOUT_MS;
}
export class SessionGate {
  version = 0;
  active = false;
  lastActivity = 0;
  open(now = Date.now()) { this.version++; this.active = true; this.lastActivity = now; }
  close() { this.version++; this.active = false; this.lastActivity = 0; }
  accepts(version: number, now = Date.now()) { return this.active && this.version === version && !sessionExpired(this.lastActivity, now); }
}

const activityListeners = new Set<() => void>();
export function reportUserActivity() { activityListeners.forEach(listener => listener()); }
export function listenUserActivity(listener: () => void) { activityListeners.add(listener); return () => { activityListeners.delete(listener); }; }
