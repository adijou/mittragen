import { useEffect, useMemo, useState } from "react";
import {
  AuthError,
  MissingIdentityError,
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  refreshSession,
  requestPasswordRecovery,
  signup,
  updateUser,
  type CallbackResult,
  type User,
} from "@netlify/identity";
import { OrganizationSettings, type OrganizationTenant } from "./OrganizationSettings";
import { SponsorDirectory } from "./SponsorDirectory";
import { TeamManagement } from "./TeamManagement";
import { ImportManagement } from "./ImportManagement";
import { TransitionManagement } from "./TransitionManagement";
import { PackageManagement } from "./PackageManagement";
import { ContractManagement } from "./ContractManagement";
import { SponsoringDossier } from "./SponsoringDossier";
import { EventSponsoringManagement } from "./EventSponsoringManagement";
import { Brand } from "./ProductBrand";

type ProductivePage = "login" | "workspace";
type Availability = "checking" | "ready" | "missing";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  role: string;
  permissions: string[];
};

type WorkspaceData = {
  tenant: Tenant & { default_currency: string };
  membership: { tenant_id: string; role: string; display_name: string | null; permissions: string[] };
  sponsorSummary: Array<{ status: string; count: string; annual_value_cents: string }>;
  demoSponsorCount: number;
  auditEvents: Array<{ action: string; created_at: string; metadata: Record<string, unknown> }>;
};

type WorkspaceSection = "overview" | "sponsors" | "packages" | "dossier" | "events" | "transitions" | "contracts" | "imports" | "team" | "settings";

const activeTenantStorageKey = "mittragen-active-tenant";

const slugFromName = (value: string) => value.toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const roleLabels: Record<string, string> = {
  owner: "Owner",
  sponsoring_admin: "Sponsoring-Admin",
  finance: "Finanzen",
  fulfillment: "Sponsoringleistungen",
  viewer: "Lesen",
};

const permissionLabels: Record<string, string> = {
  "tenant:manage": "Organisation verwalten",
  "members:manage": "Team verwalten",
  "sponsors:read": "Sponsoren lesen",
  "sponsors:write": "Sponsoren bearbeiten",
  "packages:read": "Sponsoringpakete lesen",
  "packages:write": "Sponsoringpakete veröffentlichen",
  "finance:read": "Finanzen lesen",
  "finance:write": "Finanzen bearbeiten",
  "fulfillment:write": "Sponsoringleistungen bearbeiten",
};

const formatChf = (cents: number) => new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(cents / 100);

function useIdentitySession() {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [callback, setCallback] = useState<CallbackResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const settingsResponse = await fetch("/.netlify/identity/settings", {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4500),
        });
        if (!settingsResponse.ok) throw new MissingIdentityError("Identity settings unavailable");
        if (!active) return;
        setAvailability("ready");
        const callbackResult = await handleAuthCallback();
        if (!active) return;
        if (!callbackResult) await refreshSession();
        if (!active) return;
        setCallback(callbackResult);
        setUser(callbackResult?.user ?? await getUser());
      } catch (reason) {
        if (!active) return;
        if (reason instanceof MissingIdentityError || (reason instanceof AuthError && reason.status === 404)) {
          setAvailability("missing");
        } else {
          setError(reason instanceof Error ? reason.message : "Die Anmeldung konnte nicht initialisiert werden.");
        }
      }
    };

    void load();
    const unsubscribe = onAuthChange((_event, currentUser) => setUser(currentUser));
    return () => { active = false; unsubscribe(); };
  }, []);

  return { availability, user, setUser, callback, setCallback, error };
}

