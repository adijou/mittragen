import { useEffect, useMemo, useState } from "react";
import { ProductiveAccess } from "./ProductiveAccess";
import { SponsorPortal } from "./SponsorPortal";
import { ContractSigning } from "./ContractSigning";
import { EventSponsoringPublic } from "./EventSponsoringPublic";

type Route = "/" | "/admin" | "/space" | "/sponsor" | "/ueberfuehren" | "/login" | "/workspace" | "/unterzeichnen" | "/matchball";
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

type Tone = "green" | "blue" | "gold" | "red" | "neutral";
type PackageName = "Gold Plus" | "Gold" | "Silber" | "Bronze" | "Classic";
type SponsorStatus = "Prüfen" | "Vorbereitet" | "Freigegeben" | "Geöffnet" | "Rückfrage" | "Bestätigt" | "Abgelehnt";

type TransitionSponsor = {
  id: string;
  name: string;
  contact: string;
  origin: "FC Bösingen" | "FC Wünnewil-Flamatt" | "beide Klubs";
  before: string;
  beforeValue: number;
  proposal: PackageName;
  alternative: PackageName;
  status: SponsorStatus;
  conflict?: {
    kind: string;
    detail: string;
  };
  owner: string;
  note: string;
  reason: string;
  contractRoute: string;
  provenance: string;
};

type AuditEvent = {
  id: string;
  time: string;
  action: string;
  detail: string;
};

const packageCatalog: Record<PackageName, { price: number; description: string; benefits: string[] }> = {
  "Gold Plus": { price: 25000, description: "Maximale regionale Präsenz mit exklusiven Aktivierungen.", benefits: ["Premium-Präsenz im Stadion", "Digitale Kampagnen", "6 VIP-Einladungen", "Gemeinsame PR-Aktivierung"] },
  Gold: { price: 15000, description: "Mehr regionale Präsenz und digitale Sichtbarkeit.", benefits: ["Alle bisherigen Leistungen", "Social-Media-Platzierungen", "4 VIP-Einladungen", "Gemeinsame PR-Massnahmen"] },
  Silber: { price: 8000, description: "Verlässliche Sichtbarkeit rund um den gemeinsamen Klub.", benefits: ["Banden- oder Eventpräsenz", "Website und Partnerübersicht", "2 VIP-Einladungen", "Saison-Kommunikation"] },
  Bronze: { price: 5000, description: "Kompakte Partnerschaft mit klaren Grundleistungen.", benefits: ["Partnerübersicht", "Digitale Sichtbarkeit", "2 Match-Tickets", "Partner-Netzwerk"] },
  Classic: { price: 3000, description: "Solide Unterstützung mit lokaler Verankerung.", benefits: ["Website-Präsenz", "Saison-Dank", "2 Match-Tickets", "Partner-Newsletter"] },
};

const formatChf = (value: number) => `CHF ${new Intl.NumberFormat("de-CH").format(value).replace(/,/g, "’")}`;

const statusTone = (status: SponsorStatus): Tone => {
  if (status === "Bestätigt" || status === "Freigegeben") return "green";
  if (status === "Geöffnet" || status === "Vorbereitet") return "blue";
  if (status === "Rückfrage") return "gold";
  if (status === "Prüfen" || status === "Abgelehnt") return "red";
  return "neutral";
};

function usePersistentState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) as T : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

