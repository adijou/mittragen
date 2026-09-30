import { PLATFORM_FEE_BASIS_POINTS, type BillingTerms } from "../../../shared/billing.ts";
import { readQrCreditor } from "./swiss-qr.ts";

type Env = (name: string) => string | undefined;
const env: Env = (name) => Netlify.env.get(name);

export function billingConfig(read: Env = env) {
  const operator = read("BILLING_OPERATOR_NAME")?.trim() ?? "";
  const enabled = read("BILLING_ENABLED") === "true" && Boolean(operator);
  return {
    enabled,
    operator,
    feeBasisPoints: enabled ? PLATFORM_FEE_BASIS_POINTS : 0,
    collectionNotice: enabled
      ? `Der Sponsoringbeitrag steht dem Verein zu. ${operator} (mittragen.ch) zieht die Zahlung im Auftrag des Vereins ein. Zusätzlich werden 2.5 % Plattformgebühr verrechnet. Der Vereinsanteil wird monatlich abgerechnet.`
      : "",
  };
}

export function newBillingTerms(read?: Env): BillingTerms | undefined {
  const config = billingConfig(read);
  return config.enabled ? { feeBasisPoints: config.feeBasisPoints, collectionNotice: config.collectionNotice } : undefined;
}

export function billingReadiness(read: Env = env) {
  const config = billingConfig(read);
  const creditor = readQrCreditor(read);
  return {
    enabled: config.enabled,
    feeBasisPoints: PLATFORM_FEE_BASIS_POINTS,
    payoutSchedule: "monthly" as const,
    interestBasisPoints: 0,
    operatorConfigured: Boolean(config.operator),
    // A login email is not API access. Never expose secrets to the browser.
    pingenConfigured: Boolean(read("PINGEN_CLIENT_ID") && read("PINGEN_CLIENT_SECRET") && read("PINGEN_ORGANISATION_ID")),
    pingenEnvironment: read("PINGEN_ENVIRONMENT") === "production" ? "production" : "staging",
    invoiceIssuingEnabled: Boolean(creditor),
    qrAccountConfigured: Boolean(creditor),
    postalSendingEnabled: false,
    blockers: [...(!creditor ? ["Gültige QR-IBAN und strukturierte Kontoinhaberadresse fehlen für die Rechnungsfreigabe."] : []),
      "Pingen-Zugang und Testversand müssen vor dem Postversand eingerichtet und geprüft werden.",
      "Versandkosten werden separat geführt. Kostenträger und Kostenfreigabe sind noch festzulegen."],
  };
}
