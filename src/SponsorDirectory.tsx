import { useEffect, useMemo, useState } from "react";
import { SponsorAccessPanel } from "./SponsorAccessPanel";
import { SponsorLogoPanel, SponsorLogoPreview, type SponsorLogoState } from "./SponsorLogoPanel";
import { packageOverview, sponsorPackageCsv, type SponsorPackageAssignment } from "./sponsorPackageOverview";

type Sponsor = {
  id: string;
  legal_name: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  website: string | null;
  source_organization: string | null;
  status: string;
  proposal_package: string | null;
  assigned_package_version_id: string | null;
  assigned_package_name: string | null;
  annual_value_cents: number;
  notes: string | null;
  updated_at: string;
  logo_available: boolean;
  logo_updated_at: string | null;
  package_assignments?: SponsorPackageAssignment[];
};

type SponsorForm = {
  legalName: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  website: string;
  sourceOrganization: string;
  status: "active" | "inactive";
  proposalPackage: string;
  assignedPackageVersionId: string;
  annualValue: string;
  notes: string;
};

const emptyForm = (): SponsorForm => ({
  legalName: "",
  contactName: "",
  contactEmail: "",
  phone: "",
  street: "",
  postalCode: "",
  city: "",
  website: "",
  sourceOrganization: "",
  status: "active",
  proposalPackage: "",
  assignedPackageVersionId: "",
  annualValue: "0",
  notes: "",
});

const statusLabels: Record<string, string> = {
  draft: "Entwurf",
  prepared: "Vorbereitet",
  review: "In Prüfung",
  opened: "Vorschlag geöffnet",
  question: "Rückfrage",
  approved: "Zugesagt",
  active: "Aktiv",
  inactive: "Inaktiv",
};

const operationalStatusLabels = {
  active: "Aktiv",
  inactive: "Inaktiv",
} as const;

const errorLabels: Record<string, string> = {
  invalid_legal_name: "Bitte einen gültigen Firmennamen eintragen.",
  invalid_contact_email: "Die Kontakt-E-Mail ist nicht gültig.",
  invalid_website: "Die Website-Adresse ist nicht gültig.",
  invalid_annual_value: "Der Jahreswert ist nicht gültig.",
  invalid_assigned_package: "Das gewählte Paket ist nicht mehr verfügbar.",
  permission_denied: "Für diese Änderung fehlt die Berechtigung.",
  sponsor_not_found: "Der Sponsor wurde nicht gefunden.",
};

async function requestApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

const formFromSponsor = (sponsor: Sponsor): SponsorForm => ({
  legalName: sponsor.legal_name,
  contactName: sponsor.contact_name ?? "",
  contactEmail: sponsor.contact_email ?? "",
  phone: sponsor.phone ?? "",
  street: sponsor.street ?? "",
  postalCode: sponsor.postal_code ?? "",
  city: sponsor.city ?? "",
  website: sponsor.website ?? "",
  sourceOrganization: sponsor.source_organization ?? "",
  status: sponsor.status === "inactive" ? "inactive" : "active",
  proposalPackage: sponsor.proposal_package ?? "",
  assignedPackageVersionId: sponsor.assigned_package_version_id ?? "",
  annualValue: String(sponsor.annual_value_cents / 100),
  notes: sponsor.notes ?? "",
});

