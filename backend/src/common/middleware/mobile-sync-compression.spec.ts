import express from 'express';
import { Server, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { mobileSyncCompression } from './mobile-sync-compression';

describe('mobile snapshot transport', () => {
  let server: Server;
  const payload = { amount: '446105.077', label: 'صنف عربي', items: Array.from({ length: 400 }, (_, i) => ({ code: String(i), name: 'صنف في المخزون', quantity: '0.0041' })) };
  beforeAll(async () => {
    const app = express();
    app.use(mobileSyncCompression());
    app.use((req, res) => {
      if (req.headers['x-no-transform']) res.setHeader('Cache-Control', 'no-transform');
      if (req.headers['x-error']) res.status(401);
      res.json(payload);
    });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  async function read(path: string, headers: Record<string, string | undefined> = {}, method = 'POST') {
    return new Promise<{ headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const call = request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path, method, headers }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
      });
      call.on('error', reject); call.end();
    });
  }
  it.each(['/mobile/operations-sync', '/mobile/collection-sync', '/mobile/sync?cursor=1'])('negotiates gzip without changing snapshot values on %s', async path => {
    const result = await read(path, { 'Accept-Encoding': 'gzip' });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.headers.vary).toContain('Accept-Encoding');
    expect(JSON.parse(gunzipSync(result.body).toString('utf8'))).toEqual(payload);
    expect(result.body.length).toBeLessThan(Buffer.byteLength(JSON.stringify(payload)) / 4);
  });
  it.each([{}, { 'Accept-Encoding': 'identity' }, { 'Accept-Encoding': 'gzip;q=0, identity' }])('preserves identity transport when gzip is not accepted', async headers => {
    const result = await read('/mobile/operations-sync', headers);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(result.body.toString('utf8'))).toEqual(payload);
  });
  it('compresses full order snapshots without changing decimals, and respects no-transform',async()=>{
    const result=await read('/sales-order-drafts/offline?snapshotVersion=abc',{'Accept-Encoding':'gzip'},'GET');
    expect(result.headers['content-encoding']).toBe('gzip');expect(JSON.parse(gunzipSync(result.body).toString('utf8'))).toEqual(payload);
    const plain=await read('/sales-order-drafts/offline',{'Accept-Encoding':'gzip','x-no-transform':'1'},'GET');expect(plain.headers['content-encoding']).toBeUndefined();
  });
  it.each([
    ['/auth/login', { 'Accept-Encoding': 'gzip' }, 'POST'],
    ['/mobile/operations-sync', { 'Accept-Encoding': 'gzip', 'x-error': '1' }, 'POST'],
    ['/mobile/operations-sync', { 'Accept-Encoding': 'gzip', 'x-no-transform': '1' }, 'POST'],
    ['/mobile/operations-sync', { 'Accept-Encoding': 'gzip' }, 'GET'],
  ] as const)('leaves unrelated, error, or no-transform responses unchanged', async (path, headers, method) => {
    const result = await read(path, headers, method);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(result.body.toString('utf8'))).toEqual(payload);
  });
});