const routeFromPath = (): Route => {
  if (/#(?:confirmation_token|invite_token|recovery_token|access_token)=/.test(window.location.hash)) return "/login";
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (/^\/matchball\/[0-9a-f]{36}$/i.test(path)) return "/matchball";
  if (path === "/admin" || path === "/space" || path === "/sponsor" || path === "/ueberfuehren" || path === "/login" || path === "/workspace" || path === "/unterzeichnen") return path;
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

function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
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
        <button onClick={() => { navigate("/login"); setOpen(false); }}>Login</button>
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

const initialSponsors: TransitionSponsor[] = [
  {
    id: "bergbau",
    name: "Bergbau AG",
    contact: "Mara Huber",
    origin: "FC Bösingen",
    before: "Gold Sponsoring",
    beforeValue: 20000,
    proposal: "Gold Plus",
    alternative: "Gold",
    status: "Prüfen",
    conflict: { kind: "Branchenexklusivität", detail: "Die Exklusivität kollidiert mit einem Partner des FC Wünnewil-Flamatt." },
    owner: "Adrian J.",
    note: "Exklusivitätsklausel vor Freigabe persönlich klären.",
    reason: "Die bisherige Hauptpartnerschaft wird mit erweiterten digitalen Rechten weitergeführt.",
    contractRoute: "Neuvertrag mit Exklusivitätsanhang",
    provenance: "FCB_Sponsoren_2026.xlsx · Zeile 14",
  },
  {
    id: "solartec",
    name: "Solartec AG",
    contact: "Lukas Aebischer",
    origin: "beide Klubs",
    before: "Silber Sponsoring + Bande",
    beforeValue: 13000,
    proposal: "Gold",
    alternative: "Silber",
    status: "Geöffnet",
    conflict: { kind: "Doppelsponsor", detail: "Zwei Kontakte und teilweise doppelte Leistungen aus beiden Altklubs wurden zusammengeführt." },
    owner: "Nina F.",
    note: "Kontakte abgeglichen; Lukas Aebischer ist entscheidungsberechtigt.",
    reason: "Die bisherigen Leistungen beider Klubs werden gebündelt und um digitale Sichtbarkeit ergänzt.",
    contractRoute: "Neuvertrag ersetzt beide Altverträge",
    provenance: "FCB Zeile 22 + FCWF Zeile 9",
  },
  {
    id: "fischer",
    name: "Fischer & Partner",
    contact: "Nina Fischer",
    origin: "FC Wünnewil-Flamatt",
    before: "Bronze Sponsoring",
    beforeValue: 5000,
    proposal: "Silber",
    alternative: "Bronze",
    status: "Freigegeben",
    owner: "Mara H.",
    note: "Standardmigration ohne Abweichung.",
    reason: "Das Silber-Paket wahrt die bisherige Präsenz und ergänzt zwei Netzwerk-Anlässe.",
    contractRoute: "Neuabschluss ab Saison 2027/28",
    provenance: "FCWF_Sponsoren.csv · Zeile 18",
  },
  {
    id: "garage-sense",
    name: "Garage Sense",
    contact: "Jan Schaller",
    origin: "FC Bösingen",
    before: "Classic",
    beforeValue: 3000,
    proposal: "Bronze",
    alternative: "Classic",
    status: "Rückfrage",
    conflict: { kind: "Abweichende Laufzeit", detail: "Der Altvertrag läuft bis Dezember, die neue Saison beginnt bereits im Juli." },
    owner: "Nina F.",
    note: "Sponsor wünscht Gespräch zur Übergangsperiode.",
    reason: "Bronze bietet einen nahtlosen Übergang mit zusätzlicher Sichtbarkeit.",
    contractRoute: "Nachtrag bis Dezember, danach Neuvertrag",
    provenance: "FCB_Vertraege.xlsx · Zeile 31",
  },
  {
    id: "kaeserei",
    name: "Käserei Sensetal",
    contact: "Daniela Riedo",
    origin: "FC Wünnewil-Flamatt",
    before: "Silber Sponsoring",
    beforeValue: 8000,
    proposal: "Silber",
    alternative: "Bronze",
    status: "Vorbereitet",
    owner: "Mara H.",
    note: "Bisherigen Betrag auf Wunsch unverändert belassen.",
    reason: "Leistungen werden neu geordnet, der jährliche Beitrag bleibt gleich.",
    contractRoute: "Neuvertrag mit gleichem Jahresbeitrag",
    provenance: "FCWF_Sponsoren.csv · Zeile 27",
  },
  {
    id: "bauwerk",
    name: "Bauwerk Freiburg",
    contact: "Thomas Neuhaus",
    origin: "beide Klubs",
    before: "Gold Sponsoring",
    beforeValue: 18000,
    proposal: "Gold Plus",
    alternative: "Gold",
    status: "Prüfen",
    conflict: { kind: "Rechtsträger", detail: "Ein Vertrag ist übertragbar, der zweite muss durch einen Neuvertrag ersetzt werden." },
    owner: "Adrian J.",
    note: "Rechtsprüfung zur Vertragsübernahme offen.",
    reason: "Die Leistungen werden in einer gemeinsamen Hauptpartnerschaft konsolidiert.",
    contractRoute: "Übernahme plus ergänzender Neuvertrag",
    provenance: "FCB Zeile 7 + FCWF Zeile 12",
  },
  {
    id: "regionalmarkt",
    name: "Regionalmarkt Unterland",
    contact: "Sophie Baeriswyl",
    origin: "FC Bösingen",
    before: "Bandenwerbung",
    beforeValue: 4500,
    proposal: "Bronze",
    alternative: "Classic",
    status: "Prüfen",
    conflict: { kind: "Sachleistung", detail: "Ein Teil der Gegenleistung besteht aus Verpflegung und ist noch nicht abschliessend bewertet." },
    owner: "Mara H.",
    note: "Sachleistungswert mit Einkauf abstimmen.",
    reason: "Die lokale Präsenz bleibt erhalten und wird mit Partnerkommunikation ergänzt.",
    contractRoute: "Neuvertrag mit Sachleistungsbeilage",
    provenance: "FCB_Sponsoren_2026.xlsx · Zeile 39",
  },
];

const initialAuditEvents: AuditEvent[] = [
  { id: "audit-1", time: "2026-09-08T17:20:00.000Z", action: "Datenquellen zusammengeführt", detail: "52 Datensätze aus FC Bösingen und FC Wünnewil-Flamatt" },
  { id: "audit-2", time: "2026-09-08T17:31:00.000Z", action: "Doppelsponsor erkannt", detail: "Solartec AG als gemeinsamer Datensatz markiert" },
  { id: "audit-3", time: "2026-09-08T17:45:00.000Z", action: "Vorschlag freigegeben", detail: "Fischer & Partner · Unterstützung Silber" },
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

function AdminPage({ navigate, sponsors, auditEvents }: { navigate: (route: Route) => void; sponsors: TransitionSponsor[]; auditEvents: AuditEvent[] }) {
  const targetValue = sponsors.reduce((sum, sponsor) => sum + packageCatalog[sponsor.proposal].price, 0);
  const confirmed = sponsors.filter((sponsor) => sponsor.status === "Bestätigt").length;
  const unresolved = sponsors.filter((sponsor) => sponsor.conflict && sponsor.status === "Prüfen").length;
  const progressed = sponsors.filter((sponsor) => !["Prüfen", "Vorbereitet"].includes(sponsor.status)).length;
  const completion = Math.round((progressed / sponsors.length) * 100);
  const dashboardKpis = [
    { label: "Testszenarien", value: String(sponsors.length), detail: "Fusionsfälle abgedeckt", tone: "blue" as const },
    { label: "Zielwert im Prototyp", value: formatChf(targetValue), detail: "aus gewählten Vorschlägen", tone: "green" as const },
    { label: "Offene Konflikte", value: String(unresolved), detail: "Entscheid erforderlich", tone: "red" as const },
    { label: "Bestätigungen", value: String(confirmed), detail: "im Sponsor-Space", tone: "green" as const },
  ];

  return (
    <AppShell active="Übersicht" navigate={navigate}>
      <main className="app-page">
        <PageHeading eyebrow="Dienstag, 8. September" title="Guten Morgen, Adrian" text="Das Wichtigste für die Saison 2027/28 auf einen Blick." action={<Button onClick={() => navigate("/ueberfuehren")} icon="arrow">Überführung bearbeiten</Button>}/>
        <div className="metrics">{dashboardKpis.map((item) => <article className="metric" key={item.label}><span className="metric__label">{item.label}</span><strong>{item.value}</strong><span className={`metric__detail metric__detail--${item.tone}`}>{item.detail}</span></article>)}</div>
        <section className="panel transition-panel">
          <div className="panel-heading"><div><p className="eyebrow">Laufende Überführung</p><h2>Gemeinsamer Klub · Saison 2027/28</h2></div><div className="completion"><strong>{completion}%</strong><span><i style={{width:`${completion}%`}}/></span></div></div>
          <ProcessBar active={1}/>
          <div className="transition-summary"><span><strong>{sponsors.length}</strong> Testszenarien</span><span><strong>{progressed}</strong> in Bearbeitung</span><span><strong>{confirmed}</strong> bestätigt</span><span className="warning"><strong>{unresolved}</strong> Konflikte zu klären</span><Button variant="soft" onClick={() => navigate("/ueberfuehren")}>Details öffnen</Button></div>
        </section>
        <div className="dashboard-grid">
          <section className="panel task-panel">
            <div className="panel-heading"><div><p className="eyebrow">Deine Arbeit</p><h2>Nächste Aufgaben</h2></div><button className="text-button">Alle anzeigen <Icon name="arrow" size={15}/></button></div>
            {sponsors.filter((sponsor) => sponsor.conflict && sponsor.status === "Prüfen").slice(0, 3).map((sponsor) => <button className="task-row" onClick={() => navigate("/ueberfuehren")} key={sponsor.id}><i className="dot dot--red"/><div><strong>{sponsor.conflict?.kind} bei {sponsor.name}</strong><small>{sponsor.owner} · {sponsor.contractRoute}</small></div><Status tone="red">Prüfen</Status><Icon name="chevron"/></button>)}
          </section>
          <section className="panel revenue-panel">
            <div className="panel-heading"><div><p className="eyebrow">Beiträge</p><h2>Testszenarien</h2></div><span className="season-chip">2027/28⌄</span></div>
            <div className="revenue-total"><span>Zielwert</span><strong>{formatChf(targetValue)}</strong><small>interaktive Stichprobe</small></div>
            <div className="bars bars--large">
              {(["Gold Plus", "Gold", "Silber", "Bronze", "Classic"] as PackageName[]).map((name) => { const count = sponsors.filter((sponsor) => sponsor.proposal === name).length; return <div className="bar" key={name}><small>{count}</small><i style={{height:`${Math.max(12, count * 34)}%`}}/><span>{name}</span></div>; })}
            </div>
          </section>
        </div>
        <section className="panel sponsor-panel">
          <div className="panel-heading"><div><p className="eyebrow">Beziehungen im Blick</p><h2>Unterstützende im Übergang</h2></div><button className="text-button" onClick={() => navigate("/ueberfuehren")}>Arbeitsliste öffnen <Icon name="arrow" size={15}/></button></div>
          <div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Herkunft</th><th>Bisher</th><th>Vorschlag</th><th>Beitrag</th><th>Status</th></tr></thead><tbody>{sponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.name}</strong><small>{sponsor.contact}</small></td><td>{sponsor.origin}</td><td>{sponsor.before}</td><td><strong>{sponsor.proposal}</strong></td><td>{formatChf(packageCatalog[sponsor.proposal].price)}</td><td><Status tone={statusTone(sponsor.status)}>{sponsor.status}</Status></td></tr>)}</tbody></table></div>
        </section>
        <section className="panel audit-panel">
          <div className="panel-heading"><div><p className="eyebrow">Nachvollziehbarkeit</p><h2>Letzte Prototyp-Aktionen</h2></div><Status tone="neutral">Lokal gespeichert</Status></div>
          <div className="audit-list">{auditEvents.slice(0, 5).map((event) => <div className="audit-row" key={event.id}><span className="document-icon"><Icon name="check"/></span><div><strong>{event.action}</strong><small>{event.detail}</small></div><time>{new Date(event.time).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>)}</div>
        </section>
      </main>
    </AppShell>
  );
}

function SponsorSpace({ navigate, sponsors, updateSponsor, addAudit }: {
  navigate: (route: Route) => void;
  sponsors: TransitionSponsor[];
  updateSponsor: (id: string, patch: Partial<TransitionSponsor>) => void;
  addAudit: (action: string, detail: string) => void;
}) {
  const [selectedSponsorId, setSelectedSponsorId] = usePersistentState("mittragen-space-scenario", "solartec");
  const sponsor = sponsors.find((item) => item.id === selectedSponsorId) ?? sponsors[0];
  const [selectedPackage, setSelectedPackage] = useState<PackageName>(sponsor.proposal);
  const [showComparison, setShowComparison] = useState(false);
  const [toast, setToast] = useState("");
  const firstName = sponsor.contact.split(" ")[0];
  const initials = sponsor.contact.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const selection = packageCatalog[selectedPackage];
  const comparisonPackages = Array.from(new Set([sponsor.proposal, sponsor.alternative, "Classic" as PackageName]));

  useEffect(() => {
    setSelectedPackage(sponsor.proposal);
    setShowComparison(false);
  }, [sponsor.id, sponsor.proposal]);

  const decide = (next: "Bestätigt" | "Rückfrage" | "Abgelehnt") => {
    const detail = `${sponsor.name} · ${next === "Bestätigt" ? selectedPackage : sponsor.proposal}`;
    updateSponsor(sponsor.id, { status: next, ...(next === "Bestätigt" ? { proposal: selectedPackage } : {}) });
    addAudit(next === "Bestätigt" ? "Paket im Sponsor-Space bestätigt" : next === "Rückfrage" ? "Persönliches Gespräch angefragt" : "Vorschlag abgelehnt", detail);
    setToast(next === "Bestätigt" ? "Vielen Dank. Ihre Bestätigung wurde protokolliert." : next === "Rückfrage" ? "Ihre Gesprächsanfrage wurde an den Klub übermittelt." : "Ihre Rückmeldung wurde protokolliert. Der Klub meldet sich persönlich.");
    window.setTimeout(() => setToast(""), 4000);
  };

  const reopen = () => {
    updateSponsor(sponsor.id, { status: "Geöffnet" });
    setSelectedPackage(sponsor.proposal);
    addAudit("Testszenario zurückgesetzt", sponsor.name);
  };

  return (
    <div className="space-page">
      {toast && <div className="toast" role="status"><Icon name="check"/>{toast}</div>}
      <header className="space-header"><button className="brand-button" onClick={() => navigate("/")}><Brand/></button><div className="space-header__org"><span className="club-badge">FA</span><div><strong>FC Alpenblick</strong><small>Sponsor-Space</small></div></div><div className="space-header__actions"><button className="icon-button" aria-label="Nachrichten"><Icon name="mail"/></button><span className="avatar">{initials}</span></div></header>
      <main className="space-shell">
        <section className="demo-scenario" aria-label="Testszenario auswählen"><div><p className="eyebrow">Prototyp-Test</p><strong>Sieben fiktive Fusionsszenarien durchspielen</strong></div><label><span>Testszenario</span><select value={sponsor.id} onChange={(event) => setSelectedSponsorId(event.target.value)}>{sponsors.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.conflict?.kind ?? "Standardfall"}</option>)}</select></label></section>
        <div className="space-intro"><div><p className="eyebrow">Willkommen zurück, {firstName}</p><h1>Ihre Unterstützung<br/>für die Saison 2027/28.</h1><p>Ihr persönlicher Vorschlag ist vorbereitet. Prüfen Sie Leistungen und Beitrag in Ruhe – alle Möglichkeiten bleiben offen.</p></div><div className="space-security"><Icon name="lock"/><span><strong>Sicherer persönlicher Space</strong><small>Nur für autorisierte Kontakte der {sponsor.name}</small></span></div></div>

        {sponsor.status === "Bestätigt" ? (
          <section className="confirmation-card"><span className="confirmation-card__icon"><Icon name="check" size={28}/></span><div><p className="eyebrow">Bestätigt</p><h2>Vielen Dank fürs Mittragen.</h2><p>Ihr Paket «Unterstützung {sponsor.proposal}» wurde bestätigt. Als nächster Schritt wird «{sponsor.contractRoute}» ausgelöst.</p><button className="text-button" onClick={reopen}>Testszenario erneut öffnen</button></div><Status tone="green">Bestätigung protokolliert</Status></section>
        ) : sponsor.status === "Rückfrage" ? (
          <section className="confirmation-card confirmation-card--gold"><span className="confirmation-card__icon"><Icon name="calendar" size={26}/></span><div><p className="eyebrow">Gespräch angefragt</p><h2>Wir melden uns persönlich.</h2><p>Das Sponsoringteam des FC Alpenblick nimmt Kontakt mit Ihnen auf. Ihr Vorschlag bleibt bis dahin unverändert offen.</p><button className="text-button" onClick={reopen}>Entscheidungsoptionen erneut anzeigen</button></div><Status tone="gold">In Beratung</Status></section>
        ) : sponsor.status === "Abgelehnt" ? (
          <section className="confirmation-card confirmation-card--declined"><span className="confirmation-card__icon"><Icon name="mail" size={26}/></span><div><p className="eyebrow">Rückmeldung erhalten</p><h2>Danke für Ihre offene Antwort.</h2><p>Es wird nichts automatisch ausgelöst. Der Klub nimmt persönlich Kontakt auf und klärt das weitere Vorgehen.</p><button className="text-button" onClick={reopen}>Optionen erneut prüfen</button></div><Status tone="red">Nicht weiterführen</Status></section>
        ) : (
          <>
            <section className="proposal-card">
              <div className="proposal-card__main"><div className="proposal-card__top"><div><p className="eyebrow">{selectedPackage === sponsor.proposal ? "Unser Vorschlag" : "Ihre gewählte Alternative"}</p><h2>Unterstützung {selectedPackage}</h2><p>{selection.description}</p></div><div className="price"><strong>{formatChf(selection.price)}</strong><span>pro Saison</span></div></div><div className="proposal-reason"><strong>Warum dieser Weg?</strong><span>{sponsor.reason}</span></div><div className="benefits">{selection.benefits.map((benefit) => <span key={benefit}><Icon name="check"/> {benefit}</span>)}</div></div>
              <aside className="proposal-card__action"><p>Gültig bis 30. September 2026</p><Button onClick={() => decide("Bestätigt")} icon="arrow">{selectedPackage === sponsor.proposal ? "Vorschlag" : "Alternative"} bestätigen</Button><Button variant="secondary" onClick={() => setShowComparison(!showComparison)}>{showComparison ? "Vergleich schliessen" : "Pakete vergleichen"}</Button><button className="text-button" onClick={() => decide("Rückfrage")}><Icon name="calendar" size={16}/> Persönliches Gespräch anfragen</button><button className="decline-button" onClick={() => decide("Abgelehnt")}>Im Moment nicht weiterführen</button><small>Dies ist ein lokaler Prototyp. Es wird kein Vertrag und kein Versand ausgelöst.</small></aside>
            </section>
            {showComparison && <section className="package-comparison" aria-label="Paketvergleich"><div className="panel-heading"><div><p className="eyebrow">Wahlmöglichkeit</p><h2>Passende Unterstützung auswählen</h2></div><span>Keine Option führt in eine Sackgasse.</span></div><div className="package-options">{comparisonPackages.map((name) => { const option = packageCatalog[name]; return <article className={selectedPackage === name ? "package-option package-option--selected" : "package-option"} key={name}><Status tone={name === sponsor.proposal ? "blue" : "neutral"}>{name === sponsor.proposal ? "Empfohlen" : "Alternative"}</Status><h3>{name}</h3><strong>{formatChf(option.price)}</strong><p>{option.description}</p><ul>{option.benefits.slice(0, 3).map((benefit) => <li key={benefit}><Icon name="check" size={15}/>{benefit}</li>)}</ul><Button variant={selectedPackage === name ? "soft" : "secondary"} onClick={() => { setSelectedPackage(name); setShowComparison(false); }}>{selectedPackage === name ? "Ausgewählt" : "Dieses Paket wählen"}</Button></article>; })}</div></section>}
          </>
        )}

        <section className="space-grid">
          <article className="panel plan-panel"><div className="panel-heading"><div><p className="eyebrow">Ihr Weg</p><h2>Vom bisherigen Paket zum Vorschlag</h2></div><Status tone={sponsor.conflict ? "gold" : "green"}>{sponsor.conflict?.kind ?? "Standardüberführung"}</Status></div><div className="plan-compare"><div><Status tone="neutral">Bisher</Status><h3>{sponsor.before}</h3><strong>{formatChf(sponsor.beforeValue)} / Saison</strong><ul><li><Icon name="check"/>Bestehende Sichtbarkeit</li><li><Icon name="check"/>Vereinbarte Leistungen</li><li><Icon name="check"/>Bisherige Kontaktwege</li></ul></div><span className="compare-arrow"><Icon name="arrow"/></span><div className="plan-compare__new"><Status tone="blue">Vorschlag</Status><h3>Unterstützung {sponsor.proposal}</h3><strong>{formatChf(packageCatalog[sponsor.proposal].price)} / Saison</strong><ul>{packageCatalog[sponsor.proposal].benefits.slice(0, 3).map((benefit) => <li key={benefit}><Icon name="check"/>{benefit}</li>)}</ul></div></div><div className="contract-route"><Icon name="document"/><span><strong>Vorgesehener Vertragsweg</strong><small>{sponsor.contractRoute}</small></span></div></article>
          <article className="panel finance-panel"><div className="panel-heading"><div><p className="eyebrow">Finanzen</p><h2>Rechnungen</h2></div><Status tone="green">Alles bezahlt</Status></div><div className="invoice-row"><span className="document-icon"><Icon name="invoice"/></span><div><strong>Rechnung 2026/081</strong><small>{sponsor.before} · Saison 2026/27</small></div><strong>{formatChf(sponsor.beforeValue)}</strong><button aria-label="Rechnung öffnen"><Icon name="chevron"/></button></div><button className="text-button">Alle Rechnungen anzeigen <Icon name="arrow" size={15}/></button></article>
          <article className="panel document-panel"><div className="panel-heading"><div><p className="eyebrow">Ihre Unterlagen</p><h2>Dokumente</h2></div></div>{["Überführungsvorschlag 2027/28", "Sponsoringvertrag 2026/27", `Leistungsübersicht ${sponsor.before}`].map((name, index) => <div className="document-row" key={name}><span className="document-icon"><Icon name="document"/></span><div><strong>{name}</strong><small>{index === 0 ? "Neu · PDF" : "PDF"}</small></div><button aria-label={`${name} öffnen`}><Icon name="chevron"/></button></div>)}</article>
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

function SponsorDetail({ sponsor, close, updateSponsor, addAudit }: {
  sponsor: TransitionSponsor;
  close: () => void;
  updateSponsor: (id: string, patch: Partial<TransitionSponsor>) => void;
  addAudit: (action: string, detail: string) => void;
}) {
  const release = () => {
    updateSponsor(sponsor.id, { status: "Freigegeben" });
    addAudit("Vorschlag intern freigegeben", `${sponsor.name} · Unterstützung ${sponsor.proposal}`);
    close();
  };

  return <div className="detail-overlay" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="detail-panel__header"><div><p className="eyebrow">Persönlicher Vorschlag</p><h2 id="detail-title">{sponsor.name}</h2><span>{sponsor.contact} · {sponsor.origin}</span></div><button className="detail-close" onClick={close} aria-label="Detailansicht schliessen">×</button></div>{sponsor.conflict && <div className="conflict-card"><Status tone="red">{sponsor.conflict.kind}</Status><p>{sponsor.conflict.detail}</p></div>}<div className="detail-grid"><label><span>Zielpaket</span><select value={sponsor.proposal} onChange={(event) => updateSponsor(sponsor.id, { proposal: event.target.value as PackageName, status: "Vorbereitet" })}>{Object.keys(packageCatalog).map((name) => <option key={name}>{name}</option>)}</select></label><label><span>Alternative</span><select value={sponsor.alternative} onChange={(event) => updateSponsor(sponsor.id, { alternative: event.target.value as PackageName })}>{Object.keys(packageCatalog).map((name) => <option key={name}>{name}</option>)}</select></label><label><span>Verantwortlich</span><input value={sponsor.owner} onChange={(event) => updateSponsor(sponsor.id, { owner: event.target.value })}/></label><label><span>Vertragsweg</span><input value={sponsor.contractRoute} onChange={(event) => updateSponsor(sponsor.id, { contractRoute: event.target.value })}/></label></div><label className="detail-note"><span>Interne Notiz</span><textarea value={sponsor.note} onChange={(event) => updateSponsor(sponsor.id, { note: event.target.value })}/></label><dl className="detail-facts"><div><dt>Herkunft</dt><dd>{sponsor.provenance}</dd></div><div><dt>Bisher</dt><dd>{sponsor.before} · {formatChf(sponsor.beforeValue)}</dd></div><div><dt>Vorschlag</dt><dd>{sponsor.proposal} · {formatChf(packageCatalog[sponsor.proposal].price)}</dd></div><div><dt>Status</dt><dd><Status tone={statusTone(sponsor.status)}>{sponsor.status}</Status></dd></div></dl><div className="detail-reason"><strong>Begründung für den Sponsor</strong><p>{sponsor.reason}</p></div><div className="detail-actions"><Button variant="secondary" onClick={close}>Später weiterarbeiten</Button><Button onClick={release} icon="check">Intern freigeben</Button></div></aside></div>;
}

function TransitionPage({ navigate, sponsors, updateSponsor, addAudit, resetSponsors }: {
  navigate: (route: Route) => void;
  sponsors: TransitionSponsor[];
  updateSponsor: (id: string, patch: Partial<TransitionSponsor>) => void;
  addAudit: (action: string, detail: string) => void;
  resetSponsors: () => void;
}) {
  const [step, setStep] = useState(2);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(null);
  const [campaignSimulated, setCampaignSimulated] = usePersistentState("mittragen-campaign-simulated", false);
  const [mapping, setMapping] = usePersistentState<Record<string, PackageName>>("mittragen-mapping", { "Gold Sponsoring": "Gold Plus", "Silber Sponsoring": "Silber", "Bronze Sponsoring": "Bronze", Bandenwerbung: "Classic", Classic: "Classic" });
  const selectedSponsor = sponsors.find((sponsor) => sponsor.id === selectedSponsorId);
  const sourceValue = sponsors.reduce((sum, sponsor) => sum + sponsor.beforeValue, 0);
  const targetValue = sponsors.reduce((sum, sponsor) => sum + packageCatalog[sponsor.proposal].price, 0);
  const delta = sourceValue ? ((targetValue - sourceValue) / sourceValue) * 100 : 0;
  const conflictCount = sponsors.filter((sponsor) => sponsor.conflict && sponsor.status === "Prüfen").length;
  const releasedCount = sponsors.filter((sponsor) => ["Freigegeben", "Geöffnet", "Rückfrage", "Bestätigt", "Abgelehnt"].includes(sponsor.status)).length;

  const filteredSponsors = useMemo(() => sponsors.filter((sponsor) => {
    const searchMatch = sponsor.name.toLowerCase().includes(query.toLowerCase()) || sponsor.contact.toLowerCase().includes(query.toLowerCase());
    return searchMatch && (!statusFilter || sponsor.status === statusFilter) && (!originFilter || sponsor.origin === originFilter) && (!conflictsOnly || Boolean(sponsor.conflict));
  }), [conflictsOnly, originFilter, query, sponsors, statusFilter]);

  const applyMapping = (source: string, target: PackageName) => {
    setMapping((current) => ({ ...current, [source]: target }));
    sponsors.filter((sponsor) => sponsor.before.includes(source)).forEach((sponsor) => updateSponsor(sponsor.id, { proposal: target, status: sponsor.status === "Bestätigt" ? "Bestätigt" : sponsor.conflict ? "Prüfen" : "Vorbereitet" }));
  };

  const applyScenario = (name: string, values: Record<string, PackageName>) => {
    Object.entries(values).forEach(([source, target]) => applyMapping(source, target));
    addAudit("Mapping-Szenario angewendet", name);
  };

  const simulateCampaign = () => {
    sponsors.filter((sponsor) => sponsor.status === "Freigegeben").forEach((sponsor) => updateSponsor(sponsor.id, { status: "Geöffnet" }));
    setCampaignSimulated(true);
    addAudit("Kampagnenversand simuliert", `${releasedCount} freigegebene Testszenarien`);
  };

  const stepContent = [
    { eyebrow: "Schritt 1 von 4", title: "Datenbasis vorbereiten", text: "Sponsoren, Kontakte, Verträge und Rechnungsstände mit nachvollziehbarer Herkunft zusammenführen." },
    { eyebrow: "Schritt 2 von 4", title: "Altpakete auf das Zielbild abbilden", text: "Mapping und Szenarien simulieren, bevor persönliche Vorschläge entstehen." },
    { eyebrow: "Schritt 3 von 4", title: "Persönliche Vorschläge prüfen", text: "Sieben fiktive, aber realistische Fusionsfälle einzeln bearbeiten und intern freigeben." },
    { eyebrow: "Schritt 4 von 4", title: "Kampagne sicher simulieren", text: "Empfänger, Frist, Absender und Ausnahmen vor einem späteren echten Versand kontrollieren." },
  ][step];

  return (
    <AppShell active="Überführen" navigate={navigate}>
      <main className="app-page transition-page">
        <PageHeading eyebrow={stepContent.eyebrow} title={stepContent.title} text={stepContent.text} action={<Button variant="secondary" onClick={() => navigate("/admin")}>Zur Übersicht</Button>}/>
        <ol className="wizard-nav">{wizardSteps.map((item, index) => <li key={item.label}><button className={`${index === step ? "active" : ""} ${index < step ? "done" : ""}`} onClick={() => setStep(index)}><span>{index < step ? <Icon name="check" size={16}/> : index + 1}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></button></li>)}</ol>

        {step === 0 && <><section className="panel wizard-panel import-panel"><div className="import-hero"><span className="feature-icon"><Icon name="document" size={24}/></span><div><p className="eyebrow">Demo-Datenbasis</p><h2>Sieben Testszenarien sind geladen</h2><p>Die Stichprobe deckt Doppelsponsor, Exklusivität, Laufzeit, Rechtsträger, Betragstreue, Sachleistung und Standardmigration ab.</p></div><Button variant="secondary" onClick={resetSponsors}>Demo zurücksetzen</Button></div><div className="import-sources"><div><span className="club-badge">FB</span><div><strong>FC Bösingen</strong><small>4 Szenarien · Herkunft dokumentiert</small></div><Status tone="green">Bereit</Status></div><div><span className="club-badge club-badge--gold">FW</span><div><strong>FC Wünnewil-Flamatt</strong><small>4 Szenarien · 2 Doppeldatensätze</small></div><Status tone="gold">Abgeglichen</Status></div></div></section><section className="panel import-preview"><div className="panel-heading"><div><p className="eyebrow">Validierung</p><h2>Importvorschau und Herkunft</h2></div><Status tone="blue">7 von 7 lesbar</Status></div><div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Quelle</th><th>Erkannter Fall</th><th>Validierung</th></tr></thead><tbody>{sponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.name}</strong><small>{sponsor.contact}</small></td><td>{sponsor.provenance}</td><td>{sponsor.conflict?.kind ?? "Standardmigration"}</td><td><Status tone={sponsor.conflict ? "gold" : "green"}>{sponsor.conflict ? "Klärfall" : "Vollständig"}</Status></td></tr>)}</tbody></table></div></section></>}

        {step === 1 && <><section className="scenario-strip"><article><div><p className="eyebrow">Szenario A</p><h3>Kontinuität</h3><p>Beträge möglichst stabil halten.</p></div><Button variant="secondary" onClick={() => applyScenario("Kontinuität", { "Gold Sponsoring": "Gold", "Silber Sponsoring": "Silber", "Bronze Sponsoring": "Bronze", Bandenwerbung: "Classic", Classic: "Classic" })}>Anwenden</Button></article><article className="recommended"><div><p className="eyebrow">Szenario B · empfohlen</p><h3>Ausgewogen</h3><p>Leistungen bündeln, moderate Entwicklung.</p></div><Button variant="soft" onClick={() => applyScenario("Ausgewogen", { "Gold Sponsoring": "Gold Plus", "Silber Sponsoring": "Silber", "Bronze Sponsoring": "Bronze", Bandenwerbung: "Bronze", Classic: "Classic" })}>Anwenden</Button></article><article><div><p className="eyebrow">Szenario C</p><h3>Wachstum</h3><p>Jedes Altpaket eine Stufe höher.</p></div><Button variant="secondary" onClick={() => applyScenario("Wachstum", { "Gold Sponsoring": "Gold Plus", "Silber Sponsoring": "Gold", "Bronze Sponsoring": "Silber", Bandenwerbung: "Bronze", Classic: "Bronze" })}>Anwenden</Button></article></section><section className="panel wizard-panel"><div className="mapping-grid"><div><p className="eyebrow">Bisherige Pakete</p>{Object.entries(mapping).map(([name, target]) => <div className="mapping-row" key={name}><span>{name}</span><Icon name="arrow"/><select aria-label={`Zielpaket für ${name}`} value={target} onChange={(event) => applyMapping(name, event.target.value as PackageName)}>{Object.keys(packageCatalog).map((packageName) => <option key={packageName}>{packageName}</option>)}</select></div>)}</div><aside className="mapping-summary"><p className="eyebrow">Live-Simulation</p><h2>Auswirkung der Stichprobe</h2><div><span>Aktueller Wert</span><strong>{formatChf(sourceValue)}</strong></div><div><span>Zielwert</span><strong>{formatChf(targetValue)}</strong></div><div><span>Veränderung</span><strong className={delta >= 0 ? "positive" : "negative"}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}%</strong></div><Status tone={conflictCount ? "gold" : "green"}>{conflictCount} offene Konflikte</Status></aside></div></section></>}

        {step === 2 && <><section className="metrics metrics--transition"><article className="metric"><span className="metric__label">Testszenarien</span><strong>{sponsors.length}</strong><span className="metric__detail metric__detail--green">Pflichtenheft-Ziel: 5–8</span></article><article className="metric"><span className="metric__label">Zielwert</span><strong>{formatChf(targetValue)}</strong><span className="metric__detail metric__detail--green">{delta >= 0 ? "+" : ""}{delta.toFixed(1)}% zur Stichprobe</span></article><article className="metric"><span className="metric__label">Offene Konflikte</span><strong>{conflictCount}</strong><span className="metric__detail metric__detail--red">Eigentümer und Notiz erforderlich</span></article></section><section className="panel sponsor-panel"><div className="panel-heading"><div><p className="eyebrow">Arbeitsliste</p><h2>Vorschläge und Ausnahmen</h2></div><label className="search-field"><span className="visually-hidden">Unterstützende durchsuchen</span><input type="search" placeholder="Name oder Kontakt suchen" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div><div className="filter-bar"><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Alle Status</option>{["Prüfen", "Vorbereitet", "Freigegeben", "Geöffnet", "Rückfrage", "Bestätigt", "Abgelehnt"].map((status) => <option key={status}>{status}</option>)}</select></label><label><span>Herkunft</span><select value={originFilter} onChange={(event) => setOriginFilter(event.target.value)}><option value="">Beide Altklubs</option><option>FC Bösingen</option><option>FC Wünnewil-Flamatt</option><option>beide Klubs</option></select></label><label className="check-filter"><input type="checkbox" checked={conflictsOnly} onChange={(event) => setConflictsOnly(event.target.checked)}/><span>Nur Sonderfälle</span></label><span className="result-count">{filteredSponsors.length} Einträge</span></div><div className="table-wrap"><table><thead><tr><th>Organisation</th><th>Herkunft</th><th>Fall</th><th>Vorschlag</th><th>Beitrag</th><th>Status</th><th><span className="visually-hidden">Aktion</span></th></tr></thead><tbody>{filteredSponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.name}</strong><small>{sponsor.contact}</small></td><td>{sponsor.origin}</td><td>{sponsor.conflict?.kind ?? "Standard"}</td><td><strong>{sponsor.proposal}</strong><small>Alt. {sponsor.alternative}</small></td><td>{formatChf(packageCatalog[sponsor.proposal].price)}</td><td><Status tone={statusTone(sponsor.status)}>{sponsor.status}</Status></td><td><button className="row-action" aria-label={`${sponsor.name} öffnen`} onClick={() => setSelectedSponsorId(sponsor.id)}><Icon name="chevron"/></button></td></tr>)}</tbody></table></div></section></>}

        {step === 3 && <section className="panel wizard-panel"><div className="send-review"><div><p className="eyebrow">Kampagnen-Prototyp</p><h2>Gemeinsam in die Saison 2027/28</h2><p>Persönliche Information zur neuen Klubstruktur und zum vorgeschlagenen Unterstützungsplan.</p><dl><div><dt>Empfänger</dt><dd>{releasedCount} freigegebene Testszenarien</dd></div><div><dt>Absender</dt><dd>partnerschaft@fcalpenblick.ch</dd></div><div><dt>Frist</dt><dd>30. September 2026</dd></div><div><dt>Erinnerung</dt><dd>nach 7 und 14 Tagen</dd></div></dl>{campaignSimulated && <div className="simulation-success"><Icon name="check"/><span><strong>Simulation abgeschlossen</strong><small>Die Status wurden lokal aktualisiert und im Audit-Protokoll ergänzt.</small></span></div>}</div><aside className="send-checks"><h3>Versandprüfung</h3>{[`${releasedCount} Szenarien freigegeben oder beantwortet`, "Personalisierte Vorschläge vollständig", "Keine externen Daten werden übertragen", `${conflictCount} offene Konflikte bleiben ausgenommen`].map((check) => <span key={check}><i><Icon name="check" size={15}/></i>{check}</span>)}<Button icon="arrow" onClick={simulateCampaign}>{campaignSimulated ? "Simulation wiederholen" : "Kampagne simulieren"}</Button><small>Diese Aktion versendet keine E-Mail und löst keinen Vertrag aus.</small></aside></div></section>}

        <div className="wizard-footer"><Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))}>Zurück</Button><span>Alle Änderungen bleiben als Prototyp-Daten in diesem Browser.</span><Button onClick={() => step < 3 ? setStep(step + 1) : navigate("/admin")} icon="arrow">{step < 3 ? "Weiter" : "Zur Auswertung"}</Button></div>
      </main>
      {selectedSponsor && <SponsorDetail sponsor={selectedSponsor} close={() => setSelectedSponsorId(null)} updateSponsor={updateSponsor} addAudit={addAudit}/>}
    </AppShell>
  );
}

