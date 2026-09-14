import { useEffect, useState } from "react";

type Access = {
  accounts: Array<{ email: string; created_at: string }>;
  invitations: Array<{
    id: string; email: string; delivery_status: "pending" | "sent" | "failed";
    sent_at: string | null; accepted_at: string | null; expires_at: string;
  }>;
};

const errorLabels: Record<string, string> = {
  authentication_required: "Bitte melden Sie sich erneut an.",
  permission_denied: "Für diese Einladung fehlt die Berechtigung.",
  sponsor_not_found: "Der Sponsor wurde nicht gefunden.",
  invalid_contact_email: "Bitte eine gültige Empfängeradresse eintragen.",
  invitation_recently_sent: "Die Einladung wird gerade versendet oder wurde soeben versendet. Bitte warten Sie kurz und aktualisieren Sie den Status.",
  sponsor_access_delivery_failed: "Die Einladung konnte nicht versendet werden. Bitte versuchen Sie es erneut.",
};

async function requestApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich",
}).format(new Date(value));

export function SponsorAccessPanel({ tenantId, sponsorId, contactEmail }: {
  tenantId: string; sponsorId: string; contactEmail: string | null;
}) {
  const [email, setEmail] = useState(contactEmail ?? "");
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/api/sponsors/${tenantId}/${sponsorId}/access`;

  const refresh = async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await requestApi<Access>(path, { signal });
      if (!signal?.aborted) setAccess(result);
    } catch (reason) {
      if (!signal?.aborted) setLoadError(reason instanceof Error && errorLabels[reason.message]
        || "Der Zugangsstatus konnte nicht geladen werden.");
    } finally { if (!signal?.aborted) setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [path]);

  const send = async (recipient: string) => {
    setSending(true); setError(""); setMessage("");
    try {
      const result = await requestApi<{ email: string }>(path, { method: "POST", body: JSON.stringify({ email: recipient }) });
      setMessage(`Einladung an ${result.email} versendet.`);
    } catch (reason) {
      setError(reason instanceof Error && errorLabels[reason.message] || "Die Einladung konnte nicht eingerichtet werden.");
    } finally {
      await refresh();
      setSending(false);
    }
  };

  const knownEmail = access?.invitations.some((item) => item.email.toLowerCase() === email.trim().toLowerCase())
    || access?.accounts.some((item) => item.email.toLowerCase() === email.trim().toLowerCase());

  return <section className="sponsor-access-panel" aria-label="Zugang zum Sponsor-Space">
    <div><p className="eyebrow">Sponsor-Space</p><h3>Zugang einrichten</h3><p>Laden Sie eine Kontaktperson ein, Dokumente einzusehen sowie Adresse und Logo zu verwalten. Das funktioniert auch ohne digitalen Vertragsabschluss.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); void send(email); }}>
      <label><span>E-Mail für die Einladung</span><input required type="email" maxLength={320} value={email} disabled={sending} onChange={(event) => { setEmail(event.target.value); setError(""); setMessage(""); }} placeholder="kontakt@firma.ch"/></label>
      <p className="sponsor-access-note">Prüfen Sie die Empfängeradresse vor dem Versand. Die Person erhält Zugang zu diesem Sponsor. Sie erstellt ihr Konto selbst oder meldet sich mit ihrem bestehenden Konto an. Die Kontakt-E-Mail in den Stammdaten bleibt unverändert.</p>
      <button className="access-primary" disabled={sending || loading || Boolean(loadError)}>{sending ? "Einladung wird versendet …" : knownEmail ? "Einladung erneut senden" : "Einladung senden"}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    <div className="sponsor-access-status-heading"><h4>Zugänge und Einladungen</h4><button type="button" className="sponsor-edit" disabled={sending || loading} onClick={() => void refresh()}>Status aktualisieren</button></div>
    {loading && <p role="status">Status wird geladen …</p>}
    {access && <>
      {access.accounts.length === 0 && access.invitations.length === 0 && <p>Noch kein Zugang und keine direkte Einladung vorhanden.</p>}
      {access.accounts.length > 0 && <ul className="sponsor-access-list">{access.accounts.map((account, index) => <li key={`${account.email}:${index}`}><div><strong>{account.email}</strong><span>Zugang aktiv</span></div></li>)}</ul>}
      <ul className="sponsor-access-list">{access.invitations.map((invitation) => <li key={invitation.id}>
        <div><strong>{invitation.email}</strong><span>{invitation.delivery_status === "failed" ? "Versand fehlgeschlagen" : invitation.delivery_status === "pending" ? "Versand wird vorbereitet" : invitation.accepted_at ? "Einladung angenommen" : new Date(invitation.expires_at).getTime() <= Date.now() ? "Einladung abgelaufen" : "Einladung versendet – Annahme ausstehend"}</span>
          {invitation.sent_at && <small>Zuletzt versendet: {formatDate(invitation.sent_at)}</small>}
          {!invitation.accepted_at && invitation.delivery_status === "sent" && <small>Gültig bis: {formatDate(invitation.expires_at)}</small>}
        </div>
        <button type="button" className="sponsor-edit" disabled={sending || loading || Boolean(loadError)} onClick={() => { setEmail(invitation.email); void send(invitation.email); }} aria-label={`Einladung an ${invitation.email} erneut senden`}>Erneut senden</button>
      </li>)}</ul>
    </>}
  </section>;
}
