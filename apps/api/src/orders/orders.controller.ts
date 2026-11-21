import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ListOrdersQueryInput,
  listOrdersQuerySchema,
  TransitionOrderInput,
  transitionOrderSchema,
} from './orders.dto';
import { OrdersService } from './orders.service';

// P4.16 — order list/detail and the only status-transition endpoint.
@ApiTags('orders')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách đơn theo vai trò (khách/NCC/nhân viên)' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQueryInput,
  ) {
    return this.orders.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết đơn + stepper 8 giai đoạn + timeline' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.orders.detail(user, id);
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chuyển trạng thái đơn (kiểm tra bảng D7 + vai trò + guard)' })
  transition(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionOrderSchema)) body: TransitionOrderInput,
  ) {
    return this.orders.transition(user, id, body);
  }
}
