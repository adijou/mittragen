import { useEffect, useMemo, useState } from "react";

type CampaignStatus = "draft" | "review" | "ready" | "active" | "closed";
type ProposalStatus = "review" | "ready" | "sent" | "opened" | "question" | "confirmed" | "declined" | "exception";

type Campaign = {
  id: string;
  name: string;
  target_period: string;
  response_deadline: string | null;
  status: CampaignStatus;
  sponsor_count: string;
  source_value_cents: string;
  proposed_value_cents: string;
  review_count: string;
  ready_count: string;
  exception_count: string;
  created_at: string;
};

type CampaignSummary = Pick<Campaign, "sponsor_count" | "source_value_cents" | "proposed_value_cents" | "review_count" | "ready_count" | "exception_count">;

type Mapping = {
  id: string;
  source_package: string;
  target_package: string;
  target_value_cents: number;
  target_package_version_id: string | null;
  sponsor_count: string;
  source_value_cents: string;
};

type TransitionSponsor = {
  id: string;
  sponsor_id: string;
  legal_name: string;
  contact_email: string | null;
  source_organization: string | null;
  source_package: string;
  source_value_cents: number;
  proposed_package: string;
  proposed_value_cents: number;
  proposed_package_version_id: string | null;
  status: ProposalStatus;
  exception_note: string | null;
};

type PackageVersion = { id: string; name: string; price_cents: number; capacity: number | null; available_quantity: number | null; version_number: number };
type CampaignDetail = {
  campaign: Campaign;
  summary: CampaignSummary;
  dispatch: { missing_email_count: string; missing_package_count: string };
  mappings: Mapping[];
  sponsors: TransitionSponsor[];
};

const campaignStatusLabels: Record<CampaignStatus, string> = {
  draft: "Entwurf",
  review: "In Prüfung",
  ready: "Versandbereit",
  active: "Laufend",
  closed: "Abgeschlossen",
};

const proposalStatusLabels: Record<ProposalStatus, string> = {
  review: "Prüfen",
  ready: "Freigegeben",
  sent: "Versandt",
  opened: "Geöffnet",
  question: "Rückfrage",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
  exception: "Ausnahme",
};

const editableProposalStatuses: ProposalStatus[] = ["review", "ready", "question", "confirmed", "declined", "exception"];
const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
const centsToInput = (cents: number) => (cents / 100).toFixed(cents % 100 ? 2 : 0);

