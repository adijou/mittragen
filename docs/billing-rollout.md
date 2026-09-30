# Rechnungen, QR-Inkasso und Pingen

## Produktentscheidungen

- Sponsor trägt 2.5 % zusätzlich zum Sponsoringbeitrag. Der Vereinsanteil wird nicht nochmals um diese Gebühr gekürzt.
- Zentrales Inkasso, interne Trennung nach Verein, monatliche Abrechnung; keine Verzinsung und keine Anlagefunktion.
- Bestehende Buchungen, Altverträge, Überführungen bereits vereinbarter Sponsorings und vorhandene Vertragsentwürfe behalten ihre Konditionen. Keine rückwirkenden Zuschläge.
- Versandkosten bleiben separat und noch ohne Kostenzuweisung. Weder Sponsor noch Verein wird ohne Festlegung des Kostenträgers belastet.

## In diesem Stand benutzbar

Unter **Finanzen** können Personen mit `finance:write` wiederholsicher Rechnungsentwürfe aus direkten Matchballmeldungen mit Zahlungsart Rechnung und aus bestätigten Verträgen erstellen. Vertragsraten werden nur bei eindeutigem Anfang, Ende und jährlichem/halbjährlichem/quartalsweisem Plan erzeugt. Individuelle oder undatierte Vereinbarungen erscheinen zur Prüfung. Inklusive Matchbälle werden nicht doppelt abgerechnet. Korrekturverträge behalten über ihre ursprüngliche Vertrags-ID eine gemeinsame Abrechnungsidentität; überlappende Zeiträume sind gesperrt.

Entwürfe sind als **Entwurf – keine Zahlungsaufforderung** gekennzeichnet und enthalten keinen Zahlteil. Personen mit `finance:write` können einen geprüften Entwurf unter **QR-Rechnung freigeben** verbindlich ausstellen. Die Freigabe erzeugt eine globale Rechnungsnummer, eine 27-stellige QR-Referenz mit Modulo-10-Prüfziffer, ein Rechnungsdatum und einen Snapshot der serverseitig konfigurierten Zahlungsverbindung. Der Zahlteil verwendet CHF und den Gesamtbetrag einschliesslich der bereits vereinbarten Plattformgebühr. Der Inkassotext nennt Verein und Kontoinhaber ausdrücklich; es werden weder neue Zahlungsfristen noch ein MWST-Status erfunden.

Der PDF-Download prüft Vereinsmitgliedschaft und aktives Konto. Die Freigabe speichert das vollständige PDF samt SHA-256 atomar mit der Rechnung in einer separaten RLS-geschützten Dokumenttabelle. Datenbank-Trigger verhindern Änderungen an freigegebenen Rechnungen und PDF-Dateien. Wiederholte Freigaben liefern dieselbe Rechnung. Kontowechsel, spätere Vertragsänderungen oder Stornierungen der ursprünglichen Buchung verändern das ausgestellte PDF nicht; dessen Eingänge bleiben zuordenbar. Die Rechnung selbst muss gegebenenfalls separat korrigiert werden (Gutschriften noch nicht implementiert).

Vor Freigabe wird der Entwurf mit der aktuellen Abrechnungsgrundlage verglichen. Geänderte Angaben erfordern **Entwurf aktualisieren** und erneute Prüfung. Ein Entwurf mit bereits erfassten aktiven Eingängen darf weder aktualisiert noch als volle Zahlungsaufforderung freigegeben werden.

Der QR-Zahlteil liegt auf einem separaten A4-Blatt am unteren Seitenrand (210 × 105 mm), mit Empfangsschein, Trennmarkierungen, 46-mm-Vektorcode und Fehlerkorrektur M. Das eignet sich als Grundlage für späteren Pingen-Simplexversand. `swissqrbill` liefert den Zahlteil; `pdfkit` bleibt beim Netlify-Bundling extern, seine Fontdaten werden mitgeliefert. Name, PLZ, Ort und Land sind Pflichtfelder; Strasse/Hausnummer dürfen gemäss SIX leer bleiben. Nicht darstellbare Zeichen werden abgewiesen statt still ersetzt.

Nur zusätzlich konfigurierte Plattformverantwortliche mit Finanz-Schreibrecht im jeweiligen Verein können tatsächliche Zahlungseingänge und bereits ausgeführte Auszahlungen anhand von Bankbelegen dokumentieren. Das ist keine Bankanbindung und löst keine Überweisung aus. Eine zentrale Bankbuchungsreferenz darf nicht zwei Vereinen gutgeschrieben werden. Vorerst kann ein Bankeingang nicht auf mehrere Rechnungen verteilt werden.

Teilzahlungen werden anhand kumulierter Beträge anteilig aufgeteilt; Rappen gehen über mehrere Zahlungen nicht verloren. Die Monatsabrechnung reserviert noch unzugeordnete Vereinsanteile bis zum Monatsende samt Rückständen. Vorbereitete Auszahlungen lassen sich mit Begründung aufheben; die Aufhebung und ursprünglichen Zuordnungen bleiben im Audit. Dokumentierte Bankauszahlungen sind gesperrt. Rückzahlungen, Gutschriften und Korrekturen bereits ausgezahlter Mittel sind noch nicht implementiert.