export function SponsorDirectory({ tenantId, canWrite, onChanged }: {
  tenantId: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [accessSponsor, setAccessSponsor] = useState<Sponsor | null>(null);
  const [logoSponsor, setLogoSponsor] = useState<Sponsor | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoFilter, setLogoFilter] = useState("all");
  const [showPackages, setShowPackages] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<SponsorForm>(emptyForm);
  const [statusChanged, setStatusChanged] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await requestApi<{ sponsors: Sponsor[] }>(`/api/sponsors/${tenantId}`);
      setSponsors(result.sponsors);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "sponsors_load_failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenantId]);

  const visibleSponsors = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("de-CH");
    return sponsors.filter((sponsor) => (logoFilter === "all" || (logoFilter === "missing" ? !sponsor.logo_available : sponsor.logo_available))
      && (!query || [
      sponsor.legal_name,
      sponsor.contact_name,
      sponsor.contact_email,
      sponsor.city,
      sponsor.source_organization,
    ].some((value) => value?.toLocaleLowerCase("de-CH").includes(query))));
  }, [search, sponsors, logoFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setStatusChanged(false);
    setError("");
    setFormOpen(true);
  };

  const exportSponsors = () => {
    const url = URL.createObjectURL(new Blob([sponsorPackageCsv(sponsors)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `sponsoren-pakete-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const overview = useMemo(() => packageOverview(visibleSponsors), [visibleSponsors]);

  const openEdit = (sponsor: Sponsor) => {
    setEditing(sponsor);
    setForm(formFromSponsor(sponsor));
    setStatusChanged(false);
    setError("");
    setFormOpen(true);
  };

  const updateLogo = (sponsorId: string, logo: SponsorLogoState) => {
    const updateSponsor = (sponsor: Sponsor) => sponsor.id === sponsorId ? { ...sponsor, logo_available: logo.available, logo_updated_at: logo.updatedAt } : sponsor;
    setSponsors((current) => current.map(updateSponsor));
    setEditing((current) => current ? updateSponsor(current) : null);
    setLogoSponsor((current) => current ? updateSponsor(current) : null);
  };

  const update = (field: keyof SponsorForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const amount = Number(form.annualValue.replace("'", "").replace(",", "."));
      const website = form.website && !/^https?:\/\//i.test(form.website) ? `https://${form.website}` : form.website;
      const payload: Record<string, unknown> = {
        legal_name: form.legalName,
        contact_name: form.contactName,
        contact_email: form.contactEmail,
        phone: form.phone,
        street: form.street,
        postal_code: form.postalCode,
        city: form.city,
        website,
        source_organization: form.sourceOrganization,
        proposal_package: form.proposalPackage,
        assigned_package_version_id: form.assignedPackageVersionId || null,
        annual_value_cents: Number.isFinite(amount) ? Math.round(amount * 100) : -1,
        notes: form.notes,
      };
      if (editing && (statusChanged || editing.status === "active" || editing.status === "inactive")) {
        payload.status = form.status;
      }
      const path = editing ? `/api/sponsors/${tenantId}/${editing.id}` : `/api/sponsors/${tenantId}`;
      await requestApi(path, { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setFormOpen(false);
      await load();
      onChanged();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "sponsor_write_failed";
      setError(errorLabels[code] ?? "Der Sponsor konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="sponsor-directory">
    <header className="sponsor-directory__heading">
      <div><p className="eyebrow">Stammdaten</p><h1>Sponsoren</h1><p>Firmen- und Kontaktdaten zentral pflegen. Paket und Jahreswert werden beim Vertrag festgelegt.</p></div>
      <div className="sponsor-row-actions"><button className="access-secondary" onClick={() => setShowPackages(!showPackages)} aria-pressed={showPackages}>Paketübersicht</button><button className="access-secondary" disabled={loading || !!error || sponsors.length === 0} onClick={exportSponsors}>Alle Sponsoren exportieren</button>{canWrite && <button className="access-primary" onClick={openCreate}>Sponsor erfassen</button>}</div>
    </header>
    <div className="sponsor-toolbar">
      <label><span>Suche</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Firma, Kontakt oder Ort"/></label>
      <label><span>Logo-Status</span><select value={logoFilter} onChange={(event) => setLogoFilter(event.target.value)}><option value="all">Alle Sponsoren</option><option value="missing">Ohne Logo</option><option value="present">Mit Logo</option></select></label>
      <strong>{visibleSponsors.length} von {sponsors.length}<small>{sponsors.filter((sponsor) => !sponsor.logo_available).length} ohne Logo</small></strong>
    </div>
    {showPackages && !loading && !error && <section className="sponsor-package-overview"><h2>Sponsoren und ihre Pakete</h2><p>Bestätigte Verträge einschliesslich Altbestand. Beträge in CHF pro Jahr; 0 bedeutet kostenlos, ein leeres Feld bedeutet kein zugeordnetes Paket. Entwürfe und aufgehobene Verträge sind nicht enthalten.</p><div className="sponsor-table-wrap"><table className="sponsor-table"><thead><tr><th>Sponsor</th>{overview.columns.map(column => <th key={column.id}>{column.name}</th>)}<th>Total CHF/Jahr</th></tr></thead><tbody>{overview.rows.map(({ sponsor, amounts, totalCents }) => <tr key={sponsor.id}><td><strong>{sponsor.legal_name}</strong></td>{overview.columns.map(column => <td key={column.id}>{amounts.has(column.id) ? new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(amounts.get(column.id)! / 100) : "–"}</td>)}<td><strong>{new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2 }).format(totalCents / 100)}</strong></td></tr>)}</tbody></table></div><p>Der Export enthält immer alle Sponsoren der gewählten Organisation, auch ohne Paket.</p></section>}
    {loading ? <div className="sponsor-directory__state">Sponsoren werden geladen …</div> : error && !formOpen ? <div className="workspace-error"><strong>Die Sponsoren konnten nicht geladen werden.</strong><p>{error}</p></div> : visibleSponsors.length === 0 ? <div className="sponsor-directory__state"><strong>Noch keine passenden Sponsoren.</strong><p>{sponsors.length === 0 && canWrite ? "Erfassen Sie den ersten Sponsor für diese Organisation." : "Ändern Sie den Suchbegriff oder den Logo-Filter."}</p></div> : <div className="sponsor-table-wrap"><table className="sponsor-table"><thead><tr><th>Logo</th><th>Sponsor</th><th>Kontakt</th><th>Status</th><th></th></tr></thead><tbody>{visibleSponsors.map((sponsor) => <tr key={sponsor.id}><td className="sponsor-logo-cell">{canWrite ? <button type="button" className="sponsor-logo-button" aria-label={`Logo von ${sponsor.legal_name} verwalten`} onClick={() => setLogoSponsor(sponsor)}><SponsorLogoPreview src={`/api/sponsors/${tenantId}/${sponsor.id}/logo?v=${encodeURIComponent(sponsor.logo_updated_at ?? "current")}`} name={sponsor.legal_name} available={sponsor.logo_available}/></button> : <SponsorLogoPreview src={`/api/sponsors/${tenantId}/${sponsor.id}/logo?v=${encodeURIComponent(sponsor.logo_updated_at ?? "current")}`} name={sponsor.legal_name} available={sponsor.logo_available}/>}</td><td><strong>{sponsor.legal_name}</strong><small>{[sponsor.postal_code, sponsor.city].filter(Boolean).join(" ") || sponsor.source_organization || "–"}</small></td><td><strong>{sponsor.contact_name || "–"}</strong><small>{sponsor.contact_email || sponsor.phone || "Kein Kontakt hinterlegt"}</small></td><td><span className={`sponsor-status sponsor-status--${sponsor.status}`}>{statusLabels[sponsor.status] ?? sponsor.status}</span></td><td>{canWrite && <div className="sponsor-row-actions"><button className="sponsor-edit" onClick={() => openEdit(sponsor)}>Bearbeiten</button><button className="sponsor-edit" onClick={() => setAccessSponsor(sponsor)}>Zugang einrichten</button></div>}</td></tr>)}</tbody></table></div>}

    {formOpen && <div className="sponsor-form-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !logoBusy) setFormOpen(false); }}><section className="sponsor-form" role="dialog" aria-modal="true" aria-labelledby="sponsor-form-title"><header><div><p className="eyebrow">{editing ? "Stammdaten bearbeiten" : "Neuer Eintrag"}</p><h2 id="sponsor-form-title">{editing ? editing.legal_name : "Sponsor erfassen"}</h2></div><button type="button" aria-label="Schliessen" onClick={() => setFormOpen(false)} disabled={saving || logoBusy}>×</button></header>{editing && canWrite && <SponsorLogoPanel key={`logo:${editing.id}`} tenantId={tenantId} sponsorId={editing.id} name={editing.legal_name} logo={{ available: editing.logo_available, updatedAt: editing.logo_updated_at }} disabled={saving} onBusyChange={setLogoBusy} onChanged={(logo) => updateLogo(editing.id, logo)}/>}<form onSubmit={submit}><div className="sponsor-form-grid"><label className="sponsor-form-wide"><span>Firmenname</span><input required value={form.legalName} onChange={(event) => update("legalName", event.target.value)}/></label><label><span>Kontaktperson</span><input value={form.contactName} onChange={(event) => update("contactName", event.target.value)}/></label><label><span>Kontakt-E-Mail</span><input type="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)}/></label><label><span>Telefon</span><input value={form.phone} onChange={(event) => update("phone", event.target.value)}/></label><label><span>Website</span><input value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="beispiel.ch"/></label><label className="sponsor-form-wide"><span>Strasse</span><input value={form.street} onChange={(event) => update("street", event.target.value)}/></label><label><span>PLZ</span><input value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)}/></label><label><span>Ort</span><input value={form.city} onChange={(event) => update("city", event.target.value)}/></label><label><span>Herkunft</span><input value={form.sourceOrganization} onChange={(event) => update("sourceOrganization", event.target.value)} placeholder="z. B. FC Bösingen"/></label>{editing && <label><span>Status</span><select value={form.status} onChange={(event) => { update("status", event.target.value); setStatusChanged(true); }}>{Object.entries(operationalStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}<label className="sponsor-form-wide"><span>Interne Notizen</span><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} maxLength={5000}/></label></div><p className="sponsor-form-note">Paket und Jahreswert werden im Vertragscenter ausgewählt.</p>{error && <p className="form-error" role="alert">{error}</p>}<footer><button className="access-secondary" type="button" disabled={saving || logoBusy} onClick={() => setFormOpen(false)}>Abbrechen</button><button className="access-primary" disabled={saving || logoBusy}>{saving ? "Wird gespeichert …" : editing ? "Änderungen speichern" : "Sponsor speichern"}</button></footer></form>{editing && canWrite && <SponsorAccessPanel key={editing.id} tenantId={tenantId} sponsorId={editing.id} contactEmail={editing.contact_email}/>}</section></div>}
    {logoSponsor && canWrite && <div className="sponsor-form-overlay" role="presentation"><section className="sponsor-form" role="dialog" aria-modal="true" aria-labelledby="sponsor-logo-title"><header><div><p className="eyebrow">Logo verwalten</p><h2 id="sponsor-logo-title">{logoSponsor.legal_name}</h2></div><button type="button" aria-label="Schliessen" disabled={logoBusy} onClick={() => setLogoSponsor(null)}>×</button></header><SponsorLogoPanel key={logoSponsor.id} tenantId={tenantId} sponsorId={logoSponsor.id} name={logoSponsor.legal_name} logo={{ available: logoSponsor.logo_available, updatedAt: logoSponsor.logo_updated_at }} disabled={false} onBusyChange={setLogoBusy} onChanged={(logo) => updateLogo(logoSponsor.id, logo)}/></section></div>}
    {accessSponsor && canWrite && <div className="sponsor-form-overlay" role="presentation"><section className="sponsor-form" role="dialog" aria-modal="true" aria-labelledby="sponsor-access-title"><header><div><p className="eyebrow">Sponsorzugang</p><h2 id="sponsor-access-title">{accessSponsor.legal_name}</h2></div><button type="button" aria-label="Schliessen" onClick={() => setAccessSponsor(null)}>×</button></header><SponsorAccessPanel key={accessSponsor.id} tenantId={tenantId} sponsorId={accessSponsor.id} contactEmail={accessSponsor.contact_email}/></section></div>}
  </section>;
}
