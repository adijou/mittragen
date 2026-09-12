import { useEffect, useState } from "react";
import type { OrganizationProfile } from "./OrganizationSettings";

type DossierProfile = {
  headline: string | null;
  seasonLabel: string | null;
  introduction: string | null;
  clubPortrait: string | null;
  sponsorshipImpact: string | null;
  audience: string | null;
  updatedAt: string | null;
};

type DossierPackage = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMonths: number;
  paymentPlan: string;
  rights: Array<{ name: string; description: string | null }>;
};

type DossierData = {
  tenant: { name: string; slug: string };
  profile: DossierProfile;
  organization: OrganizationProfile;
  missingFields: string[];
  packages: DossierPackage[];
};

type ProfileForm = Record<Exclude<keyof DossierProfile, "updatedAt">, string>;

const emptyForm: ProfileForm = {
  headline: "",
  seasonLabel: "",
  introduction: "",
  clubPortrait: "",
  sponsorshipImpact: "",
  audience: "",
};

const missingLabels: Record<string, string> = {
  headline: "Titel",
  introduction: "Einleitung",
  clubPortrait: "Klubporträt",
  sponsorshipImpact: "Wirkung des Sponsorings",
  contactName: "Kontaktperson",
  contactEmail: "Kontakt-E-Mail",
};

const paymentLabels: Record<string, string> = {
  annual: "jährlich",
  semiannual: "halbjährlich",
  quarterly: "quartalsweise",
  custom: "individuell",
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  maximumFractionDigits: 0,
}).format(cents / 100);

