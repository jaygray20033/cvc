import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { SearchService } from './search.service';

// Public catalog search (P2.23). Domain modules feed SearchService; the
// product tables land in P3.2 — until then results come from indexed rows.
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Tìm kiếm công khai (FULLTEXT, bỏ dấu tiếng Việt)' })
  search(@Query() query: Record<string, string | undefined>) {
    const q = (query.q ?? '').slice(0, 100);
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));
    return this.searchService.search(q, {
      entityType: query.type,
      limit,
      offset: (page - 1) * limit,
    });
  }
}
