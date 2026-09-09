import { useEffect, useMemo, useState } from "react";

type VersionStatus = "draft" | "published" | "retired";
type PaymentPlan = "annual" | "semiannual" | "quarterly" | "custom";
type Visibility = "private" | "public";
type ExclusivityScope = "none" | "industry" | "team" | "area" | "channel" | "period";

type PackageListItem = {
  id: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
  latest_name: string | null;
  latest_price_cents: number | null;
  latest_status: VersionStatus | null;
  latest_visibility: Visibility | null;
  latest_capacity: number | null;
  reserved_quantity: string;
  version_count: string;
};

type PackageVersion = {
  id: string;
  package_id: string;
  version_number: number;
  name: string;
  description: string | null;
  price_cents: number;
  duration_months: number;
  payment_plan: PaymentPlan;
  payment_terms: string | null;
  valid_from: string | null;
  valid_until: string | null;
  visibility: Visibility;
  status: VersionStatus;
  capacity: number | null;
  deviation_approval_required: boolean;
  right_count: string;
  reserved_quantity: string;
};

type PackageRight = {
  id: string;
  package_version_id: string;
  name: string;
  description: string | null;
  quantity: number;
  schedule_text: string | null;
  channel: string | null;
  location: string | null;
  responsible_role: string | null;
  exclusivity_scope: ExclusivityScope;
  exclusivity_key: string | null;
};

type PackageDetail = { package: { id: string; status: "active" | "archived" }; versions: PackageVersion[]; rights: PackageRight[] };

type VersionForm = {
  name: string;
  description: string;
  price: string;
  durationMonths: string;
  paymentPlan: PaymentPlan;
  paymentTerms: string;
  validFrom: string;
  validUntil: string;
  visibility: Visibility;
  capacity: string;
  deviationApprovalRequired: boolean;
};

type RightForm = {
  name: string;
  description: string;
  quantity: string;
  scheduleText: string;
  channel: string;
  location: string;
  responsibleRole: string;
  exclusivityScope: ExclusivityScope;
  exclusivityKey: string;
};

const emptyVersion: VersionForm = {
  name: "", description: "", price: "", durationMonths: "12", paymentPlan: "annual",
  paymentTerms: "30 Tage netto", validFrom: "", validUntil: "", visibility: "private", capacity: "",
  deviationApprovalRequired: true,
};
const emptyRight: RightForm = { name: "", description: "", quantity: "1", scheduleText: "", channel: "", location: "", responsibleRole: "Sponsoringleistungen", exclusivityScope: "none", exclusivityKey: "" };

const paymentPlanLabels: Record<PaymentPlan, string> = { annual: "Jährlich", semiannual: "Halbjährlich", quarterly: "Quartalsweise", custom: "Individuell" };
const visibilityLabels: Record<Visibility, string> = { private: "Intern", public: "Für Sponsoren sichtbar" };
const versionStatusLabels: Record<VersionStatus, string> = { draft: "Entwurf", published: "Veröffentlicht", retired: "Abgelöst" };
const exclusivityLabels: Record<ExclusivityScope, string> = { none: "Keine", industry: "Branche", team: "Team", area: "Fläche", channel: "Kanal", period: "Zeitraum" };
const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);
const centsToInput = (cents: number) => (cents / 100).toFixed(cents % 100 ? 2 : 0);

