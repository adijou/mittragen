# mittragen.ch – Vorbereitung des Pilot-Rollouts

Stand: 15. September 2026. Planungsgrundlage: aktueller Repository-Stand, dokumentierter Produktfortschritt und der vorhandene Pflichtenheft-Abgleich vom 14. September. Die ursprüngliche DOCX des Pflichtenhefts liegt in diesem Arbeitsstand nicht vor; dies ist daher keine Abnahme jeder Einzelanforderung.

## Ziel und Einordnung

Mittragen besitzt einen produktiven Kern für Sponsoren, Pakete, Verträge, Onlineabschluss, Sponsor-Space und Matchbälle. Mehrere Organisationen mit eigenen Mitgliedschaften und Rollen sind technisch vorgesehen. Damit ist ein begleiteter Pilot mit weiteren Vereinen sinnvoll. Eine vollständige Abnahme mit mehreren realen Vereinen sowie die kommerzielle SaaS-Abwicklung sind damit noch nicht nachgewiesen.

Die öffentliche Seite präsentiert die vorhandenen Funktionen und führt Interessierte zu [Digital Bell](https://digitalbell.ch/). Sie verwendet ausschliesslich gekennzeichnete, fiktive Beispielansichten und verspricht keine bereits integrierte Rechnungsverwaltung, Zahlungsabwicklung oder automatische Verlängerung. Der Kontaktbereich zeigt die Digital-Bell-Bildmarke und führt Interessierte direkt zu Digital Bell.

Ein Konto kann mehreren Vereinen zugeordnet sein. Jeder Verein hat eigene Daten, Pakete, Teamrollen und Branding. Sponsorinnen und Sponsoren benötigen nur ihren persönlichen Space und keinen eigenen Vereinsbereich. Dieses Modell ist bereits implementiert; im Pilot muss seine Bedienbarkeit und Trennung praktisch nachgewiesen werden.

## Vor dem ersten zusätzlichen Pilotverein – P0

| Arbeitspaket | Vorhandene Grundlage | Noch zu erledigen und Freigabekriterium | Vorgeschlagene Verantwortung |
| --- | --- | --- | --- |
| **P0.1 Mehrvereins- und Zugangsabnahme** | Mandanten, fünf Teamrollen, Datenbank-Zugriffsregeln; Schutz gegen Kontoverwechslungen; automatisierte Tests | Zwei getrennte Vereine, je eigene Admin- und Sponsorkonten sowie ein Konto mit Berechtigung für beide Vereine prüfen. Sponsoren, Logos, Dokumente, Onlineangebote und Aktionen müssen dem richtigen Verein zugeordnet bleiben. Verweigerten Fremdzugriff und Browser-Kontowechsel dokumentieren. | Entwicklung + je eine verantwortliche Person der Pilotvereine |
| **P0.2 Kompletter Mail-/Login-/Vertragsablauf** | Einladung, Registrierung, Bestätigung, Wiederherstellung, Vertragsabschluss und Sponsor-Space vorhanden; Mail/Login vom Auftraggeber bestätigt | Mit neuen und bestehenden Konten sowie früher eingeladenen Konten durchspielen: Einladung → tatsächlicher Maileingang → Aktivierung → richtiger Space → Vertrag/PDF → Änderung von Angaben und Logo. Zusätzlich Wiederholung, abgelaufener Link, anderer eingeloggter Sponsor, neuer Tab, mobile Nutzung und Sperrfrist prüfen. Keine produktiven Testmails ohne festgelegte Empfänger. | Entwicklung + Pilotverantwortliche |
| **P0.3 Wiederholbarer Vereinsstart** | Organisationsanlage, Team, Branding, Import und Paketpflege vorhanden | Eine kurze Einrichtungscheckliste und eine saubere Importvorlage bereitstellen. Zweiten Verein ohne Hilfe aus dem bisherigen Vereinsbestand einrichten: eigener Owner, Team, Kontakt, Logo, Pakete, Vertragsregeln, Pilot-Sponsoren und bewusst freigegebener öffentlicher Link. Keine Beispieldaten oder fremden Kontakte übernehmen. | Digital Bell + Pilotverein |
| **P0.4 Zugänge beenden können** | Rollenpflege und Zuordnung von Sponsorzugängen vorhanden | Verwaltungsablauf zum Entziehen von Team- und Sponsorzugängen sowie zum Widerrufen offener Einladungen prüfen und fehlende Aktionen ergänzen. Nach Entzug müssen auch bestehende Sitzungen und alte Links den Zugriff verlieren. Owner-Wechsel und Schutz vor dem Entfernen des letzten Owners abnehmen. | Entwicklung |
| **P0.5 Betrieb, Sicherung und Support** | Git-basierte Deployments, Protokolle und Mailanbieter vorhanden | Verantwortliche, Kontaktweg und Störungsablauf festlegen. Fehler bei Anmeldung, Funktionen und Mailzustellung erkennbar machen. Sicherungsumfang für Datenbank, Logos und weitere Dateien festhalten; eine Wiederherstellung in isolierter Umgebung tatsächlich testen. Kosten-/Nutzungsgrenzen und angemessenen Schutz öffentlicher Formulare prüfen. Vorhandene Backups gelten erst nach Nachweis als abgenommen. | Digital Bell / Betrieb |
| **P0.6 Pilotvereinbarung und Datenverantwortung** | Begleiteter Pilot als Einstiegsmodell auf der Website benannt | Pilotumfang, Laufzeit, Konditionen, Betreuung, Rückmeldungen und Ausstieg vereinbaren. Verantwortlichkeiten für Daten, Datenschutz- und Betriebsunterlagen mit den zuständigen Personen abstimmen. Mandantenbezogenen Datenexport und den Umgang mit Daten am Pilotende festlegen und fehlende Möglichkeiten ergänzen. | Digital Bell + Pilotverein; fachliche Prüfung nach Bedarf |

**Startbedingung:** P0.1–P0.6 sind dokumentiert freigegeben. Es bestehen keine offenen Fehler mit fremdem Datenzugriff, falscher Kontozuordnung oder Datenverlust. Jede bekannte funktionale Einschränkung ist mit dem Pilotverein vereinbart. Automatisierte Tests allein ersetzen die praktische Abnahme nicht.

Die Sicherheitskorrektur vor dieser Produktüberarbeitung wurde mit 210 Tests und Produktions-Build geprüft und veröffentlicht. Der vollständige Browserdurchlauf mit zwei echten Logins ist noch offen. Diese konkrete Restprüfung gehört zu P0.1/P0.2 und darf nicht als erledigt übernommen werden.

## Pilotbetrieb – klein beginnen, gezielt erweitern

Empfehlung, noch keine zugesagte Teilnehmerzahl oder Terminplanung: zuerst zwei bis drei Vereine mit unterschiedlichen Abläufen, etwa ein Fussballverein und ein Verein ohne Spielbetrieb. Pro Verein zunächst wenige ausgewählte Sponsoren aktivieren. Nach der ersten gemeinsamen Auswertung den Bestand schrittweise erweitern.

| Phase | Konkretes Ergebnis | Weiter, wenn … |
| --- | --- | --- |
| Kennenlernen | Ansprechpartner, heutiger Ablauf, wichtigste Anwendungsfälle und vereinbarter Pilotumfang | Erwartungen, Betreuung und Konditionen geklärt sind |
| Einrichten | Eigenständiger Verein mit geprüften Stammdaten, Paketen, Rollen, Branding und Pilotbestand | Die Einrichtungscheckliste vollständig ist und Verantwortliche den Datenbestand freigeben |
| Erste echte Fälle | Je ein Neuabschluss und ein Zugang für einen bestehenden Sponsor; Matchballprozess bei passendem Verein | Mail, Bestätigung, PDF und Space funktionieren und keine falsche Zuordnung auftritt |
| Auswerten | Gemeinsame Fehler- und Verbesserungsübersicht mit Priorität, zuständiger Person und nächster Entscheidung | Kritische Fehler behoben sind und der Verein den Ablauf selbst bedienen kann |
| Ausweiten | Mehr Sponsoren oder weiterer Verein | Support und Betrieb tragen und die Grenzen des Pilotumfangs weiter eingehalten werden |

Zu erfassende Signale: Aufwand bis zur ersten nutzbaren Organisation, erfolgreiche Einladung bis zum richtigen Space, vollständiger Vertragsabschluss, Import-Nacharbeit, Supportfälle und wichtigste fehlende Funktionen. Diese Werte erst messen; keine erfundenen Erfolgsquoten oder Zeitersparnisse veröffentlichen. Rückmeldungen in einem gemeinsamen, priorisierten Backlog führen.

## Funktionaler Ausbau – P1

| Priorität | Nächstes Arbeitspaket | Fertig, wenn … |
| --- | --- | --- |
| **P1.1 Rechnungen und Zahlungsstatus** | Vereinsrechnungen aus bestätigten Verträgen, Fälligkeiten, Teilzahlungen, Korrekturen und Status im Adminbereich sowie im Sponsor-Space | Laufzeit und Verrechnungsperiode getrennt sind, Beträge nachvollziehbar bleiben und ein Sponsor nur eigene Rechnungen sieht. Zahlungsanbieter erst nach geklärtem Pilotbedarf anbinden. |
| **P1.2 Dokumente und Vertragslebenszyklus** | Geschützte Ablage weiterer Unterlagen und Altvertragsdateien; Verlängerungen und Änderungen | Berechtigungen, frühere Stände und Nachweise erhalten bleiben; Verlängerungen nicht durch Überschreiben eines bestätigten Vertrags entstehen. |
| **P1.3 Weitere Sponsorenleistungen** | Banden, Websitepräsenz, Clubinfo, Tenüs oder andere vereinstypische Leistungen mit Zuständigkeit, Termin und Erfüllungsnachweis | Ein Verein die zugesagten Leistungen über die Matchballverwaltung hinaus nachhalten kann. |
| **P1.4 Überführung bei Bedarf** | Bestehende Pakete, Verträge, Ausnahmen und Sponsorentscheidungen fachlich durch den bereits vorhandenen Überführungsprozess führen | Jeder betroffene Sponsor eine geprüfte Zuordnung und dokumentierte Entscheidung hat. Für einen Verein ohne Fusionsbedarf ist dies kein pauschaler Startblocker. |

## Vor dem allgemeinen SaaS-Rollout – Release-Bedingungen

Das ursprüngliche Zielbild verlangt SaaS-Fähigkeit ab dem ersten Release. Tarifwahl und Plattform-Abrechnung bleiben deshalb offene Release-Anforderungen. Ein begleiteter Pilot mit ausdrücklich vereinbartem Umfang kann Erkenntnisse liefern; er ist nicht als Erfüllung dieser Anforderungen zu bezeichnen.

1. **Tarif- und Vertragsmodell festlegen:** Leistungsumfang, Nutzer-/Vereinsgrenzen, Pilotkonditionen, Wechsel, Kündigung und Supportangebot entscheiden.
2. **Plattform-Abrechnung umsetzen:** Vereine bezahlen die Nutzung von mittragen.ch. Dies ist fachlich getrennt von den Sponsoringrechnungen, die Vereine an ihre Sponsoren stellen.
3. **Selbständigen Ein- und Ausstieg abnehmen:** Organisation anlegen, Berechtigungen vergeben, eigene Daten übernehmen, exportieren und einen Zugang bzw. die Nutzung beenden können.
4. **Betrieb für mehrere Vereine nachweisen:** Überwachung, Wiederherstellung, Kapazität, Kostenkontrolle, Support und Verfahren bei Störungen oder Sicherheitsvorfällen praktisch prüfen.
5. **Pflichtenheft vollständig abgleichen:** Originaldatei beiziehen und jede Anforderung mit Implementierung, Testnachweis, bewusster Abgrenzung oder noch offener Aufgabe versehen. Zahlungs- und weitergehende Signaturanbindungen nach ihrem tatsächlichen Pflichtumfang einordnen.

## Empfohlener nächster Entwicklungsauftrag

P0.1 und P0.2 als zusammenhängende Abnahme mit zwei Vereinen abschliessen; dabei P0.3 als wiederverwendbare Einrichtungscheckliste mitschreiben. Parallel P0.4 (Zugänge entziehen) und P0.5 (Wiederherstellung/Betrieb) konkret prüfen und vervollständigen. Danach den ersten zusätzlichen Pilotverein freigeben. Rechnungen und Zahlungsstatus sind das erste grössere funktionale Ausbaupaket; das SaaS-Tarifmodell wird parallel entschieden.

## Quellen und Prüfbasis

- Repository: Organisations- und Teamverwaltung, Import, Pakete, Verträge, Onlineabschluss, Sponsorportal und Matchballfunktionen; Implementierung und automatisierte Tests.
- [Sponsor-Space und Zugangsmodell](sponsor-space.md), [Mailkonfiguration](email-delivery.md).
- Pflichtenheft-Zustandsreport vom 14. September 2026 im Projektkontext; seither erledigte Stammdaten-, Website-, Logo- und Zugangsarbeiten sind hier berücksichtigt.
- [Digital Bell](https://digitalbell.ch/), am 15. September 2026 geprüft: Anlaufstelle für Interesse und Pilotgespräch. Der vom Auftraggeber genannte Kontaktbereich einer anderen Produktseite dient ausschliesslich als Gestaltungsreferenz.
