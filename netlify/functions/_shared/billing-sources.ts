import type { DatabaseClient } from "./database.ts";
import type { ContractPdfData } from "./contract-pdf.ts";
import { feeCents, isDate } from "../../../shared/billing.ts";

export type InvoiceParty = { name: string; street: string; postalCode: string; city: string; country: string };
export type InvoiceSource = {
  sourceType: "event_booking" | "contract"; sourceId: string; sourceKey: string; description: string;
  recipient: InvoiceParty; issuer: InvoiceParty; contributionCents: number; feeBasisPoints: number;
  platformFeeCents: number; collectionNotice: string;
  periodStart?: string; periodEnd?: string;
};

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}
const previousDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const paymentSteps: Record<string, number> = { annual: 12, semiannual: 6, quarterly: 3 };

/** Explain the saved agreement's gaps without guessing dates, instalments or amounts. */
export function contractBillingIssues(item: ContractPdfData["package"]) {
  const issues: string[] = [];
  if (!paymentSteps[item.paymentPlan]) issues.push(item.paymentPlan === "custom"
    ? "Individueller Zahlungsplan: Fälligkeiten und Teilbeträge sind nicht für die automatische Abrechnung festgelegt."
    : "Es fehlt ein unterstützter Zahlungsplan (jährlich, halbjährlich oder quartalsweise).");
  if (!isDate(item.validFrom)) issues.push("Der Vertragsbeginn fehlt oder ist ungültig.");
  if (!isDate(item.validUntil)) issues.push("Das Vertragsende fehlt oder ist ungültig.");
  const validDuration = Number.isInteger(item.durationMonths) && item.durationMonths >= 1 && item.durationMonths <= 120;
  if (!validDuration) issues.push("Die Vertragsdauer muss zwischen 1 und 120 ganzen Monaten liegen.");
  if (!Number.isSafeInteger(item.priceCents) || item.priceCents <= 0) issues.push("Es fehlt ein gültiger positiver Jahresbeitrag.");
  if (validDuration && isDate(item.validFrom) && isDate(item.validUntil)) {
    const expectedEnd = previousDay(addMonths(item.validFrom, item.durationMonths));
    if (expectedEnd !== item.validUntil) {
      const displayDate = (date: string) => date.split("-").reverse().join(".");
      issues.push(`Laufzeit widersprüchlich: Beginn ${displayDate(item.validFrom)} und ${item.durationMonths} Monate ergeben als Ende ${displayDate(expectedEnd)}; gespeichert ist ${displayDate(item.validUntil)}.`);
    }
  }
  return issues;
}

/** Only unambiguous, dated schedules. Legacy/custom agreements require review, never guessed billing. */
export function contractInstallments(item: ContractPdfData["package"]) {
  if (contractBillingIssues(item).length || !isDate(item.validFrom)) return [];
  const step = paymentSteps[item.paymentPlan];
  const result = [];
  for (let month = 0; month < item.durationMonths; month += step) {
    const end = Math.min(month + step, item.durationMonths);
    const contributionCents = Math.round(item.priceCents * end / 12) - Math.round(item.priceCents * month / 12);
    if (contributionCents > 0) result.push({ start: addMonths(item.validFrom, month), end: previousDay(addMonths(item.validFrom, end)), contributionCents });
  }
  return result;
}

