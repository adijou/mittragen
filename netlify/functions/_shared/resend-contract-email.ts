const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ContractEmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  fetcher?: Fetcher;
};

export type ContractSigningEmail = {
  email: string;
  signerName: string;
  organizationName: string;
  sponsorName: string;
  contractNumber: string;
  packageName: string;
  annualValueCents: number;
  confirmationUrl: string;
  deliveryMode: "account" | "one_time";
  expiresAt: string;
};

export type ContractCopyEmail = Omit<ContractSigningEmail, "confirmationUrl" | "deliveryMode" | "expiresAt"> & {
  pdfBase64: string;
};

export type ContractAccessEmail = Pick<ContractSigningEmail, "email" | "signerName" | "organizationName" | "sponsorName"> & {
  portalUrl: string;
};

export class ContractEmailDeliveryError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ContractEmailDeliveryError";
    this.status = status;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] ?? character);
}

function formatChf(cents: number) {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
}

function emailShell(title: string, body: string) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#f4f7fb;color:#0b2142;font-family:Inter,Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dfe6ef;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 32px;background:#0b2142;color:#fff"><div style="font-size:20px;font-weight:800;letter-spacing:-.04em">mittragen<span style="color:#7fadff">.ch</span><span style="color:#f2b632"> ·</span></div><div style="margin-top:10px;font-size:24px;font-weight:700">${escapeHtml(title)}</div></td></tr><tr><td style="padding:32px">${body}</td></tr></table></td></tr></table></body></html>`;
}

export function buildContractSigningEmail(input: ContractSigningEmail) {
  const expiry = new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(input.expiresAt));
  const modeText = input.deliveryMode === "account"
    ? "Da diese E-Mail-Adresse bereits mit einem mittragen.ch-Konto verbunden ist, melden Sie sich bitte an. Ihre Identität wird über dieses Konto nachgewiesen."
    : `Für Sie wurde ein persönlicher Einmallink erstellt. Er ist bis ${escapeHtml(expiry)} gültig und kann genau für diese Vertragsbestätigung verwendet werden.`;
  const button = input.deliveryMode === "account" ? "Anmelden und bestätigen" : "Vertrag ansehen und bestätigen";
  const subject = `Sponsoringvertrag ${input.contractNumber} bestätigen`;
  const facts = `${escapeHtml(input.sponsorName)} · ${escapeHtml(input.packageName)} · ${escapeHtml(formatChf(input.annualValueCents))} pro Jahr`;
  const html = emailShell("Vertrag zur Bestätigung", `<h1 style="margin:0 0 18px;font-size:25px">Guten Tag ${escapeHtml(input.signerName)}</h1><p style="font-size:16px;line-height:1.65">${escapeHtml(input.organizationName)} hat den Sponsoringvertrag <strong>${escapeHtml(input.contractNumber)}</strong> zur Bestätigung freigegeben.</p><p style="padding:18px;background:#f4f7fb;border-radius:12px;font-size:15px">${facts}</p><p style="font-size:16px;line-height:1.65">${modeText}</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#1f6bff"><a href="${escapeHtml(input.confirmationUrl)}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font-weight:700">${button}</a></td></tr></table><p style="margin:24px 0 0;font-size:13px;color:#53657a">Öffnen Sie zuerst das PDF und bestätigen Sie danach ausdrücklich den unveränderten Vertragsstand.</p>`);
  const text = `${subject}\n\nGuten Tag ${input.signerName}\n\n${input.organizationName} hat den Sponsoringvertrag ${input.contractNumber} zur Bestätigung freigegeben.\n${input.sponsorName} · ${input.packageName} · ${formatChf(input.annualValueCents)} pro Jahr\n\n${input.deliveryMode === "account" ? "Melden Sie sich mit Ihrem bestehenden mittragen.ch-Konto an. Ihre Identität wird über dieses Konto nachgewiesen." : `Ihr persönlicher Einmallink ist bis ${expiry} gültig.`}\n\n${input.confirmationUrl}`;
  return { subject, html, text };
}

export function buildContractCopyEmail(input: ContractCopyEmail) {
  const subject = `Ihre Kopie des Sponsoringvertrags ${input.contractNumber}`;
  const html = emailShell("Ihre Vertragskopie", `<h1 style="margin:0 0 18px;font-size:25px">Guten Tag ${escapeHtml(input.signerName)}</h1><p style="font-size:16px;line-height:1.65">Im Anhang finden Sie die PDF-Kopie des bestätigten Sponsoringvertrags <strong>${escapeHtml(input.contractNumber)}</strong> zwischen ${escapeHtml(input.organizationName)} und ${escapeHtml(input.sponsorName)}.</p><p style="padding:18px;background:#f4f7f4;border-radius:12px;font-size:15px">${escapeHtml(input.packageName)} · ${escapeHtml(formatChf(input.annualValueCents))} pro Jahr</p>`);
  const text = `${subject}\n\nGuten Tag ${input.signerName}\n\nIm Anhang finden Sie die PDF-Kopie des bestätigten Sponsoringvertrags ${input.contractNumber} zwischen ${input.organizationName} und ${input.sponsorName}.`;
  return { subject, html, text };
}

export function buildContractAccessEmail(input: ContractAccessEmail) {
  const subject = `Ihr Zugang zum Sponsorbereich von ${input.organizationName}`;
  const html = emailShell("Ihr Sponsorzugang", `<h1 style="margin:0 0 18px;font-size:25px">Guten Tag ${escapeHtml(input.signerName)}</h1><p style="font-size:16px;line-height:1.65">Ihr bestehendes mittragen.ch-Konto wurde mit dem Sponsorbereich von <strong>${escapeHtml(input.sponsorName)}</strong> bei ${escapeHtml(input.organizationName)} verbunden.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#1f6bff"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font-weight:700">Sponsorbereich öffnen</a></td></tr></table>`);
  const text = `${subject}\n\nGuten Tag ${input.signerName}\n\nIhr bestehendes mittragen.ch-Konto wurde mit dem Sponsorbereich von ${input.sponsorName} bei ${input.organizationName} verbunden.\n\n${input.portalUrl}`;
  return { subject, html, text };
}

async function deliver(email: string, content: { subject: string; html: string; text: string }, config: ContractEmailConfig, attachments?: Array<Record<string, string>>) {
  const payload: Record<string, unknown> = { from: config.from, to: [email], subject: content.subject, html: content.html, text: content.text };
  if (config.replyTo) payload.reply_to = config.replyTo;
  if (attachments) payload.attachments = attachments;
  const response = await (config.fetcher ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ContractEmailDeliveryError(`resend_${response.status}`, response.status);
  const body = await response.json().catch(() => ({})) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new ContractEmailDeliveryError("resend_invalid_response", response.status);
  return body.id;
}

export function sendContractSigningEmail(input: ContractSigningEmail, config: ContractEmailConfig) {
  return deliver(input.email, buildContractSigningEmail(input), config);
}

export function sendContractCopyEmail(input: ContractCopyEmail, config: ContractEmailConfig) {
  return deliver(input.email, buildContractCopyEmail(input), config, [{ filename: `Sponsoringvertrag_${input.contractNumber}.pdf`, content: input.pdfBase64 }]);
}

export function sendContractAccessEmail(input: ContractAccessEmail, config: ContractEmailConfig) {
  return deliver(input.email, buildContractAccessEmail(input), config);
}
