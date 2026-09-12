import { useState } from "react";
import { Brand } from "./ProductBrand";

type IconName = "arrow" | "check" | "document" | "lock" | "package" | "users";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    document: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    package: <><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function PublicHeader() {
  const [open, setOpen] = useState(false);
  return <header className="public-header">
    <a className="brand-button" href="/" aria-label="Zur Startseite"><Brand/></a>
    <nav className={`public-nav ${open ? "public-nav--open" : ""}`} aria-label="Hauptnavigation">
      <a href="#produkt" onClick={() => setOpen(false)}>Produkt</a>
      <a href="#ablauf" onClick={() => setOpen(false)}>So funktioniert es</a>
      <a href="#sicherheit" onClick={() => setOpen(false)}>Sicherheit</a>
      <a href="/login" onClick={() => setOpen(false)}>Login</a>
    </nav>
    <div className="public-header__actions">
      <a className="button button--primary" href="/login"><span>Workspace öffnen</span></a>
      <button className="menu-button" aria-label="Menü öffnen" aria-expanded={open} onClick={() => setOpen(!open)}><span/><span/><span/></button>
    </div>
  </header>;
}

function ProductPreview() {
  const process = [
    ["Erfassen", "Kontakte und Engagements"],
    ["Vereinbaren", "Pakete und Verträge"],
    ["Erfüllen", "Leistungen und Events"],
    ["Weitertragen", "Nächste Saison"],
  ];
  return <div className="dashboard-preview" aria-label="Vorschau der mittragen.ch-Übersicht">
    <aside className="preview-sidebar">
      <Brand compact/>
      <div className="org-select">Ihre Organisation <span>⌄</span></div>
      {['Übersicht', 'Unterstützende', 'Pakete', 'Verträge', 'Events', 'Dokumente'].map((item, index) => <div className={`preview-nav-item ${index === 0 ? "preview-nav-item--active" : ""}`} key={item}>{item}</div>)}
    </aside>
    <div className="preview-main">
      <div className="preview-topline"><div><small>Alles an einem Ort</small><h3>Übersicht</h3></div><span className="season-chip">Aktuelle Saison</span></div>
      <div className="metrics metrics--compact">
        {[
          ["Unterstützende", "Zentral", "Kontakte aktuell"],
          ["Verträge", "Klar", "Status sichtbar"],
          ["Leistungen", "Planbar", "Kontingente im Blick"],
          ["Events", "Offen", "Direkt buchbar"],
        ].map(([label, value, detail]) => <article className="metric" key={label}><span className="metric__label">{label}</span><strong>{value}</strong><span className="metric__detail metric__detail--blue">{detail}</span></article>)}
      </div>
      <div className="preview-section-title"><strong>Ein gemeinsamer Ablauf</strong><span>Nachvollziehbar</span></div>
      <ol className="process-bar" aria-label="Sponsoringprozess">
        {process.map(([title, detail], index) => <li className={`process-bar__step ${index === 1 ? "process-bar__step--active" : ""}`} key={title}><span>{title}</span><small>{detail}</small></li>)}
      </ol>
      <div className="preview-grid">
        <section className="mini-panel">
          <div className="preview-section-title"><strong>Nächste Schritte</strong><span>Gemeinsam</span></div>
          {[
            ["Paket abstimmen", "Bereit"],
            ["Vertrag bestätigen", "Prüfen"],
            ["Matchball einplanen", "Offen"],
          ].map(([title, status], index) => <div className="mini-task" key={title}><i className={`dot dot--${index === 0 ? "green" : index === 1 ? "blue" : "gold"}`}/><div><strong>{title}</strong><small>klar zugewiesen</small></div><span className={`status status--${index === 0 ? "green" : index === 1 ? "blue" : "gold"}`}>{status}</span></div>)}
        </section>
        <section className="mini-panel product-preview__principles">
          <div className="preview-section-title"><strong>Ihr Auftritt</strong><span>Einheitlich</span></div>
          <p><i/><span>Logo und Farben</span></p>
          <p><i/><span>Dossier und Verträge</span></p>
          <p><i/><span>Matchinfos und E-Mails</span></p>
        </section>
      </div>
    </div>
  </div>;
}

