import { useEffect, useState } from "react";
import { logout, type User } from "@netlify/identity";
import { Brand } from "./ProductBrand";
import { claimAccountAreas } from "./accountAreas";
import { clearSponsorEntry } from "./sponsorAccess";
import { identityErrorMessage } from "./identityFeedback";
import { accountAreaPath, workspaceRoleLabels, type AccountArea } from "../shared/account-areas";
import "./AccountAreas.css";

export function AccountAreas({ user, onLogin, onHome }: { user: User | null; onLogin: () => void; onHome: () => void }) {
  const [result, setResult] = useState<{ accountId: string; areas: AccountArea[] } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    setResult(null); setError("");
    if (!user) return;
    void claimAccountAreas(user.id).then((areas) => {
      if (active) setResult({ accountId: user.id, areas });
    }).catch((reason) => { if (active) setError(identityErrorMessage(reason)); });
    return () => { active = false; };
  }, [user?.id, attempt]);
  const areas = result?.accountId === user?.id ? result?.areas : undefined;
  const signOut = async () => {
    setResult(null); clearSponsorEntry();
    try { await logout(); onLogin(); } catch { setError("Die Abmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut."); }
  };
  return <div className="account-areas-page">
    <header className="access-header"><button className="access-brand-button" onClick={onHome}><Brand/></button>
      <div className="account-areas-account">{user && <span>{user.email}</span>}
        <button className="access-link" onClick={() => user ? void signOut() : onLogin()}>{user ? "Abmelden" : "Anmelden"}</button></div>
    </header>
    <main className="account-areas-main">
      <div className="account-areas-heading"><p className="eyebrow">Ein Konto. Ihre Zugänge.</p><h1>Meine Bereiche</h1>
        <p>Wählen Sie, für welche Organisation Sie arbeiten oder welchen Sponsor-Space Sie öffnen möchten.</p></div>
      {!user ? <section className="account-areas-state"><h2>Bitte melden Sie sich an.</h2><button className="access-primary" onClick={onLogin}>Zur Anmeldung</button></section>
        : error ? <section className="account-areas-state"><p className="form-error" role="alert">{error}</p>
          <button className="access-primary" onClick={() => setAttempt((value) => value + 1)}>Zugänge erneut prüfen</button>
          <button className="access-secondary" onClick={onLogin}>Zur Anmeldung</button></section>
          : !areas ? <p role="status">Ihre Bereiche werden geladen …</p>
            : areas.length === 0 ? <section className="account-areas-state"><h2>Noch kein Bereich zugeordnet.</h2>
              <p>Für einen Sponsorzugang benötigen Sie eine Einladung der Organisation. Möchten Sie selbst einen Verein verwalten, können Sie eine Organisation einrichten.</p>
              <a className="access-primary" href="/workspace">Organisation einrichten</a></section>
              : <div className="account-areas-grid">{areas.map((area) => <a className="account-area-card"
                key={`${area.kind}:${area.tenantId}:${area.kind === "sponsor" ? area.sponsorId : ""}`}
                href={accountAreaPath(area)} onClick={() => clearSponsorEntry()}>
                <span className={`account-area-kind account-area-kind--${area.kind}`}>{area.kind === "workspace" ? "Vereinsverwaltung" : "Sponsor-Space"}</span>
                <h2>{area.tenantName}</h2>
                <p>{area.kind === "workspace" ? workspaceRoleLabels[area.role] ?? area.role : area.sponsorName}</p>
                <span className="account-area-action">{area.kind === "workspace" ? "Verwaltung öffnen" : "Als Sponsor öffnen"}<span aria-hidden="true">→</span></span>
              </a>)}</div>}
      {areas && areas.length > 0 && <p className="account-areas-note">Ihre Rolle und Ihre Berechtigungen gelten jeweils nur im ausgewählten Bereich.</p>}
    </main>
  </div>;
}
