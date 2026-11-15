import { ConfigService } from '@nestjs/config';

import { S3Service } from './s3.service';

// Unit tests with a mocked S3 client: presign TTL is 5 minutes and the
// object key carries no PII beyond the user id (P2.12).
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.example/xyz'),
}));

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(() => {
    const config = {
      get: (key: string) =>
        ({
          's3.endpoint': 'http://localhost:9000',
          's3.region': 'us-east-1',
          's3.accessKey': 'k',
          's3.secretKey': 's',
          's3.bucketPrivate': 'cvc-private',
        })[key],
    } as unknown as ConfigService;
    service = new S3Service(config);
  });

  it('object keys contain no email/CCCD-like PII', () => {
    const key = service.objectKey('user-123', 'doc-456');
    expect(key).toBe('kyc/user-123/doc-456');
    expect(key).not.toContain('@');
  });

  it('presigns a 5-minute GET link', async () => {
    const { getSignedUrl } = jest.requireMock('@aws-sdk/s3-request-presigner') as {
      getSignedUrl: jest.Mock;
    };
    const url = await service.presignGet('cvc-private', 'kyc/u/d');
    expect(url).toContain('https://presigned.example');
    expect(getSignedUrl.mock.calls.at(-1)?.[2]).toEqual({ expiresIn: 300 });
  });

  it('exposes the private bucket for KYC storage', () => {
    expect(service.privateBucket).toBe('cvc-private');
  });
});
