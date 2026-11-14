import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('health')
@Controller()
@SkipThrottle() // health probes must never be rate limited
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  health() {
    return this.appService.health();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  ready() {
    return this.appService.ready();
  }
}
