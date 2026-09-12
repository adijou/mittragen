import { useEffect, useMemo, useState } from "react";
import type { ParsedCsv } from "./importCsv";
import { parseSpreadsheetFile, type ParsedSheet } from "./importSpreadsheet";

type ImportStatus = "draft" | "mapped" | "imported";
type ImportBatch = {
  id: string;
  name: string;
  source_filename: string;
  status: ImportStatus;
  source_columns: string[];
  mapping: Record<string, string>;
  package_mapping: Record<string, string | null>;
  package_mapping_complete: boolean;
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
type PackageOption = { id: string; name: string; price_cents: number };
type ImportDetail = { batch: ImportBatch; rows: ImportRow[]; packageValues: string[]; packageOptions?: PackageOption[] };

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
  { value: "proposal_package", label: "Paketbezeichnung (für Zuordnung)" },
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

const normalizeColumn = (value: string) => value.toLocaleLowerCase("de-CH").replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normalizePackage = (value: string) => normalizeColumn(value).replace(/sponsoringpaket|sponsorpaket|sponsoring|sponsor/g, "");

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
    proposal_package: ["paket", "sponsoringpaket", "vorschlag", "sonstige", "sponsoringart", "paketkategorie"],
    annual_value_chf: ["jahreswert", "betrag", "wert", "chf"],
    notes: ["notizen", "notiz", "bemerkungen", "bemerkung", "info"],
  };
  return Object.fromEntries(Object.entries(aliases).flatMap(([target, candidates]) => {
    const match = columns.find((column) => candidates.includes(normalizeColumn(column)));
    return match ? [[target, match]] : [];
  }));
}

