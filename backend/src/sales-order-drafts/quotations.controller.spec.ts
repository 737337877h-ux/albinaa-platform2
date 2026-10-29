import { ConfigService } from '@nestjs/config';
import { QuotationsController } from './quotations.controller';
import { AuthUser } from '../common/guards/jwt-auth.guard';

describe('quotation reader access', () => {
  const actor = { organizationId: 'organization-a' } as AuthUser;
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('blocks unconfigured and foreign organizations before calling Oracle', async () => {
    const fetch = jest.fn(); global.fetch = fetch;
    const missing = new QuotationsController(new ConfigService({}));
    await expect(missing.list(actor)).rejects.toThrow('غير مهيأ');
    const foreign = new QuotationsController(new ConfigService({
      ORACLE_QUOTATIONS_ORGANIZATION_ID: 'organization-b',
      ORACLE_READ_API_URL: 'http://localhost', ORACLE_READ_API_KEY: 'test',
    }));
    await expect(foreign.list(actor)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a gateway response for another year', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
      schema: 'IAS20191', mode: 'SELECT_ONLY', oracleWrite: 'NONE', items: [],
    }) });
    const controller = new QuotationsController(new ConfigService({
      ORACLE_QUOTATIONS_ORGANIZATION_ID: actor.organizationId,
      ORACLE_READ_API_URL: 'http://localhost', ORACLE_READ_API_KEY: 'test',
    }));
    await expect(controller.list(actor)).rejects.toThrow('تعذر قراءة');
  });

  it('keeps writes disabled unless explicitly enabled', async () => {
    const fetch = jest.fn(); global.fetch = fetch;
    const controller = new QuotationsController(new ConfigService({ ORACLE_QUOTATIONS_ORGANIZATION_ID: actor.organizationId }));
    await expect(controller.create(actor, {})).rejects.toThrow('غير مفعّل');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('namespaces references by organization and preserves the same key for retries', async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ schema: 'IAS20261', serial: '2026000001526', number: '6' }) }); global.fetch = fetch;
    const controller = new QuotationsController(new ConfigService({
      ORACLE_QUOTATIONS_ORGANIZATION_ID: actor.organizationId, ORACLE_QUOTATIONS_WRITE_ENABLED: 'true',
      ORACLE_QUOTATIONS_WRITE_API_URL: 'http://localhost', ORACLE_QUOTATIONS_WRITE_API_KEY: 'test',
    }));
    const input = { externalReference: '00000000-0000-4000-8000-000000000001', lines: [] };
    await controller.create(actor, input); await controller.create(actor, input);
    const first = JSON.parse(fetch.mock.calls[0][1].body);
    expect(first.externalReference).toBe(`${actor.organizationId}:${input.externalReference}`);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  });
});