function inputToCents(value: string) {
  const normalized = value.trim().replace(/['’\s]/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function versionForm(version: PackageVersion): VersionForm {
  return {
    name: version.name, description: version.description ?? "", price: centsToInput(version.price_cents),
    durationMonths: String(version.duration_months), paymentPlan: version.payment_plan,
    paymentTerms: version.payment_terms ?? "", validFrom: version.valid_from ?? "", validUntil: version.valid_until ?? "",
    visibility: version.visibility, capacity: version.capacity === null ? "" : String(version.capacity),
    deviationApprovalRequired: version.deviation_approval_required,
  };
}

function rightForm(right: PackageRight): RightForm {
  return {
    name: right.name, description: right.description ?? "", quantity: String(right.quantity),
    scheduleText: right.schedule_text ?? "", channel: right.channel ?? "", location: right.location ?? "",
    responsibleRole: right.responsible_role ?? "", exclusivityScope: right.exclusivity_scope,
    exclusivityKey: right.exclusivity_key ?? "",
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function PackageManagement({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const [packages, setPackages] = useState<PackageListItem[]>([]);
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [form, setForm] = useState<VersionForm>(emptyVersion);
  const [showCreate, setShowCreate] = useState(false);
  const [rightEditor, setRightEditor] = useState<PackageRight | "new" | null>(null);
  const [rightDraft, setRightDraft] = useState<RightForm>(emptyRight);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedVersion = detail?.versions.find((version) => version.id === selectedVersionId) ?? detail?.versions[0] ?? null;
  const selectedRights = useMemo(() => detail?.rights.filter((right) => right.package_version_id === selectedVersion?.id) ?? [], [detail, selectedVersion?.id]);

  const applyDetail = (next: PackageDetail, preferredVersionId?: string) => {
    setDetail(next);
    setSelectedPackageId(next.package.id);
    const nextVersion = next.versions.find((version) => version.id === preferredVersionId)
      ?? next.versions.find((version) => version.status === "draft")
      ?? next.versions[0];
    setSelectedVersionId(nextVersion?.id ?? "");
    setForm(nextVersion ? versionForm(nextVersion) : emptyVersion);
  };

  const loadPackages = async (preferredPackageId?: string, preferredVersionId?: string) => {
    const listed = await request<{ packages: PackageListItem[] }>(`/api/packages/${tenantId}`);
    setPackages(listed.packages);
    const nextPackageId = preferredPackageId || selectedPackageId || listed.packages[0]?.id || "";
    if (!nextPackageId) {
      setDetail(null);
      setShowCreate(true);
      return;
    }
    const loaded = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}/${nextPackageId}`);
    applyDetail(loaded.detail, preferredVersionId);
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    setDetail(null);
    setSelectedPackageId("");
    void loadPackages().catch(() => setError("Die Sponsoringpakete konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const selectPackage = async (packageId: string) => {
    setLoading(true);
    setError("");
    try {
      const loaded = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}/${packageId}`);
      applyDetail(loaded.detail);
    } catch {
      setError("Das Paket konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  const selectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    const version = detail?.versions.find((item) => item.id === versionId);
    if (version) setForm(versionForm(version));
    setError("");
    setMessage("");
  };

  const payloadFromForm = () => {
    const priceCents = inputToCents(form.price);
    const durationMonths = Number(form.durationMonths);
    const capacity = form.capacity.trim() ? Number(form.capacity) : null;
    if (priceCents === null || !Number.isSafeInteger(durationMonths) || (capacity !== null && !Number.isSafeInteger(capacity))) return null;
    return {
      name: form.name, description: form.description || null, priceCents, durationMonths,
      paymentPlan: form.paymentPlan, paymentTerms: form.paymentTerms || null,
      validFrom: form.validFrom || null, validUntil: form.validUntil || null,
      visibility: form.visibility, capacity, deviationApprovalRequired: form.deviationApprovalRequired,
    };
  };

  const createPackage = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = payloadFromForm();
    if (!payload) { setError("Bitte Preis, Laufzeit und Kapazität gültig eintragen."); return; }
    setBusy("create"); setError(""); setMessage("");
    try {
      const result = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}`, { method: "POST", body: JSON.stringify(payload) });
      applyDetail(result.detail);
      setShowCreate(false);
      setMessage(`Paket «${result.detail.versions[0].name}» wurde als Entwurf erstellt.`);
      await loadPackages(result.detail.package.id, result.detail.versions[0].id);
    } catch { setError("Das Paket konnte nicht erstellt werden."); }
    finally { setBusy(""); }
  };

  const saveVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !selectedVersion) return;
    const payload = payloadFromForm();
    if (!payload) { setError("Bitte Preis, Laufzeit und Kapazität gültig eintragen."); return; }
    setBusy("version"); setError(""); setMessage("");
    try {
      const result = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}/${detail.package.id}/versions/${selectedVersion.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      applyDetail(result.detail, selectedVersion.id);
      setMessage(`Version ${selectedVersion.version_number} wurde gespeichert.`);
      await loadPackages(detail.package.id, selectedVersion.id);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "package_version_locked" ? "Veröffentlichte Paketversionen können nicht mehr verändert werden." : "Die Paketversion konnte nicht gespeichert werden.");
    } finally { setBusy(""); }
  };

  const copyVersion = async () => {
    if (!detail || !selectedVersion) return;
    setBusy("copy"); setError(""); setMessage("");
    try {
      const result = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}/${detail.package.id}/versions`, { method: "POST", body: JSON.stringify({ sourceVersionId: selectedVersion.id }) });
      const draft = result.detail.versions.find((version) => version.status === "draft");
      applyDetail(result.detail, draft?.id);
      setMessage(`Version ${draft?.version_number ?? ""} wurde als bearbeitbare Kopie angelegt.`);
      await loadPackages(detail.package.id, draft?.id);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "package_draft_exists" ? "Für dieses Paket besteht bereits ein Entwurf." : "Die neue Version konnte nicht erstellt werden.");
    } finally { setBusy(""); }
  };

  const publishVersion = async () => {
    if (!detail || !selectedVersion) return;
    setBusy("publish"); setError(""); setMessage("");
    try {
      const result = await request<{ detail: PackageDetail }>(`/api/packages/${tenantId}/${detail.package.id}/versions/${selectedVersion.id}/publish`, { method: "POST", body: "{}" });
      applyDetail(result.detail, selectedVersion.id);
      setMessage(`«${selectedVersion.name}» Version ${selectedVersion.version_number} ist veröffentlicht und unveränderlich.`);
      await loadPackages(detail.package.id, selectedVersion.id);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "package_rights_required" ? "Vor der Veröffentlichung muss mindestens eine Leistung erfasst sein." : "Die Paketversion konnte nicht veröffentlicht werden.");
    } finally { setBusy(""); }
  };

  const openRight = (right: PackageRight | "new") => {
    setRightEditor(right);
    setRightDraft(right === "new" ? emptyRight : rightForm(right));
    setError(""); setMessage("");
  };

  const saveRight = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail || !selectedVersion || !rightEditor) return;
    const quantity = Number(rightDraft.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) { setError("Bitte eine gültige Menge eintragen."); return; }
    const payload = {
      name: rightDraft.name, description: rightDraft.description || null, quantity,
      scheduleText: rightDraft.scheduleText || null, channel: rightDraft.channel || null,
      location: rightDraft.location || null, responsibleRole: rightDraft.responsibleRole || null,
      exclusivityScope: rightDraft.exclusivityScope,
      exclusivityKey: rightDraft.exclusivityScope === "none" ? null : rightDraft.exclusivityKey,
    };
    const path = rightEditor === "new"
      ? `/api/packages/${tenantId}/${detail.package.id}/versions/${selectedVersion.id}/rights`
      : `/api/packages/${tenantId}/${detail.package.id}/versions/${selectedVersion.id}/rights/${rightEditor.id}`;
    setBusy("right"); setError("");
    try {
      const result = await request<{ detail: PackageDetail }>(path, { method: rightEditor === "new" ? "POST" : "PATCH", body: JSON.stringify(payload) });
      applyDetail(result.detail, selectedVersion.id);
      setRightEditor(null);
      setMessage(`Leistung «${rightDraft.name}» wurde gespeichert.`);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "package_right_write_failed";
      setError(code === "exclusivity_key_required" ? "Für Exklusivität ist ein eindeutiger Schlüssel erforderlich." : code === "package_version_locked" ? "Leistungen veröffentlichter Versionen können nicht verändert werden." : "Die Leistung konnte nicht gespeichert werden.");
    } finally { setBusy(""); }
  };

  const available = selectedVersion?.capacity === null || !selectedVersion ? null : Math.max(0, selectedVersion.capacity - Number(selectedVersion.reserved_quantity));

  return <section className="package-management">
    <header><div><p className="eyebrow">Angebot und Inventar</p><h1>Sponsoringpakete</h1><p>Veröffentlichte Versionen bleiben stabil; neue Saisons entstehen als bearbeitbare Kopie.</p></div>{canWrite && <button className="access-primary" onClick={() => { setShowCreate((current) => !current); setForm(emptyVersion); }}>{showCreate ? "Formular schliessen" : "Neues Paket"}</button>}</header>

    {showCreate && canWrite && <section className="package-create"><div><p className="eyebrow">Version 1</p><h2>Neues Paket anlegen</h2><p>Der erste Entwurf kann vor der Veröffentlichung beliebig ergänzt werden.</p></div><form onSubmit={createPackage}><VersionFields form={form} setForm={setForm}/><footer><button className="access-primary" disabled={busy === "create"}>{busy === "create" ? "Wird erstellt …" : "Paket erstellen"}</button></footer></form></section>}

    {error && <p className="form-error package-feedback" role="alert">{error}</p>}
    {message && <p className="form-success package-feedback" role="status">{message}</p>}

    {loading ? <div className="package-empty">Pakete werden geladen …</div> : packages.length === 0 ? <div className="package-empty"><strong>Noch keine Sponsoringpakete.</strong><p>Erstellen Sie ein erstes Paket und ergänzen Sie danach die enthaltenen Leistungen.</p></div> : <div className="package-layout">
      <aside className="package-list"><div><p className="eyebrow">Katalog</p><h2>{packages.length} Pakete</h2></div>{packages.map((item) => <button className={item.id === selectedPackageId ? "active" : ""} onClick={() => void selectPackage(item.id)} key={item.id}><span><strong>{item.latest_name ?? "Unbenannt"}</strong><small>{item.version_count} Versionen · {item.latest_status ? versionStatusLabels[item.latest_status] : "–"}</small></span><span>{item.latest_price_cents === null ? "–" : formatChf(item.latest_price_cents)}<small>{item.latest_capacity === null ? "unbegrenzt" : `${item.reserved_quantity}/${item.latest_capacity} belegt`}</small></span></button>)}</aside>

      {detail && selectedVersion && <main className="package-detail"><header><div><span className={`package-version-status package-version-status--${selectedVersion.status}`}>{versionStatusLabels[selectedVersion.status]}</span><h2>{selectedVersion.name}</h2><p>Version {selectedVersion.version_number} · {visibilityLabels[selectedVersion.visibility]}</p></div><label><span>Paketausgabe</span><select value={selectedVersion.id} onChange={(event) => selectVersion(event.target.value)}>{detail.versions.map((version) => <option value={version.id} key={version.id}>Version {version.version_number} · {versionStatusLabels[version.status]}</option>)}</select></label></header>
        <section className="package-metrics"><article><span>Preis</span><strong>{formatChf(selectedVersion.price_cents)}</strong><small>{paymentPlanLabels[selectedVersion.payment_plan]}</small></article><article><span>Laufzeit</span><strong>{selectedVersion.duration_months}</strong><small>Monate</small></article><article><span>Leistungen</span><strong>{selectedVersion.right_count}</strong><small>strukturierte Rechte</small></article><article><span>Verfügbar</span><strong>{available === null ? "∞" : available}</strong><small>{selectedVersion.capacity === null ? "unbegrenzt" : `${selectedVersion.reserved_quantity} von ${selectedVersion.capacity} reserviert`}</small></article></section>

        <section className="package-version-card"><div className="package-section-heading"><div><p className="eyebrow">Kommerzielle Angaben</p><h3>Paketversion</h3></div><div>{canWrite && selectedVersion.status !== "draft" && <button className="access-secondary" disabled={busy === "copy"} onClick={() => void copyVersion()}>{busy === "copy" ? "Kopiert …" : "Als neue Version kopieren"}</button>}{canWrite && selectedVersion.status === "draft" && <button className="access-primary" disabled={busy === "publish"} onClick={() => void publishVersion()}>{busy === "publish" ? "Veröffentlicht …" : "Version veröffentlichen"}</button>}</div></div>
          <form onSubmit={saveVersion}><VersionFields form={form} setForm={setForm} disabled={!canWrite || selectedVersion.status !== "draft"}/>{selectedVersion.status === "draft" && canWrite && <footer><button className="access-primary" disabled={busy === "version"}>{busy === "version" ? "Speichert …" : "Version speichern"}</button></footer>}</form>
          {selectedVersion.status !== "draft" && <p className="package-lock-note"><strong>Unveränderliche Ausgabe:</strong> Bestehende Verträge und spätere Bestätigungen können dauerhaft auf diese Version verweisen.</p>}
        </section>

        <section className="package-rights"><div className="package-section-heading"><div><p className="eyebrow">Leistungsumfang</p><h3>Rechte und Leistungen</h3></div>{canWrite && selectedVersion.status === "draft" && <button className="access-secondary" onClick={() => openRight("new")}>Leistung hinzufügen</button>}</div>{selectedRights.length === 0 ? <p className="package-rights-empty">Noch keine Leistungen erfasst.</p> : <div className="package-right-list">{selectedRights.map((right) => <article key={right.id}><div><strong>{right.name}</strong><small>{right.description || "Keine Beschreibung"}</small></div><dl><div><dt>Menge</dt><dd>{right.quantity}</dd></div><div><dt>Termin</dt><dd>{right.schedule_text || "–"}</dd></div><div><dt>Kanal / Ort</dt><dd>{[right.channel, right.location].filter(Boolean).join(" · ") || "–"}</dd></div><div><dt>Verantwortlich</dt><dd>{right.responsible_role || "–"}</dd></div></dl><span className={right.exclusivity_scope === "none" ? "right-exclusive" : "right-exclusive right-exclusive--active"}>{right.exclusivity_scope === "none" ? "Nicht exklusiv" : `${exclusivityLabels[right.exclusivity_scope]} · ${right.exclusivity_key}`}</span>{canWrite && selectedVersion.status === "draft" && <button onClick={() => openRight(right)}>Bearbeiten</button>}</article>)}</div>}</section>
      </main>}
    </div>}

    {rightEditor && <div className="package-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRightEditor(null); }}><section className="package-dialog" role="dialog" aria-modal="true" aria-labelledby="package-right-title"><header><div><p className="eyebrow">Strukturierte Leistung</p><h2 id="package-right-title">{rightEditor === "new" ? "Leistung hinzufügen" : rightEditor.name}</h2></div><button type="button" aria-label="Schliessen" onClick={() => setRightEditor(null)}>×</button></header><form onSubmit={saveRight}><div className="package-right-form"><label className="wide"><span>Name</span><input required maxLength={160} value={rightDraft.name} onChange={(event) => setRightDraft((current) => ({ ...current, name: event.target.value }))}/></label><label className="wide"><span>Beschreibung</span><textarea maxLength={2000} value={rightDraft.description} onChange={(event) => setRightDraft((current) => ({ ...current, description: event.target.value }))}/></label><label><span>Menge</span><input required min="1" type="number" value={rightDraft.quantity} onChange={(event) => setRightDraft((current) => ({ ...current, quantity: event.target.value }))}/></label><label><span>Termin / Rhythmus</span><input maxLength={300} value={rightDraft.scheduleText} onChange={(event) => setRightDraft((current) => ({ ...current, scheduleText: event.target.value }))}/></label><label><span>Kanal</span><input maxLength={120} placeholder="z. B. Stadion, Website" value={rightDraft.channel} onChange={(event) => setRightDraft((current) => ({ ...current, channel: event.target.value }))}/></label><label><span>Standort</span><input maxLength={160} placeholder="z. B. Hauptplatz Nord" value={rightDraft.location} onChange={(event) => setRightDraft((current) => ({ ...current, location: event.target.value }))}/></label><label><span>Verantwortlichkeit</span><input maxLength={120} value={rightDraft.responsibleRole} onChange={(event) => setRightDraft((current) => ({ ...current, responsibleRole: event.target.value }))}/></label><label><span>Exklusivität</span><select value={rightDraft.exclusivityScope} onChange={(event) => setRightDraft((current) => ({ ...current, exclusivityScope: event.target.value as ExclusivityScope, exclusivityKey: event.target.value === "none" ? "" : current.exclusivityKey }))}>{Object.entries(exclusivityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{rightDraft.exclusivityScope !== "none" && <label className="wide"><span>Exklusivitäts-Schlüssel</span><input required maxLength={160} placeholder="z. B. Versicherungen oder hauptplatz-nord" value={rightDraft.exclusivityKey} onChange={(event) => setRightDraft((current) => ({ ...current, exclusivityKey: event.target.value }))}/><small>Gleicher Bereich und Schlüssel dürfen nicht doppelt reserviert werden.</small></label>}</div>{error && <p className="form-error" role="alert">{error}</p>}<footer><button className="access-secondary" type="button" onClick={() => setRightEditor(null)}>Abbrechen</button><button className="access-primary" disabled={busy === "right"}>{busy === "right" ? "Speichert …" : "Leistung speichern"}</button></footer></form></section></div>}
  </section>;
}

