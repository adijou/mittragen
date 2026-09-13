import type { ContractEmailConfig } from "./resend-contract-email.ts";

export function contractEmailConfig(): ContractEmailConfig {
  const apiKey = Netlify.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) throw new Error("resend_not_configured");
  return {
    apiKey,
    from: Netlify.env.get("MAIL_FROM")?.trim() || "mittragen.ch <noreply@news.mittragen.ch>",
    replyTo: Netlify.env.get("MAIL_REPLY_TO")?.trim() || undefined,
  };
}

export function absoluteSiteUrl(request: Request, path: string) {
  return new URL(path, Netlify.env.get("URL")?.trim() || new URL(request.url).origin).toString();
}
