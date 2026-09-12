import { useEffect, useMemo, useState } from "react";

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
  status: string;
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
  status: "draft",
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
  status: sponsor.status,
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
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<SponsorForm>(emptyForm);

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
    if (!query) return sponsors;
    return sponsors.filter((sponsor) => [
      sponsor.legal_name,
      sponsor.contact_name,
      sponsor.contact_email,
      sponsor.city,
      sponsor.source_organization,
    ].some((value) => value?.toLocaleLowerCase("de-CH").includes(query)));
  }, [search, sponsors]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setFormOpen(true);
  };

  const openEdit = (sponsor: Sponsor) => {
    setEditing(sponsor);
    setForm(formFromSponsor(sponsor));
    setError("");
    setFormOpen(true);
  };

  const update = (field: keyof SponsorForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const amount = Number(form.annualValue.replace("'", "").replace(",", "."));
      const website = form.website && !/^https?:\/\//i.test(form.website) ? `https://${form.website}` : form.website;
      const payload = {
        legal_name: form.legalName,
        contact_name: form.contactName,
        contact_email: form.contactEmail,
        phone: form.phone,
        street: form.street,
        postal_code: form.postalCode,
        city: form.city,
        website,
        source_organization: form.sourceOrganization,
        status: form.status,
        proposal_package: form.proposalPackage,
        assigned_package_version_id: form.assignedPackageVersionId || null,
        annual_value_cents: Number.isFinite(amount) ? Math.round(amount * 100) : -1,
        notes: form.notes,
      };
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
      {canWrite && <button className="access-primary" onClick={openCreate}>Sponsor erfassen</button>}
    </header>
    <div className="sponsor-toolbar">
      <label><span>Suche</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Firma, Kontakt oder Ort"/></label>
      <strong>{visibleSponsors.length} von {sponsors.length}</strong>
    </div>
    {loading ? <div className="sponsor-directory__state">Sponsoren werden geladen …</div> : error && !formOpen ? <div className="workspace-error"><strong>Die Sponsoren konnten nicht geladen werden.</strong><p>{error}</p></div> : visibleSponsors.length === 0 ? <div className="sponsor-directory__state"><strong>Noch keine passenden Sponsoren.</strong><p>{canWrite ? "Erfassen Sie den ersten Sponsor für diese Organisation." : "Ändern Sie den Suchbegriff."}</p></div> : <div className="sponsor-table-wrap"><table className="sponsor-table"><thead><tr><th>Sponsor</th><th>Kontakt</th><th>Status</th><th></th></tr></thead><tbody>{visibleSponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.legal_name}</strong><small>{[sponsor.postal_code, sponsor.city].filter(Boolean).join(" ") || sponsor.source_organization || "–"}</small></td><td><strong>{sponsor.contact_name || "–"}</strong><small>{sponsor.contact_email || sponsor.phone || "Kein Kontakt hinterlegt"}</small></td><td><span className={`sponsor-status sponsor-status--${sponsor.status}`}>{statusLabels[sponsor.status] ?? sponsor.status}</span></td><td>{canWrite && <button className="sponsor-edit" onClick={() => openEdit(sponsor)}>Bearbeiten</button>}</td></tr>)}</tbody></table></div>}

    {formOpen && <div className="sponsor-form-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><section className="sponsor-form" role="dialog" aria-modal="true" aria-labelledby="sponsor-form-title"><header><div><p className="eyebrow">{editing ? "Stammdaten bearbeiten" : "Neuer Eintrag"}</p><h2 id="sponsor-form-title">{editing ? editing.legal_name : "Sponsor erfassen"}</h2></div><button type="button" aria-label="Schliessen" onClick={() => setFormOpen(false)} disabled={saving}>×</button></header><form onSubmit={submit}><div className="sponsor-form-grid"><label className="sponsor-form-wide"><span>Firmenname</span><input required value={form.legalName} onChange={(event) => update("legalName", event.target.value)}/></label><label><span>Kontaktperson</span><input value={form.contactName} onChange={(event) => update("contactName", event.target.value)}/></label><label><span>Kontakt-E-Mail</span><input type="email" value={form.contactEmail} onChange={(event) => update("contactEmail", event.target.value)}/></label><label><span>Telefon</span><input value={form.phone} onChange={(event) => update("phone", event.target.value)}/></label><label><span>Website</span><input value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="beispiel.ch"/></label><label className="sponsor-form-wide"><span>Strasse</span><input value={form.street} onChange={(event) => update("street", event.target.value)}/></label><label><span>PLZ</span><input value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)}/></label><label><span>Ort</span><input value={form.city} onChange={(event) => update("city", event.target.value)}/></label><label><span>Herkunft</span><input value={form.sourceOrganization} onChange={(event) => update("sourceOrganization", event.target.value)} placeholder="z. B. FC Bösingen"/></label><label><span>Status</span><select value={form.status} onChange={(event) => update("status", event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="sponsor-form-wide"><span>Interne Notizen</span><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} maxLength={5000}/></label></div><p className="sponsor-form-note">Paket und Jahreswert werden im Vertragscenter ausgewählt.</p>{error && <p className="form-error" role="alert">{error}</p>}<footer><button className="access-secondary" type="button" disabled={saving} onClick={() => setFormOpen(false)}>Abbrechen</button><button className="access-primary" disabled={saving}>{saving ? "Wird gespeichert …" : editing ? "Änderungen speichern" : "Sponsor speichern"}</button></footer></form></section></div>}
  </section>;
}
