import { ConfigService } from '@nestjs/config';

import { VirusScanService } from './virus-scan.service';

// P2.17: with no ClamAV host configured the scanner falls back to local
// signatures (EICAR test file detection) so tests run without the daemon.
function makeService(host = ''): VirusScanService {
  const config = {
    get: (key: string) => ({ 'clamav.host': host, 'clamav.port': 3310 })[key],
  } as unknown as ConfigService;
  return new VirusScanService(config);
}

describe('VirusScanService (local fallback)', () => {
  it('marks the EICAR test file INFECTED', async () => {
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const res = await makeService().scan(Buffer.from(eicar, 'utf8'));
    expect(res.status).toBe('INFECTED');
    expect(res.signature).toContain('EICAR');
  });

  it('marks benign bytes CLEAN', async () => {
    const res = await makeService().scan(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    expect(res.status).toBe('CLEAN');
  });
});
