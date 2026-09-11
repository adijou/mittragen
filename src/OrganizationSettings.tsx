import { useEffect, useMemo, useState } from "react";
import { extractBrandColors } from "./brandColors";

export type OrganizationTenant = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  role: string;
  permissions: string[];
};

export type OrganizationProfile = {
  displayName: string;
  legalName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  representativeName: string | null;
  representativeTitle: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  renewalMode: "manual" | "annual_auto";
  noticeMonths: number | null;
  placeOfJurisdiction: string | null;
  logoAvailable: boolean;
  logoUpdatedAt: string | null;
  brandPrimaryColor: string;
  brandAccentColor: string;
  contractComplete: boolean;
  dossierContactComplete: boolean;
};

type ProfileForm = Omit<OrganizationProfile, "displayName" | "logoAvailable" | "logoUpdatedAt" | "contractComplete" | "dossierContactComplete">;

const typeLabels: Record<string, string> = {
  club: "Sportklub",
  association: "Verein / Organisation",
  event: "Event",
  project: "Projekt",
};

const emptyProfile: ProfileForm = {
  legalName: "",
  street: "",
  postalCode: "",
  city: "",
  country: "Schweiz",
  representativeName: "",
  representativeTitle: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
  renewalMode: "manual",
  noticeMonths: null,
  placeOfJurisdiction: "",
  brandPrimaryColor: "#0B2144",
  brandAccentColor: "#1967FF",
};

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