export function ProductSite() {
  return <div className="public-page">
    <PublicHeader/>
    <main>
      <section className="hero shell" id="produkt">
        <div className="hero__copy">
          <p className="eyebrow">Das Support-OS für Vereine, Events und Projekte.</p>
          <h1>Unterstützung.<br/><span>Einfach weiter.</span></h1>
          <p className="lead">mittragen.ch verbindet Unterstützende, Pakete, Verträge, Dokumente und Events in einem klaren Prozess.</p>
          <div className="button-row">
            <a className="button button--primary" href="/login"><span>Workspace öffnen</span><Icon name="arrow" size={17}/></a>
            <a className="button button--secondary" href="/sponsor"><span>Sponsorbereich</span></a>
          </div>
          <div className="proof-row"><span><Icon name="check" size={16}/> Eine gemeinsame Datenbasis</span><span><Icon name="check" size={16}/> Rollen klar getrennt</span><span><Icon name="check" size={16}/> Für Schweizer Organisationen</span></div>
        </div>
        <div className="hero__product"><ProductPreview/></div>
      </section>

      <section className="support-strip" id="ablauf">
        <div className="shell support-strip__inner">
          <p className="eyebrow">Klarer Prozess. Starker Rückhalt.</p>
          <h2>Von der ersten Zusage bis zur nächsten Saison – nachvollziehbar und gemeinsam.</h2>
          <div className="support-cards">
            <article><span className="feature-icon"><Icon name="users"/></span><h3>Unterstützende zentral führen</h3><p>Kontakte, Engagements und Zuständigkeiten bleiben an einem verlässlichen Ort aktuell.</p><a href="/login">Workspace öffnen <Icon name="arrow" size={15}/></a></article>
            <article><span className="feature-icon"><Icon name="package"/></span><h3>Leistungen klar zusagen</h3><p>Pakete, Kontingente und einzelne Sponsoringleistungen werden verbindlich und verständlich.</p><a href="/sponsor">Sponsorbereich öffnen <Icon name="arrow" size={15}/></a></article>
            <article><span className="feature-icon"><Icon name="document"/></span><h3>Dokumente automatisch erstellen</h3><p>Dossier, Verträge und Matchinfos übernehmen Logo und Farben Ihrer Organisation.</p><a href="/login">Organisation einrichten <Icon name="arrow" size={15}/></a></article>
          </div>
        </div>
      </section>

      <section className="statement shell" id="sicherheit">
        <div><p className="eyebrow">Klar organisiert. Menschlich verbunden.</p><h2>Die Plattform trägt Prozesse – damit Beziehungen im Zentrum bleiben.</h2></div>
        <div className="statement__stats"><div><strong>1</strong><span>gemeinsame Datenbasis</span></div><div><strong>4</strong><span>klar getrennte Rollen</span></div><div><strong>100%</strong><span>nachvollziehbare Abläufe</span></div></div>
      </section>

      <section className="cta-band">
        <div className="shell cta-band__inner"><div><p className="eyebrow">Unterstützung. Einfach weiter.</p><h2>Bringen Sie Ihr Sponsoring in einen klaren, gemeinsamen Prozess.</h2></div><div className="button-row"><a className="button button--primary" href="/login"><span>Workspace öffnen</span></a><a className="button button--secondary" href="/sponsor"><span>Sponsorbereich</span></a></div></div>
      </section>
    </main>
    <footer className="public-footer shell"><Brand compact/><span>Das Support-OS für Vereine, Events und Projekte.</span><span>Unterstützung. Einfach weiter.</span></footer>
  </div>;
}
