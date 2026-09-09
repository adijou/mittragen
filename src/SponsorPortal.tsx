import { useEffect, useMemo, useState } from "react";
import { getUser, logout, onAuthChange, refreshSession, type User } from "@netlify/identity";

type Right = { id: string; name: string; description: string | null; quantity: number; schedule_text: string | null; channel: string | null; location: string | null };
type PackageVersion = {
  id: string; name: string; description: string | null; price_cents: number; duration_months: number;
  payment_plan: string; capacity: number | null; available_quantity: number | null; rights: Right[];
};
type Proposal = {
  id: string; campaign_name: string; target_period: string; response_deadline: string | null;
  source_package: string; source_value_cents: number; proposed_package: string; proposed_value_cents: number;
  proposed_package_version_id: string | null; status: string;
};
type Space = {
  tenantId: string;
  sponsor: { id: string; legal_name: string; contact_email: string | null; tenant_name: string };
  proposal: Proposal | null;
  catalog: PackageVersion[];
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

function PortalBrand() {
  return <div className="product-brand" aria-label="Mittragen"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="5.5" r="4.5" className="product-brand__blue"/><circle cx="34.5" cy="13" r="4.5" className="product-brand__gold"/><circle cx="34.5" cy="29" r="4.5" className="product-brand__blue"/><circle cx="21" cy="36.5" r="4.5" className="product-brand__gold"/><circle cx="7.5" cy="29" r="4.5" className="product-brand__blue"/><circle cx="7.5" cy="13" r="4.5" className="product-brand__gold"/><circle cx="21" cy="21" r="6" className="product-brand__center"/></svg><span>mittragen</span></div>;
}

export function SponsorPortal({ onHome, onLogin }: { onHome: () => void; onLogin: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async (currentUser: User) => {
    await api<{ claimed: number }>("/api/sponsor-portal/claim", { method: "POST", body: "{}" });
    const result = await api<{ spaces: Space[] }>("/api/sponsor-portal");
    setSpaces(result.spaces);
    const first = result.spaces[0];
    setSelectedSpaceKey((current) => current || (first ? `${first.tenantId}:${first.sponsor.id}` : ""));
    setUser(currentUser);
  };

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        await refreshSession();
        const currentUser = await getUser();
        if (!active) return;
        setUser(currentUser);
        if (currentUser) await load(currentUser);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Der Sponsorbereich konnte nicht geladen werden.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    const unsubscribe = onAuthChange((_event, currentUser) => setUser(currentUser));
    return () => { active = false; unsubscribe(); };
  }, []);

  const space = useMemo(() => spaces.find((item) => `${item.tenantId}:${item.sponsor.id}` === selectedSpaceKey) ?? spaces[0] ?? null, [spaces, selectedSpaceKey]);
  const proposedPackage = space?.catalog.find((item) => item.id === space.proposal?.proposed_package_version_id) ?? null;
  const selectedPackage = space?.catalog.find((item) => item.id === selectedPackageId) ?? null;

  useEffect(() => {
    setSelectedPackageId(space?.proposal?.proposed_package_version_id ?? "");
    setAcknowledged(false);
  }, [selectedSpaceKey, space?.proposal?.id]);

  const goToLogin = () => {
    sessionStorage.setItem("mittragen-login-target", "sponsor");
    onLogin();
  };

  const respond = async (decision: "accept" | "alternative" | "advice" | "decline") => {
    if (!space?.proposal) return;
    setBusy(decision);
    setError("");
    setMessage("");
    try {
      const packageVersionId = decision === "accept" ? space.proposal.proposed_package_version_id : decision === "alternative" ? selectedPackageId : null;
      const result = await api<{ space: Space }>(`/api/sponsor-portal/${space.tenantId}/${space.proposal.id}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision, packageVersionId, acknowledged }),
      });
      setSpaces((current) => current.map((item) => item.tenantId === result.space.tenantId && item.sponsor.id === result.space.sponsor.id ? result.space : item));
      setMessage(decision === "advice" ? "Ihre Beratungsanfrage wurde übermittelt." : decision === "decline" ? "Ihre Rückmeldung wurde gespeichert." : "Vielen Dank. Ihre Paketwahl wurde verbindlich bestätigt.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsor_response_failed";
      setError(code === "package_capacity_exceeded" ? "Dieses Paket ist inzwischen ausgebucht. Bitte wählen Sie eine Alternative oder fragen Sie eine Beratung an." : code === "package_exclusivity_conflict" ? "Für dieses Paket besteht ein Exklusivitätskonflikt. Bitte fragen Sie eine Beratung an." : code === "binding_acknowledgement_required" ? "Bitte bestätigen Sie zuerst die Preis- und Verbindlichkeitshinweise." : "Ihre Antwort konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <div className="sponsor-portal"><main className="sponsor-portal__state">Sponsorbereich wird geladen …</main></div>;
  if (!user) return <div className="sponsor-portal"><header><button onClick={onHome} className="access-brand-button"><PortalBrand/></button><button className="access-link" onClick={onHome}>Zur Website</button></header><main className="sponsor-portal__welcome"><p className="eyebrow">Persönlicher Sponsorbereich</p><h1>Ihr Vorschlag ist geschützt.</h1><p>Melden Sie sich mit der E-Mail-Adresse an, an die Ihre Einladung versandt wurde. Falls Sie noch kein Konto haben, können Sie es im nächsten Schritt erstellen.</p><button className="access-primary" onClick={goToLogin}>Anmelden oder Konto erstellen</button></main></div>;

  return <div className="sponsor-portal"><header><button onClick={onHome} className="access-brand-button"><PortalBrand/></button><div><span>{user.email}</span><button className="access-link" onClick={() => void logout().then(() => setUser(null))}>Abmelden</button></div></header><main>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}{!space ? <section className="sponsor-portal__welcome"><p className="eyebrow">Noch kein Zugang</p><h1>Keine offene Einladung gefunden.</h1><p>Prüfen Sie, ob Sie mit derselben E-Mail-Adresse angemeldet sind, an die die Einladung gesendet wurde. Abgelaufene Zugänge kann Ihre Organisation neu versenden.</p></section> : <><section className="sponsor-portal__hero"><div><p className="eyebrow">{space.sponsor.tenant_name}</p><h1>Guten Tag {space.sponsor.legal_name}</h1><p>{space.proposal ? `${space.proposal.campaign_name} · ${space.proposal.target_period}` : "Ihr persönlicher Sponsorbereich"}</p></div>{spaces.length > 1 && <select value={selectedSpaceKey} onChange={(event) => setSelectedSpaceKey(event.target.value)}>{spaces.map((item) => <option value={`${item.tenantId}:${item.sponsor.id}`} key={`${item.tenantId}:${item.sponsor.id}`}>{item.sponsor.tenant_name}</option>)}</select>}</section>{!space.proposal ? <section className="sponsor-portal__welcome"><h2>Aktuell liegt kein offener Vorschlag vor.</h2></section> : <><section className="sponsor-proposal"><div><span>Bisher</span><strong>{space.proposal.source_package}</strong><b>{formatChf(space.proposal.source_value_cents)}</b></div><span aria-hidden="true">→</span><div className="sponsor-proposal__new"><span>Vorschlag</span><strong>{space.proposal.proposed_package}</strong><b>{formatChf(space.proposal.proposed_value_cents)}</b></div></section>{["confirmed", "declined"].includes(space.proposal.status) ? <section className="sponsor-decision-complete"><h2>{space.proposal.status === "confirmed" ? "Ihre Wahl ist bestätigt." : "Ihre Ablehnung wurde übermittelt."}</h2><p>{space.proposal.status === "confirmed" ? "Die Organisation sieht Ihren Entscheid und kann die nächsten Vertragsschritte vorbereiten." : "Die Organisation wird Ihre Rückmeldung im weiteren Vorgehen berücksichtigen."}</p></section> : <><section className="sponsor-rights"><div><p className="eyebrow">Leistungen</p><h2>Was im Vorschlag enthalten ist</h2></div>{proposedPackage?.rights.length ? <ul>{proposedPackage.rights.map((right) => <li key={right.id}><strong>{right.name}{right.quantity > 1 ? ` · ${right.quantity}×` : ""}</strong><span>{[right.description, right.channel, right.location, right.schedule_text].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p>Die Organisation ergänzt die detaillierten Leistungen im persönlichen Gespräch.</p>}</section><section className="sponsor-choices"><div><p className="eyebrow">Ihr Entscheid</p><h2>Wie möchten Sie weitergehen?</h2><p>Sie haben jederzeit einen klaren nächsten Weg.</p></div><label><span>Alternative vergleichen</span><select value={selectedPackageId} onChange={(event) => { setSelectedPackageId(event.target.value); setAcknowledged(false); }}>{space.catalog.map((item) => <option value={item.id} key={item.id} disabled={item.available_quantity === 0}>{item.name} · {formatChf(item.price_cents)}{item.available_quantity === 0 ? " · ausgebucht" : ""}</option>)}</select></label>{selectedPackage && <div className="sponsor-choice-preview"><strong>{selectedPackage.name}</strong><p>{selectedPackage.description || `${selectedPackage.duration_months} Monate Laufzeit`}</p><b>{formatChf(selectedPackage.price_cents)}</b></div>}<label className="sponsor-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>Ich habe Paket, Preis und Leistungen geprüft. Mit meiner Bestätigung wird diese Wahl verbindlich.</span></label><div className="sponsor-choice-actions"><button className="access-primary" disabled={!acknowledged || busy !== ""} onClick={() => void respond(selectedPackageId === space.proposal?.proposed_package_version_id ? "accept" : "alternative")}>{busy === "accept" || busy === "alternative" ? "Wird bestätigt …" : selectedPackageId === space.proposal?.proposed_package_version_id ? "Vorschlag verbindlich annehmen" : "Alternative verbindlich wählen"}</button><button className="access-secondary" disabled={busy !== ""} onClick={() => void respond("advice")}>Beratung anfragen</button><button className="access-text sponsor-decline" disabled={busy !== ""} onClick={() => window.confirm("Möchten Sie den Vorschlag wirklich ablehnen?") && void respond("decline")}>Vorschlag ablehnen</button></div></section></>}</>}</>}</main></div>;
}
