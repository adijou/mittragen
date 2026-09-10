import { useEffect, useMemo, useState } from "react";
import { parseCsv, type ParsedCsv } from "./importCsv";

type ImportStatus = "draft" | "mapped" | "imported";
type ImportBatch = {
  id: string;
  name: string;
  source_filename: string;
  status: ImportStatus;
  source_columns: string[];
  mapping: Record<string, string>;
  row_count: number;
  valid_count: number;
  error_count: number;
  imported_count: number;
  created_at: string;
  imported_at: string | null;
};
type ImportRow = {
  row_number: number;
  raw_data: Record<string, string>;
  mapped_data: Record<string, string | number | null>;
  validation_errors: string[];
  status: "pending" | "valid" | "invalid" | "imported";
};
type ImportDetail = { batch: ImportBatch; rows: ImportRow[] };

const targets = [
  { value: "legal_name", label: "Firmenname", required: true },
  { value: "contact_name", label: "Kontaktperson" },
  { value: "contact_email", label: "Kontakt-E-Mail" },
  { value: "phone", label: "Telefon" },
  { value: "street", label: "Strasse" },
  { value: "postal_code", label: "PLZ" },
  { value: "city", label: "Ort" },
  { value: "website", label: "Website" },
  { value: "source_organization", label: "Bisherige Organisation" },
  { value: "proposal_package", label: "Sponsoringpaket" },
  { value: "annual_value_chf", label: "Jahreswert in CHF" },
  { value: "notes", label: "Interne Notizen" },
] as const;

const statusLabels: Record<ImportStatus, string> = {
  draft: "Hochgeladen",
  mapped: "Geprüft",
  imported: "Importiert",
};

const errorLabels: Record<string, string> = {
  invalid_legal_name: "Firmenname fehlt",
  invalid_contact_email: "E-Mail ist ungültig",
  invalid_website: "Website ist ungültig",
  invalid_annual_value: "Jahreswert ist ungültig",
};

