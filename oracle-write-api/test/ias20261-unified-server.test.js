'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { COMPONENTS, createUnifiedHandler } = require('../src/ias20261-unified-server');

function delegate(name, calls) {
  return (request, response) => {
    calls.push([name, request.url]);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ delegatedTo: name }));
  };
}

test('reports all unified IAS20261 draft components and delegates every route family', async () => {
  const calls = [];
  const handlers = {
    purchase: delegate('purchase', calls),
    payment: delegate('payment', calls),
    journal: delegate('journal', calls),
    inventory: delegate('inventory', calls),
  };
  const server = http.createServer(createUnifiedHandler({ schema: 'IAS20261' }, handlers));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.mode, 'IAS20261_UNIFIED_DRAFT_INSERT_ONLY');
    assert.deepEqual(health.components, COMPONENTS);

    const routes = [
      ['/accounting/receipts/dry-run', 'purchase'],
      ['/inventory/out-requests/dry-run', 'purchase'],
      ['/purchasing/requests/dry-run', 'purchase'],
      ['/accounting/payments/dry-run', 'payment'],
      ['/accounting/journals/dry-run', 'journal'],
      ['/inventory/counts/dry-run', 'inventory'],
    ];
    for (const [route, target] of routes) {
      const response = await fetch(`${base}${route}`, { method: 'POST' });
      assert.equal((await response.json()).delegatedTo, target);
    }
    assert.equal(calls.length, routes.length);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
