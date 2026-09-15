import { useState } from "react";
import { Brand } from "./ProductBrand";
import "./ProductSite.css";

const contactUrl = "https://digitalbell.ch/";
type IconName = "external" | "arrow" | "check" | "document" | "lock" | "package" | "users" | "ball" | "link" | "building";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    external: <><path d="M7 7h10v10M7 17 17 7"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    document: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h4M9 12h6M9 16h6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    package: <><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    ball: <><circle cx="12" cy="12" r="9"/><path d="m12 7 5 4-2 6H9l-2-6zM12 7V3M17 11l4-2M15 17l2 3M9 17l-2 3M7 11 3 9"/></>,
    link: <><path d="m10 13 4-4M8 15l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M13 17a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1"/></>,
    building: <><path d="M4 21V5l8-3 8 3v16M2 21h20M10 21v-5h4v5M8 7h1m6 0h1M8 11h1m6 0h1"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ProductPreview() {
  const [view, setView] = useState<"club" | "sponsor">("club");
  return <figure className="ps-preview">
    <div className="ps-preview-switch" role="group" aria-label="Produktansicht wählen">
      <button aria-pressed={view === "club"} onClick={() => setView("club")}><Icon name="building" size={16}/> Für euren Verein</button>
      <button aria-pressed={view === "sponsor"} onClick={() => setView("sponsor")}><Icon name="users" size={16}/> Für eure Sponsoren</button>
    </div>
    <div className="ps-preview-window">
      <div className="ps-preview-bar"><span className="ps-club-icon">SV</span><strong>Sportverein Bergblick</strong><span className="ps-preview-lock"><Icon name="lock" size={14}/> {view === "club" ? "Vereinsbereich" : "Sponsor-Space"}</span></div>
      {view === "club" ? <div className="ps-preview-content">
        <div className="ps-preview-heading"><div><small>Eure Partnerschaften</small><h2>Wer euren Verein mitträgt.</h2></div><span className="ps-preview-badge">Saison 2026/27</span></div>
        <div className="ps-preview-labels"><span>Sponsor</span><span>Paket</span><span>Vertrag</span></div>
        {[
          { initials: "M", name: "Bäckerei Morgenrot", detail: "Kontakt und Logo aktuell", plan: "Gold", status: "Bestätigt", tone: "gold" },
          { initials: "T", name: "Werkstatt Talblick", detail: "Logo noch ausstehend", plan: "Silber", status: "Versendet", tone: "blue" },
          { initials: "G", name: "Gartenbau Grünwerk", detail: "Kontakt und Logo aktuell", plan: "Bronze", status: "Bestätigt", tone: "green" },
        ].map((row) => <div className="ps-preview-row" key={row.name}><div><span className={`ps-sponsor-avatar ps-sponsor-avatar--${row.tone}`}>{row.initials}</span><span><strong>{row.name}</strong><small>{row.detail}</small></span></div><span>{row.plan}</span><span className={`ps-preview-status ${row.status === "Versendet" ? "ps-preview-status--pending" : ""}`}>{row.status}</span></div>)}
        <div className="ps-preview-match"><span className="ps-match-icon"><Icon name="ball"/></span><div><strong>Auch der nächste Matchball ist organisiert.</strong><small>Heimspiel · Sponsor zugeordnet · Matchinfo als PDF</small></div><Icon name="check" size={18}/></div>
      </div> : <div className="ps-preview-content ps-preview-space">
        <div className="ps-preview-heading"><div><small>Euer persönlicher Sponsor-Space</small><h2>Guten Tag, Bäckerei Morgenrot.</h2></div></div>
        <div className="ps-preview-space-nav"><span>Dokumente</span><span>Meine Angaben</span><span>Logo</span></div>
        <div className="ps-preview-document"><Icon name="document" size={28}/><div><strong>Sponsoringvertrag · Gold</strong><small>Bestätigt · Vertragskopie als PDF</small></div><span className="ps-preview-status">Bereit</span></div>
        <div className="ps-preview-selfservice"><div><Icon name="users"/><strong>Eure Angaben</strong><span>Name, Kontakt, Adresse und Website selbst pflegen.</span></div><div><span className="ps-sponsor-avatar ps-sponsor-avatar--gold">M</span><strong>Euer Logo</strong><span>Einmal hinterlegen. Bei Bedarf selbst ersetzen.</span></div></div>
      </div>}
    </div>
    <figcaption><span className="ps-preview-dot"/> Beispielansicht mit fiktiven Daten · {view === "club" ? "Vereinsorganisation" : "Selbstverwaltung für Sponsoren"}</figcaption>
  </figure>;
}

