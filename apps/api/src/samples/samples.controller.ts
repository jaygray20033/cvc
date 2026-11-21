import { Role } from '@cvc/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AddSampleStopInput,
  addSampleStopSchema,
  ApproveSampleInput,
  approveSampleSchema,
  ReceiveSampleInput,
  receiveSampleSchema,
  ReviseSampleInput,
  reviseSampleSchema,
  ShipSampleInput,
  shipSampleSchema,
  UploadSampleInput,
  uploadSampleSchema,
} from './samples.dto';
import { SamplesService } from './samples.service';

// P4.17 — sample actions. Role checks are explicit in the service: supplier
// accounts upload/ship, sales may add milestones, the buyer receives/revises/
// approves.
@ApiTags('samples')
@Roles(Role.Buyer, Role.Supplier, Role.Sales, Role.Inspector, Role.Admin)
@Controller('samples')
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết mẫu + mốc vận chuyển nhập tay' })
  detail(@CurrentUser() user: AccessPayload, @Param('id') id: string) {
    return this.samples.detail(user, id);
  }

  @Post(':id/upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhà cung cấp cập nhật ảnh mẫu (uploadSample)' })
  upload(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(uploadSampleSchema)) body: UploadSampleInput,
  ) {
    return this.samples.upload(user, id, body);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhà cung cấp gửi mẫu, nhập hãng + mã vận đơn (sendSample)' })
  ship(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shipSampleSchema)) body: ShipSampleInput,
  ) {
    return this.samples.ship(user, id, body);
  }

  @Post(':id/stops')
  @ApiOperation({ summary: 'NCC/sales nhập mốc vận chuyển mẫu (moveSample)' })
  stop(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addSampleStopSchema)) body: AddSampleStopInput,
  ) {
    return this.samples.addStop(user, id, body);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách xác nhận đã nhận mẫu (receiveSample)' })
  receive(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receiveSampleSchema)) body: ReceiveSampleInput,
  ) {
    return this.samples.receive(user, id, body);
  }

  @Post(':id/revise')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách yêu cầu sửa mẫu (reviseSample, giới hạn số vòng)' })
  revise(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviseSampleSchema)) body: ReviseSampleInput,
  ) {
    return this.samples.revise(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khách duyệt mẫu; đơn chuyển sampling → contract' })
  approve(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveSampleSchema)) body: ApproveSampleInput,
  ) {
    return this.samples.approve(user, id, body);
  }
}
