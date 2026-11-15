import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Minimal S3 wrapper for KYC documents (P2.12; full file service is P2.17).
// Private-bucket objects are only reachable via short-lived presigned URLs:
// presignPut for the client upload, presignGet for owner/admin download.
// Lifecycle cleanup of abandoned UPLOADING rows is a later job.
@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucketPrivate: string;

  constructor(config: ConfigService) {
    this.client = new S3Client({
      region: config.get<string>('s3.region', 'us-east-1'),
      endpoint: config.get<string>('s3.endpoint'),
      forcePathStyle: config.get<boolean>('s3.forcePathStyle', true),
      credentials: {
        accessKeyId: config.get<string>('s3.accessKey', ''),
        secretAccessKey: config.get<string>('s3.secretKey', ''),
      },
      // SeaweedFS rejects presigned PUTs signed with the SDK's default
      // flexible checksums (BadDigest). Only checksum when actually asked.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    this.bucketPrivate = config.get<string>('s3.bucketPrivate', 'cvc-private');
  }

  get privateBucket(): string {
    return this.bucketPrivate;
  }

  // No PII in the key: random id per document, never email/CCCD.
  objectKey(userId: string, documentId: string): string {
    return `kyc/${userId}/${documentId}`;
  }

  async presignPut(bucket: string, key: string, mime: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime }),
      { expiresIn: 300 },
    );
  }

  async presignGet(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 300, // 5 minutes, per P2.12 "short lived links"
    });
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