function formFromProfile(profile: DossierProfile): ProfileForm {
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [key, profile[key as keyof ProfileForm] ?? ""])) as ProfileForm;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function SponsoringDossier({ tenantId, canManage, onOpenOrganization }: { tenantId: string; canManage: boolean; onOpenOrganization: () => void }) {
  const [data, setData] = useState<DossierData | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const result = await request<{ dossier: DossierData }>(`/api/dossier/${tenantId}`);
    setData(result.dossier);
    setForm(formFromProfile(result.dossier.profile));
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    void load().catch(() => setError("Das Sponsoringdossier konnte nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const update = (field: keyof ProfileForm, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const result = await request<{ dossier: DossierData }>(`/api/dossier/${tenantId}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setData(result.dossier);
      setForm(formFromProfile(result.dossier.profile));
      setMessage(result.dossier.missingFields.length ? "Inhalte gespeichert. Für das PDF fehlen noch Pflichtangaben." : "Klubprofil gespeichert. Das Dossier ist inhaltlich bereit.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "dossier_save_failed";
      setError(code === "permission_denied" ? "Nur Owner können die Dossierinhalte bearbeiten." : "Die Dossierinhalte konnten nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  };

  const download = async () => {
    setBusy("pdf");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/dossier/${tenantId}/pdf`, { headers: { Accept: "application/pdf" } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `request_failed_${response.status}`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `sponsoringdossier-${data?.tenant.slug ?? "organisation"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Das Sponsoringdossier wurde erstellt und heruntergeladen.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "dossier_pdf_failed";
      setError(code === "dossier_profile_incomplete" ? "Bitte zuerst alle Pflichtangaben des Klubprofils ergänzen." : code === "dossier_packages_required" ? "Für das Dossier muss mindestens ein öffentliches Paket veröffentlicht sein." : "Das PDF konnte nicht erstellt werden.");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <section className="dossier-management"><div className="workspace-loading">Sponsoringdossier wird geladen …</div></section>;
  if (!data) return <section className="dossier-management"><div className="workspace-error"><strong>Das Sponsoringdossier ist nicht verfügbar.</strong><p>{error}</p></div></section>;

  const ready = data.missingFields.length === 0 && data.packages.length > 0;
  return <section className="dossier-management">
    <header><div><p className="eyebrow">Akquiseunterlage</p><h1>Sponsoringdossier</h1><p>Klubprofil und veröffentlichte Sponsoringpakete werden zu einem einheitlichen PDF zusammengestellt.</p></div><button className="access-primary" type="button" disabled={!ready || busy !== ""} onClick={() => void download()}>{busy === "pdf" ? "PDF wird erstellt …" : "Dossier als PDF erstellen"}</button></header>

    {!ready && <section className="dossier-readiness"><div><strong>Noch nicht bereit</strong><p>{data.missingFields.length ? `Offene Angaben: ${data.missingFields.map((field) => missingLabels[field] ?? field).join(", ")}.` : "Das Klubprofil ist vollständig."}</p><p>{data.packages.length ? `${data.packages.length} öffentliche Pakete werden aufgenommen.` : "Es fehlt mindestens ein veröffentlichtes Paket mit Sichtbarkeit «Für Sponsoren sichtbar»."}</p></div></section>}
    {ready && <p className="form-success dossier-feedback">Bereit: {data.packages.length} Pakete und das vollständige Klubprofil werden in das PDF aufgenommen.</p>}
    {error && <p className="form-error dossier-feedback" role="alert">{error}</p>}
    {message && <p className="form-success dossier-feedback" role="status">{message}</p>}

    <div className="dossier-layout">
      <form className="dossier-profile" onSubmit={save}>
        <div><p className="eyebrow">Klubprofil</p><h2>Redaktionelle Inhalte</h2><p>Hier werden nur die Texte des Dossiers gepflegt. Kontakt, Logo und Farben stammen zentral aus «Organisation».</p></div>
        <label><span>Titel des Dossiers <em>Pflicht</em></span><input required minLength={2} maxLength={160} disabled={!canManage} value={form.headline} onChange={(event) => update("headline", event.target.value)} placeholder="Gemeinsam für starke Teams"/></label>
        <label><span>Saison oder Zeitraum</span><input maxLength={80} disabled={!canManage} value={form.seasonLabel} onChange={(event) => update("seasonLabel", event.target.value)} placeholder="Saison 2026/27"/></label>
        <label><span>Kurze Einleitung <em>Pflicht</em></span><textarea required maxLength={2000} disabled={!canManage} value={form.introduction} onChange={(event) => update("introduction", event.target.value)} placeholder="Was verbindet den Klub mit seinen Partnern?"/></label>
        <label><span>Klubporträt <em>Pflicht</em></span><textarea required maxLength={5000} disabled={!canManage} value={form.clubPortrait} onChange={(event) => update("clubPortrait", event.target.value)} placeholder="Geschichte, Teams, Nachwuchs, Werte und regionale Verankerung"/></label>
        <label><span>Wirkung des Sponsorings <em>Pflicht</em></span><textarea required maxLength={5000} disabled={!canManage} value={form.sponsorshipImpact} onChange={(event) => update("sponsorshipImpact", event.target.value)} placeholder="Welche konkreten Angebote und Entwicklungen werden ermöglicht?"/></label>
        <label><span>Zielgruppen und Reichweite</span><textarea maxLength={3000} disabled={!canManage} value={form.audience} onChange={(event) => update("audience", event.target.value)} placeholder="Mitglieder, Familien, Region, Spieltage und digitale Kanäle"/></label>
        {canManage ? <button className="access-primary" disabled={busy !== ""}>{busy === "save" ? "Wird gespeichert …" : "Klubprofil speichern"}</button> : <p className="organization-readonly">Nur Owner können die Dossierinhalte bearbeiten.</p>}
      </form>

      <aside className="dossier-sidebar">
        <section className="dossier-organization"><div><p className="eyebrow">Aus Organisation</p><h2>Kontakt & Erscheinungsbild</h2></div><div className="dossier-brand-preview" style={{ background: data.organization.brandPrimaryColor }}>{data.organization.logoAvailable ? <img src={`/api/organization/${tenantId}/logo?v=${encodeURIComponent(data.organization.logoUpdatedAt ?? "current")}`} alt="Organisationslogo"/> : <span>Standardgestaltung</span>}</div><dl><div><dt>Kontakt</dt><dd>{data.organization.contactName || "Noch offen"}</dd></div><div><dt>E-Mail</dt><dd>{data.organization.contactEmail || "Noch offen"}</dd></div><div><dt>Farben</dt><dd><i style={{ background: data.organization.brandPrimaryColor }}></i><i style={{ background: data.organization.brandAccentColor }}></i></dd></div></dl>{canManage && <button type="button" className="access-secondary" onClick={onOpenOrganization}>In Organisation bearbeiten</button>}</section>
        <section className="dossier-packages"><div><p className="eyebrow">Automatisch aus Paketen</p><h2>{data.packages.length} Pakete im Dossier</h2><p>Berücksichtigt werden aktuell gültige, veröffentlichte und öffentlich sichtbare Paketversionen.</p></div>{data.packages.length === 0 ? <p className="import-empty">Noch keine geeigneten Pakete vorhanden.</p> : <div>{data.packages.map((item) => <article key={item.id}><span>{item.durationMonths} Monate · {paymentLabels[item.paymentPlan] ?? item.paymentPlan}</span><h3>{item.name}</h3><strong>{formatChf(item.priceCents)}</strong>{item.description && <p>{item.description}</p>}<small>{item.rights.length} Leistungen</small></article>)}</div>}</section>
      </aside>
    </div>
  </section>;
}
