import { Role } from '@cvc/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type OrderCustomerInfo, Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { decryptCccdNumber, encryptCccdNumber } from '../common/utils/validators';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertCustomerInfoInput } from './customer-info.dto';

// P4.18 — legal customer snapshot used to render the sourcing contract.
// GET/PUT /orders/:id/customer-info. The snapshot is prefilled from Profile and
// the latest approved KYC, then stored per order so later profile edits do not
// change an existing contract. Once a Contract exists the row is read-only.
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';
const CONTRACT_OWNER_TYPE = 'sourcing_order';

const ORDER_SELECT = {
  id: true,
  orderNo: true,
  buyerId: true,
  supplierId: true,
  status: true,
} as const;

type OrderRef = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

type AccessRole = 'buyer' | 'supplier' | 'staff';

interface OrderAccess {
  order: OrderRef;
  role: AccessRole;
}

interface ProfileSnapshot {
  orgType: 'PERSONAL' | 'BUSINESS_HOUSEHOLD' | 'COMPANY';
  displayName: string;
  taxId: string | null;
  businessRegNo: string | null;
  representativeName: string | null;
  address: string | null;
}

interface AddressSnapshot {
  receiverName: string;
  city: string;
  district: string;
  ward: string;
  line: string;
}

interface KycSnapshot {
  status: string;
  cccdNumberEnc: string | null;
  reviewedAt: Date | null;
}

interface LoadedContext {
  profile: ProfileSnapshot | null;
  kyc: KycSnapshot | null;
  defaultAddress: AddressSnapshot | null;
  existing: OrderCustomerInfo | null;
  contract: { id: string; status: string } | null;
}

interface Suggestion {
  orgType: 'PERSONAL' | 'BUSINESS_HOUSEHOLD' | 'COMPANY';
  legalName: string | null;
  taxId: string | null;
  businessRegNo: string | null;
  cccdNumberEnc: string | null;
  cccdLast4: string | null;
  address: string | null;
  representativeName: string | null;
}

interface ResolvedInfo {
  orgType: 'PERSONAL' | 'BUSINESS_HOUSEHOLD' | 'COMPANY';
  legalName: string;
  taxId: string | null;
  businessRegNo: string | null;
  cccdNumberEnc: string | null;
  cccdLast4: string | null;
  address: string;
  representativeName: string | null;
}

