import { Body, Controller, Module, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { CollectionsModule } from '../src/collections/collections.module';
import { CollectionsService } from '../src/collections/collections.service';
import { CreateCollectionDto } from '../src/collections/dto/create-collection.dto';
import { CurrentUser } from '../src/common/decorators/current-user.decorator';
import { Idempotent } from '../src/common/decorators/idempotent.decorator';
import { RequirePermissions } from '../src/common/decorators/permissions.decorator';
import { AuthUser } from '../src/common/guards/jwt-auth.guard';

// Test-only adapter for the retained local ledger engine. The production POST
// /collections remains disabled; it is explicitly tested separately. This module
// is never imported by application source and is excluded from production builds.
@Controller('__test/legacy-collections')
class LegacyCollectionsTestController {
  constructor(private readonly collections: CollectionsService) {}

  @Post()
  @Idempotent()
  @RequirePermissions('collections.create')
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateCollectionDto, @Req() req: Request) {
    return this.collections.create(actor, dto, req);
  }
}

@Module({ imports: [CollectionsModule], controllers: [LegacyCollectionsTestController] })
export class LegacyCollectionsTestModule {}
