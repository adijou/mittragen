import { useEffect, useState } from "react";

export type OrganizationTenant = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  role: string;
  permissions: string[];
};

const typeLabels: Record<string, string> = {
  club: "Sportklub",
  association: "Verein / Organisation",
  event: "Event",
  project: "Projekt",
};

async function updateOrganization(tenantId: string, name: string, kind: string) {
  const response = await fetch(`/api/tenants/${tenantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind }),
  });
  const body = await response.json().catch(() => ({})) as { tenant?: OrganizationTenant; error?: string };
  if (!response.ok || !body.tenant) throw new Error(body.error ?? "tenant_update_failed");
  return body.tenant;
}

export function OrganizationSettings({ tenant, canManage, onSaved }: {
  tenant: OrganizationTenant;
  canManage: boolean;
  onSaved: (tenant: OrganizationTenant) => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [kind, setKind] = useState(tenant.kind);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(tenant.name);
    setKind(tenant.kind);
    setError("");
    setMessage("");
  }, [tenant.id, tenant.name, tenant.kind]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await updateOrganization(tenant.id, name, kind);
      onSaved(updated);
      setMessage("Organisation wurde aktualisiert.");
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "tenant_update_failed";
      setError(code === "invalid_name" ? "Der Name muss zwischen 2 und 120 Zeichen lang sein." : code === "permission_denied" ? "Nur Owner können die Organisation bearbeiten." : "Die Organisation konnte nicht aktualisiert werden.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="organization-settings">
    <header><p className="eyebrow">Organisation</p><h1>Einstellungen</h1><p>Der sichtbare Name darf sich während einer Fusion verändern. Der technische Kurzname bleibt stabil.</p></header>
    <div className="organization-settings__grid">
      <form onSubmit={submit} className="organization-card">
        <div><p className="eyebrow">Grunddaten</p><h2>Name und Typ</h2></div>
        <label><span>Anzeigename</span><input required minLength={2} maxLength={120} disabled={!canManage} value={name} onChange={(event) => setName(event.target.value)}/></label>
        <label><span>Organisationstyp</span><select disabled={!canManage} value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Technischer Kurzname</span><input readOnly value={tenant.slug}/><small>Bleibt stabil, damit Links und Integrationen bei einer Umbenennung weiter funktionieren.</small></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        {canManage ? <button className="access-primary" disabled={saving || (name.trim() === tenant.name && kind === tenant.kind)}>{saving ? "Wird gespeichert …" : "Änderungen speichern"}</button> : <p className="organization-readonly">Diese Einstellungen können nur von einem Owner geändert werden.</p>}
      </form>
      <aside className="organization-card organization-card--note"><p className="eyebrow">Fusionsfreundlich</p><h2>Arbeitsname heute, Klubname morgen</h2><p>Sie können beispielsweise mit «Fusion FC Bösingen & FC Wünnewil-Flamatt» starten und den Anzeigenamen nach dem Namensentscheid ändern. Sponsoren, Verträge und Historie bleiben derselben Organisation zugeordnet.</p><dl><div><dt>Aktueller Typ</dt><dd>{typeLabels[tenant.kind] ?? tenant.kind}</dd></div><div><dt>Status</dt><dd>{tenant.status}</dd></div><div><dt>Kurzname</dt><dd>{tenant.slug}</dd></div></dl></aside>
    </div>
  </section>;
}
