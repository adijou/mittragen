import { useEffect, useMemo, useState } from "react";
import { getUser, logout, onAuthChange, refreshSession, type User } from "@netlify/identity";
import { Brand } from "./ProductBrand";

type Right = {
  id: string; name: string; description: string | null; quantity: number;
  schedule_text: string | null; channel: string | null; location: string | null;
};
type PackageVersion = {
  id: string; name: string; description: string | null; price_cents: number; duration_months: number;
  payment_plan: string; capacity: number | null; available_quantity: number | null; rights: Right[];
};
type Proposal = {
  id: string; campaign_name: string; target_period: string; response_deadline: string | null;
  source_package: string; source_value_cents: number; proposed_package: string; proposed_value_cents: number;
  proposed_package_version_id: string | null; status: string;
};
type SponsorContract = {
  id: string; contract_number: string; title: string; status: "released" | "confirmed";
  package_name: string; price_cents: number; snapshot_hash: string; released_at: string; confirmed_at: string | null;
  signer_name: string | null; signer_role: string | null; can_confirm: boolean;
};
type Space = {
  tenantId: string;
  sponsor: { id: string; legal_name: string; contact_email: string | null; tenant_name: string };
  proposal: Proposal | null;
  catalog: PackageVersion[];
  contracts: SponsorContract[];
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency", currency: "CHF", maximumFractionDigits: 0,
}).format(cents / 100);
const formatDateTime = (value: string) => new Intl.DateTimeFormat("de-CH", {
  dateStyle: "long", timeStyle: "short",
}).format(new Date(value));

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function SponsorPortal({ onHome, onLogin }: { onHome: () => void; onLogin: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selectedSpaceKey, setSelectedSpaceKey] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [signingAuthorityName, setSigningAuthorityName] = useState("");
  const [signingAuthorityRole, setSigningAuthorityRole] = useState("");
  const [contractAcknowledged, setContractAcknowledged] = useState(false);
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

  const space = useMemo(
    () => spaces.find((item) => `${item.tenantId}:${item.sponsor.id}` === selectedSpaceKey) ?? spaces[0] ?? null,
    [spaces, selectedSpaceKey],
  );
  const proposedPackage = space?.catalog.find((item) => item.id === space.proposal?.proposed_package_version_id) ?? null;
  const selectedPackage = space?.catalog.find((item) => item.id === selectedPackageId) ?? null;

  useEffect(() => {
    setSelectedPackageId(space?.proposal?.proposed_package_version_id ?? "");
    setAcknowledged(false);
    setSigningAuthorityName("");
    setSigningAuthorityRole("");
    setContractAcknowledged(false);
  }, [selectedSpaceKey, space?.proposal?.id]);

  const goToLogin = () => { sessionStorage.setItem("mittragen-login-target", "sponsor"); onLogin(); };

  const respond = async (decision: "accept" | "alternative" | "advice" | "decline") => {
    if (!space?.proposal) return;
    setBusy(decision); setError(""); setMessage("");
    try {
      const packageVersionId = decision === "accept" ? space.proposal.proposed_package_version_id : decision === "alternative" ? selectedPackageId : null;
      const result = await api<{ space: Space }>(`/api/sponsor-portal/${space.tenantId}/${space.proposal.id}/respond`, {
        method: "POST", body: JSON.stringify({ decision, packageVersionId, acknowledged }),
      });
      setSpaces((current) => current.map((item) => item.tenantId === result.space.tenantId && item.sponsor.id === result.space.sponsor.id ? result.space : item));
      setMessage(decision === "advice" ? "Ihre Beratungsanfrage wurde übermittelt." : decision === "decline" ? "Ihre Rückmeldung wurde gespeichert." : "Vielen Dank. Ihre Paketwahl wurde verbindlich bestätigt.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsor_response_failed";
      setError(code === "package_capacity_exceeded" ? "Dieses Paket ist inzwischen ausgebucht. Bitte wählen Sie eine Alternative oder fragen Sie eine Beratung an." : code === "package_exclusivity_conflict" ? "Für dieses Paket besteht ein Exklusivitätskonflikt. Bitte fragen Sie eine Beratung an." : code === "binding_acknowledgement_required" ? "Bitte bestätigen Sie zuerst die Preis- und Verbindlichkeitshinweise." : "Ihre Antwort konnte nicht gespeichert werden.");
    } finally { setBusy(""); }
  };

  const confirmContract = async (contract: SponsorContract) => {
    if (!space) return;
    setBusy(`confirm-${contract.id}`); setError(""); setMessage("");
    try {
      await api<{ confirmed: boolean }>(`/api/contracts/${space.tenantId}/${contract.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ signingAuthorityName, signingAuthorityRole, acknowledged: contractAcknowledged }),
      });
      if (user) await load(user);
      setSigningAuthorityName(""); setSigningAuthorityRole(""); setContractAcknowledged(false);
      setMessage(`Vielen Dank. Vertrag ${contract.contract_number} wurde elektronisch bestätigt.`);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_confirmation_failed";
      setError(code === "contract_acknowledgement_required" ? "Bitte bestätigen Sie, dass Sie den Vertrag geprüft haben und zur Bestätigung berechtigt sind." : code === "contract_already_confirmed" ? "Dieser Vertrag wurde bereits bestätigt." : code === "contract_signer_mismatch" ? "Dieser Vertrag wurde einer anderen unterzeichnenden Person zugewiesen." : code === "contract_signing_invitation_expired" ? "Die Bestätigungseinladung ist abgelaufen. Bitte verlangen Sie einen neuen Versand." : "Der Vertrag konnte nicht bestätigt werden.");
    } finally { setBusy(""); }
  };

  const downloadContract = async (contract: SponsorContract) => {
    if (!space) return;
    setBusy(`pdf-${contract.id}`); setError("");
    try {
      const response = await fetch(`/api/contracts/${space.tenantId}/${contract.id}/pdf`);
      if (!response.ok) throw new Error("contract_pdf_failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `Sponsoringvertrag_${contract.contract_number}.pdf`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { setError("Das Vertrags-PDF konnte nicht geladen werden."); }
    finally { setBusy(""); }
  };

  if (loading) return <div className="sponsor-portal"><main className="sponsor-portal__state">Sponsorbereich wird geladen …</main></div>;
  if (!user) return <div className="sponsor-portal"><header><button onClick={onHome} className="access-brand-button"><Brand/></button><button className="access-link" onClick={onHome}>Zur Website</button></header><main className="sponsor-portal__welcome"><p className="eyebrow">Persönlicher Sponsorbereich</p><h1>Ihr Vorschlag ist geschützt.</h1><p>Melden Sie sich mit der E-Mail-Adresse an, an die Ihre Einladung versandt wurde. Falls Sie noch kein Konto haben, können Sie es im nächsten Schritt erstellen.</p><button className="access-primary" onClick={goToLogin}>Anmelden oder Konto erstellen</button></main></div>;

  return <div className="sponsor-portal">
    <header><button onClick={onHome} className="access-brand-button"><Brand/></button><div><span>{user.email}</span><button className="access-link" onClick={() => void logout().then(() => setUser(null))}>Abmelden</button></div></header>
    <main>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
      {!space ? <section className="sponsor-portal__welcome"><p className="eyebrow">Noch kein Zugang</p><h1>Keine offene Einladung gefunden.</h1><p>Prüfen Sie, ob Sie mit derselben E-Mail-Adresse angemeldet sind, an die die Einladung gesendet wurde. Abgelaufene Zugänge kann Ihre Organisation neu versenden.</p></section> : <>
        <section className="sponsor-portal__hero"><div><p className="eyebrow">{space.sponsor.tenant_name}</p><h1>Guten Tag {space.sponsor.legal_name}</h1><p>{space.proposal ? `${space.proposal.campaign_name} · ${space.proposal.target_period}` : "Ihr persönlicher Sponsorbereich"}</p></div>{spaces.length > 1 && <select value={selectedSpaceKey} onChange={(event) => setSelectedSpaceKey(event.target.value)}>{spaces.map((item) => <option value={`${item.tenantId}:${item.sponsor.id}`} key={`${item.tenantId}:${item.sponsor.id}`}>{item.sponsor.tenant_name}</option>)}</select>}</section>
        <ProposalSection space={space} proposedPackage={proposedPackage} selectedPackage={selectedPackage} selectedPackageId={selectedPackageId} setSelectedPackageId={setSelectedPackageId} acknowledged={acknowledged} setAcknowledged={setAcknowledged} busy={busy} respond={respond}/>
        {space.contracts.length > 0 && <section className="sponsor-contracts">
          <header><div><p className="eyebrow">Dokumente</p><h2>Ihre Sponsoringverträge</h2></div><p>Der freigegebene Inhalt ist mit einer Prüfsumme gesichert und bleibt unverändert nachvollziehbar.</p></header>
          <div className="sponsor-contracts__list">{space.contracts.map((contract) => <article className={`sponsor-contract sponsor-contract--${contract.status}`} key={contract.id}>
            <div className="sponsor-contract__summary"><span className={`contract-status contract-status--${contract.status}`}>{contract.status === "confirmed" ? "Bestätigt" : "Ihre Bestätigung fehlt"}</span><h3>{contract.title}</h3><p>{contract.contract_number} · {contract.package_name} · {formatChf(contract.price_cents)}</p><small>{contract.status === "confirmed" && contract.confirmed_at ? `Bestätigt am ${formatDateTime(contract.confirmed_at)}` : `Freigegeben am ${formatDateTime(contract.released_at)}`}</small><button className="access-secondary" disabled={busy === `pdf-${contract.id}`} onClick={() => void downloadContract(contract)}>{busy === `pdf-${contract.id}` ? "PDF wird erstellt …" : "Vertrag als PDF"}</button></div>
            {contract.status === "released" ? contract.can_confirm ? <form className="sponsor-contract__confirm" onSubmit={(event) => { event.preventDefault(); void confirmContract(contract); }}><div><strong>Vertrag elektronisch bestätigen</strong><p>Ihr angemeldetes mittragen.ch-Konto weist Ihre Identität nach. Bitte lesen Sie zuerst das vollständige PDF.</p></div>{contract.signer_name ? <div className="sponsor-contract__identity"><span>Unterzeichnende Person</span><strong>{contract.signer_name}</strong><small>{contract.signer_role}</small></div> : <><label><span>Name der berechtigten Person</span><input required value={signingAuthorityName} onChange={(event) => setSigningAuthorityName(event.target.value)} autoComplete="name"/></label><label><span>Funktion beim Sponsor</span><input required value={signingAuthorityRole} onChange={(event) => setSigningAuthorityRole(event.target.value)} placeholder="z. B. Geschäftsführung"/></label></>}<label className="sponsor-ack"><input type="checkbox" checked={contractAcknowledged} onChange={(event) => setContractAcknowledged(event.target.checked)}/><span>Ich habe den vollständigen Vertrag geprüft, bin zur Bestätigung berechtigt und stimme dem unveränderlichen Vertragsstand zu.</span></label><button className="access-primary" disabled={!contractAcknowledged || (!contract.signer_name && (!signingAuthorityName.trim() || !signingAuthorityRole.trim())) || busy !== ""}>{busy === `confirm-${contract.id}` ? "Wird bestätigt …" : "Vertrag verbindlich bestätigen"}</button><small className="sponsor-contract__legal-note">Die Bestätigung wird mit Ihrem Konto, Zeitpunkt und dem unveränderlichen Vertragsstand protokolliert.</small></form> : <div className="sponsor-contract__proof"><strong>Bestätigung einer anderen Person zugewiesen</strong><p>Sie können den Vertrag ansehen. Verbindlich bestätigen kann nur das dafür bestimmte mittragen.ch-Konto.</p></div> : <div className="sponsor-contract__proof"><strong>Bestätigung protokolliert</strong><p>Das PDF enthält den freigegebenen Stand und den Bestätigungsnachweis.</p><code>{contract.snapshot_hash.slice(0, 16)}…</code></div>}
          </article>)}</div>
        </section>}
      </>}
    </main>
  </div>;
}

type ProposalSectionProps = {
  space: Space; proposedPackage: PackageVersion | null; selectedPackage: PackageVersion | null;
  selectedPackageId: string; setSelectedPackageId: (value: string) => void;
  acknowledged: boolean; setAcknowledged: (value: boolean) => void; busy: string;
  respond: (decision: "accept" | "alternative" | "advice" | "decline") => Promise<void>;
};

function ProposalSection({ space, proposedPackage, selectedPackage, selectedPackageId, setSelectedPackageId, acknowledged, setAcknowledged, busy, respond }: ProposalSectionProps) {
  if (!space.proposal) return <section className="sponsor-portal__welcome sponsor-portal__welcome--compact"><h2>Aktuell liegt kein offener Paketvorschlag vor.</h2></section>;
  const proposal = space.proposal;
  return <>
    <section className="sponsor-proposal"><div><span>Bisher</span><strong>{proposal.source_package}</strong><b>{formatChf(proposal.source_value_cents)}</b></div><span aria-hidden="true">→</span><div className="sponsor-proposal__new"><span>Vorschlag</span><strong>{proposal.proposed_package}</strong><b>{formatChf(proposal.proposed_value_cents)}</b></div></section>
    {["confirmed", "declined"].includes(proposal.status) ? <section className="sponsor-decision-complete"><h2>{proposal.status === "confirmed" ? "Ihre Wahl ist bestätigt." : "Ihre Ablehnung wurde übermittelt."}</h2><p>{proposal.status === "confirmed" ? "Die Organisation sieht Ihren Entscheid und kann die nächsten Vertragsschritte vorbereiten." : "Die Organisation wird Ihre Rückmeldung im weiteren Vorgehen berücksichtigen."}</p></section> : <>
      <section className="sponsor-rights"><div><p className="eyebrow">Leistungen</p><h2>Was im Vorschlag enthalten ist</h2></div>{proposedPackage?.rights.length ? <ul>{proposedPackage.rights.map((right) => <li key={right.id}><strong>{right.name}{right.quantity > 1 ? ` · ${right.quantity}×` : ""}</strong><span>{[right.description, right.channel, right.location, right.schedule_text].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p>Die Organisation ergänzt die detaillierten Leistungen im persönlichen Gespräch.</p>}</section>
      <section className="sponsor-choices"><div><p className="eyebrow">Ihr Entscheid</p><h2>Wie möchten Sie weitergehen?</h2><p>Sie haben jederzeit einen klaren nächsten Weg.</p></div><label><span>Alternative vergleichen</span><select value={selectedPackageId} onChange={(event) => { setSelectedPackageId(event.target.value); setAcknowledged(false); }}>{space.catalog.map((item) => <option value={item.id} key={item.id} disabled={item.available_quantity === 0}>{item.name} · {formatChf(item.price_cents)}{item.available_quantity === 0 ? " · ausgebucht" : ""}</option>)}</select></label>{selectedPackage && <div className="sponsor-choice-preview"><strong>{selectedPackage.name}</strong><p>{selectedPackage.description || `${selectedPackage.duration_months} Monate Laufzeit`}</p><b>{formatChf(selectedPackage.price_cents)}</b></div>}<label className="sponsor-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>Ich habe Paket, Preis und Leistungen geprüft. Mit meiner Bestätigung wird diese Wahl verbindlich.</span></label><div className="sponsor-choice-actions"><button className="access-primary" disabled={!acknowledged || busy !== ""} onClick={() => void respond(selectedPackageId === proposal.proposed_package_version_id ? "accept" : "alternative")}>{busy === "accept" || busy === "alternative" ? "Wird bestätigt …" : selectedPackageId === proposal.proposed_package_version_id ? "Vorschlag verbindlich annehmen" : "Alternative verbindlich wählen"}</button><button className="access-secondary" disabled={busy !== ""} onClick={() => void respond("advice")}>Beratung anfragen</button><button className="access-text sponsor-decline" disabled={busy !== ""} onClick={() => window.confirm("Möchten Sie den Vorschlag wirklich ablehnen?") && void respond("decline")}>Vorschlag ablehnen</button></div></section>
    </>}
  </>;
}
