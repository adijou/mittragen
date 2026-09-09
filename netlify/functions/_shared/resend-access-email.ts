const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ExistingUserAccessEmail = {
  email: string;
  organizationName: string;
  roleLabel: string;
  loginUrl: string;
};

export type ResendAccessEmailConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  fetcher?: Fetcher;
};

export class ResendDeliveryError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ResendDeliveryError";
    this.status = status;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function buildEmail(input: ExistingUserAccessEmail) {
  const email = escapeHtml(input.email);
  const organizationName = escapeHtml(input.organizationName);
  const roleLabel = escapeHtml(input.roleLabel);
  const loginUrl = escapeHtml(input.loginUrl);
  const subject = `Ihr Zugang zu ${input.organizationName} auf Mittragen`;

  const html = `<!doctype html>
<html lang="de">
  <body style="margin:0;background:#f4f5f1;color:#173127;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f1;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dfe5df;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:26px 32px;background:#173127;color:#ffffff;">
            <div style="font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#cbe8d8;">MITTRAGEN</div>
            <div style="margin-top:8px;font-size:24px;font-weight:700;line-height:1.25;">Gemeinsam Unterstützung organisieren.</div>
          </td></tr>
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 18px;font-size:25px;line-height:1.3;color:#173127;">Ihr Zugang ist bereit</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.65;">Sie wurden eingeladen, im Mittragen-Workspace «${organizationName}» als <strong>${roleLabel}</strong> mitzuwirken.</p>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.65;">Für ${email} besteht bereits ein Konto. Sie müssen deshalb kein neues Passwort setzen.</p>
            <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="border-radius:10px;background:#1f7a50;">
              <a href="${loginUrl}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;text-decoration:none;color:#ffffff;">Bei Mittragen anmelden</a>
            </td></tr></table>
            <p style="margin:24px 0 0;font-size:14px;line-height:1.65;color:#53655d;">Beim Öffnen des Workspaces wird Ihr Organisationszugang automatisch aktiviert.</p>
            <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#6a7771;word-break:break-all;">Falls die Schaltfläche nicht funktioniert:<br><a href="${loginUrl}" style="color:#1f7a50;">${loginUrl}</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `Ihr Zugang zu ${input.organizationName} auf Mittragen\n\nSie wurden eingeladen, im Mittragen-Workspace «${input.organizationName}» als ${input.roleLabel} mitzuwirken.\n\nFür ${input.email} besteht bereits ein Konto. Sie müssen deshalb kein neues Passwort setzen.\n\nBei Mittragen anmelden: ${input.loginUrl}\n\nBeim Öffnen des Workspaces wird Ihr Organisationszugang automatisch aktiviert.`;

  return { subject, html, text };
}

export async function sendExistingUserAccessEmail(input: ExistingUserAccessEmail, config: ResendAccessEmailConfig): Promise<string> {
  const fetcher = config.fetcher ?? fetch;
  const content = buildEmail(input);
  const payload: Record<string, unknown> = {
    from: config.from,
    to: [input.email],
    subject: content.subject,
    html: content.html,
    text: content.text,
  };
  if (config.replyTo) payload.reply_to = config.replyTo;

  const response = await fetcher(RESEND_EMAILS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new ResendDeliveryError(`resend_${response.status}`, response.status);
  const body = await response.json().catch(() => ({})) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) throw new ResendDeliveryError("resend_invalid_response", response.status);
  return body.id;
}