function VersionFields({ form, setForm, disabled = false }: { form: VersionForm; setForm: React.Dispatch<React.SetStateAction<VersionForm>>; disabled?: boolean }) {
  const update = <Key extends keyof VersionForm>(key: Key, value: VersionForm[Key]) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="package-version-fields"><label className="wide"><span>Paketname</span><input disabled={disabled} required maxLength={160} value={form.name} onChange={(event) => update("name", event.target.value)}/></label><label className="wide"><span>Beschreibung</span><textarea disabled={disabled} maxLength={3000} value={form.description} onChange={(event) => update("description", event.target.value)}/></label><label><span>Preis in CHF</span><input disabled={disabled} required inputMode="decimal" value={form.price} onChange={(event) => update("price", event.target.value)}/></label><label><span>Laufzeit in Monaten</span><input disabled={disabled} required min="1" max="120" type="number" value={form.durationMonths} onChange={(event) => update("durationMonths", event.target.value)}/></label><label><span>Zahlungsplan</span><select disabled={disabled} value={form.paymentPlan} onChange={(event) => update("paymentPlan", event.target.value as PaymentPlan)}>{Object.entries(paymentPlanLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Zahlungsbedingungen</span><input disabled={disabled} maxLength={500} value={form.paymentTerms} onChange={(event) => update("paymentTerms", event.target.value)}/></label><label><span>Gültig ab</span><input disabled={disabled} type="date" value={form.validFrom} onChange={(event) => update("validFrom", event.target.value)}/></label><label><span>Gültig bis</span><input disabled={disabled} type="date" value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)}/></label><label><span>Sichtbarkeit</span><select disabled={disabled} value={form.visibility} onChange={(event) => update("visibility", event.target.value as Visibility)}>{Object.entries(visibilityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Kapazität</span><input disabled={disabled} min="1" type="number" placeholder="Leer = unbegrenzt" value={form.capacity} onChange={(event) => update("capacity", event.target.value)}/></label><label className="wide package-approval"><input disabled={disabled} type="checkbox" checked={form.deviationApprovalRequired} onChange={(event) => update("deviationApprovalRequired", event.target.checked)}/><span>Preisabweichungen, Rabatte und Sachleistungen benötigen eine interne Freigabe.</span></label></div>;
}
