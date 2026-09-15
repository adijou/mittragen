// Explicit self-service allowlist shared by the form and API. New fields require
// an intentional entry here and a database column; arbitrary fields stay blocked.
type ContactField = { label: string; maxLength: number; type: string; autoComplete: string; required?: boolean; wide?: boolean; placeholder?: string; error: string };
export const sponsorContactFields = {
  legal_name: { label: "Firmen- / Sponsorname", maxLength: 160, type: "text", autoComplete: "organization", required: true, wide: true, error: "Bitte den Firmen- oder Sponsornamen eintragen (maximal 160 Zeichen)." },
  contact_name: { label: "Name der Kontaktperson", maxLength: 160, type: "text", autoComplete: "name", wide: true, error: "Der Name der Kontaktperson darf maximal 160 Zeichen enthalten." },
  contact_email: { label: "Kontakt-E-Mail", maxLength: 254, type: "email", autoComplete: "email", error: "Bitte eine gültige Kontakt-E-Mail-Adresse eintragen." },
  phone: { label: "Telefon", maxLength: 80, type: "tel", autoComplete: "tel", error: "Bitte eine Telefonnummer mit maximal 80 Zeichen eintragen." },
  website: { label: "Website", maxLength: 500, type: "text", autoComplete: "url", wide: true, placeholder: "www.beispiel.ch", error: "Bitte eine gültige Website-Adresse eintragen, zum Beispiel www.beispiel.ch." },
} satisfies Record<string, ContactField>;
export type SponsorContactKey = keyof typeof sponsorContactFields;
export type SponsorContact = { legal_name: string } & Record<Exclude<SponsorContactKey, "legal_name">, string | null>;
export const sponsorContactKeys = Object.keys(sponsorContactFields) as SponsorContactKey[];
export const sponsorContactEntries = Object.entries(sponsorContactFields) as Array<[SponsorContactKey, ContactField]>;

export function pickSponsorContact(source: SponsorContact): SponsorContact {
  return Object.fromEntries(sponsorContactKeys.map((key) => [key, source[key]])) as SponsorContact;
}

export function normalizeSponsorWebsite(input: string): string | null {
  const text = input.trim();
  if (!text || /\s/.test(text) || /[\u0000-\u001f\u007f\\]/.test(text)) return null;
  // Bare domains are convenient; explicit non-HTTP schemes are never accepted.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || !url.hostname.includes(".") || url.hostname.startsWith(".") || url.hostname.endsWith(".")) return null;
    return candidate;
  } catch { return null; }
}
