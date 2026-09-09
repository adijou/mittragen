const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SponsorInvitationEmail = {
  email: string;
  sponsorName: string;
  organizationName: string;
  campaignName: string;
  packageName: string;
  sourceValueCents: number;
  proposedValueCents: number;
  responseDeadline: string | null;
  portalUrl: string;
};

export type SponsorInvitationConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  fetcher?: Fetcher;
};

export class SponsorInvitationDeliveryError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SponsorInvitationDeliveryError";
    this.status = status;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] ?? character);
}

function formatChf(cents: number) {
  return new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
}

export function buildSponsorInvitationEmail(input: SponsorInvitationEmail) {
  const sponsor = escapeHtml(input.sponsorName);
  const organization = escapeHtml(input.organizationName);
  const campaign = escapeHtml(input.campaignName);
  const packageName = escapeHtml(input.packageName);
  const portalUrl = escapeHtml(input.portalUrl);
  const deadline = input.responseDeadline
    ? new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${input.responseDeadline}T12:00:00Z`))
    : null;
  const subject = `Ihr Sponsoringvorschlag von ${input.organizationName}`;
  const deadlineText = deadline ? ` Bitte teilen Sie uns Ihren Entscheid bis ${escapeHtml(deadline)} mit.` : "";
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f4f5f1;color:#173127;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f4f5f1"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #dfe5df;border-radius:18px;overflow:hidden"><tr><td style="padding:26px 32px;background:#173127;color:#fff"><div style="font-size:13px;font-weight:700;letter-spacing:.12em;color:#cbe8d8">MITTRAGEN</div><div style="margin-top:8px;font-size:24px;font-weight:700">Gemeinsam Zukunft mittragen.</div></td></tr><tr><td style="padding:32px"><p style="margin:0 0 8px;color:#1f7a50;font-size:13px;font-weight:700">${campaign}</p><h1 style="margin:0 0 18px;font-size:25px">Guten Tag ${sponsor}</h1><p style="font-size:16px;line-height:1.65">${organization} hat Ihren persönlichen Vorschlag für die kommende Zusammenarbeit vorbereitet.${deadlineText}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;background:#f4f7f4;border-radius:12px"><tr><td style="padding:18px"><strong>${packageName}</strong><br><span style="color:#53655d">Bisher ${escapeHtml(formatChf(input.sourceValueCents))} · Vorschlag ${escapeHtml(formatChf(input.proposedValueCents))}</span></td></tr></table><p style="font-size:16px;line-height:1.65">In Ihrem geschützten Bereich können Sie den Vorschlag annehmen, ein anderes Paket wählen, eine Beratung anfragen oder ablehnen. Verbindlich wird Ihre Wahl erst nach Ihrer ausdrücklichen Bestätigung.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#1f7a50"><a href="${portalUrl}" style="display:inline-block;padding:14px 22px;color:#fff;text-decoration:none;font-weight:700">Persönlichen Vorschlag öffnen</a></td></tr></table><p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#53655d">Melden Sie sich mit genau dieser E-Mail-Adresse an oder erstellen Sie damit Ihr persönliches Konto. Der Zugang ist zeitlich begrenzt.</p><p style="margin:16px 0 0;font-size:12px;word-break:break-all;color:#6a7771">${portalUrl}</p></td></tr></table></td></tr></table></body></html>`;
  const text = `${subject}\n\nGuten Tag ${input.sponsorName}\n\n${input.organizationName} hat Ihren persönlichen Vorschlag «${input.packageName}» vorbereitet. Bisher ${formatChf(input.sourceValueCents)}, Vorschlag ${formatChf(input.proposedValueCents)}.${deadline ? ` Bitte antworten Sie bis ${deadline}.` : ""}\n\nSie können den Vorschlag annehmen, eine Alternative wählen, Beratung anfragen oder ablehnen. Verbindlich wird Ihre Wahl erst nach Ihrer ausdrücklichen Bestätigung.\n\nVorschlag öffnen: ${input.portalUrl}\n\nMelden Sie sich mit genau dieser E-Mail-Adresse an oder erstellen Sie damit Ihr persönliches Konto.`;
  return { subject, html, text };
}

export async function sendSponsorInvitationEmail(input: SponsorInvitationEmail, config: SponsorInvitationConfig) {
  const content = buildSponsorInvitationEmail(input);
  const payload: Record<string, unknown> = { from: config.from, to: [input.email], subject: content.subject, html: content.html, text: content.text };
  if (config.replyTo) payload.reply_to = config.replyTo;
  const response = await (config.fetcher ?? fetch)(RESEND_EMAILS_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new SponsorInvitationDeliveryError(`resend_${response.status}`, response.status);
  const body = await response.json().catch(() => ({})) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new SponsorInvitationDeliveryError("resend_invalid_response", response.status);
  return body.id;
}
