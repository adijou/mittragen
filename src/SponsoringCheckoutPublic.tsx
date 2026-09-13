import { useEffect, useMemo, useState } from "react";
import { Brand } from "./ProductBrand";

type CheckoutPackage = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMonths: number;
  paymentPlan: string;
  paymentTerms: string | null;
  contractStart: string;
  contractEnd: string;
  availableQuantity: number | null;
  rights: Array<{ name: string; description: string | null; quantity: number; scheduleText: string | null; channel: string | null; location: string | null }>;
};

type CheckoutData = {
  organization: {
    name: string; legalName: string | null; street: string | null; postalCode: string | null; city: string | null;
    representativeName: string | null; representativeTitle: string | null; contactName: string | null;
    contactEmail: string | null; contactPhone: string | null; website: string | null;
    brandPrimaryColor: string; brandAccentColor: string; logoAvailable: boolean;
  };
  profile: { headline: string; seasonLabel: string | null; introduction: string; clubPortrait: string | null; sponsorshipImpact: string | null; audience: string | null };
  terms: { renewalMode: "manual" | "annual_auto"; noticeMonths: number | null; placeOfJurisdiction: string | null };
  contractReady: boolean;
  packages: CheckoutPackage[];
};

type FormState = {
  legalName: string; street: string; postalCode: string; city: string; website: string;
  contactName: string; contactEmail: string; contactPhone: string;
  differentSigner: boolean; signerName: string; signerEmail: string; signerRole: string;
  contractTermsAccepted: boolean; authorityConfirmed: boolean; websiteTrap: string;
};