const features: { icon: IconName; title: string; text: string; detail: string }[] = [
  { icon: "users", title: "Sponsoren im Überblick", text: "Kontakte, Adressen, Websites und Logos zentral führen. Bestehende Excel- und CSV-Listen mit Feldzuordnung und Vorprüfung übernehmen.", detail: "Wissen bleibt im Verein." },
  { icon: "package", title: "Pakete, die klar sind", text: "Leistungen, Preise und Laufzeiten zusammenstellen. Paketversionen, verfügbare Plätze und Exklusivitäten nachvollziehbar verwalten.", detail: "Alle sprechen vom gleichen Angebot." },
  { icon: "document", title: "Vom Angebot zum Vertrag", text: "Verträge als PDF erstellen, zur Bestätigung versenden und den Status verfolgen. Auch bestehende Verträge lassen sich erfassen.", detail: "Vereinbarungen bleiben auffindbar." },
  { icon: "link", title: "Sponsoring online abschliessen", text: "Einen eigenen Vereinslink teilen. Interessierte wählen ein veröffentlichtes Paket und durchlaufen den Vertragsabschluss online.", detail: "Ein direkter Weg zur Partnerschaft." },
  { icon: "ball", title: "Matchbälle organisieren", text: "Heimspiele und mehrere Sponsoren pro Spiel verwalten. Enthaltene Paketleistungen und Saisonkontingente zuordnen, Matchinfos als PDF bereitstellen.", detail: "Auch am Spieltag ist alles klar." },
  { icon: "building", title: "Euer Verein. Euer Auftritt.", text: "Vereinsprofil, Logo und Farben pflegen. Sponsoringdossier, Verträge und öffentliche Abschlussseiten erhalten euren Auftritt.", detail: "Professionell aus einem Guss." },
];

const questions = [
  ["Können wir mehrere Vereine verwalten?", "Ja. Ein Konto kann für mehrere Organisationen berechtigt sein. Jeder Verein hat seine eigenen Daten, Pakete, Dokumente, Teamrollen und seinen eigenen Markenauftritt."],
  ["Brauchen Sponsoren einen eigenen Vereinsbereich?", "Nein. Sponsoren erhalten einen persönlichen, geschützten Sponsor-Space. Dort sehen sie ihre Dokumente und verwalten ihre Angaben und ihr Logo. Sie müssen keine Organisation anlegen."],
  ["Können wir unsere bisherigen Daten mitnehmen?", "Sponsoren lassen sich aus Excel- und CSV-Dateien übernehmen. Die Zuordnung der Felder und die Vorprüfung helfen beim Einstieg. Im Pilot begleiten wir die Einrichtung und stimmen eure bestehenden Pakete und Verträge ab."],
  ["Sind Rechnungen und Zahlungen schon integriert?", "Rechnungsverwaltung, Zahlungsstatus und automatische Verlängerungen gehören zum weiteren Ausbau. Für den Pilot legen wir gemeinsam fest, welche Abläufe ihr bereits in mittragen.ch nutzt und welche vorerst in euren bestehenden Werkzeugen bleiben."],
  ["Wie starten wir und was kostet es?", "Meldet euch bei Digital Bell. Wir besprechen euren Verein, den passenden Pilotumfang, die Begleitung und die Konditionen. So ist vor dem Start klar, was ihr nutzen könnt und wie wir zusammenarbeiten."],
];

