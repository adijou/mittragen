/** All amounts are CHF cents. Never calculate fees on binary floating point CHF values. */
export const PLATFORM_FEE_BASIS_POINTS = 250;
export type BillingTerms = { feeBasisPoints: number; collectionNotice: string; contractNotice?: string };
export const CONTRACT_PLATFORM_FEE_NOTICE = "Mit der Plattformgebühr tragen die Sponsoren zur Finanzierung der Infrastruktur von mittragen.ch bei und entlasten damit die Klubs.";

/** Cash is collected locally; do not show the central bank-collection instructions. */
export function matchballCollectionNotice(paymentMode:"invoice"|"cash",billing:BillingTerms) {
  return paymentMode==="invoice"?billing.collectionNotice
    :`Der Gesamtbetrag${billing.feeBasisPoints>0?" inklusive Plattformgebühr":""} wird vom Verein oder dem vermittelnden Klubmitglied bar einkassiert.`;
}

/** Freeze the contract wording separately from payment/collection instructions. */
export function contractBillingTerms(billing: BillingTerms): BillingTerms {
  return { ...billing, contractNotice: CONTRACT_PLATFORM_FEE_NOTICE };
}

export function feeCents(contributionCents: number, basisPoints = PLATFORM_FEE_BASIS_POINTS) {
  if (!Number.isSafeInteger(contributionCents) || contributionCents < 0 || contributionCents > 100_000_000
    || ![0, PLATFORM_FEE_BASIS_POINTS].includes(basisPoints)) throw new Error("invalid_billing_amount");
  return Number((BigInt(contributionCents) * BigInt(basisPoints) + 5_000n) / 10_000n);
}

export function splitReceipt(contributionCents: number, platformFeeCents: number, paidBefore: number, receivedCents: number) {
  const total = contributionCents + platformFeeCents;
  if (![contributionCents, platformFeeCents, paidBefore, receivedCents].every(Number.isSafeInteger)
    || contributionCents < 0 || platformFeeCents < 0 || paidBefore < 0 || receivedCents <= 0 || total <= 0
    || paidBefore + receivedCents > total) throw new Error("invalid_receipt_amount");
  // Differences of cumulative allocations avoid losing cents with many partial payments.
  const share = (paid: number) => Number(BigInt(paid) * BigInt(contributionCents) / BigInt(total));
  const clubCents = share(paidBefore + receivedCents) - share(paidBefore);
  return { clubCents, platformCents: receivedCents - clubCents };
}

export function parseChf(value: string): number | null {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function swissToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function closedMonth(value: unknown, today = swissToday()): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value >= "2020-01" && value < today.slice(0, 7);
}

export const formatBillingChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency", currency: "CHF", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(cents / 100);