async function updateOrganization(tenantId: string, name: string, kind: string) {
  const body = await request<{ tenant: OrganizationTenant }>(`/api/tenants/${tenantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  return body.tenant;
}

function formFromProfile(profile: OrganizationProfile): ProfileForm {
  return Object.fromEntries(Object.keys(emptyProfile).map((key) => [key, profile[key as keyof ProfileForm] ?? emptyProfile[key as keyof ProfileForm]])) as ProfileForm;
}

export function OrganizationSettings({ tenant, canManage, onSaved }: {
  tenant: OrganizationTenant;
  canManage: boolean;
  onSaved: (tenant: OrganizationTenant) => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [kind, setKind] = useState(tenant.kind);
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyProfile);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const logoPreview = useMemo(() => logoFile ? URL.createObjectURL(logoFile) : null, [logoFile]);

  const loadProfile = async () => {
    const result = await request<{ organization: OrganizationProfile }>(`/api/organization/${tenant.id}`);
    setProfile(result.organization);
    setForm(formFromProfile(result.organization));
  };

  useEffect(() => {
    setName(tenant.name);
    setKind(tenant.kind);
    setLogoFile(null);
    setError("");
    setMessage("");
    setLoading(true);
    void loadProfile().catch(() => setError("Das Organisationsprofil konnte nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenant.id, tenant.name, tenant.kind]);

  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);

  const update = <Key extends keyof ProfileForm>(field: Key, value: ProfileForm[Key]) => setForm((current) => ({ ...current, [field]: value }));

  const submitBasics = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving("basics"); setError(""); setMessage("");
    try {
      const updated = await updateOrganization(tenant.id, name, kind);
      onSaved(updated);
      setMessage("Name und Typ wurden aktualisiert.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "tenant_update_failed";
      setError(code === "invalid_name" ? "Der Name muss zwischen 2 und 120 Zeichen lang sein." : code === "permission_denied" ? "Nur Owner können die Organisation bearbeiten." : "Die Organisation konnte nicht aktualisiert werden.");
    } finally { setSaving(""); }
  };

  const chooseLogo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setError(""); setMessage("");
    if (!file) { setLogoFile(null); return; }
    if (!(["image/png", "image/jpeg"].includes(file.type)) || file.size > 2 * 1024 * 1024) {
      event.target.value = "";
      setLogoFile(null);
      setError("Bitte ein PNG- oder JPEG-Logo mit höchstens 2 MB wählen.");
      return;
    }
    try {
      const colors = await extractBrandColors(file);
      setLogoFile(file);
      setForm((current) => ({ ...current, brandPrimaryColor: colors.primary, brandAccentColor: colors.accent }));
      setMessage("Logo analysiert. Die erkannten Farben können vor dem Speichern angepasst werden.");
    } catch {
      setLogoFile(file);
      setError("Die Farben konnten nicht automatisch erkannt werden. Bitte die Farbwerte manuell wählen.");
    }
  };

  const submitProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving("profile"); setError(""); setMessage("");
    try {
      const website = form.website?.trim() && !/^https?:\/\//i.test(form.website) ? `https://${form.website.trim()}` : form.website?.trim();
      let result = await request<{ organization: OrganizationProfile }>(`/api/organization/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, website: website || null, noticeMonths: form.renewalMode === "annual_auto" ? form.noticeMonths : null }),
      });
      if (logoFile) {
        const upload = new FormData();
        upload.append("logo", logoFile);
        upload.append("brandPrimaryColor", form.brandPrimaryColor);
        upload.append("brandAccentColor", form.brandAccentColor);
        result = await request<{ organization: OrganizationProfile }>(`/api/organization/${tenant.id}/logo`, { method: "POST", body: upload });
      }
      setProfile(result.organization);
      setForm(formFromProfile(result.organization));
      setLogoFile(null);
      setMessage(logoFile ? "Organisationsprofil, Logo und Dossierfarben wurden gespeichert." : "Das zentrale Organisationsprofil wurde gespeichert.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "organization_save_failed";
      setError(code === "invalid_logo_size" ? "Das Logo darf höchstens 2 MB gross sein." : code === "invalid_logo_type" || code === "invalid_logo_file" ? "Die Datei ist kein lesbares PNG- oder JPEG-Logo." : code === "invalid_logo_dimensions" ? "Das Logo muss zwischen 16 × 16 und 6000 × 6000 Pixel gross sein." : code === "invalid_contact_email" ? "Bitte eine gültige Kontakt-E-Mail eintragen." : code === "invalid_website" ? "Bitte eine gültige Website-Adresse eintragen." : "Das Organisationsprofil konnte nicht gespeichert werden.");
    } finally { setSaving(""); }
  };

  return <section className="organization-settings">
    <header><p className="eyebrow">Organisation</p><h1>Zentrale Angaben</h1><p>Eine Quelle für Dossier, Verträge und Erscheinungsbild. Änderungen werden künftig überall konsistent verwendet.</p></header>
    <div className="organization-settings__grid">
      <form onSubmit={submitBasics} className="organization-card">
        <div><p className="eyebrow">Grunddaten</p><h2>Name und Typ</h2></div>
        <label><span>Anzeigename</span><input required minLength={2} maxLength={120} disabled={!canManage} value={name} onChange={(event) => setName(event.target.value)}/></label>
        <label><span>Organisationstyp</span><select disabled={!canManage} value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Technischer Kurzname</span><input readOnly value={tenant.slug}/><small>Bleibt stabil, damit Links und Integrationen weiter funktionieren.</small></label>
        {canManage ? <button className="access-primary" disabled={saving !== "" || (name.trim() === tenant.name && kind === tenant.kind)}>{saving === "basics" ? "Wird gespeichert …" : "Name und Typ speichern"}</button> : <p className="organization-readonly">Diese Einstellungen können nur von einem Owner geändert werden.</p>}
      </form>
      <aside className="organization-card organization-card--note"><p className="eyebrow">Einmal pflegen</p><h2>Überall konsistent</h2><p>Öffentlicher Kontakt und Logo erscheinen im Sponsoringdossier. Rechtliche Angaben bilden den Absender neuer Verträge.</p><dl><div><dt>Dossier</dt><dd>{profile?.dossierContactComplete ? "Kontakt bereit" : "Kontakt unvollständig"}</dd></div><div><dt>Verträge</dt><dd>{profile?.contractComplete ? "Organisation bereit" : "Angaben unvollständig"}</dd></div><div><dt>Branding</dt><dd>{profile?.logoAvailable ? "Eigenes Logo" : "Mittragen-Standard"}</dd></div></dl></aside>
    </div>

    {error && <p className="form-error organization-feedback" role="alert">{error}</p>}
    {message && <p className="form-success organization-feedback" role="status">{message}</p>}
    {loading ? <div className="workspace-loading">Organisationsprofil wird geladen …</div> : <form className="organization-profile" onSubmit={submitProfile}>
      <section className="organization-card organization-card--branding">
        <div><p className="eyebrow">Erscheinungsbild</p><h2>Logo und Dossierfarben</h2><p>Beim Auswählen eines Logos werden zwei passende Farben vorgeschlagen. Beide bleiben manuell anpassbar.</p></div>
        <div className="organization-branding">
          <div className="organization-logo-preview" style={{ background: `linear-gradient(145deg, ${form.brandPrimaryColor}, ${form.brandAccentColor})` }}>
            {(logoPreview || profile?.logoAvailable) ? <img src={logoPreview ?? `/api/organization/${tenant.id}/logo?v=${encodeURIComponent(profile?.logoUpdatedAt ?? "current")}`} alt="Logo der Organisation"/> : <span>Noch kein Logo</span>}
          </div>
          <div className="organization-branding__controls">
            <label><span>Logo hochladen</span><input type="file" accept="image/png,image/jpeg" disabled={!canManage || saving !== ""} onChange={(event) => void chooseLogo(event)}/><small>PNG oder JPEG, maximal 2 MB. Transparente PNGs werden unterstützt.</small></label>
            <div className="organization-color-fields">
              <label><span>Primärfarbe</span><span className="organization-color-input"><input type="color" disabled={!canManage} value={form.brandPrimaryColor} onChange={(event) => update("brandPrimaryColor", event.target.value.toUpperCase())}/><input pattern="#[0-9A-Fa-f]{6}" maxLength={7} disabled={!canManage} value={form.brandPrimaryColor} onChange={(event) => update("brandPrimaryColor", event.target.value.toUpperCase())}/></span></label>
              <label><span>Akzentfarbe</span><span className="organization-color-input"><input type="color" disabled={!canManage} value={form.brandAccentColor} onChange={(event) => update("brandAccentColor", event.target.value.toUpperCase())}/><input pattern="#[0-9A-Fa-f]{6}" maxLength={7} disabled={!canManage} value={form.brandAccentColor} onChange={(event) => update("brandAccentColor", event.target.value.toUpperCase())}/></span></label>
            </div>
          </div>
        </div>
      </section>

      <section className="organization-card">
        <div><p className="eyebrow">Öffentlicher Kontakt</p><h2>Für Dossier und Sponsoren</h2><p>Diese Angaben erscheinen im Sponsoringdossier und dienen als allgemeiner Organisationskontakt.</p></div>
        <div className="organization-profile__fields">
          <label><span>Kontaktperson / Team</span><input maxLength={160} disabled={!canManage} value={form.contactName ?? ""} onChange={(event) => update("contactName", event.target.value)}/></label>
          <label><span>Kontakt-E-Mail</span><input type="email" maxLength={254} disabled={!canManage} value={form.contactEmail ?? ""} onChange={(event) => update("contactEmail", event.target.value)}/></label>
          <label><span>Telefon</span><input maxLength={80} disabled={!canManage} value={form.contactPhone ?? ""} onChange={(event) => update("contactPhone", event.target.value)}/></label>
          <label><span>Website</span><input maxLength={500} disabled={!canManage} value={form.website ?? ""} onChange={(event) => update("website", event.target.value)} placeholder="www.verein.ch"/></label>
        </div>
      </section>

      <section className="organization-card">
        <div><p className="eyebrow">Rechtliche Angaben</p><h2>Absender neuer Verträge</h2><p>Diese Felder werden beim Freigeben eines Vertrags als unveränderlicher Stand übernommen.</p></div>
        <div className="organization-profile__fields">
          <label className="wide"><span>Rechtlicher Name</span><input maxLength={160} disabled={!canManage} value={form.legalName ?? ""} onChange={(event) => update("legalName", event.target.value)}/></label>
          <label className="wide"><span>Strasse</span><input maxLength={160} disabled={!canManage} value={form.street ?? ""} onChange={(event) => update("street", event.target.value)}/></label>
          <label><span>PLZ</span><input maxLength={20} disabled={!canManage} value={form.postalCode ?? ""} onChange={(event) => update("postalCode", event.target.value)}/></label>
          <label><span>Ort</span><input maxLength={120} disabled={!canManage} value={form.city ?? ""} onChange={(event) => update("city", event.target.value)}/></label>
          <label><span>Land</span><input maxLength={120} disabled={!canManage} value={form.country} onChange={(event) => update("country", event.target.value)}/></label>
          <label><span>Vertretungsberechtigte Person</span><input maxLength={160} disabled={!canManage} value={form.representativeName ?? ""} onChange={(event) => update("representativeName", event.target.value)}/></label>
          <label><span>Funktion</span><input maxLength={120} disabled={!canManage} value={form.representativeTitle ?? ""} onChange={(event) => update("representativeTitle", event.target.value)}/></label>
          <label><span>Verlängerung</span><select disabled={!canManage} value={form.renewalMode} onChange={(event) => { const mode = event.target.value as ProfileForm["renewalMode"]; setForm((current) => ({ ...current, renewalMode: mode, noticeMonths: mode === "annual_auto" ? current.noticeMonths ?? 3 : null })); }}><option value="manual">Keine automatische Verlängerung</option><option value="annual_auto">Jährlich automatisch</option></select></label>
          {form.renewalMode === "annual_auto" && <label><span>Kündigungsfrist in Monaten</span><input required min={1} max={12} type="number" disabled={!canManage} value={form.noticeMonths ?? 3} onChange={(event) => update("noticeMonths", Number(event.target.value))}/></label>}
          <label className="wide"><span>Gerichtsstand (optional)</span><input maxLength={160} disabled={!canManage} value={form.placeOfJurisdiction ?? ""} onChange={(event) => update("placeOfJurisdiction", event.target.value)}/></label>
        </div>
      </section>
      {canManage ? <button className="access-primary organization-profile__save" disabled={saving !== ""}>{saving === "profile" ? "Profil wird gespeichert …" : "Organisationsprofil speichern"}</button> : <p className="organization-readonly">Das Organisationsprofil kann nur von einem Owner geändert werden.</p>}
    </form>}
  </section>;
}
