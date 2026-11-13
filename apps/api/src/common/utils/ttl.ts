// Parses TTL strings like '15m', '30d', '3600' into seconds.
export function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL value: ${ttl}`);
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return amount;
  }
}
