import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

const context = (permissions: string[]) => ({
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
}) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  it('accepts one of the permissions declared with OR semantics', () => {
    const reflector = {
      getAllAndOverride: (key: string) => key === ANY_PERMISSIONS_KEY ? ['purchase.read', 'transfer.read'] : undefined,
    } as unknown as Reflector;
    expect(new PermissionsGuard(reflector).canActivate(context(['transfer.read']))).toBe(true);
  });

  it('rejects a caller missing every permission declared with OR semantics', () => {
    const reflector = {
      getAllAndOverride: (key: string) => key === PERMISSIONS_KEY ? undefined : ['purchase.read', 'transfer.read'],
    } as unknown as Reflector;
    expect(() => new PermissionsGuard(reflector).canActivate(context(['other.read']))).toThrow(ForbiddenException);
  });
});
