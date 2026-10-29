'use strict';
const { timingSafeEqual } = require('node:crypto');
function createQuotationHandler(config, writer) {
  return async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${config.apiKey}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { message: 'Unauthorized' });
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'POST' || !['/sales/quotations', '/sales/quotations/dry-run'].includes(path)) return send(404, { message: 'Not found' });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length; if (size > 65536) return send(413, { message: 'Request too large' }); chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return send(400, { message: 'Invalid JSON' }); }
      const result = path.endsWith('/dry-run') ? await writer.dryRun(input) : await writer.createDraft(input);
      return send(200, result);
    } catch (error) {
      if (error.errorNum === 54) return send(409, { message: 'Quotation numbering is busy; retry with the same reference' });
      if (error.errorNum) return send(503, { message: 'Quotation write failed', oracleError: error.errorNum });
      return send(400, { message: error.message });
    }
  };
}
module.exports = { createQuotationHandler };