export async function billingSources(client: DatabaseClient, tenantId: string) {
  const profile = await client.query<{ name: string; street: string | null; postal_code: string | null; city: string | null; country: string | null }>(
    `SELECT COALESCE(settings.legal_name, tenant.name) name, settings.street, settings.postal_code, settings.city, settings.country
     FROM tenants tenant LEFT JOIN tenant_contract_settings settings ON settings.tenant_id=tenant.id WHERE tenant.id=$1`, [tenantId]);
  const org = profile.rows[0];
  const issuer: InvoiceParty = { name: org.name, street: org.street ?? "", postalCode: org.postal_code ?? "", city: org.city ?? "", country: org.country ?? "CH" };
  const bookings = await client.query<{ id: string; reference: string; sponsor_name: string; address: string; postal_code: string; city: string; amount_cents: number; fee_basis_points: number; collection_notice: string; team_name: string; opponent: string }>(
    `SELECT booking.*, event.team_name, event.opponent FROM event_sponsorship_bookings booking
     JOIN sponsorship_events event ON event.id=booking.event_id AND event.tenant_id=booking.tenant_id
     WHERE booking.tenant_id=$1 AND booking.status='submitted' AND booking.payment_mode='invoice'
       AND booking.amount_cents>0 AND event.status<>'cancelled' ORDER BY booking.submitted_at FOR SHARE OF booking,event`, [tenantId]);
  const sources: InvoiceSource[] = bookings.rows.map((row) => ({
    sourceType: "event_booking", sourceId: row.id, sourceKey: `event:${row.id}`,
    description: `${row.reference} · Matchball ${row.team_name} – ${row.opponent}`,
    recipient: { name: row.sponsor_name, street: row.address, postalCode: row.postal_code, city: row.city, country: "CH" }, issuer,
    contributionCents: row.amount_cents, feeBasisPoints: row.fee_basis_points,
    platformFeeCents: feeCents(row.amount_cents, row.fee_basis_points), collectionNotice: row.collection_notice,
  }));
  const contracts = await client.query<{ id: string; root_id: string; contract_number: string; package_snapshot: ContractPdfData["package"]; sponsor_snapshot: ContractPdfData["sponsor"]; organization_snapshot: ContractPdfData["organization"] }>(
    `WITH RECURSIVE family AS (
       SELECT id,id root_id FROM sponsorship_contracts WHERE tenant_id=$1 AND parent_contract_id IS NULL
       UNION ALL SELECT child.id,family.root_id FROM sponsorship_contracts child JOIN family ON child.parent_contract_id=family.id WHERE child.tenant_id=$1
     ) SELECT contract.id,family.root_id,contract_number,package_snapshot,sponsor_snapshot,organization_snapshot
     FROM sponsorship_contracts contract JOIN family ON family.id=contract.id
     WHERE tenant_id=$1 AND status='confirmed' ORDER BY contract_number,version_number DESC FOR SHARE OF contract`, [tenantId]);
  const unresolved: Array<{ reference: string; reason: string }> = [];
  for (const row of contracts.rows) {
    const periods = contractInstallments(row.package_snapshot);
    if (!periods.length) {
      const issues = contractBillingIssues(row.package_snapshot);
      unresolved.push({ reference: row.contract_number, reason: issues.length
        ? `${issues.join(" ")} Bitte die gespeicherten Vertragsangaben prüfen.`
        : "Für die gespeicherte Laufzeit ergibt sich kein abrechenbarer Betrag von mindestens einem Rappen. Bitte den Jahresbeitrag prüfen." });
      continue;
    }
    const sponsor = row.sponsor_snapshot; const club = row.organization_snapshot;
    for (const period of periods) {
      const basisPoints = row.package_snapshot.billing?.feeBasisPoints ?? 0;
      sources.push({ sourceType: "contract", sourceId: row.id,
        // Corrective versions have new numbers; the original contract id stays the billing identity.
        sourceKey: `contract:${row.root_id}:${period.start}`,
        periodStart: period.start, periodEnd: period.end,
        description: `${row.contract_number} · ${row.package_snapshot.name} · ${period.start} bis ${period.end}`,
        recipient: { name: sponsor.legalName, street: sponsor.street ?? "", postalCode: sponsor.postalCode ?? "", city: sponsor.city ?? "", country: "CH" },
        issuer: { name: club.legalName, street: club.street, postalCode: club.postalCode, city: club.city, country: club.country },
        contributionCents: period.contributionCents, feeBasisPoints: basisPoints,
        platformFeeCents: feeCents(period.contributionCents, basisPoints), collectionNotice: row.package_snapshot.billing?.collectionNotice ?? "",
      });
    }
  }
  return { sources, unresolved };
}
