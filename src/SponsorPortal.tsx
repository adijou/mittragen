import { useEffect, useMemo, useState } from "react";
import { getUser, logout, onAuthChange, refreshSession, type User } from "@netlify/identity";
import { Brand } from "./ProductBrand";
import { SponsorAddressForm, type SponsorAddress } from "./SponsorAddressForm";
import { prepareSponsorAccess } from "./sponsorAccess";

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
  sponsor: {
    id: string; legal_name: string; contact_email: string | null; tenant_name: string;
    logoAvailable: boolean; logoUpdatedAt: string | null;
    address: SponsorAddress;
  };
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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoInputKey, setLogoInputKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [section, setSection] = useState<"documents" | "address" | "logo">("documents");
  const [loadAttempt, setLoadAttempt] = useState(0);

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
    setLoading(true);
    setError("");
    const initialize = async () => {
      try {
        await refreshSession();
        const currentUser = await getUser();
        if (!active) return;
        setUser(currentUser);
        if (currentUser) await load(currentUser);
      } catch (reason) {
        if (active) setError(reason instanceof Error && reason.message === "verified_email_required"
          ? "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse über den zugesandten Link."
          : reason instanceof Error && reason.message === "identity_verification_unavailable"
            ? "Ihr Anmeldestatus konnte gerade nicht geprüft werden. Bitte versuchen Sie es erneut."
            : "Ihr Space konnte nicht geladen werden. Bitte versuchen Sie es erneut.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialize();
    const unsubscribe = onAuthChange((_event, currentUser) => setUser(currentUser));
    return () => { active = false; unsubscribe(); };
  }, [loadAttempt]);

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
    setLogoFile(null);
    setLogoInputKey((current) => current + 1);
  }, [selectedSpaceKey, space?.proposal?.id]);

  const goToLogin = (mode: "login" | "signup" = "login") => { prepareSponsorAccess({ mode }); onLogin(); };

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

  const updateLogoState = (available: boolean, updatedAt: string | null) => {
    if (!space) return;
    setSpaces((current) => current.map((item) => item.tenantId === space.tenantId && item.sponsor.id === space.sponsor.id
      ? { ...item, sponsor: { ...item.sponsor, logoAvailable: available, logoUpdatedAt: updatedAt } }
      : item));
  };

  const uploadLogo = async () => {
    if (!space || !logoFile) return;
    setError(""); setMessage("");
    if (!["image/png", "image/jpeg"].includes(logoFile.type) || logoFile.size === 0 || logoFile.size > 2 * 1024 * 1024) {
      setError("Bitte wählen Sie ein PNG- oder JPEG-Logo mit maximal 2 MB.");
      return;
    }
    setBusy("logo-upload");
    try {
      const form = new FormData();
      form.set("logo", logoFile);
      const response = await fetch(`/api/sponsor-portal/${space.tenantId}/${space.sponsor.id}/logo`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { error?: string; logo?: { available: boolean; updatedAt: string | null } };
      if (!response.ok || !body.logo) throw new Error(body.error ?? "sponsor_logo_save_failed");
      updateLogoState(body.logo.available, body.logo.updatedAt);
      setLogoFile(null); setLogoInputKey((current) => current + 1);
      setMessage("Ihr Logo wurde sicher gespeichert.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsor_logo_save_failed";
      setError(code === "invalid_logo_size" ? "Das Logo darf maximal 2 MB gross sein."
        : code === "invalid_logo_type" || code === "invalid_logo_file" || code === "invalid_logo_dimensions"
          ? "Die Datei ist kein gültiges PNG- oder JPEG-Logo."
          : code === "sponsor_access_denied" ? "Für diesen Sponsorbereich besteht kein Logo-Zugriff."
            : "Das Logo konnte nicht gespeichert werden.");
    } finally { setBusy(""); }
  };

  const deleteLogo = async () => {
    if (!space) return;
    setBusy("logo-delete"); setError(""); setMessage("");
    try {
      const result = await api<{ logo: { available: boolean; updatedAt: string | null } }>(
        `/api/sponsor-portal/${space.tenantId}/${space.sponsor.id}/logo`, { method: "DELETE", body: "{}" },
      );
      updateLogoState(result.logo.available, result.logo.updatedAt);
      setLogoFile(null); setLogoInputKey((current) => current + 1);
      setMessage("Ihr Logo wurde entfernt.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsor_logo_delete_failed";
      setError(code === "sponsor_access_denied" ? "Für diesen Sponsorbereich besteht kein Logo-Zugriff." : "Das Logo konnte nicht entfernt werden.");
    } finally { setBusy(""); }
  };

  if (loading) return <div className="sponsor-portal"><main className="sponsor-portal__state">Sponsorbereich wird geladen …</main></div>;
  if (!user) return <div className="sponsor-portal"><header><button onClick={onHome} className="access-brand-button"><Brand/></button><button className="access-link" onClick={onHome}>Zur Website</button></header><main className="sponsor-portal__welcome"><p className="eyebrow">Persönlicher Sponsorbereich</p><h1>Willkommen in Ihrem Space.</h1><p>Hier finden Sie Ihre Vertragsdokumente und verwalten Ihre Adresse und Ihr Logo. Melden Sie sich mit der E-Mail-Adresse an, mit der Sie den Vertrag bestätigt oder die Einladung erhalten haben.</p><div className="sponsor-space-entry-actions"><button className="access-primary" onClick={() => goToLogin()}>Anmelden</button><button className="access-secondary" onClick={() => goToLogin("signup")}>Sponsor-Zugang einrichten</button></div></main></div>;

  return <div className="sponsor-portal">
    <header><button onClick={onHome} className="access-brand-button"><Brand/></button><div><span>{user.email}</span><button className="access-link" onClick={() => void logout().then(() => setUser(null))}>Abmelden</button></div></header>
    <main>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
      {!space && error ? <section className="sponsor-portal__welcome"><h1>Ihr Space konnte gerade nicht geöffnet werden.</h1><button className="access-primary" onClick={() => setLoadAttempt((value) => value + 1)}>Zugang erneut prüfen</button><button className="access-secondary" onClick={() => void logout().then(() => { setSpaces([]); setUser(null); goToLogin(); })}>Erneut anmelden</button></section> : !space ? <section className="sponsor-portal__welcome"><p className="eyebrow">Noch kein Zugang</p><h1>Noch kein Sponsoring zugeordnet.</h1><p>Verwenden Sie die Empfängeradresse Ihrer Einladung oder die E-Mail-Adresse, mit der Sie Ihren Vertrag bestätigt haben. Falls Ihre Einladung abgelaufen ist, bitten Sie die Organisation um eine neue Einladung.</p><button className="access-secondary" onClick={() => void logout().then(() => { setSpaces([]); setUser(null); goToLogin(); })}>Mit anderem Konto anmelden</button></section> : <>
        <section className="sponsor-portal__hero"><div><p className="eyebrow">{space.sponsor.tenant_name}</p><h1>Guten Tag {space.sponsor.legal_name}</h1><p>{"Ihre Dokumente, Ihre Adresse und Ihr Auftritt."}</p></div>{spaces.length > 1 && <select aria-label="Sponsoring auswählen" disabled={busy !== ""} value={selectedSpaceKey} onChange={(event) => setSelectedSpaceKey(event.target.value)}>{spaces.map((item) => <option value={`${item.tenantId}:${item.sponsor.id}`} key={`${item.tenantId}:${item.sponsor.id}`}>{item.sponsor.tenant_name} · {item.sponsor.legal_name}</option>)}</select>}</section>
        <nav className="sponsor-space-nav" aria-label="Bereiche im Sponsor-Space">
          {([['documents', 'Dokumente'], ['address', 'Adresse'], ['logo', 'Logo']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={section === value} disabled={busy !== ""} onClick={() => { setSection(value); setError(""); setMessage(""); }}>{label}</button>)}
        </nav>
        {section === "address" && <SponsorAddressForm key={`${space.tenantId}:${space.sponsor.id}`} tenantId={space.tenantId} sponsorId={space.sponsor.id} legalName={space.sponsor.legal_name} address={space.sponsor.address} disabled={busy !== ""} onBusyChange={(saving) => setBusy(saving ? "address-save" : "")} onSaved={(address) => setSpaces((current) => current.map((item) => item.tenantId === space.tenantId && item.sponsor.id === space.sponsor.id ? { ...item, sponsor: { ...item.sponsor, address } } : item))}/>}
        {section === "logo" && <section className="sponsor-logo-management">
          <div className="sponsor-logo-management__identity">
            <div className="sponsor-logo-management__preview">{space.sponsor.logoAvailable
              ? <img src={`/api/sponsor-portal/${space.tenantId}/${space.sponsor.id}/logo?v=${encodeURIComponent(space.sponsor.logoUpdatedAt ?? "current")}`} alt={`Logo ${space.sponsor.legal_name}`}/>
              : <span>{space.sponsor.legal_name.slice(0, 2).toUpperCase()}</span>}</div>
            <div><p className="eyebrow">Ihr Auftritt</p><h2>Sponsorlogo verwalten</h2><p>Hinterlegen Sie Ihr aktuelles Logo zentral für Sponsorendarstellungen dieser Organisation.</p></div>
          </div>
          <div className="sponsor-logo-management__actions">
            <label className="access-secondary sponsor-logo-management__picker"><input key={logoInputKey} type="file" accept="image/png,image/jpeg" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}/><span>{logoFile ? "Anderes Logo wählen" : space.sponsor.logoAvailable ? "Logo ersetzen" : "Logo auswählen"}</span></label>
            {logoFile && <span className="sponsor-logo-management__filename">{logoFile.name}</span>}
            {logoFile && <button className="access-primary" type="button" disabled={busy !== ""} onClick={() => void uploadLogo()}>{busy === "logo-upload" ? "Wird gespeichert …" : "Logo speichern"}</button>}
            {space.sponsor.logoAvailable && <button className="access-text sponsor-logo-management__delete" type="button" disabled={busy !== ""} onClick={() => window.confirm("Möchten Sie Ihr hinterlegtes Logo wirklich entfernen?") && void deleteLogo()}>{busy === "logo-delete" ? "Wird entfernt …" : "Logo entfernen"}</button>}
          </div>
          <small>PNG oder JPEG, maximal 2 MB. Das Logo kann jederzeit ersetzt oder entfernt werden.</small>
        </section>}
        {section === "documents" && <>
        <ProposalSection space={space} proposedPackage={proposedPackage} selectedPackage={selectedPackage} selectedPackageId={selectedPackageId} setSelectedPackageId={setSelectedPackageId} acknowledged={acknowledged} setAcknowledged={setAcknowledged} busy={busy} respond={respond}/>
        <section className="sponsor-contracts">
          <header><div><p className="eyebrow">Dokumente</p><h2>Ihre Dokumente</h2></div><p>Hier finden Sie Ihre freigegebenen und bestätigten Sponsoringverträge als PDF.</p></header>
          {space.contracts.length === 0 && <p>Ihre Vertragsdokumente erscheinen hier, sobald die Organisation sie freigegeben hat.</p>}
          <div className="sponsor-contracts__list">{space.contracts.map((contract) => <article className={`sponsor-contract sponsor-contract--${contract.status}`} key={contract.id}>
            <div className="sponsor-contract__summary"><span className={`contract-status contract-status--${contract.status}`}>{contract.status === "confirmed" ? "Bestätigt" : "Ihre Bestätigung fehlt"}</span><h3>{contract.title}</h3><p>{contract.contract_number} · {contract.package_name} · {formatChf(contract.price_cents)}</p><small>{contract.status === "confirmed" && contract.confirmed_at ? `Bestätigt am ${formatDateTime(contract.confirmed_at)}` : `Freigegeben am ${formatDateTime(contract.released_at)}`}</small><button className="access-secondary" disabled={busy === `pdf-${contract.id}`} onClick={() => void downloadContract(contract)}>{busy === `pdf-${contract.id}` ? "PDF wird erstellt …" : "Vertrag als PDF"}</button></div>
            {contract.status === "released" ? contract.can_confirm ? <form className="sponsor-contract__confirm" onSubmit={(event) => { event.preventDefault(); void confirmContract(contract); }}><div><strong>Vertrag elektronisch bestätigen</strong><p>Ihr angemeldetes mittragen.ch-Konto weist Ihre Identität nach. Bitte lesen Sie zuerst das vollständige PDF.</p></div>{contract.signer_name ? <div className="sponsor-contract__identity"><span>Unterzeichnende Person</span><strong>{contract.signer_name}</strong><small>{contract.signer_role}</small></div> : <><label><span>Name der berechtigten Person</span><input required value={signingAuthorityName} onChange={(event) => setSigningAuthorityName(event.target.value)} autoComplete="name"/></label><label><span>Funktion beim Sponsor</span><input required value={signingAuthorityRole} onChange={(event) => setSigningAuthorityRole(event.target.value)} placeholder="z. B. Geschäftsführung"/></label></>}<label className="sponsor-ack"><input type="checkbox" checked={contractAcknowledged} onChange={(event) => setContractAcknowledged(event.target.checked)}/><span>Ich habe den vollständigen Vertrag geprüft, bin zur Bestätigung berechtigt und stimme dem unveränderlichen Vertragsstand zu.</span></label><button className="access-primary" disabled={!contractAcknowledged || (!contract.signer_name && (!signingAuthorityName.trim() || !signingAuthorityRole.trim())) || busy !== ""}>{busy === `confirm-${contract.id}` ? "Wird bestätigt …" : "Vertrag verbindlich bestätigen"}</button><small className="sponsor-contract__legal-note">Die Bestätigung wird mit Ihrem Konto, Zeitpunkt und dem unveränderlichen Vertragsstand protokolliert.</small></form> : <div className="sponsor-contract__proof"><strong>Bestätigung einer anderen Person zugewiesen</strong><p>Sie können den Vertrag ansehen. Verbindlich bestätigen kann nur das dafür bestimmte mittragen.ch-Konto.</p></div> : <div className="sponsor-contract__proof"><strong>Bestätigung protokolliert</strong><p>Das PDF enthält den freigegebenen Stand und den Bestätigungsnachweis.</p><code>{contract.snapshot_hash.slice(0, 16)}…</code></div>}
          </article>)}</div>
        </section>
        </>}
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
  if (!space.proposal) return null;
  const proposal = space.proposal;
  return <>
    <section className="sponsor-proposal"><div><span>Bisher</span><strong>{proposal.source_package}</strong><b>{formatChf(proposal.source_value_cents)}</b></div><span aria-hidden="true">→</span><div className="sponsor-proposal__new"><span>Vorschlag</span><strong>{proposal.proposed_package}</strong><b>{formatChf(proposal.proposed_value_cents)}</b></div></section>
    {["confirmed", "declined"].includes(proposal.status) ? <section className="sponsor-decision-complete"><h2>{proposal.status === "confirmed" ? "Ihre Wahl ist bestätigt." : "Ihre Ablehnung wurde übermittelt."}</h2><p>{proposal.status === "confirmed" ? "Die Organisation sieht Ihren Entscheid und kann die nächsten Vertragsschritte vorbereiten." : "Die Organisation wird Ihre Rückmeldung im weiteren Vorgehen berücksichtigen."}</p></section> : <>
      <section className="sponsor-rights"><div><p className="eyebrow">Leistungen</p><h2>Was im Vorschlag enthalten ist</h2></div>{proposedPackage?.rights.length ? <ul>{proposedPackage.rights.map((right) => <li key={right.id}><strong>{right.name}{right.quantity > 1 ? ` · ${right.quantity}×` : ""}</strong><span>{[right.description, right.channel, right.location, right.schedule_text].filter(Boolean).join(" · ")}</span></li>)}</ul> : <p>Die Organisation ergänzt die detaillierten Leistungen im persönlichen Gespräch.</p>}</section>
      <section className="sponsor-choices"><div><p className="eyebrow">Ihr Entscheid</p><h2>Wie möchten Sie weitergehen?</h2><p>Sie haben jederzeit einen klaren nächsten Weg.</p></div><label><span>Alternative vergleichen</span><select value={selectedPackageId} onChange={(event) => { setSelectedPackageId(event.target.value); setAcknowledged(false); }}>{space.catalog.map((item) => <option value={item.id} key={item.id} disabled={item.available_quantity === 0}>{item.name} · {formatChf(item.price_cents)}{item.available_quantity === 0 ? " · ausgebucht" : ""}</option>)}</select></label>{selectedPackage && <div className="sponsor-choice-preview"><strong>{selectedPackage.name}</strong><p>{selectedPackage.description || `${selectedPackage.duration_months} Monate Laufzeit`}</p><b>{formatChf(selectedPackage.price_cents)}</b></div>}<label className="sponsor-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/><span>Ich habe Paket, Preis und Leistungen geprüft. Mit meiner Bestätigung wird diese Wahl verbindlich.</span></label><div className="sponsor-choice-actions"><button className="access-primary" disabled={!acknowledged || busy !== ""} onClick={() => void respond(selectedPackageId === proposal.proposed_package_version_id ? "accept" : "alternative")}>{busy === "accept" || busy === "alternative" ? "Wird bestätigt …" : selectedPackageId === proposal.proposed_package_version_id ? "Vorschlag verbindlich annehmen" : "Alternative verbindlich wählen"}</button><button className="access-secondary" disabled={busy !== ""} onClick={() => void respond("advice")}>Beratung anfragen</button><button className="access-text sponsor-decline" disabled={busy !== ""} onClick={() => window.confirm("Möchten Sie den Vorschlag wirklich ablehnen?") && void respond("decline")}>Vorschlag ablehnen</button></div></section>
    </>}
  </>;
}
