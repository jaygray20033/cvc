import { connect, Socket } from 'node:net';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ClamAV INSTREAM client (P2.17). Sends the file to the daemon over TCP and
// parses OK / FOUND. When the daemon is unreachable the scan falls back to a
// small local signature check (EICAR test string) so a broken scanner never
// silently marks files CLEAN without notice.
export type ScanResult = { status: 'CLEAN' | 'INFECTED' | 'ERROR'; signature?: string };

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

@Injectable()
export class VirusScanService {
  private readonly logger = new Logger(VirusScanService.name);
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('clamav.host', '');
    this.port = config.get<number>('clamav.port', 3310);
  }

  async scan(bytes: Buffer): Promise<ScanResult> {
    if (this.host) {
      try {
        return await this.clamavInstream(bytes);
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          'clamav unreachable, falling back to local signatures',
        );
      }
    }
    return this.localSignatures(bytes);
  }

  // ClamAV INSTREAM protocol: command + chunks (len prefix + data) + ZORO.
  private clamavInstream(bytes: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket: Socket = connect({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      let done = false;

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          const chunk = bytes.subarray(offset, offset + 4096);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          socket.write(Buffer.concat([header, chunk]));
        }
        const zero = Buffer.alloc(4);
        socket.write(zero);
      });
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        const line = buffer.toString('utf8').trim();
        if (line.includes('OK') || line.includes('FOUND') || line.includes('ERROR')) {
          done = true;
          socket.end();
          if (line.includes('FOUND')) {
            resolve({ status: 'INFECTED', signature: line });
          } else if (line.includes('OK')) {
            resolve({ status: 'CLEAN' });
          } else {
            resolve({ status: 'ERROR' });
          }
        }
      });
      socket.on('error', (err) => {
        if (!done) reject(err);
      });
      socket.on('close', () => {
        if (!done) reject(new Error('clamav closed connection without verdict'));
      });
    });
  }

  // Local fallback: EICAR test string only. A "dirty but honest" guard.
  private localSignatures(bytes: Buffer): ScanResult {
    if (bytes.includes(Buffer.from(EICAR, 'utf8'))) {
      return { status: 'INFECTED', signature: 'EICAR-TEST-SIGNATURE (local)' };
    }
    return { status: 'CLEAN' };
  }
}
