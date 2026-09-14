import { useEffect, useState } from "react";

export type SponsorAddress = { street: string | null; postal_code: string | null; city: string | null };

const errorLabels: Record<string, string> = {
  invalid_street: "Bitte eine Strasse mit Hausnummer eintragen (maximal 200 Zeichen).",
  invalid_postal_code: "Bitte eine gültige Postleitzahl eintragen (maximal 30 Zeichen).",
  invalid_city: "Bitte einen Ort eintragen (maximal 120 Zeichen).",
  sponsor_address_conflict: "Die Adresse wurde inzwischen geändert. Laden Sie den Space neu und prüfen Sie die aktuelle Adresse, bevor Sie erneut speichern.",
  sponsor_access_denied: "Sie haben keinen Zugriff auf diese Sponsorenadresse.",
  authentication_required: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
};

export function SponsorAddressForm({ tenantId, sponsorId, legalName, address, disabled, onBusyChange, onSaved }: {
  tenantId: string; sponsorId: string; legalName: string; address: SponsorAddress; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onSaved: (address: SponsorAddress) => void;
}) {
  const [street, setStreet] = useState(address.street ?? "");
  const [postalCode, setPostalCode] = useState(address.postal_code ?? "");
  const [city, setCity] = useState(address.city ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStreet(address.street ?? ""); setPostalCode(address.postal_code ?? ""); setCity(address.city ?? "");
  }, [address.street, address.postal_code, address.city]);

  const changed = street.trim() !== (address.street ?? "")
    || postalCode.trim() !== (address.postal_code ?? "") || city.trim() !== (address.city ?? "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/sponsor-portal/${tenantId}/${sponsorId}/address`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ street, postal_code: postalCode, city, original: address }),
      });
      const body = await response.json().catch(() => ({})) as { address?: SponsorAddress; error?: string };
      if (!response.ok || !body.address) throw new Error(body.error ?? "address_save_failed");
      onSaved(body.address);
      setMessage("Ihre Adresse wurde gespeichert.");
    } catch (reason) {
      setError(errorLabels[reason instanceof Error ? reason.message : ""] ?? "Die Adresse konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.");
    } finally { setSaving(false); onBusyChange(false); }
  };

  return <section className="sponsor-address">
    <header><p className="eyebrow">Ihre Angaben</p><h2>Adresse verwalten</h2><p>{legalName}</p></header>
    <form onSubmit={save} onChange={() => { setError(""); setMessage(""); }}>
      <label className="sponsor-address__street"><span>Strasse und Hausnummer</span><input required maxLength={200} autoComplete="street-address" value={street} disabled={disabled} onChange={(event) => setStreet(event.target.value)}/></label>
      <label><span>Postleitzahl</span><input required maxLength={30} autoComplete="postal-code" value={postalCode} disabled={disabled} onChange={(event) => setPostalCode(event.target.value)}/></label>
      <label><span>Ort</span><input required maxLength={120} autoComplete="address-level2" value={city} disabled={disabled} onChange={(event) => setCity(event.target.value)}/></label>
      <p className="sponsor-address__note">Diese Adresse wird für Ihre aktuellen Stammdaten übernommen. Bereits unterzeichnete Verträge behalten die zum Abschluss gültige Adresse.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="access-primary" disabled={disabled || !changed} type="submit">{saving ? "Wird gespeichert …" : "Adresse speichern"}</button>
    </form>
  </section>;
}