@Injectable()
export class CustomerInfoService {
  private readonly logger = new Logger(CustomerInfoService.name);
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.get<string>('encryption.key', '');
  }

  // GET /orders/:id/customer-info — saved snapshot + profile/KYC suggestion.
  async get(actor: AccessPayload, orderId: string) {
    const access = await this.resolveAccess(orderId, actor);
    if (!access) throw new NotFoundException(ORDER_NOT_FOUND);
    if (access.role === 'supplier') {
      throw new ForbiddenException('Nhà cung cấp không được xem thông tin pháp lý của khách.');
    }

    const context = await this.loadContext(access.order);
    return this.envelope(access.order, context, context.existing);
  }

  // PUT /orders/:id/customer-info — only the order's buyer may save the
  // snapshot; contract-linked rows are locked. Omitted CCCD/tax fields fall
  // back to the saved row, then Profile/approved KYC.
  async upsert(actor: AccessPayload, orderId: string, input: UpsertCustomerInfoInput) {
    const access = await this.resolveAccess(orderId, actor);
    if (!access) throw new NotFoundException(ORDER_NOT_FOUND);
    if (access.role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách hàng của đơn được cập nhật thông tin hợp đồng.');
    }

    const context = await this.loadContext(access.order);
    if (context.contract || context.existing?.lockedAt) {
      throw this.conflict(
        'CUSTOMER_INFO_LOCKED',
        'Hợp đồng đã được tạo; thông tin khách không thể sửa.',
      );
    }

    const merged = this.merge(input, context, context.existing);
    const missing = this.missingFields(merged);
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'CUSTOMER_INFO_INCOMPLETE',
        message: `Thiếu thông tin khách để tạo hợp đồng: ${missing.join(', ')}.`,
      });
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: a contract may have appeared since the
      // read that produced `context`.
      const contract = await tx.contract.findFirst({
        where: { ownerType: CONTRACT_OWNER_TYPE, ownerId: orderId },
        select: { id: true },
      });
      if (contract) {
        throw this.conflict(
          'CUSTOMER_INFO_LOCKED',
          'Hợp đồng đã được tạo; thông tin khách không thể sửa.',
        );
      }

      const row = await tx.orderCustomerInfo.upsert({
        where: { orderId },
        create: { orderId, ...merged },
        update: { ...merged, version: { increment: 1 } },
      });
      await tx.orderEvent.create({
        data: {
          orderId,
          type: 'customer_info.updated',
          actorId: actor.sub,
          message: 'Cập nhật thông tin khách cho hợp đồng.',
          data: {
            orgType: row.orgType,
            version: row.version,
            locked: false,
          },
        },
      });
      return row;
    });

    this.logger.log(
      { orderId, buyerId: access.order.buyerId, version: saved.version },
      'customer info saved',
    );
    return this.envelope(access.order, context, saved);
  }

  // Called by contract creation (P5.4) before rendering/signing a contract.
  async assertReadyForContract(
    orderId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const info = await client.orderCustomerInfo.findUnique({
      where: { orderId },
      select: {
        orgType: true,
        legalName: true,
        taxId: true,
        cccdNumberEnc: true,
        address: true,
        representativeName: true,
      },
    });
    if (!info) {
      throw this.conflict(
        'CUSTOMER_INFO_REQUIRED',
        'Chưa có thông tin khách cho hợp đồng; vui lòng nhập trước khi tạo hợp đồng.',
      );
    }
    const missing = this.missingFields(info);
    if (missing.length > 0) {
      throw this.conflict(
        'CUSTOMER_INFO_INCOMPLETE',
        `Thiếu thông tin khách để tạo hợp đồng: ${missing.join(', ')}.`,
      );
    }
  }

  // Internal feed for P5.4 (contract rendering). Never expose the raw CCCD over
  // the public API; only the contract pipeline may call this.
  async getContractData(orderId: string) {
    await this.assertReadyForContract(orderId);
    const info = await this.prisma.orderCustomerInfo.findUniqueOrThrow({ where: { orderId } });
    return {
      orderId: info.orderId,
      orgType: info.orgType,
      legalName: info.legalName,
      taxId: info.taxId,
      businessRegNo: info.businessRegNo,
      cccdNumber: info.cccdNumberEnc
        ? decryptCccdNumber(info.cccdNumberEnc, this.encryptionKey)
        : null,
      address: info.address,
      representativeName: info.representativeName,
      version: info.version,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async resolveAccess(orderId: string, actor: AccessPayload): Promise<OrderAccess | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_SELECT,
    });
    if (!order) return null;
    if (order.buyerId === actor.sub) return { order, role: 'buyer' };

    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return { order, role: 'supplier' };

    if (actor.role === Role.Admin || actor.role === Role.Sales || actor.role === Role.Inspector) {
      return { order, role: 'staff' };
    }
    return null;
  }

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private async loadContext(order: OrderRef): Promise<LoadedContext> {
    const [profile, kyc, defaultAddress, existing, contract] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { userId: order.buyerId },
        select: {
          orgType: true,
          displayName: true,
          taxId: true,
          businessRegNo: true,
          representativeName: true,
          address: true,
        },
      }),
      this.prisma.kycSubmission.findFirst({
        where: { userId: order.buyerId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, cccdNumberEnc: true, reviewedAt: true },
      }),
      this.prisma.address.findFirst({
        where: { userId: order.buyerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: { receiverName: true, city: true, district: true, ward: true, line: true },
      }),
      this.prisma.orderCustomerInfo.findUnique({ where: { orderId: order.id } }),
      this.prisma.contract.findFirst({
        where: { ownerType: CONTRACT_OWNER_TYPE, ownerId: order.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      }),
    ]);
    return { profile, kyc, defaultAddress, existing, contract };
  }

  private suggestion(context: LoadedContext): Suggestion {
    const profile = context.profile;
    const approvedCccdEnc =
      context.kyc?.status === 'APPROVED' ? (context.kyc.cccdNumberEnc ?? null) : null;
    return {
      orgType: profile?.orgType ?? 'PERSONAL',
      legalName: profile?.displayName?.trim() || null,
      taxId: profile?.taxId ?? null,
      businessRegNo: profile?.businessRegNo ?? null,
      cccdNumberEnc: approvedCccdEnc,
      cccdLast4: this.last4FromEnc(approvedCccdEnc),
      address: profile?.address?.trim() || this.formatAddress(context.defaultAddress),
      representativeName: profile?.representativeName ?? null,
    };
  }

  private merge(
    input: UpsertCustomerInfoInput,
    context: LoadedContext,
    existing: LoadedContext['existing'],
  ): ResolvedInfo {
    const suggested = this.suggestion(context);

    let cccdNumberEnc: string | null;
    let cccdLast4: string | null;
    if (input.orgType !== 'PERSONAL') {
      // Contracts for businesses use MST, not the owner's personal CCCD.
      cccdNumberEnc = null;
      cccdLast4 = null;
    } else if (input.cccdNumber === null) {
      cccdNumberEnc = null;
      cccdLast4 = null;
    } else if (input.cccdNumber) {
      cccdNumberEnc = encryptCccdNumber(input.cccdNumber, this.encryptionKey);
      cccdLast4 = input.cccdNumber.slice(-4);
    } else if (existing?.cccdNumberEnc) {
      cccdNumberEnc = existing.cccdNumberEnc;
      cccdLast4 = existing.cccdLast4;
    } else {
      cccdNumberEnc = suggested.cccdNumberEnc;
      cccdLast4 = suggested.cccdLast4;
    }

    return {
      orgType: input.orgType,
      legalName: input.legalName,
      taxId: this.pick(input.taxId, existing?.taxId, suggested.taxId),
      businessRegNo: this.pick(
        input.businessRegNo,
        existing?.businessRegNo,
        suggested.businessRegNo,
      ),
      cccdNumberEnc,
      cccdLast4,
      address: input.address,
      representativeName: this.pick(
        input.representativeName,
        existing?.representativeName,
        suggested.representativeName,
      ),
    };
  }

  private pick<T>(input: T | null | undefined, saved: T | null | undefined, suggested: T | null) {
    if (input === null) return null;
    if (input !== undefined) return input;
    if (saved !== undefined) return saved;
    return suggested ?? null;
  }

  private missingFields(info: {
    orgType: 'PERSONAL' | 'BUSINESS_HOUSEHOLD' | 'COMPANY';
    legalName: string | null;
    taxId: string | null;
    cccdNumberEnc: string | null;
    address: string | null;
    representativeName: string | null;
  }): string[] {
    const missing: string[] = [];
    if (!info.legalName?.trim()) missing.push('legalName');
    if (!info.address?.trim()) missing.push('address');
    if (info.orgType === 'PERSONAL') {
      if (!info.cccdNumberEnc) missing.push('cccdNumber');
    } else {
      if (!info.taxId) missing.push('taxId');
      if (!info.representativeName?.trim()) missing.push('representativeName');
    }
    return missing;
  }

  private envelope(order: OrderRef, context: LoadedContext, info: LoadedContext['existing']) {
    const suggested = this.suggestion(context);
    const missing = this.missingFields(info ?? suggested);
    const readyForContract = Boolean(info) && missing.length === 0;
    const approvedKyc = context.kyc?.status === 'APPROVED' ? context.kyc : null;

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      saved: Boolean(info),
      readyForContract,
      missingFields: readyForContract ? [] : missing,
      locked: Boolean(context.contract || info?.lockedAt),
      contractId: context.contract?.id ?? null,
      contractStatus: context.contract?.status ?? null,
      info: info
        ? {
            orgType: info.orgType,
            legalName: info.legalName,
            taxId: info.taxId,
            businessRegNo: info.businessRegNo,
            cccdMasked: info.cccdLast4 ? `****${info.cccdLast4}` : null,
            hasCccd: Boolean(info.cccdNumberEnc),
            address: info.address,
            representativeName: info.representativeName,
            version: info.version,
            lockedAt: info.lockedAt,
            updatedAt: info.updatedAt,
          }
        : null,
      suggested: {
        orgType: suggested.orgType,
        legalName: suggested.legalName,
        taxId: suggested.taxId,
        businessRegNo: suggested.businessRegNo,
        cccdMasked: suggested.cccdLast4 ? `****${suggested.cccdLast4}` : null,
        address: suggested.address,
        representativeName: suggested.representativeName,
      },
      kyc: {
        status: context.kyc?.status ?? null,
        approvedAt: approvedKyc?.reviewedAt ?? null,
        cccdMasked: approvedKyc?.cccdNumberEnc
          ? this.maskLast4(this.last4FromEnc(approvedKyc.cccdNumberEnc))
          : null,
      },
    };
  }

  private formatAddress(address: AddressSnapshot | null): string | null {
    if (!address) return null;
    return [address.line, address.ward, address.district, address.city]
      .filter((part) => Boolean(part?.trim()))
      .join(', ');
  }

  private last4FromEnc(enc: string | null): string | null {
    if (!enc) return null;
    try {
      return decryptCccdNumber(enc, this.encryptionKey).slice(-4);
    } catch {
      return null;
    }
  }

  private maskLast4(last4: string | null): string | null {
    return last4 ? `****${last4}` : null;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
