import { Role } from '@cvc/shared';
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../decorators/admin-groups.decorator';
import { type AccessPayload, CurrentUser } from '../decorators/current-user.decorator';
import { Roles } from '../decorators/roles.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { ConservationService } from './conservation.service';
import { type ListLedgerTransactionsInput, listLedgerTransactionsSchema } from './ledger.dto';
import { LedgerService } from './ledger.service';

// P4.23/P4.25 — read-only finance view over the immutable ledger plus the
// conservation status/run. There is no ledger write endpoint: money is only
// posted by business flows inside their transaction.
@ApiTags('admin')
@Roles(Role.Admin)
@AdminGroups('admin_finance', 'admin_super')
@Controller('admin/ledger')
export class AdminLedgerController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly conservation: ConservationService,
  ) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Số dư từng tài khoản sổ cái (tính từ bút toán)' })
  accounts() {
    return this.ledger.listAccounts();
  }

  @Get('trial-balance')
  @ApiOperation({ summary: 'Tổng nợ/có toàn hệ thống + cờ cân bằng' })
  trialBalance() {
    return this.ledger.trialBalance();
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Danh sách bút toán (?type=&refType=&refId=&from=&to=)' })
  list(
    @Query(new ZodValidationPipe(listLedgerTransactionsSchema))
    query: ListLedgerTransactionsInput,
  ) {
    return this.ledger.listTransactions(query);
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Chi tiết một bút toán kèm các dòng nợ/có' })
  detail(@Param('id') id: string) {
    return this.ledger.getTransaction(id);
  }

  @Get('conservation')
  @ApiOperation({
    summary: 'Trạng thái kiểm tra bảo toàn tiền (lần gần nhất + cờ khóa rút tiền)',
  })
  conservationStatus() {
    return this.conservation.status();
  }

  @Post('conservation/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chạy kiểm tra bảo toàn tiền ngay (admin tài chính)' })
  runConservation(@CurrentUser() user: AccessPayload) {
    return this.conservation.run({ source: 'manual', triggeredById: user.sub });
  }
}
