import { useEffect, useMemo, useState } from "react";

type Route = "/" | "/admin" | "/space" | "/ueberfuehren";
type IconName =
  | "arrow"
  | "bell"
  | "building"
  | "calendar"
  | "chart"
  | "check"
  | "chevron"
  | "document"
  | "home"
  | "invoice"
  | "lock"
  | "mail"
  | "package"
  | "spark"
  | "transfer"
  | "users";

const routeFromPath = (): Route => {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (path === "/admin" || path === "/space" || path === "/ueberfuehren") return path;
  return "/";
};

function useRoute() {
  const [route, setRoute] = useState<Route>(routeFromPath);

  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: Route) => {
    window.history.pushState({}, "", next);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return { route, navigate };
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    building: <><path d="M4 21V7l8-4 8 4v14"/><path d="M9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    document: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
    invoice: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    package: <><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></>,
    transfer: <><path d="M4 7h14l-3-3M20 17H6l3 3"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  };

  return (
    <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""} ${inverse ? "brand--inverse" : ""}`} aria-label="Mittragen">
      <svg className="brand__mark" viewBox="0 0 42 42" aria-hidden="true">
        <circle cx="21" cy="5.5" r="4.5" className="brand__node brand__node--blue"/>
        <circle cx="34.5" cy="13" r="4.5" className="brand__node brand__node--gold"/>
        <circle cx="34.5" cy="29" r="4.5" className="brand__node brand__node--blue"/>
        <circle cx="21" cy="36.5" r="4.5" className="brand__node brand__node--gold"/>
        <circle cx="7.5" cy="29" r="4.5" className="brand__node brand__node--blue"/>
        <circle cx="7.5" cy="13" r="4.5" className="brand__node brand__node--gold"/>
        <circle cx="21" cy="21" r="6" className="brand__center"/>
      </svg>
      <span className="brand__word">mittragen</span>
    </div>
  );
}

function Button({ children, variant = "primary", onClick, icon, type = "button" }: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "soft";
  onClick?: () => void;
  icon?: IconName;
  type?: "button" | "submit";
}) {
  return (
    <button className={`button button--${variant}`} onClick={onClick} type={type}>
      <span>{children}</span>{icon && <Icon name={icon} size={17}/>} 
    </button>
  );
}

function Status({ tone, children }: { tone: "green" | "blue" | "gold" | "red" | "neutral"; children: React.ReactNode }) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

function PublicHeader({ navigate }: { navigate: (route: Route) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <button className="brand-button" onClick={() => navigate("/")} aria-label="Zur Startseite"><Brand/></button>
      <nav className={`public-nav ${open ? "public-nav--open" : ""}`} aria-label="Hauptnavigation">
        <button onClick={() => { navigate("/"); setOpen(false); }}>Produkt</button>
        <button onClick={() => { navigate("/ueberfuehren"); setOpen(false); }}>Überführen</button>
        <button onClick={() => { navigate("/"); setOpen(false); }}>Preise</button>
        <button onClick={() => { navigate("/space"); setOpen(false); }}>Sponsor-Login</button>
      </nav>
      <div className="public-header__actions">
        <Button onClick={() => navigate("/admin")}>Prototyp öffnen</Button>
        <button className="menu-button" aria-label="Menü öffnen" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span/><span/><span/>
        </button>
      </div>
    </header>
  );
}

const kpis = [
  { label: "Aktive Unterstützende", value: "24", detail: "+3 seit letzter Saison", tone: "green" as const },
  { label: "Jährliche Beiträge", value: "CHF 286’000", detail: "+12% zum Vorjahr", tone: "green" as const },
  { label: "Offene Rechnungen", value: "3", detail: "CHF 12’400", tone: "red" as const },
  { label: "Verträge im Übergang", value: "5", detail: "in Bearbeitung", tone: "blue" as const },
];

const tasks = [
  { title: "Vorschlag für Bergbau AG prüfen", detail: "Unterstützung Gold · fällig heute", status: "Dringend", tone: "red" as const },
  { title: "Vertrag mit Solartec gegenzeichnen", detail: "Unterstützung Silber · fällig in 3 Tagen", status: "Offen", tone: "blue" as const },
  { title: "Rechnung an Fischer & Partner", detail: "CHF 5’000 · fällig in 5 Tagen", status: "Offen", tone: "gold" as const },
];

const sponsors = [
  { name: "Bergbau AG", contact: "Mara Huber", origin: "FC Bösingen", before: "Gold", proposal: "Gold Plus", value: "CHF 25’000", status: "Prüfen", tone: "red" as const },
  { name: "Solartec AG", contact: "Lukas Aebischer", origin: "beide Klubs", before: "Silber", proposal: "Gold", value: "CHF 15’000", status: "Geöffnet", tone: "blue" as const },
  { name: "Fischer & Partner", contact: "Nina Fischer", origin: "FC Wünnewil-Flamatt", before: "Bronze", proposal: "Silber", value: "CHF 8’000", status: "Bestätigt", tone: "green" as const },
  { name: "Garage Sense", contact: "Jan Schaller", origin: "FC Bösingen", before: "Classic", proposal: "Bronze", value: "CHF 5’000", status: "Beratung", tone: "gold" as const },
];

function MetricCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`metrics ${compact ? "metrics--compact" : ""}`}>
      {kpis.map((item) => (
        <article className="metric" key={item.label}>
          <span className="metric__label">{item.label}</span>
          <strong>{item.value}</strong>
          <span className={`metric__detail metric__detail--${item.tone}`}>{item.detail}</span>
        </article>
      ))}
    </div>
  );
}

function ProcessBar({ active = 1 }: { active?: number }) {
  const steps = [
    { title: "Bisher", detail: "Aktuelles Engagement" },
    { title: "Vorschlag", detail: "Passende Unterstützung" },
    { title: "Alternative", detail: "Optionen und Laufzeit" },
    { title: "Bestätigung", detail: "Vertrag abschliessen" },
  ];
  return (
    <ol className="process-bar" aria-label="Überführungsprozess">
      {steps.map((step, index) => (
        <li className={index === active ? "process-bar__step process-bar__step--active" : "process-bar__step"} key={step.title}>
          <span>{step.title}</span><small>{step.detail}</small>
        </li>
      ))}
    </ol>
  );
}

function DashboardPreview({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <div className="dashboard-preview" aria-label="Vorschau der Mittragen-Übersicht">
      <aside className="preview-sidebar">
        <Brand compact/>
        <div className="org-select">FC Alpenblick <span>⌄</span></div>
        {["Übersicht", "Unterstützende", "Pakete", "Verträge", "Rechnungen", "Überführen", "Berichte"].map((item, index) => (
          <div className={`preview-nav-item ${index === 0 ? "preview-nav-item--active" : ""}`} key={item}>{item}</div>
        ))}
      </aside>
      <div className="preview-main">
        <div className="preview-topline"><div><small>Willkommen zurück</small><h3>Übersicht</h3></div><span className="season-chip">Saison 2027/28⌄</span></div>
        <MetricCards compact/>
        <div className="preview-section-title"><strong>Laufende Überführungen</strong><button onClick={() => navigate("/ueberfuehren")}>Alle anzeigen <Icon name="arrow" size={14}/></button></div>
        <ProcessBar/>
        <div className="preview-grid">
          <section className="mini-panel">
            <div className="preview-section-title"><strong>Aktuelle Aufgaben</strong><span>Alle anzeigen</span></div>
            {tasks.map((task) => <div className="mini-task" key={task.title}><i className={`dot dot--${task.tone}`}/><div><strong>{task.title}</strong><small>{task.detail}</small></div><Status tone={task.tone}>{task.status}</Status></div>)}
          </section>
          <section className="mini-panel">
            <div className="preview-section-title"><strong>Beiträge nach Paket</strong><span>2027/28</span></div>
            <div className="bars">
              {[{n:"Gold",h:82,v:"120’000"},{n:"Silber",h:62,v:"86’000"},{n:"Bronze",h:44,v:"52’000"},{n:"Classic",h:27,v:"28’000"}].map((bar) => <div className="bar" key={bar.n}><small>{bar.v}</small><i style={{height:`${bar.h}%`}}/><span>{bar.n}</span></div>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function HomePage({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <div className="public-page">
      <PublicHeader navigate={navigate}/>
      <main>
        <section className="hero shell">
          <div className="hero__copy">
            <p className="eyebrow">Das Support-OS für Vereine, Events und Projekte.</p>
            <h1>Unterstützung.<br/><span>Einfach weiter.</span></h1>
            <p className="lead">Mittragen verbindet Gönner, Pakete, Verträge, Rechnungen und Veränderungen in einem klaren Prozess.</p>
            <div className="button-row"><Button onClick={() => navigate("/admin")} icon="arrow">Prototyp öffnen</Button><Button variant="secondary" onClick={() => navigate("/ueberfuehren")}>Überführung ansehen</Button></div>
            <div className="proof-row"><span><Icon name="check" size={16}/> Schnell eingeführt</span><span><Icon name="check" size={16}/> Für Teams jeder Grösse</span><span><Icon name="check" size={16}/> Entwickelt für die Schweiz</span></div>
          </div>
          <div className="hero__product"><DashboardPreview navigate={navigate}/></div>
        </section>

        <section className="support-strip">
          <div className="shell support-strip__inner">
            <p className="eyebrow">Klarer Prozess. Starker Rückhalt.</p>
            <h2>Vom bisherigen Engagement zur passenden Unterstützung – nachvollziehbar und gemeinsam.</h2>
            <div className="support-cards">
              <article><span className="feature-icon"><Icon name="users"/></span><h3>Ein Space für Unterstützende</h3><p>Pläne, Rechnungen, Dokumente, Kontaktdaten und Logo an einem verständlichen Ort.</p><button onClick={() => navigate("/space")}>Sponsor-Space öffnen <Icon name="arrow" size={15}/></button></article>
              <article><span className="feature-icon"><Icon name="transfer"/></span><h3>Veränderung ohne Sackgasse</h3><p>Persönliche Vorschläge, echte Alternativen, Beratung und Bestätigung in einem geführten Weg.</p><button onClick={() => navigate("/ueberfuehren")}>Überführung ansehen <Icon name="arrow" size={15}/></button></article>
              <article><span className="feature-icon"><Icon name="lock"/></span><h3>Jede Aktion nachvollziehbar</h3><p>Verträge, Zahlungen, Versände und Änderungen erzeugen einen klaren Audit-Trail.</p><button onClick={() => navigate("/admin")}>Backoffice ansehen <Icon name="arrow" size={15}/></button></article>
            </div>
          </div>
        </section>

        <section className="statement shell">
          <div><p className="eyebrow">Sponsor first. Change by design.</p><h2>Eine Plattform, die Beziehungen durch Veränderung trägt.</h2></div>
          <div className="statement__stats"><div><strong>1</strong><span>gemeinsame Datenbasis</span></div><div><strong>4</strong><span>klare Wahlmöglichkeiten</span></div><div><strong>100%</strong><span>mobil nutzbar</span></div></div>
        </section>

        <section className="cta-band">
          <div className="shell cta-band__inner"><div><p className="eyebrow">Der erste Produkt-Slice ist bereit.</p><h2>Erlebe den Ablauf aus beiden Perspektiven.</h2></div><div className="button-row"><Button onClick={() => navigate("/admin")}>Backoffice öffnen</Button><Button variant="secondary" onClick={() => navigate("/space")}>Sponsor-Space öffnen</Button></div></div>
        </section>
      </main>
      <footer className="public-footer shell"><Brand compact/><span>Das Support-OS für Vereine, Events und Projekte.</span><span>Made in Switzerland.</span></footer>
    </div>
  );
}

const navItems: { label: string; icon: IconName; route?: Route }[] = [
  { label: "Übersicht", icon: "home", route: "/admin" },
  { label: "Unterstützende", icon: "users" },
  { label: "Pakete", icon: "package" },
  { label: "Verträge", icon: "document" },
  { label: "Rechnungen", icon: "invoice" },
  { label: "Kommunikation", icon: "mail" },
  { label: "Überführen", icon: "transfer", route: "/ueberfuehren" },
  { label: "Berichte", icon: "chart" },
];

function AppShell({ children, active, navigate }: { children: React.ReactNode; active: string; navigate: (route: Route) => void }) {
  const [mobileNav, setMobileNav] = useState(false);
  return (
    <div className="app-layout">
      <aside className={`app-sidebar ${mobileNav ? "app-sidebar--open" : ""}`}>
        <button className="brand-button app-sidebar__brand" onClick={() => navigate("/")}><Brand inverse/></button>
        <div className="tenant-card"><span className="tenant-card__avatar">FA</span><div><strong>FC Alpenblick</strong><small>Organisation</small></div><span>⌄</span></div>
        <nav aria-label="App-Navigation">
          {navItems.map((item) => <button className={item.label === active ? "active" : ""} onClick={() => { if (item.route) navigate(item.route); setMobileNav(false); }} key={item.label}><Icon name={item.icon}/><span>{item.label}</span>{item.label === "Überführen" && <em>5</em>}</button>)}
        </nav>
        <div className="app-sidebar__bottom"><button><span className="avatar">AJ</span><span><strong>Adrian J.</strong><small>Owner</small></span><span>•••</span></button></div>
      </aside>
      <div className="app-content">
        <header className="app-topbar">
          <button className="menu-button app-menu" aria-label="Navigation öffnen" onClick={() => setMobileNav(!mobileNav)}><span/><span/><span/></button>
          <div className="app-topbar__context"><span className="context-dot"/> Interaktiver MVP-Prototyp</div>
          <div className="app-topbar__right"><button className="icon-button" aria-label="Benachrichtigungen"><Icon name="bell"/><i/></button><div className="top-avatar">AJ</div></div>
        </header>
        {children}
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function AdminPage({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <AppShell active="Übersicht" navigate={navigate}>
      <main className="app-page">
        <PageHeading eyebrow="Dienstag, 8. September" title="Guten Morgen, Adrian" text="Das Wichtigste für die Saison 2027/28 auf einen Blick." action={<Button onClick={() => navigate("/ueberfuehren")} icon="arrow">Überführung bearbeiten</Button>}/>
        <MetricCards/>
        <section className="panel transition-panel">
          <div className="panel-heading"><div><p className="eyebrow">Laufende Überführung</p><h2>Gemeinsamer Klub · Saison 2027/28</h2></div><div className="completion"><strong>72%</strong><span><i style={{width:"72%"}}/></span></div></div>
          <ProcessBar active={1}/>
          <div className="transition-summary"><span><strong>48</strong> Vorschläge vorbereitet</span><span><strong>32</strong> versendet</span><span><strong>17</strong> bestätigt</span><span className="warning"><strong>4</strong> Konflikte zu klären</span><Button variant="soft" onClick={() => navigate("/ueberfuehren")}>Details öffnen</Button></div>
        </section>
        <div className="dashboard-grid">
          <section className="panel task-panel">
            <div className="panel-heading"><div><p className="eyebrow">Deine Arbeit</p><h2>Nächste Aufgaben</h2></div><button className="text-button">Alle anzeigen <Icon name="arrow" size={15}/></button></div>
            {tasks.map((task) => <button className="task-row" key={task.title}><i className={`dot dot--${task.tone}`}/><div><strong>{task.title}</strong><small>{task.detail}</small></div><Status tone={task.tone}>{task.status}</Status><Icon name="chevron"/></button>)}
          </section>
          <section className="panel revenue-panel">
            <div className="panel-heading"><div><p className="eyebrow">Beiträge</p><h2>Nach Paket</h2></div><span className="season-chip">2027/28⌄</span></div>
            <div className="revenue-total"><span>Gesamt</span><strong>CHF 286’000</strong><small>+12% zum Vorjahr</small></div>
            <div className="bars bars--large">
              {[{n:"Gold",h:88,v:"120’000"},{n:"Silber",h:67,v:"86’000"},{n:"Bronze",h:45,v:"52’000"},{n:"Classic",h:29,v:"28’000"}].map((bar) => <div className="bar" key={bar.n}><small>{bar.v}</small><i style={{height:`${bar.h}%`}}/><span>{bar.n}</span></div>)}
            </div>
          </section>
        </div>
        <section className="panel sponsor-panel">
          <div className="panel-heading"><div><p className="eyebrow">Beziehungen im Blick</p><h2>Unterstützende im Übergang</h2></div><button className="text-button">Alle anzeigen <Icon name="arrow" size={15}/></button></div>
          <div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Herkunft</th><th>Bisher</th><th>Vorschlag</th><th>Beitrag</th><th>Status</th></tr></thead><tbody>{sponsors.map((sponsor) => <tr key={sponsor.name}><td><strong>{sponsor.name}</strong><small>{sponsor.contact}</small></td><td>{sponsor.origin}</td><td>{sponsor.before}</td><td><strong>{sponsor.proposal}</strong></td><td>{sponsor.value}</td><td><Status tone={sponsor.tone}>{sponsor.status}</Status></td></tr>)}</tbody></table></div>
        </section>
      </main>
    </AppShell>
  );
}

function SponsorSpace({ navigate }: { navigate: (route: Route) => void }) {
  const [decision, setDecision] = useState<"open" | "confirmed" | "consultation">(() => (localStorage.getItem("mittragen-decision") as "confirmed" | "consultation" | null) ?? "open");
  const [toast, setToast] = useState("");

  const decide = (next: "confirmed" | "consultation") => {
    setDecision(next);
    localStorage.setItem("mittragen-decision", next);
    setToast(next === "confirmed" ? "Vielen Dank. Ihre Bestätigung wurde protokolliert." : "Ihre Gesprächsanfrage wurde an den Klub übermittelt.");
    window.setTimeout(() => setToast(""), 4000);
  };

  return (
    <div className="space-page">
      {toast && <div className="toast" role="status"><Icon name="check"/>{toast}</div>}
      <header className="space-header"><button className="brand-button" onClick={() => navigate("/")}><Brand/></button><div className="space-header__org"><span className="club-badge">FA</span><div><strong>FC Alpenblick</strong><small>Sponsor-Space</small></div></div><div className="space-header__actions"><button className="icon-button" aria-label="Nachrichten"><Icon name="mail"/></button><span className="avatar">LA</span></div></header>
      <main className="space-shell">
        <div className="space-intro"><div><p className="eyebrow">Willkommen zurück, Lukas</p><h1>Ihre Unterstützung<br/>für die Saison 2027/28.</h1><p>Ihr persönlicher Vorschlag ist vorbereitet. Prüfen Sie Leistungen und Beitrag in Ruhe – alle Möglichkeiten bleiben offen.</p></div><div className="space-security"><Icon name="lock"/><span><strong>Sicherer persönlicher Space</strong><small>Nur für autorisierte Kontakte der Solartec AG</small></span></div></div>

        {decision === "confirmed" ? (
          <section className="confirmation-card"><span className="confirmation-card__icon"><Icon name="check" size={28}/></span><div><p className="eyebrow">Bestätigt</p><h2>Vielen Dank fürs Mittragen.</h2><p>Ihr Paket «Unterstützung Gold» wurde bestätigt. Der Vertrag wird nun vom FC Alpenblick gegengezeichnet und danach hier bereitgestellt.</p></div><Status tone="green">Bestätigung protokolliert</Status></section>
        ) : decision === "consultation" ? (
          <section className="confirmation-card confirmation-card--gold"><span className="confirmation-card__icon"><Icon name="calendar" size={26}/></span><div><p className="eyebrow">Gespräch angefragt</p><h2>Wir melden uns persönlich.</h2><p>Das Sponsoringteam des FC Alpenblick nimmt Kontakt mit Ihnen auf. Ihr Vorschlag bleibt bis dahin unverändert offen.</p></div><Status tone="gold">In Beratung</Status></section>
        ) : (
          <section className="proposal-card">
            <div className="proposal-card__main"><div className="proposal-card__top"><div><p className="eyebrow">Unser Vorschlag</p><h2>Unterstützung Gold</h2><p>Mehr regionale Präsenz und digitale Sichtbarkeit für eine starke gemeinsame Zukunft.</p></div><div className="price"><strong>CHF 15’000</strong><span>pro Saison</span></div></div><div className="benefits"><span><Icon name="check"/> Alle bisherigen Leistungen</span><span><Icon name="check"/> Exklusive Social-Media-Platzierungen</span><span><Icon name="check"/> Einladung zu zwei VIP-Events</span><span><Icon name="check"/> Gemeinsame PR-Massnahmen</span></div></div>
            <aside className="proposal-card__action"><p>Gültig bis 30. September 2026</p><Button onClick={() => decide("confirmed")} icon="arrow">Vorschlag bestätigen</Button><Button variant="secondary">Pakete vergleichen</Button><button className="text-button" onClick={() => decide("consultation")}><Icon name="calendar" size={16}/> Persönliches Gespräch anfragen</button><small>Mit der Bestätigung stimmen Sie dem angezeigten Vertragsentwurf zu. Im produktiven System folgt hier der vollständige rechtliche Bestätigungstext.</small></aside>
          </section>
        )}

        <section className="space-grid">
          <article className="panel plan-panel"><div className="panel-heading"><div><p className="eyebrow">Ihr Weg</p><h2>Vom bisherigen Paket zum Vorschlag</h2></div></div><div className="plan-compare"><div><Status tone="neutral">Bisher</Status><h3>Silber Paket</h3><strong>CHF 10’000 / Saison</strong><ul><li><Icon name="check"/>Logo auf Trikots</li><li><Icon name="check"/>Banner im Stadion</li><li><Icon name="check"/>2 Event-Tickets</li></ul></div><span className="compare-arrow"><Icon name="arrow"/></span><div className="plan-compare__new"><Status tone="blue">Vorschlag</Status><h3>Unterstützung Gold</h3><strong>CHF 15’000 / Saison</strong><ul><li><Icon name="check"/>Alle bisherigen Leistungen</li><li><Icon name="check"/>Digitale Sichtbarkeit</li><li><Icon name="check"/>4 VIP-Einladungen</li></ul></div></div></article>
          <article className="panel finance-panel"><div className="panel-heading"><div><p className="eyebrow">Finanzen</p><h2>Rechnungen</h2></div><Status tone="green">Alles bezahlt</Status></div><div className="invoice-row"><span className="document-icon"><Icon name="invoice"/></span><div><strong>Rechnung 2026/081</strong><small>Unterstützung Silber · Saison 2026/27</small></div><strong>CHF 10’000</strong><button aria-label="Rechnung öffnen"><Icon name="chevron"/></button></div><button className="text-button">Alle Rechnungen anzeigen <Icon name="arrow" size={15}/></button></article>
          <article className="panel document-panel"><div className="panel-heading"><div><p className="eyebrow">Ihre Unterlagen</p><h2>Dokumente</h2></div></div>{["Überführungsvorschlag 2027/28", "Sponsoringvertrag 2026/27", "Leistungsübersicht Silber"].map((name, index) => <div className="document-row" key={name}><span className="document-icon"><Icon name="document"/></span><div><strong>{name}</strong><small>{index === 0 ? "Neu · PDF" : "PDF"}</small></div><button aria-label={`${name} öffnen`}><Icon name="chevron"/></button></div>)}</article>
        </section>
      </main>
    </div>
  );
}

const wizardSteps = [
  { label: "Datenbasis", detail: "Import und Herkunft" },
  { label: "Mapping", detail: "Alt zu neu" },
  { label: "Vorschläge", detail: "Prüfen und freigeben" },
  { label: "Versand", detail: "Informieren und verfolgen" },
];

function TransitionPage({ navigate }: { navigate: (route: Route) => void }) {
  const [step, setStep] = useState(2);
  const [query, setQuery] = useState("");
  const filteredSponsors = useMemo(() => sponsors.filter((sponsor) => sponsor.name.toLowerCase().includes(query.toLowerCase()) || sponsor.contact.toLowerCase().includes(query.toLowerCase())), [query]);

  const stepContent = [
    { eyebrow: "Schritt 1 von 4", title: "Datenbasis vorbereiten", text: "Sponsoren, Kontakte, Verträge und Rechnungsstände mit nachvollziehbarer Herkunft zusammenführen." },
    { eyebrow: "Schritt 2 von 4", title: "Altpakete auf das Zielbild abbilden", text: "Definieren Sie, welche neue Unterstützung zu bisherigen Paketen passt, bevor persönliche Vorschläge entstehen." },
    { eyebrow: "Schritt 3 von 4", title: "Persönliche Vorschläge prüfen", text: "Beiträge, Leistungen und Konflikte einzeln prüfen. Erst freigegebene Vorschläge können versendet werden." },
    { eyebrow: "Schritt 4 von 4", title: "Kampagne sicher versenden", text: "Empfänger, Frist, Absender und Erinnerung vor dem Start noch einmal kontrollieren." },
  ][step];

  return (
    <AppShell active="Überführen" navigate={navigate}>
      <main className="app-page transition-page">
        <PageHeading eyebrow={stepContent.eyebrow} title={stepContent.title} text={stepContent.text} action={<Button variant="secondary" onClick={() => navigate("/admin")}>Zur Übersicht</Button>}/>
        <ol className="wizard-nav">
          {wizardSteps.map((item, index) => <li key={item.label}><button className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} onClick={() => setStep(index)}><span>{index < step ? <Icon name="check" size={16}/> : index + 1}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></button></li>)}
        </ol>

        {step === 0 && <section className="panel wizard-panel"><div className="drop-zone"><span className="feature-icon"><Icon name="document" size={24}/></span><h2>Sponsorenlisten importieren</h2><p>CSV oder XLSX mit Sponsoren, Kontakten, Verträgen und Rechnungsständen.</p><Button>Importdatei auswählen</Button><small>Im Prototyp wird noch keine Datei übertragen.</small></div><div className="import-sources"><div><span className="club-badge">FB</span><div><strong>FC Bösingen</strong><small>28 Sponsoren · geprüft</small></div><Status tone="green">Bereit</Status></div><div><span className="club-badge club-badge--gold">FW</span><div><strong>FC Wünnewil-Flamatt</strong><small>24 Sponsoren · 2 Klärfälle</small></div><Status tone="gold">Prüfen</Status></div></div></section>}

        {step === 1 && <section className="panel wizard-panel"><div className="mapping-grid"><div><p className="eyebrow">Bisherige Pakete</p>{["Gold Sponsoring", "Silber Sponsoring", "Bronze Sponsoring", "Bandenwerbung"].map((name) => <div className="mapping-row" key={name}><span>{name}</span><Icon name="arrow"/><select aria-label={`Zielpaket für ${name}`} defaultValue={name.includes("Gold") ? "Gold Plus" : name.includes("Silber") ? "Gold" : name.includes("Bronze") ? "Silber" : "Classic"}><option>Gold Plus</option><option>Gold</option><option>Silber</option><option>Bronze</option><option>Classic</option></select></div>)}</div><aside className="mapping-summary"><p className="eyebrow">Simulation</p><h2>Auswirkung auf die Saison</h2><div><span>Aktueller Wert</span><strong>CHF 258’000</strong></div><div><span>Zielwert</span><strong>CHF 286’000</strong></div><div><span>Veränderung</span><strong className="positive">+10.9%</strong></div><Status tone="gold">4 Konflikte prüfen</Status></aside></div></section>}

        {step === 2 && <><section className="metrics metrics--transition"><article className="metric"><span className="metric__label">Vorschläge bereit</span><strong>48</strong><span className="metric__detail metric__detail--green">92% der Daten vollständig</span></article><article className="metric"><span className="metric__label">Zielwert</span><strong>CHF 286’000</strong><span className="metric__detail metric__detail--green">+10.9% zum Bestand</span></article><article className="metric"><span className="metric__label">Konflikte</span><strong>4</strong><span className="metric__detail metric__detail--red">Entscheid erforderlich</span></article></section><section className="panel sponsor-panel"><div className="panel-heading"><div><p className="eyebrow">Arbeitsliste</p><h2>Vorschläge und Ausnahmen</h2></div><label className="search-field"><span className="visually-hidden">Unterstützende durchsuchen</span><input type="search" placeholder="Name oder Kontakt suchen" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div><div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Herkunft</th><th>Bisher</th><th>Vorschlag</th><th>Beitrag</th><th>Status</th><th><span className="visually-hidden">Aktion</span></th></tr></thead><tbody>{filteredSponsors.map((sponsor) => <tr key={sponsor.name}><td><strong>{sponsor.name}</strong><small>{sponsor.contact}</small></td><td>{sponsor.origin}</td><td>{sponsor.before}</td><td><strong>{sponsor.proposal}</strong></td><td>{sponsor.value}</td><td><Status tone={sponsor.tone}>{sponsor.status}</Status></td><td><button className="row-action" aria-label={`${sponsor.name} öffnen`}><Icon name="chevron"/></button></td></tr>)}</tbody></table></div></section></>}

        {step === 3 && <section className="panel wizard-panel"><div className="send-review"><div><p className="eyebrow">Kampagne</p><h2>Gemeinsam in die Saison 2027/28</h2><p>Persönliche Information zur neuen Klubstruktur und zum vorgeschlagenen Unterstützungsplan.</p><dl><div><dt>Empfänger</dt><dd>48 autorisierte Kontakte</dd></div><div><dt>Absender</dt><dd>partnerschaft@fcalpenblick.ch</dd></div><div><dt>Frist</dt><dd>30. September 2026</dd></div><div><dt>Erinnerung</dt><dd>nach 7 und 14 Tagen</dd></div></dl></div><aside className="send-checks"><h3>Versandprüfung</h3>{["48 Vorschläge intern freigegeben", "Keine unaufgelösten Variablen", "Absender-Domain verifiziert", "4 Konflikte bewusst ausgenommen"].map((check) => <span key={check}><i><Icon name="check" size={15}/></i>{check}</span>)}<Button icon="arrow">Kampagne freigeben</Button><small>Der Prototyp löst keinen echten Versand aus.</small></aside></div></section>}

        <div className="wizard-footer"><Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))}>Zurück</Button><span>Änderungen werden im Prototyp lokal dargestellt.</span><Button onClick={() => setStep(Math.min(3, step + 1))} icon={step < 3 ? "arrow" : undefined}>{step < 3 ? "Weiter" : "Prüfung abgeschlossen"}</Button></div>
      </main>
    </AppShell>
  );
}

export default function App() {
  const { route, navigate } = useRoute();
  if (route === "/admin") return <AdminPage navigate={navigate}/>;
  if (route === "/space") return <SponsorSpace navigate={navigate}/>;
  if (route === "/ueberfuehren") return <TransitionPage navigate={navigate}/>;
  return <HomePage navigate={navigate}/>;
}
