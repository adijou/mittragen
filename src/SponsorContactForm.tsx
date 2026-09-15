import { useEffect, useState } from "react";
import { sponsorContactEntries, sponsorContactKeys, type SponsorContact, type SponsorContactKey } from "../shared/sponsor-contact";
export type { SponsorContact } from "../shared/sponsor-contact";

const errorLabels: Record<string, string> = {
  sponsor_contact_conflict: "Die Angaben wurden inzwischen geändert. Laden Sie den Space neu und prüfen Sie die aktuellen Angaben, bevor Sie erneut speichern.",
  sponsor_access_denied: "Sie haben keinen Zugriff auf diese Sponsorenangaben.",
  authentication_required: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
};

const inputValues = (contact: SponsorContact) => Object.fromEntries(
  sponsorContactKeys.map((field) => [field, contact[field] ?? ""]),
) as Record<SponsorContactKey, string>;

export function SponsorContactForm({ fetcher = fetch, tenantId, sponsorId, contact, loginEmail, disabled, onBusyChange, onSaved }: {
  fetcher?: typeof fetch;
  tenantId: string; sponsorId: string; contact: SponsorContact; loginEmail: string; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onSaved: (contact: SponsorContact) => void;
}) {
  const contactSnapshot = JSON.stringify(contact);
  const [values, setValues] = useState(() => inputValues(contact));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValues(inputValues(JSON.parse(contactSnapshot) as SponsorContact));
  }, [contactSnapshot]);

  const changed = (Object.keys(values) as Array<keyof SponsorContact>)
    .some((field) => values[field].trim() !== (contact[field] ?? ""));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const response = await fetcher(`/api/sponsor-portal/${tenantId}/${sponsorId}/contact`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ ...values, original: contact }),
      });
      const body = await response.json().catch(() => ({})) as { contact?: SponsorContact; error?: string };
      if (!response.ok || !body.contact) throw new Error(body.error ?? "contact_save_failed");
      setValues(inputValues(body.contact));
      onSaved(body.contact);
      setMessage("Ihre Kontaktdaten wurden gespeichert.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      const fieldError = sponsorContactEntries.find(([key]) => `invalid_${key}` === code)?.[1].error;
      setError(fieldError ?? errorLabels[code] ?? "Die Kontaktdaten konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.");
    } finally { setSaving(false); onBusyChange(false); }
  };

  return <section className="sponsor-address sponsor-contact">
    <header><p className="eyebrow">Meine Angaben</p><h2>Name und Kontakt</h2><p>Halten Sie Ihre Angaben für die Organisation aktuell.</p></header>
    <form onSubmit={save} onChange={() => { setError(""); setMessage(""); }}>
      {sponsorContactEntries.map(([key, field]) => <label key={key} className={field.wide ? "sponsor-address__street" : undefined}>
        <span>{field.label}</span><input required={field.required} type={field.type} maxLength={field.maxLength} autoComplete={field.autoComplete}
          placeholder={field.placeholder} aria-describedby={key === "contact_email" ? "sponsor-contact-login-note" : undefined}
          value={values[key]} disabled={disabled} onChange={(event) => setValues({ ...values, [key]: event.target.value })}/>
      </label>)}
      <p className="sponsor-address__note" id="sponsor-contact-login-note">Die Kontakt-E-Mail dient der Kommunikation mit der Organisation. Für die Anmeldung verwenden Sie weiterhin <strong>{loginEmail}</strong>.</p>
      <p className="sponsor-address__note">Bereits unterzeichnete Verträge behalten die zum Abschluss gültigen Angaben.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="access-primary" disabled={disabled || !changed} type="submit">{saving ? "Wird gespeichert …" : "Kontaktdaten speichern"}</button>
    </form>
  </section>;
}
