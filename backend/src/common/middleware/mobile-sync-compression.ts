import compression from 'compression';

const SYNC_PATHS = new Set(['/mobile/sync', '/mobile/operations-sync', '/mobile/collection-sync']);

/** Compress large read-only sync snapshots when the client negotiates an encoding. */
export function mobileSyncCompression() {
  return compression({
    threshold: 1024,
    level: 4,
    filter: (request, response) => {
      const eligible = ((request.method === 'POST' && SYNC_PATHS.has(request.path))
        || (request.method === 'GET' && request.path === '/sales-order-drafts/offline'))
        && response.statusCode >= 200 && response.statusCode < 300
        && compression.filter(request, response);
      if (!eligible) return false;
      // The public proxy advertises Brotli even for Android's native HTTP
      // transport, which decodes gzip but cannot decode a Brotli snapshot.
      // Keep the client's quality/refusal rules, including wildcard offers.
      const accepted = request.headers['accept-encoding'];
      if (accepted) {
        request.headers['accept-encoding'] = [
          ...accepted.split(',').filter(value => !/^\s*br\s*(?:;|$)/i.test(value)),
          'br;q=0',
        ].join(',');
      }
      return true;
    },
  });
}
