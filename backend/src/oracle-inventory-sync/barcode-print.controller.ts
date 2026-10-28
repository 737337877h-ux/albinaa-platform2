import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Injectable, Post, UnauthorizedException } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { randomUUID, timingSafeEqual } from 'crypto';
import JsBarcode from 'jsbarcode';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';

export class BarcodeJobDto {
  @IsUUID() operationId!: string;
  @IsString() @Matches(/^[\x20-\x7e]{1,80}$/) itemCode!: string;
  @IsString() @MaxLength(200) itemName!: string;
  @IsNumber() @Min(20) @Max(104) widthMm!: number;
  @IsNumber() @Min(20) @Max(150) heightMm!: number;
  @IsInt() @Min(1) @Max(100) copies!: number;
  @IsBoolean() showName!: boolean;
  @IsBoolean() showCode!: boolean;
}
export class BarcodeAckDto {
  @IsUUID() id!: string;
  @IsUUID() claim!: string;
  @Matches(/^(submitted|failed|unknown)$/) status!: string;
}
type Job = { id: string; organization_id: string; payload: any; status: string; claim: string; created_at: Date };

@Injectable()
export class BarcodePrintService {
  private seen = 0;
  constructor(private readonly db: PrismaService) {}
  private org() { return process.env.BARCODE_PRINT_ORG || ''; }
  private authorize(key: string) {
    const expected = process.env.BARCODE_PRINT_KEY || '';
    if (expected.length < 32 || !this.org() || !key || Buffer.byteLength(key) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) throw new UnauthorizedException();
  }
  printer(actor: AuthUser) {
    return { name: 'ZDesigner GK888t (EPL)', available: actor.organizationId === this.org() && Date.now() - this.seen < 30000 };
  }
  async create(actor: AuthUser, dto: BarcodeJobDto) {
    if (actor.organizationId !== this.org()) throw new BadRequestException('الطابعة غير مهيأة لهذه المنشأة');
    const { operationId, ...payload } = dto;
    const encoded: any = {};
    JsBarcode(encoded, dto.itemCode, { format: 'CODE128', displayValue: false });
    const bits = encoded.encodings.map((e: any) => e.data).join('');
    // Two physical dots per narrow bar plus a ten-module quiet zone at each end.
    if ((bits.length + 20) * 2 > (dto.widthMm - 4) * 203 / 25.4) throw new BadRequestException('كود الصنف طويل لهذا المقاس؛ زد عرض الملصق');
    const json = JSON.stringify({ ...payload, bits });
    await this.db.$executeRaw`INSERT INTO barcode_print_jobs (id,organization_id,user_id,operation_id,payload) VALUES (${randomUUID()}::uuid,${actor.organizationId}::uuid,${actor.id}::uuid,${operationId}::uuid,${json}::jsonb) ON CONFLICT (organization_id,operation_id) DO NOTHING`;
    const rows = await this.db.$queryRaw<Job[]>`SELECT * FROM barcode_print_jobs WHERE organization_id=${actor.organizationId}::uuid AND operation_id=${operationId}::uuid`;
    if (JSON.stringify(rows[0].payload, Object.keys(rows[0].payload).sort()) !== JSON.stringify(JSON.parse(json), Object.keys(JSON.parse(json)).sort())) throw new ConflictException('رقم الطلب مستخدم بإعدادات مختلفة');
    return { id: rows[0].id, status: rows[0].status };
  }
  list(actor: AuthUser) {
    return this.db.$queryRaw`SELECT id,payload,status,created_at,finished_at FROM barcode_print_jobs WHERE organization_id=${actor.organizationId}::uuid AND user_id=${actor.id}::uuid ORDER BY created_at DESC LIMIT 20`;
  }
  async next(key: string) {
    this.authorize(key); this.seen = Date.now();
    await this.db.$executeRaw`UPDATE barcode_print_jobs SET status='unknown',finished_at=now() WHERE organization_id=${this.org()}::uuid AND status='dispatching' AND claimed_at < now()-interval '5 minutes'`;
    const claim = randomUUID();
    const rows = await this.db.$queryRaw<Job[]>`UPDATE barcode_print_jobs SET status='dispatching',claim=${claim}::uuid,claimed_at=now() WHERE id=(SELECT id FROM barcode_print_jobs WHERE organization_id=${this.org()}::uuid AND status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    return rows[0] ? { id: rows[0].id, claim, payload: rows[0].payload } : null;
  }
  async ack(key: string, dto: BarcodeAckDto) {
    this.authorize(key);
    const count = await this.db.$executeRaw`UPDATE barcode_print_jobs SET status=${dto.status},finished_at=now() WHERE id=${dto.id}::uuid AND organization_id=${this.org()}::uuid AND claim=${dto.claim}::uuid AND status IN ('dispatching','unknown')`;
    return { updated: count };
  }
}

@Controller('barcode-print')
export class BarcodePrintController {
  constructor(private readonly service: BarcodePrintService) {}
  @Get('printer') @RequirePermissions('inventory.read') printer(@CurrentUser() actor: AuthUser) { return this.service.printer(actor); }
  @Get('jobs') @RequirePermissions('inventory.read') list(@CurrentUser() actor: AuthUser) { return this.service.list(actor); }
  @Post('jobs') @RequirePermissions('inventory.read') create(@CurrentUser() actor: AuthUser, @Body() dto: BarcodeJobDto) { return this.service.create(actor, dto); }
  @Public() @Post('agent/next') next(@Headers('x-print-key') key: string) { return this.service.next(key); }
  @Public() @Post('agent/ack') ack(@Headers('x-print-key') key: string, @Body() dto: BarcodeAckDto) { return this.service.ack(key, dto); }
}
