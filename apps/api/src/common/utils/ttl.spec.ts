import { parseTtlToSeconds } from './ttl';

describe('parseTtlToSeconds', () => {
  it('parses seconds/minutes/hours/days and plain numbers', () => {
    expect(parseTtlToSeconds('45')).toBe(45);
    expect(parseTtlToSeconds('45s')).toBe(45);
    expect(parseTtlToSeconds('15m')).toBe(900);
    expect(parseTtlToSeconds('2h')).toBe(7200);
    expect(parseTtlToSeconds('30d')).toBe(2592000);
  });

  it('rejects invalid values', () => {
    expect(() => parseTtlToSeconds('abc')).toThrow();
    expect(() => parseTtlToSeconds('-5m')).toThrow();
  });
});
