import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { GlobalSearchQueryDto } from './dto/global-search-query.dto';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiOperation({ summary: 'بحث شامل في العملاء والإيصالات والمستندات والحجوزات ضمن نطاق المستخدم' })
  search(@CurrentUser() user: AuthUser, @Query() query: GlobalSearchQueryDto) {
    return this.searchService.search(user, query.q);
  }
}
