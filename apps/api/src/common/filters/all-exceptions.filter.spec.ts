import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { PinoLogger } from 'nestjs-pino';

import { AllExceptionsFilter } from './all-exceptions.filter';

function setup(requestId = 'req-1') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  const req = { id: requestId, header: () => undefined } as unknown as Request;
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  const logger = {
    setContext: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;
  return { filter: new AllExceptionsFilter(logger), host, json, status };
}

describe('AllExceptionsFilter', () => {
  it('formats an HttpException as { code, message, requestId }', () => {
    const { filter, host, json, status } = setup();
    filter.catch(new HttpException('Bad input', HttpStatus.BAD_REQUEST), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: 'Bad input',
      requestId: 'req-1',
    });
  });

  it('maps a Prisma unique error to 409', () => {
    const { filter, host, json, status } = setup();
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNIQUE_CONSTRAINT', requestId: 'req-1' }),
    );
  });

  it('hides internals on a 500', () => {
    const { filter, host, json, status } = setup();
    filter.catch(new Error('secret stack detail'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
      requestId: 'req-1',
    });
  });
});
