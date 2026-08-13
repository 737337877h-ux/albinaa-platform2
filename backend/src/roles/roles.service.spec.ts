import { RolesService } from './roles.service';

describe('RolesService', () => {
  it('always creates public API roles as non-system roles', async () => {
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'role-1', name: 'Read only', isSystem: false }),
      },
    } as any;
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const service = new RolesService(prisma, audit);

    const result = await service.createRole(
      { id: 'admin-1', organizationId: 'org-1', permissions: ['users.manage'] } as any,
      { name: 'Read only', isSystem: true } as any,
    );

    expect(result.isSystem).toBe(false);
    expect(prisma.role.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Read only', isSystem: false }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      newValue: { name: 'Read only', isSystem: false },
    }));
  });
});
