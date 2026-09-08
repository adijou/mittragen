import { useEffect, useState } from "react";

type MembershipRole = "owner" | "sponsoring_admin" | "finance" | "fulfillment" | "viewer";

type TeamMember = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: MembershipRole;
  created_at: string;
};

type TeamInvitation = {
  id: string;
  email: string;
  role: MembershipRole;
  delivery_status: "pending" | "sent" | "existing_user" | "failed";
  expires_at: string;
  identity_invited_at: string | null;
  created_at: string;
};

const roles: Array<{ value: MembershipRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "Organisation, Team und alle Fachbereiche" },
  { value: "sponsoring_admin", label: "Sponsoring-Admin", description: "Sponsoren, Angebote und Leistungen" },
  { value: "finance", label: "Finanzen", description: "Rechnungen und Finanzdaten" },
  { value: "fulfillment", label: "Leistungserfüllung", description: "Vereinbarte Leistungen bearbeiten" },
  { value: "viewer", label: "Lesen", description: "Sponsoren und Finanzen ansehen" },
];

const roleLabel = (role: MembershipRole) => roles.find((item) => item.value === role)?.label ?? role;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function TeamManagement({ tenantId }: { tenantId: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, MembershipRole>>({});
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("sponsoring_admin");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const result = await request<{ team: { members: TeamMember[]; invitations: TeamInvitation[] } }>(`/api/team/${tenantId}`);
    setMembers(result.team.members);
    setInvitations(result.team.invitations);
    setRoleDrafts(Object.fromEntries(result.team.members.map((member) => [member.id, member.role])));
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    void load().catch(() => setError("Das Team konnte nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError("");
    setMessage("");
    try {
      const result = await request<{ invitation: TeamInvitation; delivery: "sent" | "existing_user" }>(`/api/team/${tenantId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setEmail("");
      setMessage(result.delivery === "sent"
        ? `Die Einladung wurde an ${result.invitation.email} versandt.`
        : `${result.invitation.email} besitzt bereits ein Konto. Der Zugang wird beim nächsten Login aktiviert.`);
      await load();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "team_invitation_failed";
      setError(code === "already_member"
        ? "Diese Person ist bereits Mitglied der Organisation."
        : code === "invalid_email"
          ? "Bitte eine gültige E-Mail-Adresse eintragen."
          : code === "identity_invite_failed"
            ? "Die Einladung konnte von Netlify Identity nicht versandt werden. Sie kann später erneut ausgelöst werden."
            : "Die Einladung konnte nicht erstellt werden.");
      await load().catch(() => null);
    } finally {
      setSending(false);
    }
  };

  const saveRole = async (member: TeamMember) => {
    const nextRole = roleDrafts[member.id] ?? member.role;
    setSavingMemberId(member.id);
    setError("");
    setMessage("");
    try {
      const result = await request<{ member: TeamMember }>(`/api/team/${tenantId}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      setMembers((current) => current.map((item) => item.id === member.id ? result.member : item));
      setMessage(`Rolle für ${result.member.display_name ?? result.member.email ?? "Teammitglied"} aktualisiert.`);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "team_member_update_failed";
      setRoleDrafts((current) => ({ ...current, [member.id]: member.role }));
      setError(code === "last_owner"
        ? "Die letzte Owner-Rolle kann nicht entfernt werden. Ernennen Sie zuerst einen weiteren Owner."
        : "Die Rolle konnte nicht geändert werden.");
    } finally {
      setSavingMemberId("");
    }
  };

  return <section className="team-management">
    <header><div><p className="eyebrow">Zugänge und Rollen</p><h1>Team verwalten</h1><p>Jede Person erhält nur die Rechte, die sie für ihre Aufgabe benötigt.</p></div><span className="team-count">{members.length} aktiv</span></header>

    <div className="team-layout">
      <section className="team-card team-card--members">
        <div className="team-card__heading"><div><p className="eyebrow">Aktive Zugänge</p><h2>Mitglieder</h2></div></div>
        {loading ? <p className="team-state">Team wird geladen …</p> : members.length === 0 ? <p className="team-state">Noch keine Mitglieder vorhanden.</p> : <div className="team-members">
          {members.map((member) => <article className="team-member" key={member.id}>
            <span className="team-avatar" aria-hidden="true">{(member.display_name ?? member.email ?? "M").slice(0, 2).toUpperCase()}</span>
            <div className="team-member__identity"><strong>{member.display_name ?? member.email ?? "Mitglied"}</strong>{member.display_name && <small>{member.email}</small>}<span>{roleLabel(member.role)}</span></div>
            <label><span className="visually-hidden">Rolle für {member.display_name ?? member.email}</span><select value={roleDrafts[member.id] ?? member.role} onChange={(event) => setRoleDrafts((current) => ({ ...current, [member.id]: event.target.value as MembershipRole }))}>{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button className="team-save" disabled={savingMemberId === member.id || (roleDrafts[member.id] ?? member.role) === member.role} onClick={() => void saveRole(member)}>{savingMemberId === member.id ? "Speichert …" : "Speichern"}</button>
          </article>)}
        </div>}
      </section>

      <aside className="team-card team-card--invite">
        <div><p className="eyebrow">Person hinzufügen</p><h2>Einladung senden</h2><p>Die Person setzt ihr Passwort über den sicheren Link von Netlify Identity.</p></div>
        <form onSubmit={invite}>
          <label><span>E-Mail-Adresse</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@organisation.ch"/></label>
          <label><span>Rolle</span><select value={role} onChange={(event) => setRole(event.target.value as MembershipRole)}>{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{roles.find((item) => item.value === role)?.description}</small></label>
          <button className="access-primary" disabled={sending}>{sending ? "Einladung wird versandt …" : "Einladung versenden"}</button>
        </form>
      </aside>
    </div>

    {error && <p className="form-error team-feedback" role="alert">{error}</p>}
    {message && <p className="form-success team-feedback" role="status">{message}</p>}

    {invitations.length > 0 && <section className="team-card team-card--pending"><div className="team-card__heading"><div><p className="eyebrow">Noch nicht angenommen</p><h2>Offene Einladungen</h2></div></div><div className="team-invitations">{invitations.map((invitation) => <article key={invitation.id}><div><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · gültig bis {new Intl.DateTimeFormat("de-CH", { dateStyle: "medium" }).format(new Date(invitation.expires_at))}</small></div><span className={`team-delivery team-delivery--${invitation.delivery_status}`}>{invitation.delivery_status === "sent" ? "Versandt" : invitation.delivery_status === "existing_user" ? "Konto vorhanden" : invitation.delivery_status === "failed" ? "Versand fehlgeschlagen" : "Wird versandt"}</span></article>)}</div></section>}
  </section>;
}