const emptyForm: FormState = {
  legalName: "", street: "", postalCode: "", city: "", website: "", contactName: "", contactEmail: "", contactPhone: "",
  differentSigner: false, signerName: "", signerEmail: "", signerRole: "", contractTermsAccepted: false, authorityConfirmed: false, websiteTrap: "",
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat("de-CH").format(new Date(`${value}T12:00:00`));
const paymentLabel = (value: string) => ({ annual: "jährlich", semiannual: "halbjährlich", quarterly: "quartalsweise", custom: "gemäss Vereinbarung" }[value] ?? value);

async function getJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

function errorText(code: string) {
  const messages: Record<string, string> = {
    checkout_package_not_available: "Dieses Paket ist nicht mehr für den Online-Abschluss verfügbar. Bitte Seite neu laden.",
    package_capacity_exceeded: "Dieses Paket ist inzwischen vollständig vergeben.",
    package_exclusivity_conflict: "Eine exklusive Leistung dieses Pakets ist inzwischen vergeben.",
    checkout_contract_exists: "Für diese Organisation und dieses Paket besteht bereits ein Vertrag. Bitte wenden Sie sich direkt an den Klub.",
    checkout_sponsor_inactive: "Der Abschluss kann nicht automatisch verarbeitet werden. Bitte wenden Sie sich direkt an den Klub.",
    checkout_delivery_failed: "Der Vertrag wurde erstellt, aber die Bestätigungs-E-Mail konnte nicht versendet werden. Bitte nennen Sie dem Klub die angezeigte Referenz.",
    contract_identity_lookup_failed: "Der Kontostatus konnte gerade nicht geprüft werden. Bitte versuchen Sie es später erneut.",
    checkout_rate_limited: "Es wurden in kurzer Zeit zu viele Abschlüsse angefordert. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Klub.",
  };
  return messages[code] ?? "Der Abschluss konnte nicht verarbeitet werden. Bitte prüfen Sie Ihre Angaben oder versuchen Sie es später erneut.";
}

export function SponsoringCheckoutPublic() {
  const publicKey = window.location.pathname.match(/^\/sponsoring\/([0-9a-f]{36})\/?$/i)?.[1]?.toLowerCase() ?? "";
  const [data, setData] = useState<CheckoutData | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [startedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [success, setSuccess] = useState<{ contractNumber: string; deliveryMode: "account" | "one_time"; signerEmail?: string } | null>(null);
  const selected = useMemo(() => data?.packages.find((item) => item.id === selectedId) ?? null, [data, selectedId]);

  useEffect(() => {
    if (!publicKey) { setLoading(false); setError("sponsoring_checkout_link_invalid"); return; }
    void getJson<{ checkout: CheckoutData }>(`/api/sponsoring-checkout/${publicKey}`)
      .then((result) => { setData(result.checkout); setSelectedId(result.checkout.packages.find((item) => item.availableQuantity !== 0)?.id ?? ""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "sponsoring_checkout_load_failed"))
      .finally(() => setLoading(false));
  }, [publicKey]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(""); setReference("");
    try {
      const website = form.website.trim() && !/^https?:\/\//i.test(form.website) ? `https://${form.website.trim()}` : form.website.trim() || null;
      const { differentSigner, ...fields } = form;
      const result = await getJson<{ checkout: { reference: string; contractNumber: string; deliveryMode: "account" | "one_time"; signerEmail?: string } }>(`/api/sponsoring-checkout/${publicKey}/submit`, {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          website,
          signerIsContact: !differentSigner,
          signerName: differentSigner ? form.signerName : form.contactName,
          signerEmail: differentSigner ? form.signerEmail : form.contactEmail,
          signerRole: differentSigner ? form.signerRole : "",
          packageVersionId: selected.id,
          idempotencyKey,
          startedAt,
        }),
      });
      setReference(result.checkout.reference);
      setSuccess(result.checkout);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsoring_checkout_submit_failed";
      setError(code);
    } finally { setBusy(false); }
  };

  if (loading) return <main className="checkout-public checkout-public--state"><p>Sponsoringangebote werden geladen …</p></main>;
  if (!data) return <main className="checkout-public checkout-public--state"><h1>Link nicht verfügbar</h1><p>Dieser Sponsoringlink ist ungültig oder nicht mehr verfügbar.</p></main>;

  const style = { "--club-primary": data.organization.brandPrimaryColor, "--club-accent": data.organization.brandAccentColor } as React.CSSProperties;
  return <main className="checkout-public" style={style}>
    <header className="checkout-public__header"><a href="/" className="checkout-public__platform" aria-label="Zur mittragen.ch Startseite"><Brand compact/></a><div className="checkout-public__club">{data.organization.logoAvailable ? <img src={`/api/sponsoring-checkout/${publicKey}/logo`} alt={`Logo ${data.organization.name}`}/> : <span>{data.organization.name.slice(0, 2).toUpperCase()}</span>}<strong>{data.organization.name}</strong></div></header>

    <section className="checkout-public__hero"><div><p className="eyebrow">Sponsoringpartnerschaft</p><h1>{data.profile.headline}</h1><p>{data.profile.introduction}</p>{data.profile.seasonLabel && <span>{data.profile.seasonLabel}</span>}</div></section>

    {success ? <section className="checkout-success"><span aria-hidden="true">✓</span><p className="eyebrow">Vertrag {success.contractNumber}</p><h2>Bitte jetzt per E-Mail bestätigen</h2><p>{success.deliveryMode === "account" ? "Für diese E-Mail-Adresse besteht bereits ein mittragen.ch-Konto. Die Nachricht führt zur Anmeldung und anschliessenden Bestätigung im Sponsorportal." : "Sie erhalten einen sieben Tage gültigen Einmallink. Dort können Sie den Vertrag als PDF prüfen und verbindlich bestätigen."}</p><dl><div><dt>Referenz</dt><dd>{reference}</dd></div><div><dt>E-Mail</dt><dd>{success.signerEmail || (form.differentSigner ? form.signerEmail : form.contactEmail)}</dd></div></dl><p>Keine Nachricht erhalten? Bitte Spam-Ordner prüfen und dem Klub die Referenz mitteilen.</p></section> : <>
      <section className="checkout-public__catalog"><div className="checkout-section-heading"><p className="eyebrow">1 · Paket wählen</p><h2>So möchten Sie mittragen</h2><p>Preise, Laufzeiten und Leistungen sind vom Klub verbindlich freigegeben.</p></div>{data.packages.length === 0 ? <div className="checkout-empty"><strong>Aktuell ist kein Paket online abschliessbar.</strong><p>Bitte wenden Sie sich direkt an {data.organization.contactName || data.organization.name}.</p></div> : <div className="checkout-packages">{data.packages.map((item) => <label className={`checkout-package ${selectedId === item.id ? "checkout-package--selected" : ""} ${item.availableQuantity === 0 ? "checkout-package--sold" : ""}`} key={item.id}><input type="radio" name="package" value={item.id} disabled={item.availableQuantity === 0} checked={selectedId === item.id} onChange={() => setSelectedId(item.id)}/><span className="checkout-package__select">{item.availableQuantity === 0 ? "Vergeben" : selectedId === item.id ? "Gewählt" : "Wählen"}</span><h3>{item.name}</h3><strong>{formatChf(item.priceCents)}</strong><small>{paymentLabel(item.paymentPlan)} · {item.durationMonths} Monate</small>{item.description && <p>{item.description}</p>}<ul>{item.rights.map((right, index) => <li key={`${right.name}-${index}`}><b>✓</b><span>{right.quantity > 1 ? `${right.quantity} × ` : ""}{right.name}{right.description && <small>{right.description}</small>}</span></li>)}</ul></label>)}</div>}</section>

      {selected && <form className="checkout-form" onSubmit={submit}><section className="checkout-summary"><div className="checkout-section-heading"><p className="eyebrow">2 · Vertragsgrundlage</p><h2>{selected.name} verbindlich vorbereiten</h2></div><div className="checkout-summary__facts"><dl><div><dt>Jahresbeitrag</dt><dd>{formatChf(selected.priceCents)}</dd></div><div><dt>Laufzeit</dt><dd>{formatDate(selected.contractStart)} – {formatDate(selected.contractEnd)}</dd></div><div><dt>Zahlung</dt><dd>{paymentLabel(selected.paymentPlan)}{selected.paymentTerms ? ` · ${selected.paymentTerms}` : ""}</dd></div><div><dt>Vertragspartner</dt><dd>{data.organization.legalName}</dd></div></dl><p>{data.terms.renewalMode === "annual_auto" ? `Der Vertrag verlängert sich jeweils um ein Jahr, sofern er nicht ${data.terms.noticeMonths ?? 0} Monate vor Ablauf gekündigt wird.` : "Eine Verlängerung erfolgt nur nach neuer Vereinbarung."} Gerichtsstand: {data.terms.placeOfJurisdiction}.</p></div></section>

        <section className="checkout-form__fields"><div className="checkout-section-heading"><p className="eyebrow">3 · Ihre Angaben</p><h2>Sponsor und Unterzeichnung</h2><p>Diese Angaben werden unverändert in den Vertragsentwurf übernommen.</p></div><fieldset><legend>Organisation</legend><label className="wide"><span>Firma / Organisation</span><input required maxLength={160} autoComplete="organization" value={form.legalName} onChange={(event) => update("legalName", event.target.value)}/></label><label className="wide"><span>Strasse und Nummer</span><input required maxLength={200} autoComplete="street-address" value={form.street} onChange={(event) => update("street", event.target.value)}/></label><label><span>PLZ</span><input required maxLength={30} autoComplete="postal-code" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)}/></label><label><span>Ort</span><input required maxLength={120} autoComplete="address-level2" value={form.city} onChange={(event) => update("city", event.target.value)}/></label><label className="wide"><span>Website (optional)</span><input maxLength={500} inputMode="url" autoComplete="url" placeholder="www.beispiel.ch" value={form.website} onChange={(event) => update("website", event.target.value)}/></label></fieldset>
          <fieldset><legend>Kontaktperson</legend><label><span>Vor- und Nachname</span><input required maxLength={160} autoComplete="name" value={form.contactName} onChange={(event) => update("contactName", event.target.value)}/></label><label><span>E-Mail</span><input required maxLength={320} type="email" autoComplete="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)}/></label><label className="wide"><span>Telefon (optional)</span><input maxLength={80} type="tel" autoComplete="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)}/></label><p className="checkout-signer-note wide">Standardmässig erhält diese Kontaktperson den Vertrag zur Bestätigung und unterzeichnet ihn.</p><label className="checkout-signer-toggle wide"><input type="checkbox" checked={form.differentSigner} onChange={(event) => update("differentSigner", event.target.checked)}/><span>Eine andere Person unterzeichnet den Vertrag.</span></label></fieldset>
          {form.differentSigner && <fieldset><legend>Abweichende unterzeichnende Person</legend><label><span>Vor- und Nachname</span><input required maxLength={160} autoComplete="name" value={form.signerName} onChange={(event) => update("signerName", event.target.value)}/></label><label><span>E-Mail für Bestätigung</span><input required maxLength={320} type="email" autoComplete="email" value={form.signerEmail} onChange={(event) => update("signerEmail", event.target.value)}/></label><label className="wide"><span>Funktion (optional)</span><input maxLength={120} placeholder="z. B. Geschäftsführerin" value={form.signerRole} onChange={(event) => update("signerRole", event.target.value)}/></label></fieldset>}
          <label className="checkout-trap" aria-hidden="true"><span>Website bestätigen</span><input tabIndex={-1} autoComplete="off" value={form.websiteTrap} onChange={(event) => update("websiteTrap", event.target.value)}/></label>
          <div className="checkout-consents"><label><input type="checkbox" checked={form.contractTermsAccepted} onChange={(event) => update("contractTermsAccepted", event.target.checked)}/><span>Ich habe Paket, Preis, Laufzeit, Leistungen, Zahlungs- und Verlängerungsbedingungen geprüft und möchte den Vertrag zur abschliessenden Bestätigung erhalten.</span></label><label><input type="checkbox" checked={form.authorityConfirmed} onChange={(event) => update("authorityConfirmed", event.target.checked)}/><span>{form.differentSigner ? "Die angegebene unterzeichnende Person ist für die Organisation zeichnungs- oder abschlussberechtigt." : "Ich bin für die genannte Organisation zeichnungs- oder abschlussberechtigt."}</span></label></div>
          {error && <p className="form-error" role="alert">{errorText(error)}{reference && <> Referenz: <strong>{reference}</strong>.</>}</p>}
          <button className="checkout-submit" disabled={busy || !form.contractTermsAccepted || !form.authorityConfirmed}>{busy ? "Vertrag wird erstellt …" : "Vertrag erstellen und Bestätigung senden"}</button><small className="checkout-submit-note">Der Vertrag wird erst mit der anschliessenden Bestätigung per Konto oder Einmallink abgeschlossen.</small>
        </section></form>}
    </>}

    <footer className="checkout-public__footer"><div><strong>{data.organization.name}</strong><span>{[data.organization.street, `${data.organization.postalCode ?? ""} ${data.organization.city ?? ""}`.trim()].filter(Boolean).join(" · ")}</span></div><div>{data.organization.contactEmail && <a href={`mailto:${data.organization.contactEmail}`}>{data.organization.contactEmail}</a>}{data.organization.website && <a href={data.organization.website}>Website</a>}</div></footer>
  </main>;
}
