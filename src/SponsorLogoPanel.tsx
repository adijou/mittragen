import { useEffect, useState } from "react";

export type SponsorLogoState = { available: boolean; updatedAt: string | null };

export function SponsorLogoPreview({ src, name, available }: { src: string; name: string; available: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src, available]);
  return <span className={`sponsor-logo-preview${!available ? " sponsor-logo-preview--missing" : ""}`}>
    {available && !failed ? <img src={src} alt={`Logo ${name}`} loading="lazy" onError={() => setFailed(true)}/>
      : <span>{available ? "Nicht geladen" : "Logo fehlt"}</span>}
  </span>;
}

export function SponsorLogoPanel({ tenantId, sponsorId, name, logo, disabled, onBusyChange, onChanged }: {
  tenantId: string; sponsorId: string; name: string; logo: SponsorLogoState; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onChanged: (logo: SponsorLogoState) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/sponsors/${tenantId}/${sponsorId}/logo`;

  const save = async (remove = false) => {
    if (!remove && !file) return;
    if (!remove && file && (file.size === 0 || file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type))) {
      setError("Bitte ein PNG- oder JPEG-Logo mit maximal 2 MB auswählen."); return;
    }
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const form = new FormData();
      if (file) form.set("logo", file);
      const response = await fetch(endpoint, { method: remove ? "DELETE" : "POST", body: remove ? undefined : form, signal: AbortSignal.timeout(30000) });
      const result = await response.json().catch(() => ({})) as { error?: string; logo?: SponsorLogoState };
      if (!response.ok || !result.logo) throw new Error(result.error ?? "sponsor_logo_save_failed");
      onChanged(result.logo); setFile(null); setInputKey((key) => key + 1);
      setMessage(remove ? "Das Logo wurde entfernt." : "Das Logo wurde gespeichert und ist auch im Sponsor-Space verfügbar.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code.startsWith("invalid_logo_") ? "Bitte ein gültiges PNG- oder JPEG-Logo mit maximal 2 MB auswählen."
        : code === "sponsor_access_denied" ? "Für die Logo-Verwaltung fehlt die Berechtigung."
          : code === "authentication_required" ? "Ihre Sitzung ist abgelaufen. Bitte erneut anmelden."
            : "Das Logo konnte nicht geändert werden. Bitte versuchen Sie es erneut.");
    } finally { setBusy(false); onBusyChange(false); }
  };

  return <section className="sponsor-admin-logo" aria-label="Sponsorlogo verwalten">
    <header><SponsorLogoPreview src={`${endpoint}?v=${encodeURIComponent(logo.updatedAt ?? "current")}`} name={name} available={logo.available}/>
      <div><h3>Sponsorlogo</h3><p>{logo.available ? "Dieses Logo wird auch im Sponsor-Space verwendet." : "Für diesen Sponsor ist noch kein Logo hinterlegt."}</p></div></header>
    <label><span>{logo.available ? "Logo ersetzen" : "Logo hinzufügen"}</span><input key={inputKey} type="file" accept="image/png,image/jpeg" disabled={busy || disabled} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); setMessage(""); }}/></label>
    <small>PNG oder JPEG, maximal 2 MB.</small>
    <div className="sponsor-admin-logo__actions">
      {file && <button type="button" className="access-primary" disabled={busy || disabled} onClick={() => void save()}>{busy ? "Wird gespeichert …" : "Logo speichern"}</button>}
      {logo.available && <button type="button" className="access-secondary" disabled={busy || disabled} onClick={() => window.confirm("Möchten Sie das Logo dieses Sponsors entfernen?") && void save(true)}>Logo entfernen</button>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
  </section>;
}
