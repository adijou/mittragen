import { useEffect, useState, type FormEvent } from "react";
import { annualValueForPackage } from "./sponsorPackagePricing";

type ContractStatus = "draft" | "released" | "confirmed" | "void";
type ContractItem = {
  id: string; contract_number: string; version_number: number; title: string; sponsor_name: string;
  package_name: string; package_snapshot: { priceCents: number; durationMonths: number };
  special_agreements: string; status: ContractStatus; signing_method: "click" | "advanced" | "qualified";
  snapshot_hash: string | null; released_at: string | null; confirmed_at: string | null; confirmed_name: string | null; confirmed_role: string | null;
  sponsor_snapshot: { legalName: string; contactName: string | null; contactEmail: string | null };
};
type SigningRequest = {
  id: string; signer_email: string; signer_name: string; signer_role: string;
  delivery_mode: "account" | "one_time"; status: "pending" | "sent" | "opened" | "confirmed" | "failed" | "revoked";
  delivery_error: string | null; expires_at: string; sent_at: string | null; opened_at: string | null; confirmed_at: string | null;
  access_status: "none" | "pending" | "sent" | "existing_user" | "failed" | "accepted";
  access_error: string | null; access_invited_at: string | null; access_accepted_at: string | null;
};
type ContractDetail = { contract: ContractItem; signingRequest: SigningRequest | null; events: Array<{ id: string; event_type: string; actor_email: string | null; created_at: string; evidence: Record<string, unknown> }> };
type Eligible = { transition_sponsor_id: string; sponsor_name: string; package_name: string; proposed_value_cents: number; confirmed_at: string };
type SponsorOption = { id: string; legal_name: string };
type PackageOption = { id: string; name: string; price_cents: number; duration_months: number; version_number: number };
type Settings = {
  legalName: string | null; street: string | null; postalCode: string | null; city: string | null; country: string;
  representativeName: string | null; representativeTitle: string | null; contactEmail: string | null;
  renewalMode: "manual" | "annual_auto"; noticeMonths: number | null; placeOfJurisdiction: string | null; complete: boolean;
};

const statusLabels: Record<ContractStatus, string> = { draft: "Entwurf", released: "Zur Bestätigung", confirmed: "Bestätigt", void: "Aufgehoben" };
const eventLabels: Record<string, string> = { created: "Entwurf erstellt", updated: "Entwurf bearbeitet", released: "Freigegeben", viewed: "Geöffnet", downloaded: "PDF heruntergeladen", confirmed: "Elektronisch bestätigt", voided: "Aufgehoben", signing_invited: "Zur Bestätigung versendet", access_invited: "Sponsorzugang eingerichtet", copy_sent: "PDF-Kopie versendet" };
const errorLabels: Record<string, string> = {
  invalid_sponsor: "Bitte einen Sponsor auswählen.",
  invalid_package_version: "Bitte ein publiziertes Paket auswählen.",
  invalid_annual_value: "Bitte einen gültigen Jahreswert eintragen.",
  contract_selection_not_found: "Sponsor oder Paket ist nicht mehr verfügbar. Bitte die Auswahl aktualisieren.",
  confirmed_proposal_required: "Die bestätigte Paketwahl aus der Überführung ist nicht mehr verfügbar.",
  contract_settings_incomplete: "Bitte zuerst die vollständigen Angaben der Vertragsorganisation erfassen.",
  contract_sponsor_data_incomplete: "Beim Sponsor fehlen Adresse, Kontaktperson oder E-Mail-Adresse.",
  legal_review_acknowledgement_required: "Bitte die fachliche und rechtliche Prüfung bestätigen.",
  package_capacity_exceeded: "Die Kapazität dieses Pakets ist ausgeschöpft.",
  package_exclusivity_conflict: "Dieses Paket kollidiert mit einem bereits vergebenen Exklusivrecht.",
  package_reservation_held: "Für diesen Sponsor und dieses Paket besteht noch eine offene Reservierung aus einer Überführung.",
  contract_source_unavailable: "Sponsor oder Paket ist für die Freigabe nicht mehr verfügbar.",
  invalid_signer_email: "Bitte eine gültige E-Mail-Adresse der unterzeichnenden Person eintragen.",
  signer_name_required: "Bitte den Namen der unterzeichnenden Person eintragen.",
  signer_role_required: "Bitte die Funktion der unterzeichnenden Person eintragen.",
  contract_signing_delivery_failed: "Die Einladung konnte nicht per E-Mail versendet werden. Bitte prüfen Sie die Versandkonfiguration und versuchen Sie es erneut.",
  contract_access_invitation_failed: "Der Sponsorzugang konnte nicht eingerichtet oder versendet werden.",
  contract_copy_delivery_failed: "Die PDF-Kopie konnte nicht per E-Mail versendet werden.",
  contract_signer_locked: "Dieser Vertrag wurde bereits an ein bestehendes Konto gesendet. Die Empfängeradresse kann aus Sicherheitsgründen nicht mehr geändert werden.",
};
const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

