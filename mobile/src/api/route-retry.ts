/** Never replay a write after a network error: its response may simply be lost. */
export function canRetryOnAlternateRoute(method?: string): boolean {
  return ['get', 'head', 'options'].includes((method || 'get').toLowerCase());
}
