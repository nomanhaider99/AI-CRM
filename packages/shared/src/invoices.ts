// Invoice math shared by the API (the source of truth for stored totals) and the web form (live totals),
// so both always agree. Amounts are computed in integer cents to avoid floating point drift.

/** Largest value numeric(12,2) holds, in cents. */
export const MAX_MONEY_CENTS = 999_999_999_999n;

export interface InvoiceLine {
  qty: number;
  unitPrice: number;
}

const cents = (n: number) => BigInt(Math.round(n * 100));

/** qty × unit price, rounded half up to the cent (both inputs carry at most 2 decimals). */
export const lineTotalCents = (line: InvoiceLine) => (cents(line.qty) * cents(line.unitPrice) + 50n) / 100n;

/** "1234.50" for 123450n: the exact decimal string the DB stores. */
export function centsToDecimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export const centsToNumber = (value: bigint) => Number(centsToDecimal(value));

/** Line totals and the invoice total. The total is the sum of the rounded line totals. */
export function invoiceTotals(lines: readonly InvoiceLine[]) {
  const lineCents = lines.map(lineTotalCents);
  const totalCents = lineCents.reduce((sum, c) => sum + c, 0n);
  return {
    lines: lineCents.map(centsToNumber),
    totalCents,
    total: centsToNumber(totalCents),
    withinLimit: totalCents <= MAX_MONEY_CENTS,
  };
}

/** INV-0001. Four digits minimum; the sequence keeps counting past 9999. */
export const formatInvoiceNumber = (seq: number) => `INV-${String(seq).padStart(4, "0")}`;