export function ProductSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="product-site">
    <a className="ps-skip" href="#inhalt">Zum Inhalt</a>
    <header className="ps-header ps-shell">
      <a href="/" className="ps-brand" aria-label="mittragen.ch Startseite"><Brand/></a>
      <nav id="product-navigation" className={`ps-nav ${menuOpen ? "ps-nav--open" : ""}`} aria-label="Hauptnavigation">
        <a href="#funktionen" onClick={() => setMenuOpen(false)}>Funktionen</a>
        <a href="#zusammenarbeit" onClick={() => setMenuOpen(false)}>Für Vereine</a>
        <a className="ps-header-contact" href="#pilot" onClick={() => setMenuOpen(false)}>Interessiert? <Icon name="arrow" size={16}/></a>
        <a className="ps-header-login" href="/login" onClick={() => setMenuOpen(false)}>Login</a>
      </nav>
      <button className="ps-menu" aria-label={menuOpen ? "Menü schliessen" : "Menü öffnen"} aria-expanded={menuOpen} aria-controls="product-navigation" onClick={() => setMenuOpen(!menuOpen)}><span/><span/></button>
    </header>
    <main id="inhalt">
      <section className="ps-hero ps-shell">
        <div className="ps-hero-copy">
          <h1>Euer Sponsoring.<br/><span>Einfach organisiert.</span></h1>
          <p>Von der ersten Zusage bis zum eigenen Sponsor-Space: mittragen.ch verbindet Sponsoren, Pakete, Verträge und Matchbälle. Damit mehr Zeit für euren Verein bleibt.</p>
          <div className="ps-actions"><a className="ps-text-link" href="#funktionen">Funktionen entdecken <span aria-hidden="true">↓</span></a></div>
          <div className="ps-hero-note"><Icon name="check" size={16}/><span>Für Schweizer Vereine · persönlich begleitet von <a href={contactUrl}>Digital Bell</a></span></div>
        </div>
        <ProductPreview/>
      </section>

      <section className="ps-benefits" aria-label="Vorteile im Vereinsalltag"><div className="ps-shell"><span><Icon name="users"/> Ein gemeinsamer Datenstand</span><span><Icon name="document"/> Vereinbarungen greifbar</span><span><Icon name="lock"/> Eigene Bereiche und Teamrollen</span></div></section>

      <section className="ps-section ps-shell" id="funktionen">
        <div className="ps-section-heading"><p className="ps-eyebrow">Bereits im Produkt</p><h2>Alles, was eure Partnerschaften<br/>im Alltag zusammenhält.</h2><p>Von der Sponsorenliste zur verbindlichen Zusage – und weiter zur Organisation der vereinbarten Matchbälle.</p></div>
        <div className="ps-features">{features.map((feature, index) => <article key={feature.title}><div className="ps-feature-top"><span className="ps-feature-icon"><Icon name={feature.icon} size={24}/></span><span>0{index + 1}</span></div><h3>{feature.title}</h3><p>{feature.text}</p><strong>{feature.detail}</strong></article>)}</div>
      </section>

      <section className="ps-space-section" id="sponsor-space"><div className="ps-shell ps-space-grid">
        <div className="ps-space-visual" aria-label="Drei Bereiche des Sponsor-Space"><div className="ps-space-person"><span className="ps-sponsor-avatar ps-sponsor-avatar--gold">M</span><div><small>Einladung angenommen</small><strong>Willkommen in eurem Space.</strong></div><span className="ps-space-check"><Icon name="check"/></span></div>{[
          ["document", "Dokumente", "Vertragskopien jederzeit einsehen"], ["users", "Meine Angaben", "Name, E-Mail, Telefon, Adresse und Website"], ["package", "Mein Logo", "Hinterlegen, ersetzen oder entfernen"],
        ].map(([icon, title, text]) => <div className="ps-space-item" key={title}><Icon name={icon as IconName}/><div><strong>{title}</strong><span>{text}</span></div><Icon name="check" size={16}/></div>)}<p>Beispiel · persönlicher Bereich eines Sponsors</p></div>
        <div><p className="ps-eyebrow">Ein eigener Space für eure Sponsoren</p><h2>Weniger nachfragen.<br/>Mehr selbst erledigen.</h2><p>Nach der Vertragsbestätigung oder einer Einladung aus der Sponsorverwaltung erhalten Sponsoren Zugang zu ihrem persönlichen Bereich.</p><ul className="ps-check-list"><li><Icon name="check"/> Vertragsdokumente geschützt abrufen</li><li><Icon name="check"/> Kontaktdaten, Adresse und Website selbst pflegen</li><li><Icon name="check"/> Logo hochladen – auch im Vereinsbereich sichtbar</li></ul><p className="ps-space-note">Der Verein bleibt auf dem aktuellen Stand. Bereits bestätigte Verträge behalten ihre ursprünglichen Angaben.</p><a className="ps-text-link" href="/sponsor">Schon Sponsor? Zum eigenen Space <Icon name="arrow" size={18}/></a></div>
      </div></section>

      <section className="ps-section ps-shell ps-multiclub" id="zusammenarbeit">
        <div><p className="ps-eyebrow">Ein Verein oder mehrere</p><h2>Gemeinsam arbeiten.<br/>Verantwortung klar halten.</h2><p>Ob Sponsoring-Team, Vorstand oder Begleitung mehrerer Vereine: Ihr arbeitet in den Organisationen, für die ihr berechtigt seid.</p><p>Jeder Verein führt seine eigenen Sponsoren, Pakete und Verträge. Teammitglieder erhalten passende Rollen; Sponsoren ihren eigenen Space.</p><a className="ps-text-link" href={contactUrl}>Euren Einsatz mit Digital Bell besprechen <Icon name="arrow" size={18}/></a></div>
        <div className="ps-clubs"><div className="ps-clubs-label"><Icon name="building" size={17}/> Jede Organisation eigenständig</div>{[{ mark: "SV", name: "Sportverein Bergblick", text: "Eigene Sponsoren · eigenes Team", color: "blue" }, { mark: "KV", name: "Kulturverein Stadtgarten", text: "Eigene Pakete · eigener Auftritt", color: "gold" }].map((club) => <div className="ps-club" key={club.name}><span className={`ps-club-mark ps-club-mark--${club.color}`}>{club.mark}</span><div><strong>{club.name}</strong><span>{club.text}</span></div><Icon name="lock" size={19}/></div>)}<p>Illustration mit fiktiven Vereinen. Zugänge und Berechtigungen werden je Organisation vergeben.</p></div>
      </section>

      <section className="ps-pilot-section" id="pilot"><div className="ps-shell">
        <div className="ps-pilot-heading"><div><p className="ps-eyebrow">Der nächste Schritt: euer Verein</p><h2>Im Alltag erproben.<br/>Gemeinsam besser machen.</h2></div><p>Die Kernfunktionen sind produktiv. Jetzt möchten wir mit weiteren Pilotvereinen lernen, was im Vereinsalltag zählt – mit einem überschaubaren Start und persönlicher Begleitung.</p></div>
        <ol className="ps-pilot-steps"><li><span>01</span><h3>Euren Alltag verstehen</h3><p>Ihr zeigt uns, wie ihr Sponsoring heute organisiert und wo Zeit verloren geht.</p></li><li><span>02</span><h3>Gemeinsam einrichten</h3><p>Wir stimmen Pilotumfang und Konditionen ab und begleiten Vereinsprofil, Daten und Pakete.</p></li><li><span>03</span><h3>Mit echten Fällen starten</h3><p>Ihr nutzt mittragen.ch mit ausgewählten Sponsoren. Euer Feedback bestimmt den nächsten Ausbau mit.</p></li></ol>
        <div className="ps-pilot-contact"><div><span>mittragen.ch für euren Verein?</span><strong>Interessiert? Meldet euch bei uns.</strong></div><a className="ps-developer-link" href={contactUrl} target="_blank" rel="noopener noreferrer" aria-label="Digital Bell – mittragen.ch kennenlernen (öffnet in neuem Tab)"><img src="/brand/digital-bell-logo.png" alt="Digital Bell" width="2048" height="463" loading="lazy"/><span>digitalbell.ch <Icon name="external" size={16}/></span></a></div>
      </div></section>

      <section className="ps-section ps-shell ps-faq"><div><p className="ps-eyebrow">Gut zu wissen</p><h2>Die ersten Fragen.<br/>Klare Antworten.</h2></div><div>{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>


    </main>
    <footer className="ps-footer ps-shell"><div><a href="/" className="ps-brand"><Brand compact/></a><p>Unterstützung. Einfach weiter.</p></div><nav aria-label="Weitere Links"><a href={contactUrl}>Kontakt · digitalbell.ch <Icon name="arrow" size={15}/></a><a href="/login">Vereinszugang</a><a href="/sponsor">Sponsor-Space</a></nav><span>Für Vereine, die gemeinsam mehr bewegen.</span></footer>
  </div>;
}
