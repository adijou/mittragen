# Rechnungen, Inkasso und Pingen: erster Ausbaustand

## Produktentscheidungen

- Sponsor trägt 2.5 % zusätzlich zum Sponsoringbeitrag. Der Vereinsanteil wird nicht nochmals um diese Gebühr gekürzt.
- Zentrales Inkasso, interne Trennung nach Verein, monatliche Abrechnung; keine Verzinsung und keine Anlagefunktion.
- Bestehende Buchungen, Altverträge, Überführungen bereits vereinbarter Sponsorings und vorhandene Vertragsentwürfe behalten ihre Konditionen. Keine rückwirkenden Zuschläge.
- Versandkosten bleiben separat und noch ohne Kostenzuweisung. Weder Sponsor noch Verein wird ohne Festlegung des Kostenträgers belastet.

## In diesem Stand benutzbar

Unter **Finanzen** können Personen mit `finance:write` wiederholsicher Rechnungsentwürfe aus direkten Matchballmeldungen mit Zahlungsart Rechnung und aus bestätigten Verträgen erstellen. Vertragsraten werden nur bei eindeutigem Anfang, Ende und jährlichem/halbjährlichem/quartalsweisem Plan erzeugt. Individuelle oder undatierte Vereinbarungen erscheinen zur Prüfung. Inklusive Matchbälle werden nicht doppelt abgerechnet. Korrekturverträge behalten über ihre ursprüngliche Vertrags-ID eine gemeinsame Abrechnungsidentität; überlappende Zeiträume sind gesperrt.

PDFs sind klar als **Entwurf – keine Zahlungsaufforderung** gekennzeichnet. Sie enthalten keine Bankverbindung, Zahlungsfrist, QR-Zahlteil oder endgültige Rechnungsnummer. Der PDF-Download prüft die Vereinsmitgliedschaft und das aktive Konto. Eine stornierte oder geänderte Abrechnungsgrundlage sperrt weitere Erfassungen und die Vorschau, statt alte Beträge still zu ersetzen.

Nur zusätzlich konfigurierte Plattformverantwortliche mit Finanz-Schreibrecht im jeweiligen Verein können tatsächliche Zahlungseingänge und bereits ausgeführte Auszahlungen anhand von Bankbelegen dokumentieren. Das ist keine Bankanbindung und löst keine Überweisung aus. Eine zentrale Bankbuchungsreferenz darf nicht zwei Vereinen gutgeschrieben werden. Vorerst kann ein Bankeingang nicht auf mehrere Rechnungen verteilt werden.

Teilzahlungen werden anhand kumulierter Beträge anteilig aufgeteilt; Rappen gehen über mehrere Zahlungen nicht verloren. Die Monatsabrechnung reserviert noch unzugeordnete Vereinsanteile bis zum Monatsende samt Rückständen. Vorbereitete Auszahlungen lassen sich mit Begründung aufheben; die Aufhebung und ursprünglichen Zuordnungen bleiben im Audit. Dokumentierte Bankauszahlungen sind gesperrt. Rückzahlungen, Gutschriften und Korrekturen bereits ausgezahlter Mittel sind noch nicht implementiert.

Pingen ist als zentrale, serverseitige Preisabfrage vorbereitet. Sie übermittelt keine Adress- oder PDF-Daten und erstellt keinen Brief. Das Kostenbeispiel ist ausdrücklich keine verbindliche Versandfreigabe. Es verwendet die Endpunkte des aktuellen offiziellen JS-SDK (`src/constants.ts`, `src/oauth.ts`, `src/resources/letters/letters.ts` in https://github.com/pingencom/pingen2-sdk-js).

## Konfiguration (nur serverseitige Netlify-Variablen)

| Variable | Verwendung |
| --- | --- |
| `BILLING_ENABLED` | Standard aus. Erst `true` aktiviert die Gebühr für neue öffentliche Buchungen und neue direkte Vertragsentwürfe. |
| `BILLING_OPERATOR_NAME` | Tatsächlicher Rechtsträger des Inkassos; ohne Namen bleibt die Aktivierung aus. Wird in die neuen Vereinbarungen eingefroren. |
| `BILLING_OPERATOR_USER_IDS` | Kommagetrennte Identity-IDs der Plattformverantwortlichen, zusätzlich zu ihrer Vereinsberechtigung. Ohne Eintrag keine Bankerfassung. |
| `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID` | Zentrale Pingen-API-Konfiguration. Ein WebApp-Login allein genügt nicht. Keine Secrets in Browser oder Repository. |
| `PINGEN_ENVIRONMENT` | Standard `staging`. `production` verwendet die Produktions-Preisabfrage. Staging benötigt eigene Zugangsdaten. |

Die Gebühr wird serverseitig berechnet. Öffentliche Formulare übermitteln zusätzlich den zuvor angezeigten Gesamtbetrag und Gebührensatz; geänderte Preise oder eine zwischenzeitliche Aktivierung verlangen eine erneute Prüfung. Bei zentralem Inkasso steht für neue Matchballmeldungen ausschliesslich Rechnung zur Verfügung. Vertrags-PDF, E-Mail und Bestätigungsansicht weisen den Zuschlag gesondert aus. Gebühren-Snapshots werden bei Bearbeitung, Freigabe und Korrekturversionen bewahrt.

## Vor produktiver Rechnungsstellung noch offen

1. QR-IBAN, tatsächlicher Kontoinhaber mit vollständiger strukturierter Adresse, Inkassorechtsträger sowie Bankfreigabe für das vorgesehene Inkasso festlegen. Die Marke mittragen.ch ersetzt nicht den tatsächlichen Kontoinhaber.
2. Steuerbehandlung der Vereinsleistung und Plattformgebühr, Rechnungs-/Inkassotexte und Vollmacht festlegen. Im Entwurf wird kein MWST-Status erfunden.
3. Verbindliche Rechnungsnummern, unveränderliche ausgestellte Rechnungen und QR-Zahlteil nach SIX validieren. Die bisherige Entwurfsreferenz ist keine QR-Referenz.
4. Pingen-Zugang verbinden; Dokument im Sandboxkonto mit Adressfenster, QR-Papier und Seitenfolge testen. Anschliessend dauerhafte Versandaufträge, Vorschau, konkrete Kostenfreigabe, Kostenträger, Idempotenz, Webhook-Signaturen und Statusabgleich implementieren und prüfen.
5. Live-Rechnungsstellung und Versand bewusst aktivieren. `BILLING_ENABLED` allein schaltet den Versand **nicht** frei. Es gibt in dieser Version absichtlich keine Upload-/Send-Route und keinen Scheduler für Banküberweisungen.

## Prüfung

`npm run build` und `npm test`. Die Finanztests führen sämtliche Migrationen in PostgreSQL/PGlite aus und prüfen den tatsächlichen Route-Handler unter RLS: Rollen, Kontowechsel, Origin, Beträge, Wiederholungen, Teilzahlungen, übergreifend doppelte Bankreferenzen, Monatsgrenzen, Stornos und PDF-Zugriff. Pingen wird ausschliesslich mit HTTP-Testantworten geprüft; keine echten Briefe oder E-Mails werden versendet. Für die visuelle PDF-Prüfung kann `BILLING_PDF_FIXTURE=/absoluter/pfad/draft.pdf` beim Testlauf gesetzt werden.