Pingen ist als zentrale, serverseitige Preisabfrage vorbereitet. Sie übermittelt keine Adress- oder PDF-Daten und erstellt keinen Brief. Das Kostenbeispiel ist ausdrücklich keine verbindliche Versandfreigabe. Es verwendet die Endpunkte des aktuellen offiziellen JS-SDK (`src/constants.ts`, `src/oauth.ts`, `src/resources/letters/letters.ts` in https://github.com/pingencom/pingen2-sdk-js).

## Konfiguration (nur serverseitige Netlify-Variablen)

| Variable | Verwendung |
| --- | --- |
| `BILLING_ENABLED` | Standard aus. Erst `true` aktiviert die Gebühr für neue öffentliche Buchungen und neue direkte Vertragsentwürfe. |
| `BILLING_OPERATOR_NAME` | Tatsächlicher Rechtsträger des Inkassos; ohne Namen bleibt die Aktivierung aus. Wird in die neuen Vereinbarungen eingefroren. |
| `BILLING_QR_CREDITOR` | JSON mit `iban`, `name`, `street`, `houseNumber`, `postalCode`, `city`, `country`; nur Functions-Scope. Kein echtes Konto im Repository. Gültige QR-IBAN und strukturierte Pflichtfelder aktivieren die Rechnungsfreigabe unabhängig von der Gebühr für neue Abschlüsse. |
| `BILLING_OPERATOR_USER_IDS` | Kommagetrennte Identity-IDs der Plattformverantwortlichen, zusätzlich zu ihrer Vereinsberechtigung. Ohne Eintrag keine Bankerfassung. |
| `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID` | Zentrale Pingen-API-Konfiguration. Ein WebApp-Login allein genügt nicht. Keine Secrets in Browser oder Repository. |
| `PINGEN_ENVIRONMENT` | Standard `staging`. `production` verwendet die Produktions-Preisabfrage. Staging benötigt eigene Zugangsdaten. |

Die Gebühr wird serverseitig berechnet. Öffentliche Formulare übermitteln zusätzlich den zuvor angezeigten Gesamtbetrag und Gebührensatz; geänderte Preise oder eine zwischenzeitliche Aktivierung verlangen eine erneute Prüfung. Bei zentralem Inkasso steht für neue Matchballmeldungen ausschliesslich Rechnung zur Verfügung. Vertrags-PDF, E-Mail und Bestätigungsansicht weisen den Zuschlag gesondert aus. Gebühren-Snapshots werden bei Bearbeitung, Freigabe und Korrekturversionen bewahrt.

## Verbleibende Einführungsschritte

1. Die bestätigten Kontodaten in `BILLING_QR_CREDITOR` hinterlegen. Sie wurden für dieses Projekt serverseitig eingerichtet; der öffentliche Quellcode enthält nur SIX-Testkonten. Vor der Verwendung muss der Kontoinhaber den Angaben der Bank entsprechen.
2. Steuerbehandlung der Vereinsleistung und Plattformgebühr, Rechnungs-/Inkassotexte und Vollmacht festlegen. Im Entwurf wird kein MWST-Status erfunden.
3. Neue Migration und Rechnungsfreigabe zunächst in der PR-Vorschau prüfen. Freigegebene PDFs sind zahlbar; Beispieltests verwenden ausschliesslich das öffentliche SIX-Testkonto. Keine Produktionsrechnungen automatisch ausstellen.
4. Pingen-Zugang verbinden; Dokument im Sandboxkonto mit Adressfenster, QR-Papier und Seitenfolge testen. Anschliessend dauerhafte Versandaufträge, Vorschau, konkrete Kostenfreigabe, Kostenträger, Idempotenz, Webhook-Signaturen und Statusabgleich implementieren und prüfen.
5. Live-Rechnungsstellung und Versand bewusst aktivieren. `BILLING_ENABLED` allein schaltet den Versand **nicht** frei. Es gibt in dieser Version absichtlich keine Upload-/Send-Route und keinen Scheduler für Banküberweisungen.

## Prüfung

`npm run build` und `npm test`. Die Finanztests führen sämtliche Migrationen in PostgreSQL/PGlite aus und prüfen den tatsächlichen Route-Handler unter RLS: Rollen, Kontowechsel, Origin, Beträge, Wiederholungen, Teilzahlungen, übergreifend doppelte Bankreferenzen, Monatsgrenzen, Stornos und PDF-Zugriff. Pingen wird ausschliesslich mit HTTP-Testantworten geprüft; keine echten Briefe oder E-Mails werden versendet. Für die visuelle PDF-Prüfung können `BILLING_PDF_FIXTURE`, `BILLING_QR_PDF_FIXTURE` und `BILLING_QR_FEE_PDF_FIXTURE` auf absolute PDF-Pfade gesetzt werden. Der Testlauf prüft zusätzlich QR-Kontovalidierung, Prüfziffer mit publiziertem SIX-Beispiel, Freigaberechte, fehlgeschlagene Freigabe ohne Teilspeicherung, Wiederholungen, globale Referenzen, unveränderliche PDFs nach Kontowechsel und Dokument-RLS. Die gerenderten Test-PDFs werden zusätzlich mit einem unabhängigen ZXing-Decoder auf Konto, Betrag, strukturierte Felder und QRR-Prüfziffer geprüft.

Referenzen: [SIX Implementation Guidelines v2.3](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf), [SIX Style Guide](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/style-guide-qr-bill-en.pdf), [SwissQRBill](https://github.com/schoero/swissqrbill).
