import { validate, isUUID } from 'class-validator';
import { ContactAttemptDto, ContactAttemptService, normalizeContactOperationId } from './contact-attempt.controller';

const legacy = 'mu8hz7mb-4cp2qq6k';
const uuid = 'f6cd21b5-dee1-4159-b255-b3e57ab889d1';
describe('existing mobile contact attempts', () => {
  function dto(operationId: unknown) {
    return Object.assign(new ContactAttemptDto(), { operationId, customerId: uuid, channel: 'sms', occurredAt: '2026-09-19T14:43:25.907Z' });
  }
  it('accepts existing mobile keys and UUIDs while retaining other validation', async () => {
    expect(await validate(dto(legacy))).toHaveLength(0);
    expect(await validate(dto(uuid))).toHaveLength(0);
    expect((await validate(Object.assign(dto(legacy), {customerId: legacy}))).map(x => x.property)).toContain('customerId');
  });
  it.each(['', 'bad', 'mu8hz7mb-', 'mu8hz7mb-abcdefghij', ' mu8hz7mb-4cp2qq6k', null, 123, {}])('rejects malformed IDs: %p', async (id) => {
    expect((await validate(dto(id))).map(x => x.property)).toContain('operationId');
  });
  it('maps legacy retries to a stable UUID, scoped to tenant and user', () => {
    const id = normalizeContactOperationId(legacy, 'org', 'user');
    expect(isUUID(id, '5')).toBe(true);
    expect(normalizeContactOperationId(legacy, 'org', 'user')).toBe(id);
    expect(normalizeContactOperationId(legacy, 'org2', 'user')).not.toBe(id);
    expect(normalizeContactOperationId(legacy, 'org', 'user2')).not.toBe(id);
    expect(normalizeContactOperationId(uuid, 'org', 'user')).toBe(uuid);
  });
  it('uses the same normalized key for insert and replay lookup without duplicating the record', async () => {
    let stored: any;
    const tx: any = {
      $queryRaw: jest.fn(async (sql: TemplateStringsArray, ...args: any[]) => sql.join('').includes('SELECT id,status') ? (stored ? [stored] : []) : []),
      $executeRaw: jest.fn(async (_sql: TemplateStringsArray, id: string) => { stored = {id, status:'pending'}; }),
      customerAssignment: {findFirst: jest.fn().mockResolvedValue(null)},
    };
    const db: any = {collector:{findUnique:jest.fn().mockResolvedValue(null)},customer:{findFirst:jest.fn().mockResolvedValue({id:uuid})},$transaction:(fn:any)=>fn(tx)};
    const svc = new ContactAttemptService(db);
    jest.spyOn(svc as any, 'snapshot').mockResolvedValue({hash:'baseline',latest:0});
    const actor:any = {id:'user',organizationId:'org',permissions:['customers.read_all']};
    const first = await svc.register(actor, dto(legacy));
    expect(await svc.register(actor, dto(legacy))).toEqual(first);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls.filter((c:any[]) => c[0].join('').includes('SELECT id,status')).every((c:any[]) => c.includes(first.id))).toBe(true);
  });
});
