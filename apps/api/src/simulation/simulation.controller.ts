import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  PumpSimulationInput,
  pumpSimulationSchema,
  SetSimulationInput,
  setSimulationSchema,
} from './simulation.dto';
import { SimulationService } from './simulation.service';

// P4.21 — demo-only routes. The service returns 404 unless
// ENABLE_SIMULATION=true and NODE_ENV is not production.
@ApiTags('simulation')
@Roles(Role.Admin, Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector)
@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}

  @Post('orders/:id/auto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bật/tắt tự động hoá tiến độ cho một đơn (chỉ test/staging)' })
  setAuto(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setSimulationSchema)) body: SetSimulationInput,
  ) {
    return this.simulation.setAuto(user, id, body);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Trạng thái mô phỏng của đơn (chỉ test/staging)' })
  status(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.simulation.status(user, id);
  }

  @Post('pump')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chạy một nhịp tiến độ sản xuất/vận chuyển/khiếu nại' })
  pump(
    @CurrentUser() user: AccessPayload,
    @Body(new ZodValidationPipe(pumpSimulationSchema)) body: PumpSimulationInput,
  ) {
    return this.simulation.pump(user, body);
  }
}
