import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AddShipmentStopInput,
  addShipmentStopSchema,
  ConfirmReceiptInput,
  confirmReceiptSchema,
  CreateShipmentInput,
  createShipmentSchema,
  UpdateShipmentInput,
  updateShipmentSchema,
} from './shipments.dto';
import { ShipmentsService } from './shipments.service';

// P4.19 C/D — order-scoped shipment list/create and buyer receipt.
@ApiTags('shipments')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('orders')
export class OrderShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post(':id/shipments')
  @ApiOperation({ summary: 'NCC/sales nhập vận đơn tự đặt (hãng, mã, link, ngày, ảnh phiếu)' })
  create(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createShipmentSchema)) body: CreateShipmentInput,
  ) {
    return this.shipments.create(user, id, body);
  }

  @Get(':id/shipments')
  @ApiOperation({ summary: 'Timeline vận chuyển nhập tay + mốc gợi ý' })
  list(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.shipments.listForOrder(user, id);
  }

  @Post(':id/confirm-receipt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách xác nhận đã nhận hàng; đơn shipping → received' })
  confirmReceipt(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmReceiptSchema)) body: ConfirmReceiptInput,
  ) {
    return this.shipments.confirmReceipt(user, id, body);
  }
}

// P4.19 C — one shipment: read, edit header, append a milestone.
@ApiTags('shipments')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết vận đơn + timeline' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.shipments.detail(user, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'NCC/sales cập nhật hãng, mã vận đơn, link, ngày dự kiến/trạng thái' })
  update(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateShipmentSchema)) body: UpdateShipmentInput,
  ) {
    return this.shipments.update(user, id, body);
  }

  @Post(':id/stops')
  @ApiOperation({ summary: 'NCC/sales thêm mốc vận chuyển nhập tay (moveGoods)' })
  addStop(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addShipmentStopSchema)) body: AddShipmentStopInput,
  ) {
    return this.shipments.addStop(user, id, body);
  }
}
