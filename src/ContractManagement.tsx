import { useEffect, useState, type FormEvent } from "react";
import { annualValueForPackage } from "./sponsorPackagePricing";

type ContractStatus = "draft" | "released" | "confirmed" | "void";
type ContractItem = {
  id: string; contract_number: string; version_number: number; title: string; sponsor_name: string;
  parent_contract_id: string | null; sponsor_id: string; package_version_id: string;
  package_name: string; package_snapshot: { priceCents: number; durationMonths: number };
  special_agreements: string; status: ContractStatus; signing_method: "click" | "advanced" | "qualified";
  snapshot_hash: string | null; released_at: string | null; confirmed_at: string | null; confirmed_email: string | null;
  confirmed_name: string | null; confirmed_role: string | null;
  confirmation_mode: "authenticated_account" | "one_time_link" | "legacy_portal" | "admin_legacy" | null;
  confirmation_recorded_at: string | null; confirmation_note: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null;
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
const eventLabels: Record<string, string> = { created: "Entwurf erstellt", updated: "Entwurf bearbeitet", released: "Freigegeben", viewed: "Geöffnet", downloaded: "PDF heruntergeladen", confirmed: "Elektronisch bestätigt", admin_confirmed: "Altbestand administrativ übernommen", voided: "Aufgehoben", signing_invited: "Zur Bestätigung versendet", access_invited: "Sponsorzugang eingerichtet", copy_sent: "PDF-Kopie versendet" };
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
  contract_identity_lookup_failed: "Die Kontoprüfung von Netlify Identity ist derzeit nicht verfügbar. Es wurde keine E-Mail ausgelöst.",
  contract_signing_delivery_failed: "Die Einladung konnte nicht per E-Mail versendet werden. Bitte prüfen Sie die Versandkonfiguration und versuchen Sie es erneut.",
  contract_access_invitation_failed: "Der Sponsorzugang konnte nicht eingerichtet oder versendet werden.",
  contract_copy_delivery_failed: "Die PDF-Kopie konnte nicht per E-Mail versendet werden.",
  contract_signer_locked: "Dieser Vertrag wurde bereits an ein bestehendes Konto gesendet. Die Empfängeradresse kann aus Sicherheitsgründen nicht mehr geändert werden.",
  signing_authority_name_required: "Bitte den Namen der unterzeichnenden Person eintragen.",
  legacy_confirmation_date_required: "Bitte das ursprüngliche Abschlussdatum eintragen.",
  invalid_legacy_confirmation_date: "Bitte ein gültiges ursprüngliches Abschlussdatum eintragen.",
  legacy_confirmation_date_in_future: "Das ursprüngliche Abschlussdatum darf nicht in der Zukunft liegen.",
  legacy_confirmation_evidence_required: "Bitte festhalten, worauf der administrative Abschluss gestützt wird.",
  admin_contract_acknowledgement_required: "Bitte die Übernahme des bereits abgeschlossenen Vertrags ausdrücklich bestätigen.",
  contract_admin_confirmation_failed: "Der Altvertrag konnte nicht administrativ übernommen werden.",
  contract_correction_reason_required: "Bitte den Grund für die Korrektur festhalten.",
  contract_removal_reason_required: "Bitte den Grund für das Löschen oder Aufheben festhalten.",
  contract_revision_exists: "Für diesen Vertrag besteht bereits ein offener Korrekturvertrag.",
  contract_locked: "Dieser Vertragsstand kann nicht direkt bearbeitet werden. Erstellen Sie stattdessen einen Korrekturentwurf.",
  contract_already_void: "Dieser Vertrag ist bereits aufgehoben.",
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
  const [legacyCreateSponsorId, setLegacyCreateSponsorId] = useState("");
  const [legacyCreatePackageVersionId, setLegacyCreatePackageVersionId] = useState("");
  const [legacyCreateAnnualValue, setLegacyCreateAnnualValue] = useState("");
  const [legacyCreateSignerName, setLegacyCreateSignerName] = useState("");
  const [legacyCreateSignerRole, setLegacyCreateSignerRole] = useState("");
  const [legacyCreateConfirmedOn, setLegacyCreateConfirmedOn] = useState("");
  const [legacyCreateEvidenceNote, setLegacyCreateEvidenceNote] = useState("");
  const [legacyCreateAcknowledged, setLegacyCreateAcknowledged] = useState(false);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [title, setTitle] = useState("Sponsoringvertrag");
  const [specialAgreements, setSpecialAgreements] = useState("Keine besonderen Vereinbarungen.");
  const [draftSponsorId, setDraftSponsorId] = useState("");
  const [draftPackageVersionId, setDraftPackageVersionId] = useState("");
  const [draftAnnualValue, setDraftAnnualValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [removalReason, setRemovalReason] = useState("");
  const [legalReview, setLegalReview] = useState(false);
  const [signerEmail, setSignerEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [legacySignerName, setLegacySignerName] = useState("");
  const [legacySignerRole, setLegacySignerRole] = useState("");
  const [legacyConfirmedOn, setLegacyConfirmedOn] = useState("");
  const [legacyEvidenceNote, setLegacyEvidenceNote] = useState("");
  const [legacyAcknowledged, setLegacyAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyDetail = (next: ContractDetail) => {
    setDetail(next);
    setTitle(next.contract.title);
    setSpecialAgreements(next.contract.special_agreements);
    setDraftSponsorId(next.contract.sponsor_id);
    setDraftPackageVersionId(next.contract.package_version_id);
    setDraftAnnualValue(String(next.contract.package_snapshot.priceCents / 100));
    setCorrectionReason("");
    setRemovalReason("");
    setLegalReview(false);
    setSignerEmail(next.signingRequest?.signer_email ?? next.contract.sponsor_snapshot.contactEmail ?? "");
    setSignerName(next.signingRequest?.signer_name ?? next.contract.sponsor_snapshot.contactName ?? "");
    setSignerRole(next.signingRequest?.signer_role ?? "");
    setLegacySignerName(next.contract.sponsor_snapshot.contactName ?? next.signingRequest?.signer_name ?? "");
    setLegacySignerRole(next.signingRequest?.signer_role ?? "");
    setLegacyConfirmedOn("");
    setLegacyEvidenceNote("");
    setLegacyAcknowledged(false);
  };

  const load = async (preferredId?: string | null) => {
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
    const nextLegacySponsorId = result.sponsors.some((sponsor) => sponsor.id === legacyCreateSponsorId) ? legacyCreateSponsorId : (result.sponsors[0]?.id ?? "");
    const selectedLegacyPackage = result.catalog.find((option) => option.id === legacyCreatePackageVersionId) ?? result.catalog[0];
    setLegacyCreateSponsorId(nextLegacySponsorId);
    setLegacyCreatePackageVersionId(selectedLegacyPackage?.id ?? "");
    if (!selectedLegacyPackage || selectedLegacyPackage.id !== legacyCreatePackageVersionId) setLegacyCreateAnnualValue(selectedLegacyPackage ? String(selectedLegacyPackage.price_cents / 100) : "");
    const id = preferredId === null
      ? result.contracts.find((contract) => contract.status !== "void")?.id ?? result.contracts[0]?.id
      : preferredId ?? detail?.contract.id ?? result.contracts.find((contract) => contract.status !== "void")?.id ?? result.contracts[0]?.id;
    if (id) {
      const loaded = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${id}`);
      applyDetail(loaded.detail);
    } else setDetail(null);
  };

  useEffect(() => {
    setLoading(true); setError(""); setDetail(null); setSponsorId(""); setPackageVersionId(""); setAnnualValue("");
    setLegacyCreateSponsorId(""); setLegacyCreatePackageVersionId(""); setLegacyCreateAnnualValue("");
    setLegacyCreateSignerName(""); setLegacyCreateSignerRole(""); setLegacyCreateConfirmedOn(""); setLegacyCreateEvidenceNote(""); setLegacyCreateAcknowledged(false);
    void load().catch(() => setError("Die Verträge konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const selectPackage = (id: string) => {
    setPackageVersionId(id);
    setAnnualValue(annualValueForPackage(id, catalog) ?? "");
  };

  const selectLegacyPackage = (id: string) => {
    setLegacyCreatePackageVersionId(id);
    setLegacyCreateAnnualValue(annualValueForPackage(id, catalog) ?? "");
  };

  const selectDraftPackage = (id: string) => {
    setDraftPackageVersionId(id);
    setDraftAnnualValue(annualValueForPackage(id, catalog) ?? "");
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

  const createLegacyContract = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(legacyCreateAnnualValue.replace(/[’']/g, "").replace(",", "."));
    if (!window.confirm(`Den bereits abgeschlossenen Altvertrag mit Abschlussdatum ${legacyCreateConfirmedOn} direkt und ohne E-Mail-Versand übernehmen?`)) return;
    setBusy("legacy-create"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/legacy`, {
        method: "POST",
        body: JSON.stringify({
          sponsorId: legacyCreateSponsorId,
          packageVersionId: legacyCreatePackageVersionId,
          annualValueCents: Number.isFinite(amount) ? Math.round(amount * 100) : -1,
          signingAuthorityName: legacyCreateSignerName,
          signingAuthorityRole: legacyCreateSignerRole,
          confirmedOn: legacyCreateConfirmedOn,
          evidenceNote: legacyCreateEvidenceNote,
          acknowledged: legacyCreateAcknowledged,
        }),
      });
      applyDetail(result.detail);
      setLegacyCreateConfirmedOn("");
      setLegacyCreateEvidenceNote("");
      setLegacyCreateAcknowledged(false);
      setMessage(`Altvertrag ${result.detail.contract.contract_number} wurde ohne E-Mail-Versand als abgeschlossener Altbestand übernommen.`);
      await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_admin_confirmation_failed";
      setError(errorLabels[code] ?? "Der Altvertrag konnte nicht direkt übernommen werden.");
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
    const amount = Number(draftAnnualValue.replace(/[’']/g, "").replace(",", "."));
    setBusy("save"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          sponsorId: draftSponsorId,
          packageVersionId: draftPackageVersionId,
          annualValueCents: Number.isFinite(amount) ? Math.round(amount * 100) : -1,
          title,
          specialAgreements,
          signingMethod: "click",
        }),
      });
      applyDetail(result.detail); setMessage("Vertragsentwurf gespeichert."); await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_update_failed";
      setError(errorLabels[code] ?? "Der Vertragsentwurf konnte nicht gespeichert werden.");
    }
    finally { setBusy(""); }
  };

  const createCorrection = async () => {
    if (!detail || !correctionReason.trim()) return;
    setBusy("revision"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}/revision`, {
        method: "POST", body: JSON.stringify({ reason: correctionReason }),
      });
      applyDetail(result.detail);
      setMessage(`Korrekturentwurf ${result.detail.contract.contract_number} wurde als Version ${result.detail.contract.version_number} erstellt.`);
      await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_revision_create_failed";
      setError(errorLabels[code] ?? "Der Korrekturentwurf konnte nicht erstellt werden.");
    } finally { setBusy(""); }
  };

  const removeContract = async () => {
    if (!detail || !removalReason.trim()) return;
    const isDraft = detail.contract.status === "draft";
    const prompt = isDraft
      ? `Entwurf ${detail.contract.contract_number} endgültig löschen?`
      : `Vertrag ${detail.contract.contract_number} nachvollziehbar aufheben? Der bisherige Vertragsstand und sein Nachweis bleiben erhalten.`;
    if (!window.confirm(prompt)) return;
    setBusy("remove"); setError(""); setMessage("");
    try {
      const result = await api<{ removed: true; mode: "deleted" | "voided" }>(`/api/contracts/${tenantId}/${detail.contract.id}/void`, {
        method: "POST", body: JSON.stringify({ reason: removalReason }),
      });
      setDetail(null);
      setMessage(result.mode === "deleted" ? "Der Vertragsentwurf wurde endgültig gelöscht." : "Der Vertrag wurde aufgehoben und ins Archiv verschoben.");
      await load(null);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_removal_failed";
      setError(errorLabels[code] ?? "Der Vertrag konnte nicht gelöscht oder aufgehoben werden.");
    } finally { setBusy(""); }
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
        ? "Die Person hat bereits ein mittragen.ch-Konto. Der Vertrag wurde zur Bestätigung in ihren Sponsorbereich gesendet."
        : "Die Person hat kein mittragen.ch-Konto. Ein persönlicher Einmallink wurde versendet.");
      await load(detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_signing_send_failed";
      setError(errorLabels[code] ?? "Der Vertrag konnte nicht zur Bestätigung versendet werden.");
    } finally { setBusy(""); }
  };

  const confirmLegacyContract = async (event: FormEvent) => {
    event.preventDefault(); if (!detail) return;
    if (!window.confirm(`Altvertrag ${detail.contract.contract_number} mit Abschlussdatum ${legacyConfirmedOn} endgültig als abgeschlossen übernehmen?`)) return;
    setBusy("admin-confirm"); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${detail.contract.id}/admin-confirm`, {
        method: "POST",
        body: JSON.stringify({
          signingAuthorityName: legacySignerName,
          signingAuthorityRole: legacySignerRole,
          confirmedOn: legacyConfirmedOn,
          evidenceNote: legacyEvidenceNote,
          acknowledged: legacyAcknowledged,
        }),
      });
      applyDetail(result.detail);
      setMessage("Der bestehende Vertrag wurde ohne E-Mail-Versand als Altbestand übernommen und revisionssicher protokolliert.");
      await load(detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_admin_confirmation_failed";
      setError(errorLabels[code] ?? "Der Altvertrag konnte nicht administrativ übernommen werden.");
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

  const activeContracts = contracts.filter((contract) => contract.status !== "void");
  const archivedContracts = contracts.filter((contract) => contract.status === "void");

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
    {!loading && canWrite && <section className="contract-legacy contract-legacy--create">
      <div><p className="eyebrow">Altbestand</p><h2>Altvertrag für einen Sponsor erfassen</h2><p>Einen bereits rechtsgültig abgeschlossenen Vertrag direkt übernehmen. Es wird keine Bestätigungs- oder sonstige E-Mail versendet.</p></div>
      <form onSubmit={createLegacyContract}>
        <label><span>Sponsor</span><select required value={legacyCreateSponsorId} onChange={(event) => setLegacyCreateSponsorId(event.target.value)}><option value="">Sponsor wählen</option>{sponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.legal_name}</option>)}</select></label>
        <label><span>Sponsoringpaket</span><select required value={legacyCreatePackageVersionId} onChange={(event) => selectLegacyPackage(event.target.value)}><option value="">Paket wählen</option>{catalog.map((option) => <option key={option.id} value={option.id}>{option.name} · {formatChf(option.price_cents)} · {option.duration_months} Monate</option>)}</select></label>
        <label><span>Jahreswert in CHF</span><input required min="0" step="0.01" inputMode="decimal" value={legacyCreateAnnualValue} onChange={(event) => setLegacyCreateAnnualValue(event.target.value)}/></label>
        <label><span>Ursprüngliches Abschlussdatum</span><input type="date" required value={legacyCreateConfirmedOn} onChange={(event) => setLegacyCreateConfirmedOn(event.target.value)}/></label>
        <label><span>Unterzeichnende Person</span><input required maxLength={160} value={legacyCreateSignerName} onChange={(event) => setLegacyCreateSignerName(event.target.value)} autoComplete="name"/></label>
        <label><span>Funktion beim Sponsor (optional)</span><input maxLength={120} value={legacyCreateSignerRole} onChange={(event) => setLegacyCreateSignerRole(event.target.value)} placeholder="Standard: vertretungsberechtigte Person"/></label>
        <label className="wide"><span>Nachweis / Bemerkung</span><textarea required maxLength={600} value={legacyCreateEvidenceNote} onChange={(event) => setLegacyCreateEvidenceNote(event.target.value)} placeholder="z. B. beidseitig unterzeichneter Papiervertrag vom 15.06.2024 liegt im Vereinsarchiv"/></label>
        <label className="contract-release-check wide"><input type="checkbox" checked={legacyCreateAcknowledged} onChange={(event) => setLegacyCreateAcknowledged(event.target.checked)}/><span>Ich bestätige, dass dieser Vertrag bereits rechtsgültig abgeschlossen wurde, die Angaben dem vorhandenen Nachweis entsprechen und der Vertrag als Altbestand übernommen werden darf.</span></label>
        <button className="access-secondary wide" disabled={busy !== "" || !legacyCreateSponsorId || !legacyCreatePackageVersionId || !legacyCreateAcknowledged || !legacyCreateConfirmedOn || !legacyCreateSignerName.trim() || !legacyCreateEvidenceNote.trim()}>{busy === "legacy-create" ? "Wird übernommen …" : "Altvertrag direkt übernehmen"}</button>
        {(sponsors.length === 0 || catalog.length === 0) && <p className="contract-create__missing wide">{sponsors.length === 0 ? "Zuerst einen aktiven Sponsor erfassen. " : ""}{catalog.length === 0 ? "Zuerst ein gültiges Paket publizieren." : ""}</p>}
      </form>
    </section>}
    {loading ? <div className="transition-empty">Verträge werden geladen …</div> : <div className="contract-layout">
      <aside>
        <section><p className="eyebrow">Aus Überführung</p>{eligible.length === 0 ? <p className="contract-empty">Keine bestätigte Überführung ohne Vertrag.</p> : eligible.map((item) => <article className="eligible-contract" key={item.transition_sponsor_id}><div><strong>{item.sponsor_name}</strong><span>{item.package_name} · {formatChf(item.proposed_value_cents)}</span></div>{canWrite && <button disabled={busy === item.transition_sponsor_id} onClick={() => void createTransitionContract(item)}>Entwurf erstellen</button>}</article>)}</section>
        <section><p className="eyebrow">Verträge</p>{activeContracts.length === 0 ? <p className="contract-empty">Noch keine aktiven Verträge.</p> : activeContracts.map((contract) => <button className={`contract-list-item ${detail?.contract.id === contract.id ? "active" : ""}`} key={contract.id} onClick={() => void selectContract(contract.id)}><span><strong>{contract.sponsor_name}</strong><small>{contract.contract_number} · V{contract.version_number} · {contract.package_name}</small></span><i className={`contract-status contract-status--${contract.status}`}>{statusLabels[contract.status]}</i></button>)}{archivedContracts.length > 0 && <details className="contract-archive"><summary>Archivierte Verträge ({archivedContracts.length})</summary>{archivedContracts.map((contract) => <button className={`contract-list-item ${detail?.contract.id === contract.id ? "active" : ""}`} key={contract.id} onClick={() => void selectContract(contract.id)}><span><strong>{contract.sponsor_name}</strong><small>{contract.contract_number} · V{contract.version_number} · {contract.package_name}</small></span><i className="contract-status contract-status--void">Aufgehoben</i></button>)}</details>}</section>
      </aside>
      <main>{detail ? <>
        <header className="contract-detail-header"><div><span className={`contract-status contract-status--${detail.contract.status}`}>{statusLabels[detail.contract.status]}</span><h2>{detail.contract.contract_number} <small>V{detail.contract.version_number}</small></h2><p>{detail.contract.sponsor_name} · {detail.contract.package_name} · {formatChf(detail.contract.package_snapshot.priceCents)}/Jahr</p>{detail.contract.parent_contract_id && <small className="contract-detail-header__revision">Korrekturversion eines früheren Vertragsstands</small>}</div><a className="access-secondary" href={`/api/contracts/${tenantId}/${detail.contract.id}/pdf`} target="_blank" rel="noreferrer">PDF öffnen</a></header>
        {detail.contract.status === "draft" ? <form className="contract-editor" onSubmit={saveDraft}>
          <div className="contract-editor__selection">
            <label><span>Sponsor</span><select required value={draftSponsorId} onChange={(event) => setDraftSponsorId(event.target.value)}><option value="">Sponsor wählen</option>{!sponsors.some((sponsor) => sponsor.id === draftSponsorId) && <option value={draftSponsorId}>{detail.contract.sponsor_name}</option>}{sponsors.map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.legal_name}</option>)}</select></label>
            <label><span>Sponsoringpaket</span><select required value={draftPackageVersionId} onChange={(event) => selectDraftPackage(event.target.value)}><option value="">Paket wählen</option>{!catalog.some((option) => option.id === draftPackageVersionId) && <option value={draftPackageVersionId}>{detail.contract.package_name} · bisheriger Stand</option>}{catalog.map((option) => <option key={option.id} value={option.id}>{option.name} · {formatChf(option.price_cents)} · {option.duration_months} Monate</option>)}</select></label>
            <label><span>Jahreswert in CHF</span><input required min="0" step="0.01" inputMode="decimal" value={draftAnnualValue} onChange={(event) => setDraftAnnualValue(event.target.value)}/></label>
          </div>
          <label><span>Dokumenttitel</span><input required value={title} onChange={(event) => setTitle(event.target.value)}/></label>
          <label><span>Besondere Vereinbarungen</span><textarea required maxLength={5000} value={specialAgreements} onChange={(event) => setSpecialAgreements(event.target.value)}/><small>Produktionskosten, Eigentum, spezielle Platzierungen oder individuelle Abweichungen hier ausdrücklich aufführen.</small></label>
          <div className="contract-signing-method"><strong>Bestätigungsweg</strong><p>Nach der Freigabe prüft mittragen.ch die E-Mail-Adresse: Bestehende Konten bestätigen nach der Anmeldung, alle anderen Personen erhalten einen persönlichen Einmallink.</p></div>
          <button className="access-secondary" disabled={busy === "save"}>{busy === "save" ? "Speichert …" : "Entwurf speichern"}</button>
          <label className="contract-release-check"><input type="checkbox" checked={legalReview} onChange={(event) => setLegalReview(event.target.checked)}/><span>Ich bestätige, dass Vertragsinhalt, Absender, Paket, Beitrag, Laufzeit, Verlängerung und besondere Vereinbarungen fachlich sowie rechtlich geprüft wurden.</span></label>
          <button className="access-primary" type="button" disabled={!legalReview || busy === "release" || !canWrite} onClick={() => void releaseContract()}>{busy === "release" ? "Wird freigegeben …" : "Unveränderlich freigeben"}</button>
        </form> : <>
          <section className="contract-proof"><h3>{detail.contract.status === "void" ? "Vertrag aufgehoben" : detail.contract.status === "confirmed" ? detail.contract.confirmation_mode === "admin_legacy" ? "Altbestand übernommen" : "Elektronisch bestätigt" : detail.signingRequest ? "Zur Bestätigung versendet" : "Bereit zum Versand"}</h3>{detail.contract.confirmed_at && <p>{detail.contract.confirmed_name} · {detail.contract.confirmed_role}<br/>{detail.contract.confirmation_mode === "admin_legacy" ? "Ursprünglicher Abschluss: " : "Bestätigt: "}{new Intl.DateTimeFormat("de-CH", detail.contract.confirmation_mode === "admin_legacy" ? { dateStyle: "long" } : { dateStyle: "long", timeStyle: "short" }).format(new Date(detail.contract.confirmed_at))}{detail.contract.confirmation_mode === "admin_legacy" && detail.contract.confirmation_recorded_at && <><br/>Administrativ erfasst: {new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeStyle: "short" }).format(new Date(detail.contract.confirmation_recorded_at))} · {detail.contract.confirmed_email}</>}</p>}{detail.contract.confirmation_mode === "admin_legacy" && detail.contract.confirmation_note && <p className="contract-proof__note"><strong>Nachweis:</strong> {detail.contract.confirmation_note}</p>}{detail.contract.status === "void" && detail.contract.voided_at && <p className="contract-proof__note"><strong>Aufgehoben:</strong> {new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeStyle: "short" }).format(new Date(detail.contract.voided_at))}<br/><strong>Grund:</strong> {detail.contract.void_reason}</p>}<code>{detail.contract.snapshot_hash}</code></section>
          {detail.contract.status === "released" && <form className="contract-dispatch" onSubmit={sendForConfirmation}>
            <div><p className="eyebrow">Unterzeichnende Person</p><h3>Vertrag zur Bestätigung senden</h3><p>mittragen.ch erkennt automatisch, ob diese E-Mail-Adresse bereits ein Konto hat.</p></div>
            <label><span>E-Mail-Adresse</span><input type="email" required value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} autoComplete="email"/></label>
            <label><span>Name</span><input required value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name"/></label>
            <label><span>Funktion beim Sponsor (optional)</span><input value={signerRole} onChange={(event) => setSignerRole(event.target.value)} placeholder="Standard: vertretungsberechtigte Person"/></label>
            {detail.signingRequest && <div className={`contract-delivery-status contract-delivery-status--${detail.signingRequest.status}`}><strong>{detail.signingRequest.delivery_mode === "account" ? "mittragen.ch-Konto erkannt" : "Persönlicher Einmallink"}</strong><span>{detail.signingRequest.status === "failed" ? "Versand fehlgeschlagen" : detail.signingRequest.opened_at ? "Vertrag geöffnet" : "E-Mail versendet"} · gültig bis {new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.signingRequest.expires_at))}</span></div>}
            <button className="access-primary" disabled={busy !== "" || !canWrite}>{busy === "send" ? "Wird versendet …" : detail.signingRequest ? "Erneut zur Bestätigung senden" : "Zur Bestätigung senden"}</button>
          </form>}
          {detail.contract.status === "released" && canWrite && <section className="contract-legacy">
            <div><p className="eyebrow">Bestehende Verträge</p><h3>Altvertrag direkt übernehmen</h3><p>Für einen bereits rechtsgültig abgeschlossenen Vertrag. Dieser Weg versendet keine E-Mail und ersetzt keine fehlende Zustimmung; er protokolliert den vorhandenen Abschluss als Altbestand.</p></div>
            <form onSubmit={confirmLegacyContract}>
              <label><span>Ursprüngliches Abschlussdatum</span><input type="date" required value={legacyConfirmedOn} onChange={(event) => setLegacyConfirmedOn(event.target.value)}/></label>
              <label><span>Unterzeichnende Person</span><input required maxLength={160} value={legacySignerName} onChange={(event) => setLegacySignerName(event.target.value)} autoComplete="name"/></label>
              <label><span>Funktion beim Sponsor (optional)</span><input maxLength={120} value={legacySignerRole} onChange={(event) => setLegacySignerRole(event.target.value)} placeholder="Standard: vertretungsberechtigte Person"/></label>
              <label className="wide"><span>Nachweis / Bemerkung</span><textarea required maxLength={600} value={legacyEvidenceNote} onChange={(event) => setLegacyEvidenceNote(event.target.value)} placeholder="z. B. beidseitig unterzeichneter Papiervertrag vom 15.06.2024 liegt im Vereinsarchiv"/></label>
              {detail.signingRequest && <p className="contract-legacy__notice">Eine bereits vorbereitete oder versandte digitale Einladung wird beim Abschluss widerrufen.</p>}
              <label className="contract-release-check wide"><input type="checkbox" checked={legacyAcknowledged} onChange={(event) => setLegacyAcknowledged(event.target.checked)}/><span>Ich bestätige, dass dieser Vertrag bereits rechtsgültig abgeschlossen wurde, die Angaben dem vorhandenen Nachweis entsprechen und der Vertrag als Altbestand übernommen werden darf.</span></label>
              <button className="access-secondary wide" disabled={busy !== "" || !legacyAcknowledged || !legacyConfirmedOn || !legacySignerName.trim() || !legacyEvidenceNote.trim()}>{busy === "admin-confirm" ? "Wird übernommen …" : "Altvertrag als abgeschlossen übernehmen"}</button>
            </form>
          </section>}
          {detail.contract.status === "confirmed" && detail.signingRequest && <section className="contract-follow-up">
            <div><p className="eyebrow">Nach der Bestätigung</p><h3>Zugang und Vertragskopie</h3><p>Beide Schritte sind getrennt. Ein neuer Zugang wird per sicherer Einladung eingerichtet; Passwörter werden nie versendet.</p></div>
            <div className="contract-follow-up__actions"><button className="access-secondary" disabled={busy !== "" || !canWrite} onClick={() => void createAccess()}>{busy === "access" ? "Zugang wird eingerichtet …" : detail.signingRequest.access_status === "accepted" || detail.signingRequest.access_status === "existing_user" ? "Zugang erneut zustellen" : "Zugang einrichten"}</button><button className="access-secondary" disabled={busy !== "" || !canWrite} onClick={() => void emailCopy()}>{busy === "copy" ? "PDF wird versendet …" : "PDF-Kopie senden"}</button></div>
            {detail.signingRequest.access_invited_at && <small>Zugangsstatus: {detail.signingRequest.access_status === "accepted" ? "angenommen" : detail.signingRequest.access_status === "existing_user" ? "bestehendes Konto verbunden" : detail.signingRequest.access_status === "sent" ? "Einladung versendet" : detail.signingRequest.access_status === "failed" ? "Versand fehlgeschlagen" : "wird vorbereitet"}</small>}
          </section>}
        </>}
        {canWrite && (detail.contract.status === "released" || detail.contract.status === "confirmed") && <section className="contract-admin-actions">
          <div><p className="eyebrow">Korrektur</p><h3>Neue Vertragsversion erstellen</h3><p>Der aktuelle Vertragsstand bleibt unverändert. Der neue Entwurf übernimmt alle Angaben und kann anschliessend vollständig bearbeitet werden. Mit seiner Freigabe wird dieser Stand automatisch aufgehoben.</p></div>
          <label><span>Grund der Korrektur</span><textarea required maxLength={600} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="z. B. Sponsoringpaket und Jahreswert per Saisonwechsel angepasst"/></label>
          <button type="button" className="access-secondary" disabled={busy !== "" || !correctionReason.trim()} onClick={() => void createCorrection()}>{busy === "revision" ? "Wird erstellt …" : "Korrekturentwurf erstellen"}</button>
        </section>}
        {canWrite && detail.contract.status !== "void" && <section className="contract-admin-actions contract-admin-actions--danger">
          <div><p className="eyebrow">Entfernen</p><h3>{detail.contract.status === "draft" ? "Entwurf löschen" : "Vertrag aufheben"}</h3><p>{detail.contract.status === "draft" ? "Der Entwurf und sein Entwurfsprotokoll werden endgültig entfernt." : "Der Vertrag wird nicht aus dem Nachweis gelöscht, sondern mit Grund und Zeitpunkt ins Archiv verschoben."}</p></div>
          <label><span>Begründung</span><textarea required maxLength={600} value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} placeholder={detail.contract.status === "draft" ? "z. B. irrtümlich doppelt erfasst" : "z. B. im gegenseitigen Einvernehmen aufgehoben"}/></label>
          <button type="button" className="contract-danger-button" disabled={busy !== "" || !removalReason.trim()} onClick={() => void removeContract()}>{busy === "remove" ? "Wird verarbeitet …" : detail.contract.status === "draft" ? "Entwurf endgültig löschen" : "Vertrag nachvollziehbar aufheben"}</button>
        </section>}
        <section className="contract-events"><p className="eyebrow">Nachweis</p><h3>Ereignisprotokoll</h3>{detail.events.map((event) => <div key={event.id}><span></span><p><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}{event.actor_email ? ` · ${event.actor_email}` : ""}</small></p></div>)}</section>
      </> : <div className="contract-empty-state"><h2>Vertrag auswählen</h2><p>Erstellen Sie oben einen Entwurf aus Sponsor und Paket oder öffnen Sie einen bestehenden Vertrag.</p></div>}</main>
    </div>}
  </section>;
}