const emptySettings: Settings = {
  legalName: "", street: "", postalCode: "", city: "", country: "Schweiz", representativeName: "",
  representativeTitle: "", contactEmail: "", renewalMode: "manual", noticeMonths: null, placeOfJurisdiction: "", complete: false,
};

export function ContractManagement({ tenantId, canWrite, canManage, onOpenOrganization }: { tenantId: string; canWrite: boolean; canManage: boolean; onOpenOrganization: () => void }) {
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [sponsors, setSponsors] = useState<SponsorOption[]>([]);
  const [catalog, setCatalog] = useState<PackageOption[]>([]);
  const [sponsorId, setSponsorId] = useState("");
  const [packageVersionId, setPackageVersionId] = useState("");
  const [annualValue, setAnnualValue] = useState("");
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [title, setTitle] = useState("Sponsoringvertrag");
  const [specialAgreements, setSpecialAgreements] = useState("Keine besonderen Vereinbarungen.");
  const [legalReview, setLegalReview] = useState(false);
  const [signerEmail, setSignerEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyDetail = (next: ContractDetail) => {
    setDetail(next);
    setTitle(next.contract.title);
    setSpecialAgreements(next.contract.special_agreements);
    setLegalReview(false);
    setSignerEmail(next.signingRequest?.signer_email ?? next.contract.sponsor_snapshot.contactEmail ?? "");
    setSignerName(next.signingRequest?.signer_name ?? next.contract.sponsor_snapshot.contactName ?? "");
    setSignerRole(next.signingRequest?.signer_role ?? "");
  };

  const load = async (preferredId?: string) => {
    const result = await api<{ contracts: ContractItem[]; eligible: Eligible[]; sponsors: SponsorOption[]; catalog: PackageOption[]; settings: Settings }>(`/api/contracts/${tenantId}`);
    setContracts(result.contracts);
    setEligible(result.eligible);
    setSponsors(result.sponsors);
    setCatalog(result.catalog);
    setSettings(result.settings ?? emptySettings);
    const nextSponsorId = result.sponsors.some((sponsor) => sponsor.id === sponsorId) ? sponsorId : (result.sponsors[0]?.id ?? "");
    const selectedPackage = result.catalog.find((option) => option.id === packageVersionId) ?? result.catalog[0];
    setSponsorId(nextSponsorId);
    setPackageVersionId(selectedPackage?.id ?? "");
    if (!selectedPackage || selectedPackage.id !== packageVersionId) setAnnualValue(selectedPackage ? String(selectedPackage.price_cents / 100) : "");
    const id = preferredId ?? detail?.contract.id ?? result.contracts[0]?.id;
    if (id) {
      const loaded = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${id}`);
      applyDetail(loaded.detail);
    } else setDetail(null);
  };

  useEffect(() => {
    setLoading(true); setError(""); setDetail(null); setSponsorId(""); setPackageVersionId(""); setAnnualValue("");
    void load().catch(() => setError("Die Verträge konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const selectPackage = (id: string) => {
    setPackageVersionId(id);
    setAnnualValue(annualValueForPackage(id, catalog) ?? "");
  };

  const createDirectContract = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(annualValue.replace(/[’']/g, "").replace(",", "."));
    setBusy("direct"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}`, {
        method: "POST",
        body: JSON.stringify({ sponsorId, packageVersionId, annualValueCents: Number.isFinite(amount) ? Math.round(amount * 100) : -1 }),
      });
      applyDetail(result.detail);
      setMessage(`Vertragsentwurf ${result.detail.contract.contract_number} wurde erstellt.`);
      await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_create_failed";
      setError(errorLabels[code] ?? "Der Vertragsentwurf konnte nicht erstellt werden.");
    } finally { setBusy(""); }
  };

  const createTransitionContract = async (item: Eligible) => {
    setBusy(item.transition_sponsor_id); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}`, { method: "POST", body: JSON.stringify({ transitionSponsorId: item.transition_sponsor_id }) });
      applyDetail(result.detail); setMessage(`Vertragsentwurf ${result.detail.contract.contract_number} wurde erstellt.`); await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_create_failed";
      setError(errorLabels[code] ?? "Der Vertragsentwurf konnte nicht erstellt werden.");
    } finally { setBusy(""); }
  };

  const selectContract = async (id: string) => {
    setBusy("load"); setError("");
    try { applyDetail((await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${id}`)).detail); }
    catch { setError("Der Vertrag konnte nicht geladen werden."); }
    finally { setBusy(""); }
  };

  const saveDraft = async (event: FormEvent) => {
    event.preventDefault(); if (!detail) return;
    setBusy("save"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}`, { method: "PATCH", body: JSON.stringify({ title, specialAgreements, signingMethod: "click" }) });
      applyDetail(result.detail); setMessage("Vertragsentwurf gespeichert."); await load(result.detail.contract.id);
    } catch { setError("Der Vertragsentwurf konnte nicht gespeichert werden."); }
    finally { setBusy(""); }
  };

  const releaseContract = async () => {
    if (!detail || !window.confirm(`Vertrag ${detail.contract.contract_number} als unveränderlichen Stand für den Sponsor freigeben?`)) return;
    setBusy("release"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}/release`, { method: "POST", body: JSON.stringify({ legalReviewAcknowledged: legalReview }) });
      applyDetail(result.detail); setMessage("Der Vertrag ist unveränderlich freigegeben und bereit für den Versand zur Bestätigung."); await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_release_failed";
      setError(errorLabels[code] ?? "Der Vertrag konnte nicht freigegeben werden.");
    } finally { setBusy(""); }
  };

  const sendForConfirmation = async (event: FormEvent) => {
    event.preventDefault(); if (!detail) return;
    setBusy("send"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail; deliveryMode: "account" | "one_time" }>(`/api/contracts/${tenantId}/${detail.contract.id}/send`, {
        method: "POST", body: JSON.stringify({ signerEmail, signerName, signerRole }),
      });
      applyDetail(result.detail);
      setMessage(result.deliveryMode === "account"
        ? "Die Person hat bereits ein Mittragen-Konto. Der Vertrag wurde zur Bestätigung in ihren Sponsorbereich gesendet."
        : "Die Person hat kein Mittragen-Konto. Ein persönlicher Einmallink wurde versendet.");
      await load(detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_signing_send_failed";
      setError(errorLabels[code] ?? "Der Vertrag konnte nicht zur Bestätigung versendet werden.");
    } finally { setBusy(""); }
  };

  const createAccess = async () => {
    if (!detail) return;
    setBusy("access"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}/access`, { method: "POST", body: "{}" });
      applyDetail(result.detail); setMessage("Der persönliche Sponsorzugang wurde eingerichtet oder als sichere Konto-Einladung versendet.");
      await load(detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_access_invitation_failed";
      setError(errorLabels[code] ?? "Der Sponsorzugang konnte nicht eingerichtet werden.");
    } finally { setBusy(""); }
  };

  const emailCopy = async () => {
    if (!detail) return;
    setBusy("copy"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}/email-copy`, { method: "POST", body: "{}" });
      applyDetail(result.detail); setMessage(`Die PDF-Kopie wurde an ${result.detail.signingRequest?.signer_email ?? "die unterzeichnende Person"} gesendet.`);
      await load(detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_copy_delivery_failed";
      setError(errorLabels[code] ?? "Die PDF-Kopie konnte nicht versendet werden.");
    } finally { setBusy(""); }
  };

  return <section className="contract-management">
    <header><div><p className="eyebrow">Vertragscenter</p><h1>Verträge nachvollziehbar abschliessen</h1><p>Hier werden Sponsor, publiziertes Paket und der verhandelte Jahreswert zusammengeführt. Die Überführung bleibt ein separater Weg für bestehende Sponsorings.</p></div>{canManage && <button className="access-secondary" onClick={onOpenOrganization}>Organisationsangaben</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {!settings.complete && <div className="contract-warning"><strong>Organisationsangaben noch unvollständig</strong><p>Entwürfe sind möglich. Vor der Freigabe müssen Rechtsträger, Adresse, Vertretung und Kontakt zentral erfasst sein.</p>{canManage && <button onClick={onOpenOrganization}>In Organisation vervollständigen</button>}</div>}
    {!loading && canWrite && <form className="contract-create" onSubmit={createDirectContract}>
      <div><p className="eyebrow">Neuer Vertragsentwurf</p><h2>Sponsor und Paket verbinden</h2><p>Der Paketpreis wird vorgeschlagen. Der vereinbarte Jahreswert bleibt frei anpassbar.</p></div>
      <label><span>Sponsor</span><select required value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}><option value="">Sponsor wählen</option>{sponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.legal_name}</option>)}</select></label>
      <label><span>Sponsoringpaket</span><select required value={packageVersionId} onChange={(event) => selectPackage(event.target.value)}><option value="">Paket wählen</option>{catalog.map((option) => <option key={option.id} value={option.id}>{option.name} · {formatChf(option.price_cents)} · {option.duration_months} Monate</option>)}</select></label>
      <label><span>Jahreswert in CHF</span><input required min="0" step="0.01" inputMode="decimal" value={annualValue} onChange={(event) => setAnnualValue(event.target.value)}/></label>
      <button className="access-primary" disabled={busy === "direct" || !sponsorId || !packageVersionId}>{busy === "direct" ? "Wird erstellt …" : "Entwurf erstellen"}</button>
      {(sponsors.length === 0 || catalog.length === 0) && <p className="contract-create__missing">{sponsors.length === 0 ? "Zuerst einen aktiven Sponsor erfassen. " : ""}{catalog.length === 0 ? "Zuerst ein gültiges Paket publizieren." : ""}</p>}
    </form>}
    {loading ? <div className="transition-empty">Verträge werden geladen …</div> : <div className="contract-layout">
      <aside>
        <section><p className="eyebrow">Aus Überführung</p>{eligible.length === 0 ? <p className="contract-empty">Keine bestätigte Überführung ohne Vertrag.</p> : eligible.map((item) => <article className="eligible-contract" key={item.transition_sponsor_id}><div><strong>{item.sponsor_name}</strong><span>{item.package_name} · {formatChf(item.proposed_value_cents)}</span></div>{canWrite && <button disabled={busy === item.transition_sponsor_id} onClick={() => void createTransitionContract(item)}>Entwurf erstellen</button>}</article>)}</section>
        <section><p className="eyebrow">Verträge</p>{contracts.length === 0 ? <p className="contract-empty">Noch keine Verträge.</p> : contracts.map((contract) => <button className={`contract-list-item ${detail?.contract.id === contract.id ? "active" : ""}`} key={contract.id} onClick={() => void selectContract(contract.id)}><span><strong>{contract.sponsor_name}</strong><small>{contract.contract_number} · {contract.package_name}</small></span><i className={`contract-status contract-status--${contract.status}`}>{statusLabels[contract.status]}</i></button>)}</section>
      </aside>
      <main>{detail ? <>
        <header className="contract-detail-header"><div><span className={`contract-status contract-status--${detail.contract.status}`}>{statusLabels[detail.contract.status]}</span><h2>{detail.contract.contract_number}</h2><p>{detail.contract.sponsor_name} · {detail.contract.package_name} · {formatChf(detail.contract.package_snapshot.priceCents)}/Jahr</p></div><a className="access-secondary" href={`/api/contracts/${tenantId}/${detail.contract.id}/pdf`} target="_blank" rel="noreferrer">PDF öffnen</a></header>
        {detail.contract.status === "draft" ? <form className="contract-editor" onSubmit={saveDraft}>
          <label><span>Dokumenttitel</span><input required value={title} onChange={(event) => setTitle(event.target.value)}/></label>
          <label><span>Besondere Vereinbarungen</span><textarea required maxLength={5000} value={specialAgreements} onChange={(event) => setSpecialAgreements(event.target.value)}/><small>Produktionskosten, Eigentum, spezielle Platzierungen oder individuelle Abweichungen hier ausdrücklich aufführen.</small></label>
          <div className="contract-signing-method"><strong>Bestätigungsweg</strong><p>Nach der Freigabe prüft Mittragen die E-Mail-Adresse: Bestehende Konten bestätigen nach der Anmeldung, alle anderen Personen erhalten einen persönlichen Einmallink.</p></div>
          <button className="access-secondary" disabled={busy === "save"}>{busy === "save" ? "Speichert …" : "Entwurf speichern"}</button>
          <label className="contract-release-check"><input type="checkbox" checked={legalReview} onChange={(event) => setLegalReview(event.target.checked)}/><span>Ich bestätige, dass Vertragsinhalt, Absender, Paket, Beitrag, Laufzeit, Verlängerung und besondere Vereinbarungen fachlich sowie rechtlich geprüft wurden.</span></label>
          <button className="access-primary" type="button" disabled={!legalReview || busy === "release" || !canWrite} onClick={() => void releaseContract()}>{busy === "release" ? "Wird freigegeben …" : "Unveränderlich freigeben"}</button>
        </form> : <>
          <section className="contract-proof"><h3>{detail.contract.status === "confirmed" ? "Elektronisch bestätigt" : detail.signingRequest ? "Zur Bestätigung versendet" : "Bereit zum Versand"}</h3>{detail.contract.confirmed_at && <p>{detail.contract.confirmed_name} · {detail.contract.confirmed_role}<br/>{new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeStyle: "short" }).format(new Date(detail.contract.confirmed_at))}</p>}<code>{detail.contract.snapshot_hash}</code></section>
          {detail.contract.status === "released" && <form className="contract-dispatch" onSubmit={sendForConfirmation}>
            <div><p className="eyebrow">Unterzeichnende Person</p><h3>Vertrag zur Bestätigung senden</h3><p>Mittragen erkennt automatisch, ob diese E-Mail-Adresse bereits ein Konto hat.</p></div>
            <label><span>E-Mail-Adresse</span><input type="email" required value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} autoComplete="email"/></label>
            <label><span>Name</span><input required value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name"/></label>
            <label><span>Funktion beim Sponsor</span><input required value={signerRole} onChange={(event) => setSignerRole(event.target.value)} placeholder="z. B. Geschäftsführung"/></label>
            {detail.signingRequest && <div className={`contract-delivery-status contract-delivery-status--${detail.signingRequest.status}`}><strong>{detail.signingRequest.delivery_mode === "account" ? "Mittragen-Konto erkannt" : "Persönlicher Einmallink"}</strong><span>{detail.signingRequest.status === "failed" ? "Versand fehlgeschlagen" : detail.signingRequest.opened_at ? "Vertrag geöffnet" : "E-Mail versendet"} · gültig bis {new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.signingRequest.expires_at))}</span></div>}
            <button className="access-primary" disabled={busy !== "" || !canWrite}>{busy === "send" ? "Wird versendet …" : detail.signingRequest ? "Erneut zur Bestätigung senden" : "Zur Bestätigung senden"}</button>
          </form>}
          {detail.contract.status === "confirmed" && detail.signingRequest && <section className="contract-follow-up">
            <div><p className="eyebrow">Nach der Bestätigung</p><h3>Zugang und Vertragskopie</h3><p>Beide Schritte sind getrennt. Ein neuer Zugang wird per sicherer Einladung eingerichtet; Passwörter werden nie versendet.</p></div>
            <div className="contract-follow-up__actions"><button className="access-secondary" disabled={busy !== "" || !canWrite} onClick={() => void createAccess()}>{busy === "access" ? "Zugang wird eingerichtet …" : detail.signingRequest.access_status === "accepted" || detail.signingRequest.access_status === "existing_user" ? "Zugang erneut zustellen" : "Zugang einrichten"}</button><button className="access-secondary" disabled={busy !== "" || !canWrite} onClick={() => void emailCopy()}>{busy === "copy" ? "PDF wird versendet …" : "PDF-Kopie senden"}</button></div>
            {detail.signingRequest.access_invited_at && <small>Zugangsstatus: {detail.signingRequest.access_status === "accepted" ? "angenommen" : detail.signingRequest.access_status === "existing_user" ? "bestehendes Konto verbunden" : detail.signingRequest.access_status === "sent" ? "Einladung versendet" : detail.signingRequest.access_status === "failed" ? "Versand fehlgeschlagen" : "wird vorbereitet"}</small>}
          </section>}
        </>}
        <section className="contract-events"><p className="eyebrow">Nachweis</p><h3>Ereignisprotokoll</h3>{detail.events.map((event) => <div key={event.id}><span></span><p><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}{event.actor_email ? ` · ${event.actor_email}` : ""}</small></p></div>)}</section>
      </> : <div className="contract-empty-state"><h2>Vertrag auswählen</h2><p>Erstellen Sie oben einen Entwurf aus Sponsor und Paket oder öffnen Sie einen bestehenden Vertrag.</p></div>}</main>
    </div>}
  </section>;
}