const normalizeColumn = (value: string) => value.toLocaleLowerCase("de-CH").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function suggestMapping(columns: string[]) {
  const aliases: Record<string, string[]> = {
    legal_name: ["firma", "firmenname", "sponsor", "unternehmen", "organisation", "name"],
    contact_name: ["kontaktperson", "ansprechperson", "kontakt", "person"],
    contact_email: ["email", "mail", "kontaktmail"],
    phone: ["telefon", "phone", "mobil", "mobile"],
    street: ["strasse", "adresse"],
    postal_code: ["plz", "postleitzahl"],
    city: ["ort", "stadt"],
    website: ["website", "webseite", "web", "url"],
    source_organization: ["herkunft", "bisherigerverein", "quelle", "club", "klub"],
    proposal_package: ["paket", "sponsoringpaket", "vorschlag"],
    annual_value_chf: ["jahreswert", "betrag", "wert", "chf"],
    notes: ["notizen", "notiz", "bemerkungen", "bemerkung"],
  };
  return Object.fromEntries(Object.entries(aliases).flatMap(([target, candidates]) => {
    const match = columns.find((column) => candidates.includes(normalizeColumn(column)));
    return match ? [[target, match]] : [];
  }));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

export function ImportManagement({ tenantId, tenantName, demoSponsorCount, canDeleteDemo, onChanged }: {
  tenantId: string;
  tenantName: string;
  demoSponsorCount: number;
  canDeleteDemo: boolean;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [fileData, setFileData] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [importName, setImportName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingDemo, setDeletingDemo] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadBatches = async () => {
    const result = await request<{ batches: ImportBatch[] }>(`/api/imports/${tenantId}`);
    setBatches(result.batches);
  };

  useEffect(() => {
    setLoading(true);
    setDetail(null);
    setError("");
    void loadBatches().catch(() => setError("Die bisherigen Importe konnten nicht geladen werden.")).finally(() => setLoading(false));
  }, [tenantId]);

  const readFile = async (file: File | undefined) => {
    setError("");
    setMessage("");
    if (!file) return;
    if (file.size > 2_000_000) { setError("Die CSV-Datei darf höchstens 2 MB gross sein."); return; }
    try {
      const parsed = parseCsv(await file.text());
      setFileData(parsed);
      setFileName(file.name);
      setImportName(file.name.replace(/\.csv$/i, ""));
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "csv_invalid";
      const labels: Record<string, string> = {
        csv_no_data: "Die CSV-Datei enthält keine Datenzeilen.",
        csv_unclosed_quote: "Die CSV-Datei enthält ein nicht geschlossenes Anführungszeichen.",
        csv_empty_column: "Jede CSV-Spalte benötigt eine Überschrift.",
        csv_duplicate_column: "CSV-Spalten dürfen nicht gleich benannt sein.",
        csv_too_many_columns: "Die CSV-Datei darf höchstens 50 Spalten enthalten.",
        csv_too_many_rows: "Pro Import sind höchstens 1'000 Zeilen erlaubt.",
      };
      setError(labels[code] ?? "Die CSV-Datei konnte nicht gelesen werden.");
      setFileData(null);
    }
  };

  const createImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fileData) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await request<ImportDetail>(`/api/imports/${tenantId}`, {
        method: "POST",
        body: JSON.stringify({ name: importName, sourceFilename: fileName, rows: fileData.rows }),
      });
      setDetail(created);
      setMapping(suggestMapping(created.batch.source_columns));
      setFileData(null);
      setFileName("");
      setImportName("");
      setMessage(`${created.batch.row_count} Zeilen wurden sicher zwischengespeichert. Ordnen Sie nun die Spalten zu.`);
      await loadBatches();
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "permission_denied" ? "Für Datenimporte fehlt die Berechtigung." : "Der Import konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  };

  const openBatch = async (batchId: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const loaded = await request<ImportDetail>(`/api/imports/${tenantId}/${batchId}`);
      setDetail(loaded);
      setMapping(Object.keys(loaded.batch.mapping).length ? loaded.batch.mapping : suggestMapping(loaded.batch.source_columns));
    } catch {
      setError("Der Import konnte nicht geöffnet werden.");
    } finally {
      setBusy(false);
    }
  };

  const validateMapping = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const validated = await request<ImportDetail>(`/api/imports/${tenantId}/${detail.batch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mapping }),
      });
      setDetail(validated);
      setMapping(validated.batch.mapping);
      setMessage(validated.batch.error_count === 0
        ? "Alle Zeilen sind gültig und bereit für die Übernahme."
        : `${validated.batch.error_count} Zeilen benötigen noch eine Korrektur in der Quelldatei oder Zuordnung.`);
      await loadBatches();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "import_mapping_failed";
      setError(code === "legal_name_mapping_required" ? "Bitte ordnen Sie mindestens den Firmenname zu." : "Die Zuordnung konnte nicht geprüft werden.");
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request<{ importedCount: number }>(`/api/imports/${tenantId}/${detail.batch.id}/commit`, { method: "POST" });
      const loaded = await request<ImportDetail>(`/api/imports/${tenantId}/${detail.batch.id}`);
      setDetail(loaded);
      setMessage(`${result.importedCount} Sponsoren wurden übernommen und als Entwurf angelegt.`);
      await loadBatches();
      onChanged();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "import_commit_failed";
      setError(code === "import_not_ready" ? "Vor der Übernahme müssen alle Zeilen gültig sein." : "Die Sponsoren konnten nicht übernommen werden.");
    } finally {
      setBusy(false);
    }
  };

  const deleteDemoData = async (event: React.FormEvent) => {
    event.preventDefault();
    setDeletingDemo(true);
    setError("");
    setMessage("");
    try {
      const result = await request<{ deletedCount: number }>(`/api/tenants/${tenantId}/demo-data`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: cleanupConfirmation }),
      });
      setCleanupOpen(false);
      setCleanupConfirmation("");
      setMessage(`${result.deletedCount} Beispiel-Sponsoren wurden gelöscht. Der Importverlauf und Ihre eigenen Daten bleiben unverändert.`);
      onChanged();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "demo_data_delete_failed";
      const labels: Record<string, string> = {
        confirmation_mismatch: `Bitte geben Sie «${tenantName}» exakt ein.`,
        demo_data_in_use: "Mindestens ein Beispiel-Sponsor wird bereits in einem Vertrag verwendet und kann deshalb nicht automatisch gelöscht werden.",
        permission_denied: "Nur Owner können Beispieldaten löschen.",
      };
      setError(labels[code] ?? "Die Beispieldaten konnten nicht gelöscht werden.");
    } finally {
      setDeletingDemo(false);
    }
  };

  const preview = useMemo(() => detail?.rows.slice(0, 12) ?? [], [detail]);

  return <section className="data-import">
    <header><div><p className="eyebrow">Bestehende Daten übernehmen</p><h1>Datenimport</h1><p>CSV hochladen, Felder zuordnen, vollständig prüfen und erst dann als Sponsoren übernehmen.</p></div><span className="import-limit">max. 1'000 Zeilen</span></header>

    {demoSponsorCount > 0 && <section className="import-demo-cleanup">
      <div><p className="eyebrow">Vor dem Echtimport</p><h2>{demoSponsorCount} Beispiel-Sponsoren vorhanden</h2><p>Sie können ausschliesslich die beim Onboarding angelegten Beispieldaten entfernen. Eigene und bereits importierte Sponsoren bleiben erhalten.</p></div>
      {canDeleteDemo ? !cleanupOpen ? <button className="access-secondary danger-button" type="button" onClick={() => { setCleanupOpen(true); setError(""); setMessage(""); }}>Beispieldaten löschen</button> : <form onSubmit={deleteDemoData}><label><span>Zur Bestätigung «{tenantName}» eingeben</span><input required value={cleanupConfirmation} onChange={(event) => setCleanupConfirmation(event.target.value)} autoComplete="off"/></label><div><button className="access-text" type="button" disabled={deletingDemo} onClick={() => { setCleanupOpen(false); setCleanupConfirmation(""); }}>Abbrechen</button><button className="access-primary danger-button" disabled={deletingDemo || cleanupConfirmation.trim() !== tenantName}>{deletingDemo ? "Wird gelöscht …" : `${demoSponsorCount} Beispieldaten endgültig löschen`}</button></div></form> : <small>Nur ein Owner kann die Beispieldaten entfernen.</small>}
    </section>}

    <div className="import-top-grid">
      <form className="import-card import-upload" onSubmit={createImport}>
        <div><p className="eyebrow">Schritt 1</p><h2>CSV-Datei auswählen</h2></div>
        <label className="import-file"><span>{fileName || "CSV-Datei auswählen"}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])}/><small>UTF-8, Komma oder Semikolon, maximal 2 MB</small></label>
        {fileData && <div className="import-file-summary"><strong>{fileData.rows.length} Zeilen</strong><span>{fileData.columns.length} Spalten erkannt</span></div>}
        <label><span>Bezeichnung</span><input required minLength={2} maxLength={160} value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="Sponsoren FC Bösingen 2026"/></label>
        <button className="access-primary" disabled={busy || !fileData}>{busy ? "Wird vorbereitet …" : "Import vorbereiten"}</button>
      </form>

      <section className="import-card import-history">
        <div><p className="eyebrow">Verlauf</p><h2>Bisherige Importe</h2></div>
        {loading ? <p className="import-empty">Importe werden geladen …</p> : batches.length === 0 ? <p className="import-empty">Noch keine Datenübernahme vorhanden.</p> : <div className="import-batches">{batches.map((batch) => <button type="button" key={batch.id} className={detail?.batch.id === batch.id ? "active" : ""} onClick={() => void openBatch(batch.id)}><span><strong>{batch.name}</strong><small>{batch.source_filename} · {batch.row_count} Zeilen</small></span><em className={`import-status import-status--${batch.status}`}>{statusLabels[batch.status]}</em></button>)}</div>}
      </section>
    </div>

    {error && <p className="form-error import-feedback" role="alert">{error}</p>}
    {message && <p className="form-success import-feedback" role="status">{message}</p>}

    {detail && <section className="import-workspace">
      <header><div><p className="eyebrow">Schritt 2</p><h2>{detail.batch.name}</h2><p>{detail.batch.source_filename} · {detail.batch.row_count} Datenzeilen</p></div><span className={`import-status import-status--${detail.batch.status}`}>{statusLabels[detail.batch.status]}</span></header>

      <div className="import-mapping">
        <div className="import-mapping__heading"><div><h3>Spalten zuordnen</h3><p>Links steht das Mittragen-Feld, rechts die passende Spalte aus Ihrer Datei.</p></div><button className="access-secondary" type="button" disabled={busy || detail.batch.status === "imported"} onClick={() => void validateMapping()}>{busy ? "Prüft …" : "Zuordnung prüfen"}</button></div>
        <div className="import-targets">{targets.map((target) => <label key={target.value}><span>{target.label}{"required" in target && target.required && <em>Pflicht</em>}</span><select disabled={detail.batch.status === "imported"} value={mapping[target.value] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [target.value]: event.target.value }))}><option value="">Nicht übernehmen</option>{detail.batch.source_columns.map((column) => <option value={column} key={column}>{column}</option>)}</select></label>)}</div>
      </div>

      {detail.batch.status !== "draft" && <div className="import-validation">
        <article><span>Gültig</span><strong>{detail.batch.valid_count}</strong></article>
        <article className={detail.batch.error_count ? "has-errors" : ""}><span>Mit Fehlern</span><strong>{detail.batch.error_count}</strong></article>
        <article><span>Übernommen</span><strong>{detail.batch.imported_count}</strong></article>
        {detail.batch.status !== "imported" && <button className="access-primary" disabled={busy || detail.batch.error_count > 0 || detail.batch.valid_count !== detail.batch.row_count} onClick={() => void commitImport()}>{busy ? "Wird übernommen …" : `${detail.batch.valid_count} Sponsoren übernehmen`}</button>}
      </div>}

      <div className="import-preview"><table><thead><tr><th>Zeile</th><th>Firmenname</th><th>Kontakt</th><th>Jahreswert</th><th>Prüfung</th></tr></thead><tbody>{preview.map((row) => <tr key={row.row_number}><td>{row.row_number}</td><td><strong>{String(row.mapped_data.legal_name ?? row.raw_data[detail.batch.source_columns[0]] ?? "–")}</strong></td><td>{String(row.mapped_data.contact_email ?? row.mapped_data.contact_name ?? "–")}</td><td>{typeof row.mapped_data.annual_value_cents === "number" ? new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" }).format(row.mapped_data.annual_value_cents / 100) : "–"}</td><td>{row.validation_errors.length ? <span className="import-row-error">{row.validation_errors.map((code) => errorLabels[code] ?? code).join(", ")}</span> : row.status === "pending" ? <span className="import-row-pending">Noch nicht geprüft</span> : <span className="import-row-valid">✓ Gültig</span>}</td></tr>)}</tbody></table>{detail.batch.row_count > preview.length && <p>Vorschau der ersten {preview.length} von {detail.batch.row_count} Zeilen.</p>}</div>
    </section>}
  </section>;
}
