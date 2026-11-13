import compression from 'compression';

const SYNC_PATHS = new Set(['/mobile/sync', '/mobile/operations-sync', '/mobile/collection-sync']);

/** Compress large read-only sync snapshots when the client negotiates an encoding. */
export function mobileSyncCompression() {
  return compression({
    threshold: 1024,
    level: 4,
    filter: (request, response) => request.method === 'POST'
      && SYNC_PATHS.has(request.path)
      && response.statusCode >= 200 && response.statusCode < 300
      && compression.filter(request, response),
  });
}
