import { PLATFORM_FEE_BASIS_POINTS, contractBillingTerms, type BillingTerms } from "../../../shared/billing.ts";
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
  return config.enabled ? contractBillingTerms({ feeBasisPoints: config.feeBasisPoints, collectionNotice: config.collectionNotice }) : undefined;
}

export function billingReadiness(read: Env = env) {
  const config = billingConfig(read);
  const creditor = readQrCreditor(read);
  const pingenConfigured=Boolean(read("PINGEN_CLIENT_ID")&&read("PINGEN_CLIENT_SECRET")&&read("PINGEN_ORGANISATION_ID"));
  return {
    enabled: config.enabled,
    feeBasisPoints: PLATFORM_FEE_BASIS_POINTS,
    payoutSchedule: "monthly" as const,
    interestBasisPoints: 0,
    operatorConfigured: Boolean(config.operator),
    // A login email is not API access. Never expose secrets to the browser.
    pingenConfigured,
    pingenEnvironment: read("PINGEN_ENVIRONMENT") === "production" ? "production" : "staging",
    invoiceIssuingEnabled: Boolean(creditor),
    qrAccountConfigured: Boolean(creditor),
    postalSendingEnabled:pingenConfigured&&read("PINGEN_POSTAL_ENABLED")==="true",
    postageCostBearer:"club" as const,
    postageBilling:"deduct_from_monthly_payout" as const,
    pingenWebhookConfigured:Boolean(read("PINGEN_WEBHOOK_SECRET")),
    blockers: [...(!creditor ? ["Gültige QR-IBAN und strukturierte Kontoinhaberadresse fehlen für die Rechnungsfreigabe."] : []),
      ...(!pingenConfigured?["Pingen-API-Zugang des zentralen Kontos fehlt noch."]:[]),
      ...(read("PINGEN_POSTAL_ENABLED")!=="true"?["Pingen-Testversand und Versandfreigabe stehen noch aus."]:[]),
      ...(!read("PINGEN_WEBHOOK_SECRET")?["Automatische Versandstatusmeldungen sind noch nicht verbunden."]:[])],
  };
}
