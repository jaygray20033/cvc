import { Role } from '@cvc/shared';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';

import { AdminGroups } from '../common/decorators/admin-groups.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { DEAD_LETTER_QUEUE, QUEUE_NAMES, type QueueName } from './queue.constants';
import { QueueService } from './queue.service';

// Read/inspect/requeue API for BullMQ (P2.19, admin only). No delete: failed
// jobs stay in the archive until an admin explicitly retries them.
@ApiTags('admin')
@Controller('admin/jobs')
@Roles(Role.Admin)
@AdminGroups('admin_super', 'admin_ops', 'admin_finance', 'admin_support')
export class JobsAdminController {
  constructor(private readonly queues: QueueService) {}

  @Get()
  @ApiOperation({ summary: 'Số đếm job theo queue (waiting/active/failed...)' })
  async overview() {
    const items = await Promise.all(
      QUEUE_NAMES.map(async (name) => ({
        queue: name,
        counts: await this.queues.counts(name),
      })),
    );
    const dlq = this.queues.getQueue(DEAD_LETTER_QUEUE);
    const deadCounts = await dlq.getJobCounts('waiting', 'completed', 'failed');
    return { items, deadLetter: { queue: DEAD_LETTER_QUEUE, counts: deadCounts } };
  }

  @Get('dead-letter')
  @ApiOperation({ summary: 'Danh sách job đã hết số lần thử (dead-letter)' })
  async deadLetter(@Query() query: Record<string, string | undefined>) {
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
    const jobs = await this.queues.getQueue(DEAD_LETTER_QUEUE).getWaiting(0, limit - 1);
    return {
      items: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        queue: job.data.queue,
        originalJobId: job.data.jobId,
        error: job.data.error,
        failedAt: job.data.failedAt,
        data: job.data.data,
      })),
    };
  }

  @Get(':queue/failed')
  @ApiOperation({ summary: 'Job đang ở trạng thái failed của một queue' })
  async failed(@Param('queue') queue: string, @Query() query: Record<string, string | undefined>) {
    this.assertQueue(queue);
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
    const jobs = await this.queues.getQueue(queue as QueueName).getFailed(0, limit - 1);
    return {
      items: jobs.map((job) => ({
        id: job.id,
        name: job.name,
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
        data: job.data,
      })),
    };
  }

  // Re-run a failed/dead job through the original queue.
  @Post(':queue/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cho một job lỗi chạy lại' })
  async retry(@Param('queue') queue: string, @Param('jobId') jobId: string) {
    this.assertQueue(queue);
    const job: Awaited<ReturnType<Queue['getJob']>> = await this.queues
      .getQueue(queue as QueueName)
      .getJob(jobId);
    if (!job) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Không tìm thấy job.' });
    }
    try {
      await job.retry('failed');
    } catch (error) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: `Không thử lại được job: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return { message: 'Job đã được đưa vào hàng đợi để chạy lại.' };
  }

  private assertQueue(name: string): void {
    if (!(QUEUE_NAMES as readonly string[]).includes(name)) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Queue không tồn tại.' });
    }
  }
}