function AuthPage({ availability, user, callback, setCallback, setUser, onHome, onWorkspace, onSponsor }: {
  availability: Availability;
  user: User | null;
  callback: CallbackResult | null;
  setCallback: (result: CallbackResult | null) => void;
  setUser: (user: User | null) => void;
  onHome: () => void;
  onWorkspace: () => void;
  onSponsor: () => void;
}) {
  const initialMode = callback?.type === "invite" ? "invite" : callback?.type === "recovery" ? "recovery" : "login";
  const [mode, setMode] = useState<"login" | "signup" | "invite" | "recovery">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const finishLogin = async () => {
    const target = sessionStorage.getItem("mittragen-login-target");
    sessionStorage.removeItem("mittragen-login-target");
    if (target === "sponsor") { onSponsor(); return; }
    try {
      const response = await fetch("/api/sponsor-portal/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json().catch(() => ({})) as { claimed?: number };
      if (response.ok && Number(result.claimed) > 0) { onSponsor(); return; }
    } catch { /* Fall back to the organization workspace. */ }
    onWorkspace();
  };

  useEffect(() => {
    if (callback?.type === "invite") setMode("invite");
    if (callback?.type === "recovery") setMode("recovery");
  }, [callback]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        const currentUser = await login(email, password);
        setUser(currentUser);
        await finishLogin();
      } else if (mode === "signup") {
        const currentUser = await signup(email, password, { full_name: name });
        if (currentUser.confirmedAt) {
          setUser(currentUser);
          await finishLogin();
        } else {
          setMessage("Konto erstellt. Bitte bestätigen Sie Ihre E-Mail-Adresse.");
        }
      } else if (mode === "invite" && callback?.token) {
        const currentUser = await acceptInvite(callback.token, password);
        setCallback(null);
        setUser(currentUser);
        await finishLogin();
      } else if (mode === "recovery") {
        const currentUser = await updateUser({ password });
        setCallback(null);
        setUser(currentUser);
        await finishLogin();
      }
    } catch (reason) {
      setError(reason instanceof AuthError ? reason.message : "Die Aktion konnte nicht abgeschlossen werden.");
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (!email) { setError("Bitte zuerst Ihre E-Mail-Adresse eintragen."); return; }
    setBusy(true);
    setError("");
    try {
      await requestPasswordRecovery(email);
      setMessage("Falls ein Konto besteht, wurde ein Link zum Zurücksetzen versandt.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Der Wiederherstellungslink konnte nicht angefordert werden.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="access-page"><header className="access-header"><button onClick={onHome} className="access-brand-button"><Brand/></button><button className="access-link" onClick={onHome}>Zur Website</button></header><main className="auth-layout"><section className="auth-story"><p className="eyebrow">Produktiver Zugang</p><h1>Unterstützung sicher organisieren.</h1><p>Mandantengetrennte Daten, klar definierte Rollen und ein persönlicher Workspace für jede Organisation.</p><ul><li>PostgreSQL mit Row-Level Security</li><li>Serverseitige Rollenprüfung</li><li>Sichere Netlify-Identity-Sitzung</li></ul></section><section className="auth-card"><div className="auth-card__heading"><p className="eyebrow">{mode === "signup" ? "Organisation starten" : mode === "invite" ? "Einladung annehmen" : mode === "recovery" ? "Passwort erneuern" : "Willkommen zurück"}</p><h2>{mode === "signup" ? "Konto erstellen" : mode === "invite" ? "Zugang aktivieren" : mode === "recovery" ? "Neues Passwort setzen" : "Bei mittragen.ch anmelden"}</h2></div>{availability === "checking" ? <div className="auth-state">Anmeldung wird vorbereitet …</div> : availability === "missing" ? <div className="auth-warning"><strong>Identity ist noch nicht aktiviert.</strong><p>Die Anwendung ist vorbereitet. In Netlify muss für das Projekt «mittragen» einmalig Identity aktiviert werden.</p></div> : user && mode === "login" ? <div className="auth-state"><strong>Bereits angemeldet als {user.email}</strong><button className="access-primary" onClick={finishLogin}>Zugang öffnen</button></div> : <form onSubmit={submit}>{mode === "signup" && <label><span>Name</span><input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Vorname Nachname"/></label>}{!['invite', 'recovery'].includes(mode) && <label><span>E-Mail</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.ch"/></label>}<label><span>{mode === "recovery" ? "Neues Passwort" : "Passwort"}</span><input required minLength={8} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mindestens 8 Zeichen"/></label>{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}<button className="access-primary" disabled={busy} type="submit">{busy ? "Bitte warten …" : mode === "signup" ? "Konto erstellen" : mode === "invite" ? "Einladung annehmen" : mode === "recovery" ? "Passwort speichern" : "Anmelden"}</button>{mode === "login" && <><button className="access-secondary" type="button" onClick={() => setMode("signup")}>Konto erstellen</button><button className="access-text" type="button" onClick={recover}>Passwort vergessen?</button></>}{mode === "signup" && <button className="access-text" type="button" onClick={() => setMode("login")}>Bereits ein Konto? Anmelden</button>}</form>}</section></main></div>;
}

class ApiRequestError extends Error {
  requestId?: string;

  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.requestId = requestId;
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string; requestId?: string };
  if (!response.ok) throw new ApiRequestError(body.error ?? `request_failed_${response.status}`, body.requestId);
  return body;
}

function WorkspacePage({ user, setUser, onHome, onLogin, onPrototype: _onPrototype }: { user: User | null; setUser: (user: User | null) => void; onHome: () => void; onLogin: () => void; onPrototype: () => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [createError, setCreateError] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState("club");
  const [includeDemo, setIncludeDemo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>("overview");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api<{ claimed: number; tenantIds: string[] }>("/api/team/claim", { method: "POST" }).then(() => api<{ tenants: Tenant[] }>("/api/tenants")).then((result) => {
      setTenants(result.tenants);
      setSelectedTenantId((current) => {
        const stored = localStorage.getItem(activeTenantStorageKey) ?? "";
        return result.tenants.some((tenant) => tenant.id === current) ? current
          : result.tenants.some((tenant) => tenant.id === stored) ? stored
            : result.tenants[0]?.id ?? "";
      });
    }).catch(async (reason) => {
      if (reason instanceof Error && reason.message === "authentication_required") {
        await logout().catch(() => null);
        setUser(null);
        onLogin();
        return;
      }
      setWorkspaceError(reason instanceof Error ? reason.message : "workspace_load_failed");
    }).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!selectedTenantId) { setWorkspace(null); return; }
    setLoading(true);
    setWorkspace(null);
    setWorkspaceError("");
    localStorage.setItem(activeTenantStorageKey, selectedTenantId);
    api<{ workspace: WorkspaceData }>(`/api/workspace/${selectedTenantId}`).then((result) => setWorkspace(result.workspace)).catch(async (reason) => {
      if (reason instanceof Error && reason.message === "authentication_required") {
        await logout().catch(() => null);
        setUser(null);
        onLogin();
        return;
      }
      setWorkspaceError(reason instanceof Error ? reason.message : "workspace_load_failed");
    }).finally(() => setLoading(false));
  }, [selectedTenantId]);

  const reloadWorkspace = async () => {
    if (!selectedTenantId) return;
    const result = await api<{ workspace: WorkspaceData }>(`/api/workspace/${selectedTenantId}`);
    setWorkspace(result.workspace);
  };

  const createTenant = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const result = await api<{ tenant: Tenant }>("/api/tenants", { method: "POST", body: JSON.stringify({ name, slug, kind, includeDemo }) });
      setTenants((current) => [...current, result.tenant].sort((a, b) => a.name.localeCompare(b.name, "de-CH")));
      setSelectedTenantId(result.tenant.id);
      setWorkspaceSection("overview");
      setName("");
      setSlug("");
      setKind("club");
      setIncludeDemo(false);
      setCreateOpen(false);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "tenant_create_failed";
      const reference = reason instanceof ApiRequestError && reason.requestId ? ` Technische Referenz: ${reason.requestId}` : "";
      const labels: Record<string, string> = {
        slug_already_exists: "Dieser Kurzname wird bereits verwendet. Bitte wählen Sie einen anderen.",
        invalid_name: "Bitte einen gültigen Organisationsnamen eintragen.",
        invalid_slug: "Der technische Kurzname darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten.",
        invalid_kind: "Bitte einen gültigen Organisationstyp auswählen.",
      };
      setCreateError(labels[code] ?? `Die Organisation konnte wegen eines technischen Fehlers nicht erstellt werden.${reference}`);
    } finally {
      setCreating(false);
    }
  };

  const signOut = async () => {
    await logout();
    setUser(null);
    onHome();
  };

  const totalSponsors = useMemo(() => workspace?.sponsorSummary.reduce((sum, item) => sum + Number(item.count), 0) ?? 0, [workspace]);
  const totalValue = useMemo(() => workspace?.sponsorSummary.reduce((sum, item) => sum + Number(item.annual_value_cents), 0) ?? 0, [workspace]);

  const tenantForm = <form onSubmit={createTenant}>
    <label><span>Name der Organisation</span><input required value={name} onChange={(event) => { const next = event.target.value; setName(next); setSlug(slugFromName(next)); }} placeholder="FC Muster"/></label>
    <label><span>Technischer Kurzname</span><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="fc-muster"/><small>Bleibt auch bei einer späteren Umbenennung stabil.</small></label>
    <label><span>Organisationstyp</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="club">Sportklub</option><option value="association">Verein / Organisation</option><option value="event">Event</option><option value="project">Projekt</option></select></label>
    <label className="onboarding-check"><input type="checkbox" checked={includeDemo} onChange={(event) => setIncludeDemo(event.target.checked)}/><span>Sieben Beispiel-Sponsoren zum Kennenlernen übernehmen</span></label>
    {createError && <p className="form-error" role="alert">{createError}</p>}
    <button className="access-primary" disabled={creating}>{creating ? "Organisation wird erstellt …" : "Organisation erstellen"}</button>
  </form>;

  if (!user) return <div className="access-page"><header className="access-header"><button onClick={onHome} className="access-brand-button"><Brand/></button></header><main className="access-empty"><h1>Anmeldung erforderlich</h1><p>Der produktive Workspace ist nur für angemeldete Benutzer zugänglich.</p><button className="access-primary" onClick={onLogin}>Zur Anmeldung</button></main></div>;

  return <div className="workspace-page">
    <aside className="workspace-sidebar">
      <button onClick={onHome} className="access-brand-button"><Brand inverse/></button>
      <div className="workspace-user"><span>{(user.name ?? user.email ?? "M").slice(0, 2).toUpperCase()}</span><div><strong>{user.name ?? "mittragen.ch User"}</strong><small>{user.email}</small></div></div>
      <nav>
        <button className={workspaceSection === "overview" ? "active" : ""} onClick={() => setWorkspaceSection("overview")}>Übersicht</button>
        <button className={workspaceSection === "sponsors" ? "active" : ""} onClick={() => setWorkspaceSection("sponsors")}>Sponsoren</button>
        <button className={workspaceSection === "packages" ? "active" : ""} onClick={() => setWorkspaceSection("packages")}>Pakete</button>
        <button className={workspaceSection === "dossier" ? "active" : ""} onClick={() => setWorkspaceSection("dossier")}>Dossier</button>
        <button className={workspaceSection === "events" ? "active" : ""} onClick={() => setWorkspaceSection("events")}>Events</button>
        <button className={workspaceSection === "transitions" ? "active" : ""} onClick={() => setWorkspaceSection("transitions")}>Überführung</button>
        <button className={workspaceSection === "contracts" ? "active" : ""} onClick={() => setWorkspaceSection("contracts")}>Verträge</button>
        {workspace?.membership.permissions.includes("sponsors:write") && <button className={workspaceSection === "imports" ? "active" : ""} onClick={() => setWorkspaceSection("imports")}>Datenübernahme</button>}
        {workspace?.membership.permissions.includes("members:manage") && <button className={workspaceSection === "team" ? "active" : ""} onClick={() => setWorkspaceSection("team")}>Team</button>}
        <button className={workspaceSection === "settings" ? "active" : ""} onClick={() => setWorkspaceSection("settings")}>Organisation</button>
      </nav>
      <button className="workspace-logout" onClick={signOut}>Abmelden</button>
    </aside>

    <main className="workspace-main">
      <header className="workspace-topbar">
        <div><p className="eyebrow">Produktiver Workspace</p><strong>Mandantengetrennte Datenbasis</strong></div>
        {tenants.length > 0 && <div className="workspace-tenant-tools">
          <label><span>Organisation</span><select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>{tenants.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}</select></label>
          <button className="access-secondary" type="button" onClick={() => { setCreateError(""); setCreateOpen(true); }}>Neue Organisation</button>
        </div>}
      </header>

      {loading ? <div className="workspace-loading">Workspace wird geladen …</div>
        : workspaceError ? <div className="workspace-error"><strong>Der Workspace konnte nicht geladen werden.</strong><p>{workspaceError}</p></div>
          : tenants.length === 0 ? <section className="onboarding-card"><div><p className="eyebrow">Schritt 1 von 3</p><h1>Organisation einrichten</h1><p>mittragen.ch erstellt einen isolierten Mandanten und weist Ihnen die Owner-Rolle zu.</p></div>{tenantForm}</section>
            : workspaceSection === "sponsors" && workspace ? <SponsorDirectory tenantId={selectedTenantId} canWrite={workspace.membership.permissions.includes("sponsors:write")} onChanged={() => { void reloadWorkspace(); }}/>
              : workspaceSection === "packages" && workspace ? <PackageManagement tenantId={selectedTenantId} canWrite={workspace.membership.permissions.includes("packages:write")}/>
                : workspaceSection === "dossier" && workspace ? <SponsoringDossier tenantId={selectedTenantId} canManage={workspace.membership.permissions.includes("tenant:manage")} onOpenOrganization={() => setWorkspaceSection("settings")}/>
                  : workspaceSection === "events" && workspace ? <EventSponsoringManagement tenantId={selectedTenantId} canWrite={workspace.membership.permissions.includes("fulfillment:write")} canManage={workspace.membership.permissions.includes("tenant:manage")}/>
                    : workspaceSection === "transitions" && workspace ? <TransitionManagement tenantId={selectedTenantId} canWrite={workspace.membership.permissions.includes("sponsors:write")}/>
                      : workspaceSection === "contracts" && workspace ? <ContractManagement tenantId={selectedTenantId} canWrite={workspace.membership.permissions.includes("packages:write")} canManage={workspace.membership.permissions.includes("tenant:manage")} onOpenOrganization={() => setWorkspaceSection("settings")}/>
                        : workspaceSection === "imports" && workspace ? <ImportManagement tenantId={selectedTenantId} tenantName={workspace.tenant.name} demoSponsorCount={workspace.demoSponsorCount} canDeleteDemo={workspace.membership.permissions.includes("tenant:manage")} onChanged={() => { void reloadWorkspace(); }}/>
                          : workspaceSection === "team" && workspace ? <TeamManagement tenantId={selectedTenantId}/>
                            : workspaceSection === "settings" && workspace ? <OrganizationSettings tenant={workspace.tenant as OrganizationTenant} canManage={workspace.membership.permissions.includes("tenant:manage")} onSaved={(updated) => { setTenants((current) => current.map((tenant) => tenant.id === updated.id ? updated : tenant)); setWorkspace((current) => current ? { ...current, tenant: { ...current.tenant, ...updated } } : current); }}/>
                            : workspace && <>
                            <section className="workspace-heading"><div><p className="eyebrow">{roleLabels[workspace.membership.role] ?? workspace.membership.role}</p><h1>{workspace.tenant.name}</h1><p>Die Daten werden serverseitig auf den Mandanten <code>{workspace.tenant.slug}</code> begrenzt.</p></div><span className="workspace-status">{workspace.tenant.status}</span></section>
                            <section className="workspace-metrics"><article><span>Sponsoren</span><strong>{totalSponsors}</strong><small>im relationalen Kern</small></article><article><span>Jährlicher Zielwert</span><strong>{formatChf(totalValue)}</strong><small>aus allen Status</small></article><article><span>Ihre Rolle</span><strong>{roleLabels[workspace.membership.role] ?? workspace.membership.role}</strong><small>serverseitig geprüft</small></article></section>
                            <div className="workspace-grid"><section className="workspace-panel"><div className="workspace-panel__heading"><p className="eyebrow">Rollenmodell</p><h2>Ihre Berechtigungen</h2></div><div className="permission-list">{workspace.membership.permissions.map((permission) => <span key={permission}>✓ {permissionLabels[permission] ?? permission}</span>)}</div></section><section className="workspace-panel"><div className="workspace-panel__heading"><p className="eyebrow">Datenisolation</p><h2>Aktive Schutzschichten</h2></div><ul className="security-list"><li><strong>Identity</strong><span>Sitzung und Benutzeridentität</span></li><li><strong>Functions</strong><span>Mitgliedschaft und Rolle</span></li><li><strong>PostgreSQL RLS</strong><span>Tenant-ID auf jeder Abfrage</span></li></ul></section></div>
                          </>}
    </main>

    {createOpen && tenants.length > 0 && <div className="sponsor-form-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) setCreateOpen(false); }}>
      <section className="sponsor-form tenant-create-dialog" role="dialog" aria-modal="true" aria-labelledby="tenant-create-title">
        <header><div><p className="eyebrow">Weiteren Mandanten anlegen</p><h2 id="tenant-create-title">Neue Organisation</h2><p>Die neue Organisation erhält einen vollständig getrennten Datenraum. Sie werden automatisch Owner.</p></div><button type="button" aria-label="Schliessen" onClick={() => setCreateOpen(false)} disabled={creating}>×</button></header>
        {tenantForm}
      </section>
    </div>}
  </div>;
}

export function ProductiveAccess({ page, onLogin, onWorkspace, onSponsor, onPrototype }: { page: ProductivePage; onHome: () => void; onLogin: () => void; onWorkspace: () => void; onSponsor: () => void; onPrototype: () => void }) {
  const session = useIdentitySession();
  const goToWebsite = () => window.location.assign("/");
  if (page === "login") return <AuthPage {...session} onHome={goToWebsite} onWorkspace={onWorkspace} onSponsor={onSponsor}/>;
  if (session.availability === "checking") return <div className="access-page"><main className="access-empty">Zugang wird geprüft …</main></div>;
  return <WorkspacePage user={session.user} setUser={session.setUser} onHome={goToWebsite} onLogin={onLogin} onPrototype={onPrototype}/>;
}
