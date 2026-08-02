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
import { ImportAnalyticalAccountsDto } from './dto/import-analytical-accounts.dto';
import { QueryAnalyticalAccountsDto } from './dto/query-analytical-accounts.dto';
import { AnalyticalStatementQueryDto } from './dto/statement-query.dto';

// Analytical Accounts — extensible non-customer accounting accounts (debtors,
// employee advances/custodies, and future categories). Fully separate from
// Customer/CustomerBalance: no balance mutation, no collections impact.
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

  @Post('import')
  @RequirePermissions('analytical_accounts.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'layout', enum: ['debtor', 'employee'] })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Import accounts + movements from CSV (debtor or employee layout). '
      + 'Movements are append-only and deduped; re-uploading the same file is safe.',
  })
  import(
    @CurrentUser() user: AuthUser,
    @Query() dto: ImportAnalyticalAccountsDto,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    return this.accounts.importCsv(user, dto.layout, file, req);
  }
}
