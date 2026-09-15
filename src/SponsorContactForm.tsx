import { useEffect, useState } from "react";
import type { SponsorContact } from "../netlify/functions/_shared/sponsor-self-service";
export type { SponsorContact } from "../netlify/functions/_shared/sponsor-self-service";

const errorLabels: Record<string, string> = {
  invalid_legal_name: "Bitte den Firmen- oder Sponsornamen eintragen (maximal 160 Zeichen).",
  invalid_contact_name: "Der Name der Kontaktperson darf maximal 160 Zeichen enthalten.",
  invalid_contact_email: "Bitte eine gültige Kontakt-E-Mail-Adresse eintragen.",
  invalid_phone: "Bitte eine Telefonnummer mit maximal 80 Zeichen eintragen.",
  sponsor_contact_conflict: "Die Angaben wurden inzwischen geändert. Laden Sie den Space neu und prüfen Sie die aktuellen Angaben, bevor Sie erneut speichern.",
  sponsor_access_denied: "Sie haben keinen Zugriff auf diese Sponsorenangaben.",
  authentication_required: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
};

const inputValues = (contact: SponsorContact) => ({
  legal_name: contact.legal_name, contact_name: contact.contact_name ?? "",
  contact_email: contact.contact_email ?? "", phone: contact.phone ?? "",
});

export function SponsorContactForm({ tenantId, sponsorId, contact, loginEmail, disabled, onBusyChange, onSaved }: {
  tenantId: string; sponsorId: string; contact: SponsorContact; loginEmail: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onSaved: (contact: SponsorContact) => void;
}) {
  const [values, setValues] = useState(() => inputValues(contact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValues(inputValues(contact));
  }, [contact.legal_name, contact.contact_name, contact.contact_email, contact.phone]);

  const changed = (Object.keys(values) as Array<keyof SponsorContact>)
    .some((field) => values[field].trim() !== (contact[field] ?? ""));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/sponsor-portal/${tenantId}/${sponsorId}/contact`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...values, original: contact }),
      });
      const body = await response.json().catch(() => ({})) as { contact?: SponsorContact; error?: string };
      if (!response.ok || !body.contact) throw new Error(body.error ?? "contact_save_failed");
      setValues(inputValues(body.contact));
      onSaved(body.contact);
      setMessage("Ihre Kontaktdaten wurden gespeichert.");
    } catch (reason) {
      setError(errorLabels[reason instanceof Error ? reason.message : ""] ?? "Die Kontaktdaten konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.");
    } finally { setSaving(false); onBusyChange(false); }
  };

  return <section className="sponsor-address sponsor-contact">
    <header><p className="eyebrow">Meine Angaben</p><h2>Name und Kontakt</h2><p>Halten Sie Ihre Angaben für die Organisation aktuell.</p></header>
    <form onSubmit={save} onChange={() => { setError(""); setMessage(""); }}>
      <label className="sponsor-address__street"><span>Firmen- / Sponsorname</span><input required maxLength={160} autoComplete="organization" value={values.legal_name} disabled={disabled} onChange={(event) => setValues({ ...values, legal_name: event.target.value })}/></label>
      <label className="sponsor-address__street"><span>Name der Kontaktperson</span><input maxLength={160} autoComplete="name" value={values.contact_name} disabled={disabled} onChange={(event) => setValues({ ...values, contact_name: event.target.value })}/></label>
      <label><span>Kontakt-E-Mail</span><input type="email" maxLength={254} autoComplete="email" aria-describedby="sponsor-contact-login-note" value={values.contact_email} disabled={disabled} onChange={(event) => setValues({ ...values, contact_email: event.target.value })}/></label>
      <label><span>Telefon</span><input type="tel" maxLength={80} autoComplete="tel" value={values.phone} disabled={disabled} onChange={(event) => setValues({ ...values, phone: event.target.value })}/></label>
      <p className="sponsor-address__note" id="sponsor-contact-login-note">Die Kontakt-E-Mail dient der Kommunikation mit der Organisation. Für die Anmeldung verwenden Sie weiterhin <strong>{loginEmail}</strong>.</p>
      <p className="sponsor-address__note">Bereits unterzeichnete Verträge behalten die zum Abschluss gültigen Angaben.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="access-primary" disabled={disabled || !changed} type="submit">{saving ? "Wird gespeichert …" : "Kontaktdaten speichern"}</button>
    </form>
  </section>;
}
