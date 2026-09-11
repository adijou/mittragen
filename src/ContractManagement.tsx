import { useEffect, useState } from "react";

type ContractStatus = "draft" | "released" | "confirmed" | "void";
type ContractItem = {
  id: string; contract_number: string; version_number: number; title: string; sponsor_name: string;
  package_name: string; special_agreements: string; status: ContractStatus; signing_method: "click" | "advanced" | "qualified";
  snapshot_hash: string | null; released_at: string | null; confirmed_at: string | null; confirmed_name: string | null; confirmed_role: string | null;
};
type ContractDetail = { contract: ContractItem; events: Array<{ id: string; event_type: string; actor_email: string | null; created_at: string; evidence: Record<string, unknown> }> };
type Eligible = { transition_sponsor_id: string; sponsor_name: string; package_name: string; proposed_value_cents: number; confirmed_at: string };
type Settings = {
  legalName: string | null; street: string | null; postalCode: string | null; city: string | null; country: string;
  representativeName: string | null; representativeTitle: string | null; contactEmail: string | null;
  renewalMode: "manual" | "annual_auto"; noticeMonths: number | null; placeOfJurisdiction: string | null; complete: boolean;
};

const statusLabels: Record<ContractStatus, string> = { draft: "Entwurf", released: "Zur Bestätigung", confirmed: "Bestätigt", void: "Aufgehoben" };
const eventLabels: Record<string, string> = { created: "Entwurf erstellt", updated: "Entwurf bearbeitet", released: "Freigegeben", viewed: "Geöffnet", downloaded: "PDF heruntergeladen", confirmed: "Elektronisch bestätigt", voided: "Aufgehoben" };
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
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [title, setTitle] = useState("Sponsoringvertrag");
  const [specialAgreements, setSpecialAgreements] = useState("Keine besonderen Vereinbarungen.");
  const [legalReview, setLegalReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyDetail = (next: ContractDetail) => {
    setDetail(next);
    setTitle(next.contract.title);
    setSpecialAgreements(next.contract.special_agreements);
    setLegalReview(false);
  };

  const load = async (preferredId?: string) => {
    const result = await api<{ contracts: ContractItem[]; eligible: Eligible[]; settings: Settings }>(`/api/contracts/${tenantId}`);
    setContracts(result.contracts);
    setEligible(result.eligible);
    setSettings(result.settings ?? emptySettings);
    const id = preferredId ?? detail?.contract.id ?? result.contracts[0]?.id;
    if (id) {
      const loaded = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${id}`);
      applyDetail(loaded.detail);
    } else setDetail(null);
  };

  useEffect(() => {
    setLoading(true); setError(""); setDetail(null);
    void load().catch(() => setError("Die Verträge konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const createContract = async (item: Eligible) => {
    setBusy(item.transition_sponsor_id); setError(""); setMessage("");
    try {
      const result = await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}`, { method: "POST", body: JSON.stringify({ transitionSponsorId: item.transition_sponsor_id }) });
      applyDetail(result.detail); setMessage(`Vertragsentwurf ${result.detail.contract.contract_number} wurde erstellt.`); await load(result.detail.contract.id);
    } catch { setError("Der Vertragsentwurf konnte nicht erstellt werden."); }
    finally { setBusy(""); }
  };

  const selectContract = async (id: string) => {
    setBusy("load"); setError("");
    try { applyDetail((await api<{ detail: ContractDetail }>(`/api/contracts/${tenantId}/${id}`)).detail); }
    catch { setError("Der Vertrag konnte nicht geladen werden."); }
    finally { setBusy(""); }
  };

  const saveDraft = async (event: React.FormEvent) => {
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
      applyDetail(result.detail); setMessage("Der Vertrag ist im Sponsorbereich zur Bestätigung freigegeben."); await load(result.detail.contract.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "contract_release_failed";
      setError(code === "contract_settings_incomplete" ? "Bitte zuerst die vollständigen Angaben der Vertragsorganisation erfassen." : code === "contract_sponsor_data_incomplete" ? "Beim Sponsor fehlen Adresse, Kontaktperson oder E-Mail-Adresse." : code === "legal_review_acknowledgement_required" ? "Bitte die fachliche und rechtliche Prüfung bestätigen." : "Der Vertrag konnte nicht freigegeben werden.");
    } finally { setBusy(""); }
  };

  return <section className="contract-management">
    <header><div><p className="eyebrow">Vertragscenter</p><h1>Verträge nachvollziehbar abschliessen</h1><p>Aus dem bestätigten Paket entsteht ein gebrandeter, unveränderlicher Vertragsstand mit sauberem Nachweis.</p></div>{canManage && <button className="access-secondary" onClick={onOpenOrganization}>Organisationsangaben</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {!settings.complete && <div className="contract-warning"><strong>Organisationsangaben noch unvollständig</strong><p>Entwürfe sind möglich. Vor der Freigabe müssen Rechtsträger, Adresse, Vertretung und Kontakt zentral erfasst sein.</p>{canManage && <button onClick={onOpenOrganization}>In Organisation vervollständigen</button>}</div>}
    {loading ? <div className="transition-empty">Verträge werden geladen …</div> : <div className="contract-layout"><aside><section><p className="eyebrow">Bereit für Vertrag</p>{eligible.length === 0 ? <p className="contract-empty">Noch keine bestätigte Paketwahl ohne Vertrag.</p> : eligible.map((item) => <article className="eligible-contract" key={item.transition_sponsor_id}><div><strong>{item.sponsor_name}</strong><span>{item.package_name} · {formatChf(item.proposed_value_cents)}</span></div>{canWrite && <button disabled={busy === item.transition_sponsor_id} onClick={() => void createContract(item)}>Entwurf erstellen</button>}</article>)}</section><section><p className="eyebrow">Verträge</p>{contracts.length === 0 ? <p className="contract-empty">Noch keine Verträge.</p> : contracts.map((contract) => <button className={`contract-list-item ${detail?.contract.id === contract.id ? "active" : ""}`} key={contract.id} onClick={() => void selectContract(contract.id)}><span><strong>{contract.sponsor_name}</strong><small>{contract.contract_number} · {contract.package_name}</small></span><i className={`contract-status contract-status--${contract.status}`}>{statusLabels[contract.status]}</i></button>)}</section></aside><main>{detail ? <><header className="contract-detail-header"><div><span className={`contract-status contract-status--${detail.contract.status}`}>{statusLabels[detail.contract.status]}</span><h2>{detail.contract.contract_number}</h2><p>{detail.contract.sponsor_name} · {detail.contract.package_name}</p></div><a className="access-secondary" href={`/api/contracts/${tenantId}/${detail.contract.id}/pdf`} target="_blank" rel="noreferrer">PDF öffnen</a></header>{detail.contract.status === "draft" ? <form className="contract-editor" onSubmit={saveDraft}><label><span>Dokumenttitel</span><input required value={title} onChange={(event) => setTitle(event.target.value)}/></label><label><span>Besondere Vereinbarungen</span><textarea required maxLength={5000} value={specialAgreements} onChange={(event) => setSpecialAgreements(event.target.value)}/><small>Produktionskosten, Eigentum, spezielle Platzierungen oder individuelle Abweichungen hier ausdrücklich aufführen.</small></label><div className="contract-signing-method"><strong>Bestätigungsart</strong><label><input type="radio" checked readOnly/> Nachvollziehbare Klickbestätigung</label><label className="disabled"><input type="radio" disabled/> Fortgeschrittene Signatur · Provider folgt</label><label className="disabled"><input type="radio" disabled/> Qualifizierte Signatur · Provider folgt</label></div><button className="access-secondary" disabled={busy === "save"}>{busy === "save" ? "Speichert …" : "Entwurf speichern"}</button><label className="contract-release-check"><input type="checkbox" checked={legalReview} onChange={(event) => setLegalReview(event.target.checked)}/><span>Ich bestätige, dass Vertragsinhalt, Absender, Paket, Beitrag, Laufzeit, Verlängerung und besondere Vereinbarungen fachlich sowie rechtlich geprüft wurden.</span></label><button className="access-primary" type="button" disabled={!legalReview || busy === "release" || !canWrite} onClick={() => void releaseContract()}>{busy === "release" ? "Wird freigegeben …" : "Unveränderlich freigeben"}</button></form> : <section className="contract-proof"><h3>{detail.contract.status === "confirmed" ? "Elektronisch bestätigt" : "Wartet auf Sponsorbestätigung"}</h3>{detail.contract.confirmed_at && <p>{detail.contract.confirmed_name} · {detail.contract.confirmed_role}<br/>{new Intl.DateTimeFormat("de-CH", { dateStyle: "long", timeStyle: "short" }).format(new Date(detail.contract.confirmed_at))}</p>}<code>{detail.contract.snapshot_hash}</code></section>}<section className="contract-events"><p className="eyebrow">Nachweis</p><h3>Ereignisprotokoll</h3>{detail.events.map((event) => <div key={event.id}><span></span><p><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}{event.actor_email ? ` · ${event.actor_email}` : ""}</small></p></div>)}</section></> : <div className="contract-empty-state"><h2>Vertrag auswählen</h2><p>Erstellen Sie einen Entwurf aus einer bestätigten Paketwahl oder öffnen Sie einen bestehenden Vertrag.</p></div>}</main></div>}
  </section>;
}
