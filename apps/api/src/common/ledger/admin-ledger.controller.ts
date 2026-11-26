import { Role } from '@cvc/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminGroups } from '../decorators/admin-groups.decorator';
import { Roles } from '../decorators/roles.decorator';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import { type ListLedgerTransactionsInput, listLedgerTransactionsSchema } from './ledger.dto';
import { LedgerService } from './ledger.service';

// P4.23 — read-only finance view over the immutable ledger. There is no write
// endpoint: money is only posted by business flows inside their transaction.
@ApiTags('admin')
@Roles(Role.Admin)
@AdminGroups('admin_finance', 'admin_super')
@Controller('admin/ledger')
export class AdminLedgerController {
  constructor(private readonly ledger: LedgerService) {}

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
}
