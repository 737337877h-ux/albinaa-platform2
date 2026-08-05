import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { AnalyticalAccountsService } from './analytical-accounts.service';
import { CreateAnalyticalAccountDto } from './dto/create-analytical-account.dto';
import { EMPLOYEE_IMPORT_CATEGORIES, ImportAnalyticalAccountsDto } from './dto/import-analytical-accounts.dto';
import { QueryAnalyticalAccountsDto } from './dto/query-analytical-accounts.dto';
import { AnalyticalStatementQueryDto } from './dto/statement-query.dto';

// Analytical Accounts — extensible non-customer accounting accounts. The
// advance-statement import is routed into Customer/CustomerBalance so advance
// accounts receive the same follow-up, promise, collection, and task workflow.
@ApiTags('Analytical Accounts')
@ApiBearerAuth('access-token')
@Controller('analytical-accounts')
export class AnalyticalAccountsController {
  constructor(private readonly accounts: AnalyticalAccountsService) {}

  @Get()
  @RequirePermissions('analytical_accounts.read')
  @ApiOperation({ summary: 'List analytical accounts with running balance per account' })
  findAll(@CurrentUser() user: AuthUser, @Query() q: QueryAnalyticalAccountsDto) {
    return this.accounts.findAll(user, q);
  }

  @Get(':id')
  @RequirePermissions('analytical_accounts.read')
  @ApiOperation({ summary: 'Analytical account detail with balance' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(user, id);
  }

  @Get('summary/by-category')
  @RequirePermissions('analytical_accounts.read')
  @ApiQuery({ name: 'category', required: false })
  @ApiOperation({ summary: 'Totals and account count by currency for an analytical account category' })
  summary(@CurrentUser() user: AuthUser, @Query('category') category?: string) {
    return this.accounts.summary(user, category);
  }

  @Get(':id/statement')
  @RequirePermissions('analytical_accounts.read')
  @ApiOperation({ summary: 'Account statement: movements with running balance (paginated)' })
  statement(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: AnalyticalStatementQueryDto,
  ) {
    return this.accounts.statement(user, id, q);
  }

  @Post()
  @RequirePermissions('analytical_accounts.manage')
  @ApiOperation({ summary: 'Manually create an analytical account (no movements)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnalyticalAccountDto, @Req() req: Request) {
    return this.accounts.create(user, dto, req);
  }

  @Post('import-advances')
  @RequirePermissions('customers.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'معاينة أو استيراد حسابات السلف على الغير إلى منظومة العملاء' })
  importAdvances(
    @CurrentUser() user: AuthUser,
    @Query('dryRun') dryRun: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.accounts.importAdvanceStatementExcel(user, file, dryRun !== 'false', req);
  }

  @Post('import')
  @RequirePermissions('analytical_accounts.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'layout', enum: ['debtor', 'employee', 'advance_statement', 'employee_statement'] })
  @ApiQuery({
    name: 'employeeCategory',
    required: false,
    enum: EMPLOYEE_IMPORT_CATEGORIES,
    description: 'Required when layout=employee. One of employee_advance | employee_custody.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Import analytical accounts from CSV, or preview/execute an advance-on-others statement XLSX. '
      + 'Movements are append-only and deduped; re-uploading the same file is safe.',
  })
  import(
    @CurrentUser() user: AuthUser,
    @Query() dto: ImportAnalyticalAccountsDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (dto.layout === 'advance_statement' || dto.layout === 'employee_statement') {
      return this.accounts.importAdvanceStatementExcel(
        user,
        file,
        dto.dryRun !== 'false',
        req,
      );
    }
    return this.accounts.importCsv(user, dto.layout, dto.employeeCategory, file, req);
  }
}