function suggestPackageMapping(values: string[], options: PackageOption[], current: Record<string, string | null> = {}) {
  return Object.fromEntries(values.map((value) => {
    if (Object.prototype.hasOwnProperty.call(current, value)) return [value, current[value]];
    const normalized = normalizePackage(value);
    const match = options.find((option) => normalizePackage(option.name) === normalized);
    return [value, match?.id ?? null];
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
  const [packageMapping, setPackageMapping] = useState<Record<string, string | null>>({});
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [packageMappingDirty, setPackageMappingDirty] = useState(false);
  const [fileData, setFileData] = useState<ParsedCsv | null>(null);
  const [fileSheets, setFileSheets] = useState<ParsedSheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState("");
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
    const result = await request<{ batches: ImportBatch[]; packageOptions: PackageOption[] }>(`/api/imports/${tenantId}`);
    setBatches(result.batches);
    setPackageOptions(result.packageOptions);
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
    if (file.size > 2_000_000) { setError("Die CSV- oder Excel-Datei darf höchstens 2 MB gross sein."); return; }
    try {
      const sheets = await parseSpreadsheetFile(file);
      setFileSheets(sheets);
      setSelectedSheet(sheets[0].name);
      setFileData(sheets[0]);
      setFileName(file.name);
      setImportName(file.name.replace(/\.(?:csv|xlsx)$/i, ""));
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "csv_invalid";
      const labels: Record<string, string> = {
        csv_no_data: "Die CSV-Datei enthält keine Datenzeilen.",
        csv_unclosed_quote: "Die CSV-Datei enthält ein nicht geschlossenes Anführungszeichen.",
        csv_empty_column: "Jede CSV-Spalte benötigt eine Überschrift.",
        csv_duplicate_column: "CSV-Spalten dürfen nicht gleich benannt sein.",
        csv_too_many_columns: "Die CSV-Datei darf höchstens 50 Spalten enthalten.",
        csv_too_many_rows: "Pro Import sind höchstens 1'000 Zeilen erlaubt.",
        spreadsheet_no_data: "Die Datei enthält kein Blatt mit Kopfzeile und Datenzeilen.",
        spreadsheet_too_many_columns: "Ein Tabellenblatt darf höchstens 50 verwendete Spalten enthalten.",
        spreadsheet_too_many_rows: "Pro Tabellenblatt sind höchstens 1'000 Datenzeilen erlaubt.",
        spreadsheet_file_type: "Unterstützt werden CSV- und XLSX-Dateien.",
        xlsx_invalid: "Die XLSX-Datei ist beschädigt oder hat kein unterstütztes Excel-Format.",
      };
      setError(labels[code] ?? "Die Datei konnte nicht gelesen werden.");
      setFileData(null);
      setFileSheets([]);
      setSelectedSheet("");
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
      setPackageMapping({});
      setMappingDirty(true);
      setPackageMappingDirty(false);
      setFileData(null);
      setFileSheets([]);
      setSelectedSheet("");
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
      if (loaded.packageOptions) setPackageOptions(loaded.packageOptions);
      setPackageMapping(suggestPackageMapping(loaded.packageValues, loaded.packageOptions ?? packageOptions, loaded.batch.package_mapping));
      setMappingDirty(false);
      setPackageMappingDirty(Boolean(loaded.packageValues.length && !loaded.batch.package_mapping_complete));
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
      const reviewingColumns = mappingDirty || detail.batch.status === "draft";
      const validated = await request<ImportDetail>(`/api/imports/${tenantId}/${detail.batch.id}`, {
        method: "PATCH",
        body: JSON.stringify(reviewingColumns ? { mapping } : { mapping, packageMapping }),
      });
      setDetail(validated);
      setMapping(validated.batch.mapping);
      setMappingDirty(false);
      if (validated.packageOptions) setPackageOptions(validated.packageOptions);
      const nextOptions = validated.packageOptions ?? packageOptions;
      setPackageMapping(suggestPackageMapping(validated.packageValues, nextOptions, validated.batch.package_mapping));
      setPackageMappingDirty(Boolean(validated.packageValues.length && !validated.batch.package_mapping_complete));
      setMessage(validated.batch.error_count > 0
        ? `${validated.batch.error_count} Zeilen benötigen noch eine Korrektur in der Quelldatei oder Zuordnung.`
        : validated.packageValues.length && !validated.batch.package_mapping_complete
          ? `${validated.packageValues.length} Paketbezeichnungen erkannt. Bitte jetzt den veröffentlichten Paketen zuordnen.`
          : "Alle Zeilen und Paketzuordnungen sind gültig und bereit für die Übernahme.");
      await loadBatches();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "import_mapping_failed";
      const labels: Record<string, string> = {
        legal_name_mapping_required: "Bitte ordnen Sie mindestens den Firmenname zu.",
        package_mapping_incomplete: "Bitte jede erkannte Paketbezeichnung prüfen.",
        package_version_not_available: "Mindestens ein gewähltes Paket ist nicht mehr veröffentlicht.",
      };
      setError(labels[code] ?? "Die Zuordnung konnte nicht geprüft werden.");
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

  const chooseSheet = (name: string) => {
    const sheet = fileSheets.find((item) => item.name === name);
    if (!sheet) return;
    setSelectedSheet(name);
    setFileData(sheet);
  };

  const preview = useMemo(() => detail?.rows.slice(0, 12) ?? [], [detail]);
  const assignedPackageCount = detail?.packageValues.filter((value) => packageMapping[value]).length ?? 0;

  return <section className="data-import">
    <header><div><p className="eyebrow">Bestehende Daten übernehmen</p><h1>Datenimport</h1><p>Excel oder CSV hochladen, Tabellenblatt und Felder wählen, Pakete zuordnen und erst dann als Sponsoren übernehmen.</p></div><span className="import-limit">max. 1'000 Zeilen</span></header>

    {demoSponsorCount > 0 && <section className="import-demo-cleanup">
      <div><p className="eyebrow">Vor dem Echtimport</p><h2>{demoSponsorCount} Beispiel-Sponsoren vorhanden</h2><p>Sie können ausschliesslich die beim Onboarding angelegten Beispieldaten entfernen. Eigene und bereits importierte Sponsoren bleiben erhalten.</p></div>
      {canDeleteDemo ? !cleanupOpen ? <button className="access-secondary danger-button" type="button" onClick={() => { setCleanupOpen(true); setError(""); setMessage(""); }}>Beispieldaten löschen</button> : <form onSubmit={deleteDemoData}><label><span>Zur Bestätigung «{tenantName}» eingeben</span><input required value={cleanupConfirmation} onChange={(event) => setCleanupConfirmation(event.target.value)} autoComplete="off"/></label><div><button className="access-text" type="button" disabled={deletingDemo} onClick={() => { setCleanupOpen(false); setCleanupConfirmation(""); }}>Abbrechen</button><button className="access-primary danger-button" disabled={deletingDemo || cleanupConfirmation.trim() !== tenantName}>{deletingDemo ? "Wird gelöscht …" : `${demoSponsorCount} Beispieldaten endgültig löschen`}</button></div></form> : <small>Nur ein Owner kann die Beispieldaten entfernen.</small>}
    </section>}

    <div className="import-top-grid">
      <form className="import-card import-upload" onSubmit={createImport}>
        <div><p className="eyebrow">Schritt 1</p><h2>Excel- oder CSV-Datei auswählen</h2></div>
        <label className="import-file"><span>{fileName || "Datei auswählen"}</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])}/><small>XLSX oder UTF-8-CSV, maximal 2 MB</small></label>
        {fileSheets.length > 1 && <label><span>Tabellenblatt</span><select value={selectedSheet} onChange={(event) => chooseSheet(event.target.value)}>{fileSheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} · {sheet.rows.length} Zeilen</option>)}</select><small>Nur das ausgewählte Blatt wird vorbereitet.</small></label>}
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
        <div className="import-mapping__heading"><div><h3>Spalten zuordnen</h3><p>Links steht das mittragen.ch-Feld, rechts die passende Spalte aus Ihrer Datei.</p></div><button className="access-secondary" type="button" disabled={busy || detail.batch.status === "imported"} onClick={() => void validateMapping()}>{busy ? "Prüft …" : !mappingDirty && detail.packageValues.length ? "Paketzuordnung bestätigen" : "Zuordnung prüfen"}</button></div>
        <div className="import-targets">{targets.map((target) => <label key={target.value}><span>{target.label}{"required" in target && target.required && <em>Pflicht</em>}</span><select disabled={detail.batch.status === "imported"} value={mapping[target.value] ?? ""} onChange={(event) => { setMapping((current) => ({ ...current, [target.value]: event.target.value })); setMappingDirty(true); setPackageMappingDirty(false); }}><option value="">Nicht übernehmen</option>{detail.batch.source_columns.map((column) => <option value={column} key={column}>{column}</option>)}</select></label>)}</div>
      </div>

      {detail.packageValues.length > 0 && <section className="import-package-mapping">
        <div className="import-mapping__heading"><div><p className="eyebrow">Schritt 3</p><h3>Paketbezeichnungen zuordnen</h3><p>Jede Bezeichnung aus der Datei kann einem veröffentlichten Paket zugeordnet oder bewusst nur als Text übernommen werden. Ohne eigenen Jahreswert wird der Paketpreis verwendet.</p></div><span>{assignedPackageCount} von {detail.packageValues.length} zugeordnet</span></div>
        {packageOptions.length === 0 && <p className="import-package-note">Es gibt noch keine veröffentlichten Pakete. Sie können die Bezeichnungen als Text übernehmen und die Pakete später zuordnen.</p>}
        <div className="import-package-grid">{detail.packageValues.map((value) => <label key={value}><span>{value}</span><select disabled={detail.batch.status === "imported"} value={packageMapping[value] ?? ""} onChange={(event) => { setPackageMapping((current) => ({ ...current, [value]: event.target.value || null })); setPackageMappingDirty(true); }}><option value="">Nur als Text übernehmen</option>{packageOptions.map((option) => <option key={option.id} value={option.id}>{option.name} · {new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 0 }).format(option.price_cents / 100)}</option>)}</select></label>)}</div>
      </section>}

      {detail.batch.status !== "draft" && <div className="import-validation">
        <article><span>Gültig</span><strong>{detail.batch.valid_count}</strong></article>
        <article className={detail.batch.error_count ? "has-errors" : ""}><span>Mit Fehlern</span><strong>{detail.batch.error_count}</strong></article>
        <article><span>Übernommen</span><strong>{detail.batch.imported_count}</strong></article>
        {detail.batch.status !== "imported" && <button className="access-primary" disabled={busy || mappingDirty || packageMappingDirty || !detail.batch.package_mapping_complete || detail.batch.error_count > 0 || detail.batch.valid_count !== detail.batch.row_count} onClick={() => void commitImport()}>{busy ? "Wird übernommen …" : `${detail.batch.valid_count} Sponsoren übernehmen`}</button>}
      </div>}

      <div className="import-preview"><table><thead><tr><th>Zeile</th><th>Firmenname</th><th>Kontakt</th><th>Paket</th><th>Jahreswert</th><th>Prüfung</th></tr></thead><tbody>{preview.map((row) => <tr key={row.row_number}><td>{row.row_number}</td><td><strong>{String(row.mapped_data.legal_name ?? row.raw_data[detail.batch.source_columns[0]] ?? "–")}</strong></td><td>{String(row.mapped_data.contact_email ?? row.mapped_data.contact_name ?? "–")}</td><td>{String(row.mapped_data.proposal_package ?? "–")}</td><td>{typeof row.mapped_data.annual_value_cents === "number" ? new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" }).format(row.mapped_data.annual_value_cents / 100) : "–"}</td><td>{row.validation_errors.length ? <span className="import-row-error">{row.validation_errors.map((code) => errorLabels[code] ?? code).join(", ")}</span> : row.status === "pending" ? <span className="import-row-pending">Noch nicht geprüft</span> : <span className="import-row-valid">✓ Gültig</span>}</td></tr>)}</tbody></table>{detail.batch.row_count > preview.length && <p>Vorschau der ersten {preview.length} von {detail.batch.row_count} Zeilen.</p>}</div>
    </section>}
  </section>;
}