export default function App() {
  const { route, navigate } = useRoute();
  const [sponsors, setSponsors] = usePersistentState<TransitionSponsor[]>("mittragen-transition-sponsors-v2", initialSponsors);
  const [auditEvents, setAuditEvents] = usePersistentState<AuditEvent[]>("mittragen-audit-events-v2", initialAuditEvents);

  const updateSponsor = (id: string, patch: Partial<TransitionSponsor>) => {
    setSponsors((current) => current.map((sponsor) => sponsor.id === id ? { ...sponsor, ...patch } : sponsor));
  };

  const addAudit = (action: string, detail: string) => {
    setAuditEvents((current) => [{ id: `${Date.now()}-${current.length}`, time: new Date().toISOString(), action, detail }, ...current].slice(0, 30));
  };

  const resetSponsors = () => {
    setSponsors(initialSponsors);
    setAuditEvents([{ id: `${Date.now()}-reset`, time: new Date().toISOString(), action: "Demo-Daten zurückgesetzt", detail: "Sieben Testszenarien auf Ausgangsstand gesetzt" }, ...initialAuditEvents]);
  };

  if (route === "/login" || route === "/workspace") return <ProductiveAccess page={route === "/login" ? "login" : "workspace"} onHome={() => navigate("/")} onLogin={() => navigate("/login")} onWorkspace={() => navigate("/workspace")} onSponsor={() => navigate("/sponsor")} onPrototype={() => navigate("/ueberfuehren")}/>;
  if (route === "/sponsor") return <SponsorPortal onHome={() => navigate("/")} onLogin={() => navigate("/login")}/>;
  if (route === "/unterzeichnen") return <ContractSigning onHome={() => navigate("/")}/>;
  if (route === "/matchball") return <EventSponsoringPublic onHome={() => navigate("/")}/>;
  if (route === "/admin") return <AdminPage navigate={navigate} sponsors={sponsors} auditEvents={auditEvents}/>;
  if (route === "/space") return <SponsorSpace navigate={navigate} sponsors={sponsors} updateSponsor={updateSponsor} addAudit={addAudit}/>;
  if (route === "/ueberfuehren") return <TransitionPage navigate={navigate} sponsors={sponsors} updateSponsor={updateSponsor} addAudit={addAudit} resetSponsors={resetSponsors}/>;
  return <HomePage navigate={navigate}/>;
}
