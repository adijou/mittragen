import { useRef, useState } from "react";
import { filterHelpTopics, normalizeHelpQuery, workspaceHelpTopics, type HelpSection } from "./workspaceHelpContent";
import "./WorkspaceHelp.css";

export function WorkspaceHelp({ permissions, hasWorkspace, onOpenSection }: {
  permissions: readonly string[];
  hasWorkspace: boolean;
  onOpenSection: (section: HelpSection) => void;
}) {
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const topics = filterHelpTopics(query, topicId);
  const resultCount = topics.reduce((sum, topic) => sum + topic.articles.length, 0);
  const totalCount = workspaceHelpTopics.reduce((sum, topic) => sum + topic.articles.length, 0);
  const searchKey = normalizeHelpQuery(query);
  const filtered = Boolean(searchKey) || topicId !== "all";

  const reset = () => {
    setQuery("");
    setTopicId("all");
    searchRef.current?.focus();
  };

  return <section className="workspace-help" aria-labelledby="workspace-help-title">
    <header className="workspace-help__heading">
      <div><p className="eyebrow">Nachschlagen und weiterarbeiten</p><h1 id="workspace-help-title">FAQ & Hilfe</h1><p>Die wichtigsten Abläufe für Ihren Verein – Schritt für Schritt, von der ersten Einrichtung bis zum Sponsor-Space.</p></div>
      <span className="workspace-help__count">{workspaceHelpTopics.length} Themen · {totalCount} Antworten</span>
    </header>

    <div className="workspace-help__filters" role="search" aria-label="FAQ durchsuchen">
      <label className="workspace-help__search"><span>Was möchten Sie erledigen?</span><input ref={searchRef} id="workspace-help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="z. B. Sponsor einladen, Vertrag, Logo" aria-describedby="workspace-help-results"/></label>
      <label><span>Thema</span><select value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="all">Alle Themen</option>{workspaceHelpTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
    </div>
    <div className="workspace-help__result-bar"><p id="workspace-help-results" role="status" aria-live="polite" aria-atomic="true">{filtered ? `${resultCount} passende ${resultCount === 1 ? "Antwort" : "Antworten"}` : `${totalCount} Antworten in allen Themen`}</p>{filtered && <button className="access-text" type="button" onClick={reset}>Suche und Filter zurücksetzen</button>}</div>
    <p className="workspace-help__permissions">Die Anleitungen beschreiben die verfügbaren Funktionen. Welche Aktionen Sie ausführen können, hängt von Ihrer Rolle im ausgewählten Verein ab.</p>

    {topics.length === 0 ? <div className="workspace-help__empty"><h2>Keine passende Antwort gefunden</h2><p>Versuchen Sie einen kürzeren Suchbegriff oder wählen Sie «Alle Themen». Die Suche berücksichtigt auch die einzelnen Schritte und Hinweise.</p></div> : <div className="workspace-help__topics">{topics.map((topic) => <section className="workspace-help__topic" key={topic.id} aria-labelledby={`help-topic-${topic.id}`}>
      <header><div><h2 id={`help-topic-${topic.id}`}>{topic.title}</h2><span>{topic.articles.length} {topic.articles.length === 1 ? "Antwort" : "Antworten"}</span></div>{hasWorkspace && (!topic.permission || permissions.includes(topic.permission)) && <button className="access-text" type="button" onClick={() => onOpenSection(topic.section)}>{topic.sectionLabel} öffnen <span aria-hidden="true">→</span></button>}</header>
      {topic.articles.map((article) => <details className="workspace-help__article" key={`${article.id}:${searchKey}`} open={searchKey ? true : undefined}>
        <summary>{article.question}<span className="workspace-help__toggle" aria-hidden="true">+</span></summary>
        <div className="workspace-help__answer"><p>{article.answer}</p>{article.steps && <ol>{article.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}{article.note && <p className="workspace-help__note"><strong>Gut zu wissen:</strong> {article.note}</p>}</div>
      </details>)}
    </section>)}</div>}

    <footer className="workspace-help__footer"><strong>Noch eine Frage offen?</strong><p>Wenden Sie sich bei fehlenden Rechten an den Owner Ihres Vereins. Für Unterstützung mit mittragen.ch erreichen Sie <a href="https://digitalbell.ch/" target="_blank" rel="noopener noreferrer">Digital Bell <span className="visually-hidden">(öffnet in neuem Tab)</span></a>.</p></footer>
  </section>;
}
