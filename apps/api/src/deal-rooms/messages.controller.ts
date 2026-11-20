import { Role } from '@cvc/shared';
import { Controller, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TranslateMessageQueryInput, translateMessageQuerySchema } from './deal-rooms.dto';
import { TranslationsService } from './translations.service';

// P4.14 — translate a room message. Access is the same as the room itself,
// checked in the service (non-members get 404).
@ApiTags('messages')
@Roles(
  Role.Buyer,
  Role.Participant,
  Role.Retailer,
  Role.Supplier,
  Role.Sales,
  Role.Inspector,
  Role.Admin,
)
@Controller('messages')
export class MessagesController {
  constructor(private readonly translations: TranslationsService) {}

  @Post(':id/translate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dịch tin nhắn sang ngôn ngữ đích (cache theo tin+ngôn ngữ)' })
  translate(
    @CurrentUser() user: AccessPayload,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(translateMessageQuerySchema)) query: TranslateMessageQueryInput,
  ) {
    return this.translations.translate(user, id, query.lang);
  }
}
