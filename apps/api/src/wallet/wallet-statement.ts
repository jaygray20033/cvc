// P4.24 — wallet statement exporters. CSV is Excel-compatible; the PDF is a
// small dependency-free ASCII renderer (standard Helvetica) so exports work
// without extra services.

export interface StatementRow {
  time: Date;
  transactionId: string;
  type: string;
  reference: string;
  note: string;
  amount: string;
  direction: 'IN' | 'OUT';
}

export interface StatementSummary {
  userId: string;
  currency: string;
  balance: string;
  held: string;
  available: string;
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function formatTime(value: Date): string {
  return value.toISOString().replace('T', ' ').slice(0, 16);
}

export function buildStatementCsv(input: {
  from: string;
  to: string;
  rows: StatementRow[];
}): string {
  const header = ['Thời gian', 'Mã bút toán', 'Loại', 'Nghiệp vụ', 'Ghi chú', 'Số tiền', 'Chiều'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of input.rows) {
    lines.push(
      [
        formatTime(row.time),
        row.transactionId,
        row.type,
        row.reference,
        row.note,
        row.amount,
        row.direction,
      ]
        .map((value) => csvCell(String(value ?? '')))
        .join(','),
    );
  }
  lines.push(`# Kỳ: ${input.from} → ${input.to}`);
  // BOM so Excel detects UTF-8 Vietnamese text.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function toAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '?');
}

function pdfText(text: string): string {
  return text.replace(/[\\()]/g, (match) => `\\${match}`);
}

function text(x: number, y: number, size: number, font: 'F1' | 'F2', value: string): string {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(
    toAscii(value),
  )}) Tj ET\n`;
}

function truncate(value: string, length: number): string {
  const ascii = toAscii(value);
  return ascii.length > length ? `${ascii.slice(0, length - 3)}...` : ascii;
}

function rightAligned(right: number, size: number, value: string): number {
  // Helvetica digits/letters average ~0.52em; good enough for a statement.
  return Math.max(40, right - value.length * size * 0.52);
}

export function buildStatementPdf(input: {
  wallet: StatementSummary;
  from: string;
  to: string;
  rows: StatementRow[];
}): Buffer {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const bottom = 50;
  const rowHeight = 20;
  const tableTop = 690;
  const rowsPerPage = Math.floor((tableTop - bottom) / rowHeight);

  const chunks: StatementRow[][] = [];
  if (input.rows.length === 0) chunks.push([]);
  for (let index = 0; index < input.rows.length; index += rowsPerPage) {
    chunks.push(input.rows.slice(index, index + rowsPerPage));
  }

  const contents = chunks.map((rows, page) => {
    let stream = '';
    let y = pageHeight - margin;

    stream += text(margin, y, 16, 'F2', 'CVC WALLET STATEMENT');
    y -= 22;
    stream += text(
      margin,
      y,
      9,
      'F1',
      `Period: ${input.from} -> ${input.to}   Currency: ${input.wallet.currency}`,
    );
    y -= 14;
    stream += text(margin, y, 9, 'F1', `User: ${input.wallet.userId}`);
    y -= 14;
    stream += text(
      margin,
      y,
      9,
      'F1',
      `Total: ${input.wallet.balance}   Held: ${input.wallet.held}   Available: ${input.wallet.available}`,
    );
    y -= 26;

    stream += text(margin, y, 8, 'F2', 'TIME / TYPE');
    stream += text(220, y, 8, 'F2', 'REFERENCE');
    stream += text(rightAligned(500, 8, 'AMOUNT'), y, 8, 'F2', 'AMOUNT');
    stream += text(520, y, 8, 'F2', 'IN/OUT');
    y -= 14;

    if (rows.length === 0) {
      stream += text(margin, y, 9, 'F1', 'No transactions in this period.');
    }
    for (const row of rows) {
      stream += text(margin, y, 8, 'F1', `${formatTime(row.time)}  ${row.type}`);
      stream += text(
        margin,
        y - 9,
        7,
        'F1',
        truncate(row.reference || row.note || row.transactionId, 90),
      );
      stream += text(rightAligned(500, 8, row.amount), y, 8, 'F2', row.amount);
      stream += text(520, y, 8, 'F1', row.direction);
      y -= rowHeight;
    }

    const totalIn = input.rows
      .filter((row) => row.direction === 'IN')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const totalOut = input.rows
      .filter((row) => row.direction === 'OUT')
      .reduce((sum, row) => sum + Number(row.amount), 0);
    stream += text(
      margin,
      bottom,
      8,
      'F1',
      `Money in: ${totalIn.toFixed(2)}   Money out: ${totalOut.toFixed(2)}   Page ${page + 1}/${chunks.length}`,
    );
    stream += text(pageWidth - margin - 120, bottom, 8, 'F1', 'CVC - generated statement');
    return stream;
  });

  const objects: string[] = [];
  const pageObjectNumbers = contents.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers
    .map((number) => `${number} 0 R`)
    .join(' ')}] /Count ${contents.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  contents.forEach((stream, index) => {
    const pageNumber = 5 + index * 2;
    const contentNumber = pageNumber + 1;
    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] =
      `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`;
  });

  let document = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = Buffer.byteLength(document, 'ascii');
    document += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length}\n`;
  document += '0000000000 65535 f \n';
  for (let number = 1; number < objects.length; number += 1) {
    document += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, 'ascii');
}
