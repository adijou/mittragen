import { useEffect, useRef, useState } from "react";
import { Brand } from "./ProductBrand";
import { confirmedAccessDestination } from "./identityFeedback";

export function EmailConfirmationSuccess({ email, preferSponsor, onHome, onContinue }: {
  email: string;
  preferSponsor: boolean;
  onHome: () => void;
  onContinue: (destination: "sponsor" | "workspace") => void;
}) {
  const [destination, setDestination] = useState<"sponsor" | "workspace" | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const check = useRef<Promise<"sponsor" | "workspace"> | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    check.current ??= confirmedAccessDestination(preferSponsor);
    void check.current.then((result) => {
      if (active) setDestination(result);
    }).catch(() => {
      if (active) setError("Ihre E-Mail-Adresse ist bestätigt. Ihr Zugang konnte noch nicht geladen werden. Bitte versuchen Sie es erneut.");
    });
    return () => { active = false; };
  }, [preferSponsor, attempt]);

  return <div className="access-page">
    <header className="access-header"><button onClick={onHome} className="access-brand-button"><Brand/></button><button className="access-link" onClick={onHome}>Zur Website</button></header>
    <main className="email-confirmation-layout">
      <section className="auth-card email-confirmation-card" aria-labelledby="email-confirmation-title">
        <span className="email-confirmation-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6"/></svg></span>
        <p className="eyebrow">Bestätigung erfolgreich</p>
        <h1 id="email-confirmation-title">E-Mail-Adresse erfolgreich bestätigt.</h1>
        <p role="status">Vielen Dank. Ihre E-Mail-Adresse <strong>{email}</strong> ist bestätigt und Sie sind angemeldet.</p>
        {destination && <p>{destination === "sponsor" ? "In Ihrem persönlichen Space finden Sie Ihre Dokumente und können Ihre Adresse und Ihr Logo verwalten." : "Sie können jetzt Ihren persönlichen Zugang öffnen."}</p>}
        {error ? <><p className="form-error" role="alert">{error}</p><button className="access-primary" onClick={() => { check.current = null; setAttempt((value) => value + 1); }}>Zugang erneut prüfen</button></>
          : <button className="access-primary" disabled={!destination} onClick={() => destination && onContinue(destination)}>{destination === "sponsor" ? "Weiter zu meinem Space" : destination === "workspace" ? "Weiter zu meinem Zugang" : "Zugang wird vorbereitet …"}</button>}
      </section>
    </main>
  </div>;
}
