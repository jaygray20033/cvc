import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { type AccessPayload, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  type ListWalletTransactionsInput,
  listWalletTransactionsSchema,
  type WalletStatementInput,
  walletStatementSchema,
} from './wallet.dto';
import { WalletService } from './wallet.service';

// P4.24 — a user's own wallet. Balance is reconciled from the ledger on read.
@ApiTags('wallet')
@Controller('me/wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Roles()
  @Get()
  @ApiOperation({ summary: 'Ví của tôi: tổng, tạm giữ, khả dụng (đối chiếu sổ cái)' })
  get(@CurrentUser() user: AccessPayload) {
    return this.wallet.getWallet(user.sub);
  }

  @Roles()
  @Get('transactions')
  @ApiOperation({ summary: 'Sao kê giao dịch ví (?from=&to=&page=&limit=)' })
  list(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(listWalletTransactionsSchema))
    query: ListWalletTransactionsInput,
  ) {
    return this.wallet.listTransactions(user.sub, query);
  }

  @Roles()
  @Get('statement')
  @ApiOperation({ summary: 'Tải sao kê ví CSV/PDF (?format=csv|pdf&from=&to=)' })
  async statement(
    @CurrentUser() user: AccessPayload,
    @Query(new ZodValidationPipe(walletStatementSchema))
    query: WalletStatementInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.wallet.getStatement(user.sub, query);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.body;
  }
}