function inputToCents(value: string) {
  const normalized = value.trim().replace(/['’\s]/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function TransitionManagement({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [catalog, setCatalog] = useState<PackageVersion[]>([]);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, { packageVersionId: string; targetPackage: string; targetValue: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [campaignName, setCampaignName] = useState("Gemeinsam in die neue Saison");
  const [targetPeriod, setTargetPeriod] = useState("Saison 2027/28");
  const [responseDeadline, setResponseDeadline] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<TransitionSponsor | null>(null);
  const [proposalPackage, setProposalPackage] = useState("");
  const [proposalValue, setProposalValue] = useState("");
  const [proposalPackageVersionId, setProposalPackageVersionId] = useState("");
  const [proposalStatus, setProposalStatus] = useState<ProposalStatus>("review");
  const [exceptionNote, setExceptionNote] = useState("");

  const applyDetail = (next: CampaignDetail) => {
    setDetail(next);
    setSelectedCampaignId(next.campaign.id);
    setMappingDrafts(Object.fromEntries(next.mappings.map((mapping) => [mapping.id, {
      packageVersionId: mapping.target_package_version_id ?? "",
      targetPackage: mapping.target_package,
      targetValue: centsToInput(mapping.target_value_cents),
    }])));
  };

  const loadCampaigns = async (preferredId?: string) => {
    const [result, packageResult] = await Promise.all([
      request<{ campaigns: Campaign[] }>(`/api/transitions/${tenantId}`),
      request<{ catalog: PackageVersion[] }>(`/api/packages/${tenantId}`),
    ]);
    setCatalog(packageResult.catalog);
    setCampaigns(result.campaigns);
    const nextId = preferredId || selectedCampaignId || result.campaigns[0]?.id || "";
    if (!nextId) {
      setDetail(null);
      setShowCreate(true);
      return;
    }
    const loaded = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}/${nextId}`);
    applyDetail(loaded.detail);
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    setSelectedCampaignId("");
    setDetail(null);
    void loadCampaigns().catch(() => setError("Die Überführungskampagnen konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const selectCampaign = async (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setLoading(true);
    setError("");
    try {
      const result = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}/${campaignId}`);
      applyDetail(result.detail);
    } catch {
      setError("Die Kampagne konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  const createCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("create");
    setError("");
    setMessage("");
    try {
      const result = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}`, {
        method: "POST",
        body: JSON.stringify({ name: campaignName, targetPeriod, responseDeadline: responseDeadline || null }),
      });
      applyDetail(result.detail);
      setShowCreate(false);
      setMessage(`${result.detail.summary.sponsor_count} Sponsorings wurden als Ausgangslage übernommen.`);
      await loadCampaigns(result.detail.campaign.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "transition_create_failed";
      setError(code === "campaign_requires_sponsors"
        ? "Bitte zuerst mindestens einen Sponsor erfassen oder importieren."
        : "Die Überführungskampagne konnte nicht erstellt werden.");
    } finally {
      setBusy("");
    }
  };

  const saveMapping = async (mapping: Mapping) => {
    const draft = mappingDrafts[mapping.id];
    const targetValueCents = inputToCents(draft?.targetValue ?? "");
    if (!draft?.targetPackage.trim() || targetValueCents === null) {
      setError("Bitte Zielpaket und einen gültigen Zielbetrag eintragen.");
      return;
    }
    setBusy(mapping.id);
    setError("");
    setMessage("");
    try {
      const result = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}/${detail?.campaign.id}/mappings/${mapping.id}`, {
        method: "PATCH",
        body: JSON.stringify({ targetPackage: draft.targetPackage, targetValueCents, targetPackageVersionId: draft.packageVersionId || null }),
      });
      applyDetail(result.detail);
      setMessage(`Mapping «${mapping.source_package}» wurde aktualisiert.`);
      await loadCampaigns(result.detail.campaign.id);
    } catch {
      setError("Das Paket-Mapping konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  };

  const openSponsor = (sponsor: TransitionSponsor) => {
    setEditing(sponsor);
    setProposalPackage(sponsor.proposed_package);
    setProposalValue(centsToInput(sponsor.proposed_value_cents));
    setProposalPackageVersionId(sponsor.proposed_package_version_id ?? "");
    setProposalStatus(sponsor.status);
    setExceptionNote(sponsor.exception_note ?? "");
    setError("");
    setMessage("");
  };

  const saveSponsor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !detail) return;
    const proposedValueCents = inputToCents(proposalValue);
    if (!proposalPackage.trim() || proposedValueCents === null) {
      setError("Bitte Vorschlag und einen gültigen Zielbetrag eintragen.");
      return;
    }
    if (proposalStatus === "exception" && !exceptionNote.trim()) {
      setError("Für eine Ausnahme ist eine Begründung erforderlich.");
      return;
    }
    setBusy(editing.id);
    setError("");
    try {
      const result = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}/${detail.campaign.id}/sponsors/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ proposedPackage: proposalPackage, proposedValueCents, proposedPackageVersionId: proposalPackageVersionId || null, status: proposalStatus, exceptionNote }),
      });
      applyDetail(result.detail);
      setEditing(null);
      setMessage(`Vorschlag für ${editing.legal_name} wurde gespeichert.`);
      await loadCampaigns(result.detail.campaign.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "transition_sponsor_failed";
      setError(code === "exception_note_required"
        ? "Für eine Ausnahme ist eine Begründung erforderlich."
        : code === "proposal_package_version_required"
          ? "Ein freigegebener Vorschlag muss mit einem veröffentlichten Paket verknüpft sein."
          : "Der Vorschlag konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  };

  const changeCampaignStatus = async (status: "draft" | "review" | "ready") => {
    if (!detail) return;
    setBusy("status");
    setError("");
    setMessage("");
    try {
      const result = await request<{ detail: CampaignDetail }>(`/api/transitions/${tenantId}/${detail.campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      applyDetail(result.detail);
      setMessage(`Kampagnenstatus auf «${campaignStatusLabels[status]}» gesetzt.`);
      await loadCampaigns(result.detail.campaign.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "transition_status_failed";
      setError(code === "campaign_not_dispatchable"
        ? "Noch nicht versandbereit: Bitte offene Vorschläge abschliessen sowie E-Mail-Adresse und veröffentlichtes Paket bei allen Freigaben ergänzen."
        : "Der Kampagnenstatus konnte nicht geändert werden.");
    } finally {
      setBusy("");
    }
  };

  const dispatchCampaign = async () => {
    if (!detail || !window.confirm(`Jetzt ${detail.summary.ready_count} persönliche Einladungen über Resend versenden?`)) return;
    setBusy("dispatch");
    setError("");
    setMessage("");
    try {
      const result = await request<{ sent: number; failed: number }>(`/api/transitions/${tenantId}/${detail.campaign.id}/dispatch`, { method: "POST", body: "{}" });
      setMessage(`${result.sent} Einladungen versandt${result.failed ? `, ${result.failed} fehlgeschlagen` : ""}.`);
      await loadCampaigns(detail.campaign.id);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "transition_dispatch_failed";
      setError(code === "resend_not_configured" ? "Resend ist noch nicht vollständig konfiguriert." : "Der Versand konnte nicht abgeschlossen werden.");
    } finally {
      setBusy("");
    }
  };

  const visibleSponsors = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de-CH");
    return detail?.sponsors.filter((sponsor) => {
      const matchesQuery = !normalizedQuery || [sponsor.legal_name, sponsor.contact_email, sponsor.source_organization, sponsor.source_package, sponsor.proposed_package]
        .some((value) => value?.toLocaleLowerCase("de-CH").includes(normalizedQuery));
      return matchesQuery && (!statusFilter || sponsor.status === statusFilter);
    }) ?? [];
  }, [detail, query, statusFilter]);

  const delta = detail && Number(detail.summary.source_value_cents)
    ? ((Number(detail.summary.proposed_value_cents) - Number(detail.summary.source_value_cents)) / Number(detail.summary.source_value_cents)) * 100
    : 0;

  return <section className="transition-management">
    <header>
      <div><p className="eyebrow">Produktive Überführung</p><h1>Veränderung vorbereiten</h1><p>Ausgangslage sichern, Paketwelten zuordnen und jeden Vorschlag nachvollziehbar freigeben.</p></div>
      {canWrite && <button className="access-primary" type="button" onClick={() => setShowCreate((current) => !current)}>{showCreate ? "Formular schliessen" : "Neue Kampagne"}</button>}
    </header>

    {showCreate && canWrite && <section className="transition-create-card">
      <div><p className="eyebrow">Neue Ausgangslage</p><h2>Kampagne anlegen</h2><p>Alle aktuellen Sponsorings werden als unveränderlicher Startpunkt übernommen.</p></div>
      <form onSubmit={createCampaign}>
        <label><span>Name</span><input required minLength={2} maxLength={160} value={campaignName} onChange={(event) => setCampaignName(event.target.value)}/></label>
        <label><span>Zielperiode</span><input required minLength={2} maxLength={80} value={targetPeriod} onChange={(event) => setTargetPeriod(event.target.value)}/></label>
        <label><span>Antwortfrist</span><input type="date" value={responseDeadline} onChange={(event) => setResponseDeadline(event.target.value)}/></label>
        <button className="access-primary" disabled={busy === "create"}>{busy === "create" ? "Wird angelegt …" : "Ausgangslage übernehmen"}</button>
      </form>
    </section>}

    {error && <p className="form-error transition-feedback" role="alert">{error}</p>}
    {message && <p className="form-success transition-feedback" role="status">{message}</p>}

    {loading ? <div className="transition-empty">Überführung wird geladen …</div> : campaigns.length === 0 ? <div className="transition-empty"><strong>Noch keine Überführungskampagne.</strong><p>Erstellen Sie zuerst eine Kampagne, um die aktuellen Sponsorings als Ausgangslage zu sichern.</p></div> : detail && <>
      <section className="transition-campaign-bar">
        <label><span>Kampagne</span><select value={selectedCampaignId} onChange={(event) => void selectCampaign(event.target.value)}>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name} · {campaignStatusLabels[campaign.status]}</option>)}</select></label>
        <div><span className={`transition-status transition-status--${detail.campaign.status}`}>{campaignStatusLabels[detail.campaign.status]}</span><strong>{detail.campaign.target_period}</strong><small>{detail.campaign.response_deadline ? `Antwortfrist ${new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(new Date(`${detail.campaign.response_deadline}T12:00:00Z`))}` : "Noch keine Antwortfrist"}</small></div>
        {canWrite && !["active", "closed"].includes(detail.campaign.status) && <label><span>Status setzen</span><select disabled={busy === "status"} value={detail.campaign.status} onChange={(event) => void changeCampaignStatus(event.target.value as "draft" | "review" | "ready")}><option value="draft">Entwurf</option><option value="review">In Prüfung</option><option value="ready">Versandbereit</option></select></label>}
      </section>

      <section className="transition-metrics">
        <article><span>Sponsorings</span><strong>{detail.summary.sponsor_count}</strong><small>eingefrorene Ausgangslage</small></article>
        <article><span>Bisheriger Wert</span><strong>{formatChf(Number(detail.summary.source_value_cents))}</strong><small>pro Jahr</small></article>
        <article><span>Zielwert</span><strong>{formatChf(Number(detail.summary.proposed_value_cents))}</strong><small className={delta >= 0 ? "positive" : "negative"}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)} %</small></article>
        <article><span>Offen / Ausnahmen</span><strong>{detail.summary.review_count} / {detail.summary.exception_count}</strong><small>{detail.summary.ready_count} freigegeben</small></article>
      </section>

      <section className="transition-section">
        <div className="transition-section__heading"><div><p className="eyebrow">Schritt 1</p><h2>Paket-Mapping</h2><p>Ein Zielpaket und Standardbetrag pro bisherigem Paket festlegen.</p></div><span>{detail.mappings.length} Paketgruppen</span></div>
        <div className="transition-mapping-list">{detail.mappings.map((mapping) => {
          const draft = mappingDrafts[mapping.id];
          return <article key={mapping.id}>
            <div><span>Bisher</span><strong>{mapping.source_package}</strong><small>{mapping.sponsor_count} Sponsorings · {formatChf(Number(mapping.source_value_cents))}</small></div>
            <span className="transition-arrow" aria-hidden="true">→</span>
            <label><span>Veröffentlichtes Zielpaket</span><select disabled={!canWrite} value={draft?.packageVersionId ?? ""} onChange={(event) => {
              const selected = catalog.find((version) => version.id === event.target.value);
              setMappingDrafts((current) => ({ ...current, [mapping.id]: {
                packageVersionId: event.target.value,
                targetPackage: selected?.name ?? mapping.target_package,
                targetValue: selected ? centsToInput(selected.price_cents) : centsToInput(mapping.target_value_cents),
              } }));
            }}><option value="">Noch nicht verknüpft</option>{catalog.map((version) => <option value={version.id} key={version.id}>{version.name} · {formatChf(version.price_cents)}</option>)}</select></label>
            <label><span>Zielbetrag pro Sponsor</span><input disabled readOnly value={draft?.targetValue ?? centsToInput(mapping.target_value_cents)}/></label>
            {canWrite && <button className="transition-save" disabled={busy === mapping.id} onClick={() => void saveMapping(mapping)}>{busy === mapping.id ? "Speichert …" : "Mapping speichern"}</button>}
          </article>;
        })}</div>
        <p className="transition-note">Mapping-Änderungen werden auf offene und bereits freigegebene Vorschläge angewendet. Manuelle Ausnahmen und bereits beantwortete Vorschläge bleiben unverändert.</p>
      </section>

      <section className="transition-section">
        <div className="transition-section__heading"><div><p className="eyebrow">Schritt 2</p><h2>Vorschläge und Ausnahmen</h2><p>Persönliche Abweichungen prüfen und intern freigeben.</p></div><span>{visibleSponsors.length} von {detail.sponsors.length}</span></div>
        <div className="transition-toolbar"><label><span>Suche</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Sponsor, Herkunft oder Paket"/></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Alle Status</option>{Object.entries(proposalStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
        <div className="transition-table-wrap"><table><thead><tr><th>Sponsor</th><th>Herkunft</th><th>Bisher</th><th>Vorschlag</th><th>Zielwert</th><th>Status</th><th></th></tr></thead><tbody>{visibleSponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.legal_name}</strong><small>{sponsor.contact_email || "Kein E-Mail-Kontakt"}</small></td><td>{sponsor.source_organization || "–"}</td><td><strong>{sponsor.source_package}</strong><small>{formatChf(sponsor.source_value_cents)}</small></td><td>{sponsor.proposed_package}</td><td>{formatChf(sponsor.proposed_value_cents)}</td><td><span className={`proposal-status proposal-status--${sponsor.status}`}>{proposalStatusLabels[sponsor.status]}</span></td><td>{canWrite && <button onClick={() => openSponsor(sponsor)}>Bearbeiten</button>}</td></tr>)}</tbody></table></div>
        {detail.campaign.status === "ready" && <div className="transition-ready"><strong>Interne Prüfung abgeschlossen.</strong><p>Der Versand erstellt persönliche, 14 Tage gültige Sponsorzugänge. Es wird erst nach Ihrer Bestätigung versendet.</p><button className="access-primary" disabled={busy === "dispatch"} onClick={() => void dispatchCampaign()}>{busy === "dispatch" ? "Wird versandt …" : `${detail.summary.ready_count} Einladungen versenden`}</button></div>}
      </section>
    </>}

    {editing && <div className="transition-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(null); }}><section className="transition-dialog" role="dialog" aria-modal="true" aria-labelledby="transition-dialog-title"><header><div><p className="eyebrow">Persönlicher Vorschlag</p><h2 id="transition-dialog-title">{editing.legal_name}</h2></div><button type="button" aria-label="Schliessen" onClick={() => setEditing(null)}>×</button></header><form onSubmit={saveSponsor}><div className="transition-dialog__origin"><span>Bisher: <strong>{editing.source_package}</strong></span><span>{formatChf(editing.source_value_cents)}</span></div><label><span>Veröffentlichtes Paket</span><select value={proposalPackageVersionId} onChange={(event) => { const selected = catalog.find((version) => version.id === event.target.value); setProposalPackageVersionId(event.target.value); if (selected) { setProposalPackage(selected.name); setProposalValue(centsToInput(selected.price_cents)); } }}><option value="">Individuelle Ausnahme</option>{catalog.map((version) => <option value={version.id} key={version.id}>{version.name} · {formatChf(version.price_cents)}</option>)}</select></label><label><span>Vorgeschlagenes Paket</span><input required maxLength={160} readOnly={Boolean(proposalPackageVersionId)} value={proposalPackage} onChange={(event) => setProposalPackage(event.target.value)}/></label><label><span>Zielbetrag in CHF</span><input required inputMode="decimal" readOnly={Boolean(proposalPackageVersionId)} value={proposalValue} onChange={(event) => setProposalValue(event.target.value)}/></label><label><span>Bearbeitungsstatus</span><select value={proposalStatus} onChange={(event) => setProposalStatus(event.target.value as ProposalStatus)}>{editableProposalStatuses.map((status) => <option value={status} key={status}>{proposalStatusLabels[status]}</option>)}</select></label><label><span>Ausnahme / interne Begründung</span><textarea maxLength={2000} required={proposalStatus === "exception"} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} placeholder="z. B. bestehende Laufzeit, Doppelsponsoring oder individuelle Absprache"/></label>{error && <p className="form-error" role="alert">{error}</p>}<footer><button className="access-secondary" type="button" onClick={() => setEditing(null)}>Abbrechen</button><button className="access-primary" disabled={busy === editing.id}>{busy === editing.id ? "Speichert …" : "Vorschlag speichern"}</button></footer></form></section></div>}
  </section>;
}
