import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  currentOrganization(orgId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true, name: true, createdAt: true,
        _count: { select: { branches: true, users: true, customers: true } },
      },
    });
  }

  findAll(orgId: string) {
    return this.prisma.branch.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, name: true, active: true, createdAt: true,
        _count: { select: { users: true, customers: true, collectors: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(orgId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true, name: true, active: true, createdAt: true,
        _count: { select: { users: true, customers: true, collectors: true } },
      },
    });
    if (!branch) throw new NotFoundException('الفرع غير موجود');
    return branch;
  }

  async create(actor: AuthUser, dto: CreateBranchDto, req?: Request) {
    const exists = await this.prisma.branch.findFirst({
      where: { organizationId: actor.organizationId, name: dto.name },
    });
    if (exists) throw new ConflictException('يوجد فرع بنفس الاسم');

    const branch = await this.prisma.branch.create({
      data: { organizationId: actor.organizationId, name: dto.name },
    });
    await this.audit.log({
      userId: actor.id, action: 'branch_created', entityTable: 'branches', entityId: branch.id,
      newValue: { name: dto.name }, req,
    });
    return branch;
  }

  async update(actor: AuthUser, id: string, dto: UpdateBranchDto, req?: Request) {
    const before = await this.findOne(actor.organizationId, id);
    if (dto.name && dto.name !== before.name) {
      const dup = await this.prisma.branch.findFirst({
        where: { organizationId: actor.organizationId, name: dto.name, id: { not: id } },
      });
      if (dup) throw new ConflictException('يوجد فرع بنفس الاسم');
    }
    const branch = await this.prisma.branch.update({ where: { id }, data: { name: dto.name } });
    await this.audit.log({
      userId: actor.id, action: 'branch_updated', entityTable: 'branches', entityId: id,
      oldValue: { name: before.name }, newValue: { name: dto.name }, req,
    });
    return branch;
  }

  async setStatus(actor: AuthUser, id: string, active: boolean, req?: Request) {
    const before = await this.findOne(actor.organizationId, id);
    const branch = await this.prisma.branch.update({ where: { id }, data: { active } });
    await this.audit.log({
      userId: actor.id, action: active ? 'branch_enabled' : 'branch_disabled',
      entityTable: 'branches', entityId: id,
      oldValue: { active: before.active }, newValue: { active }, req,
    });
    return branch;
  }
}
