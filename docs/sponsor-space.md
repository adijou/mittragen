# Persönlicher Sponsor-Space

Nach der Bestätigung über einen Vertrags-Einmallink kann die unterzeichnende Person direkt ihren persönlichen Space einrichten. Auf der Bestätigungsseite stehen die Kontoerstellung und die Anmeldung mit einem bestehenden Konto zur Verfügung. Die E-Mail-Adresse wird vorausgefüllt; sie dient in der Oberfläche nur als Eingabehilfe.

Bei einem neuen Konto erfolgt die E-Mail-Bestätigung über Netlify Identity. Erst die verifizierte Konto-E-Mail berechtigt zur automatischen Zuordnung des unterzeichneten Sponsorings. Die Administration muss keine zusätzliche Einladung auslösen. Bestehende Einladungen und vorhandene Kontozugänge funktionieren weiterhin.

Der dauerhafte Einstieg ist `/sponsor`. Nach einem normalen Login werden vorhandene Sponsorzugänge ebenfalls erkannt. Nach einer E-Mail-Bestätigung erscheint **E-Mail-Adresse erfolgreich bestätigt** mit **Weiter zu meinem Space**. Die Zuordnung wird auch dann erkannt, wenn der Bestätigungslink in einem neuen Tab ohne den ursprünglichen Formularzustand geöffnet wurde.

## Bestehenden Sponsor aus der Administration einladen

1. Im Workspace **Sponsoren** öffnen und beim gewünschten Sponsor **Zugang einrichten** wählen. Derselbe Bereich steht im Bearbeitungsformular unter den Stammdaten bereit.
2. Die vorausgefüllte Kontakt-E-Mail prüfen oder eine andere berechtigte Empfängeradresse eintragen. Eine abweichende Einladungsadresse ändert die Stammdaten nicht.
3. **Einladung senden** wählen. Die E-Mail führt zum Sponsor-Space. Dort erstellt die Person ihr Konto und bestätigt die E-Mail-Adresse oder meldet sich mit ihrem bestehenden Konto an.

Die Einladung funktioniert ohne Vertrag, bei importierten Altverträgen und unabhängig von Überführungsvorschlägen. Sie berechtigt zum Space genau dieses Sponsors und verleiht keine Organisations- oder Teamrolle. Der Empfänger erhält keinen neuen Vertragsabschluss durch die Einladung.

**Zugänge und Einladungen** zeigt bestehende Kontozugänge sowie direkte Einladungen mit Versand- und Annahmestatus. Mit **Status aktualisieren** wird die Anzeige neu geladen. **Erneut senden** verlängert die Einladung auf sieben Tage. Eine offene Einladung ist nach Ablauf nicht mehr aktivierbar; bereits eingerichtete Kontozugänge bleiben erhalten. Fehlgeschlagener Versand wird als Fehler ausgewiesen, nicht als Erfolg. Erfolg bedeutet Annahme durch den Mailanbieter, nicht garantierte Zustellung ins Postfach.

Nur Rollen mit `sponsors:write` dürfen den Zugangsbereich aufrufen und Einladungen versenden. Erst ein angemeldetes Konto mit bestätigter, passender E-Mail übernimmt eine erfolgreich versandte, noch gültige Einladung. Wiederholte Logins erzeugen keine zusätzlichen Zuordnungen. Versandvorbereitung, Versandergebnis und Aktivierung werden protokolliert.

## Im Space

- **Dokumente:** Freigegebene und bestätigte Sponsoringverträge können als PDF heruntergeladen werden. Ausstehende Vertragsbestätigungen und vorhandene Überführungsvorschläge bleiben erreichbar.
- **Adresse:** Strasse/Hausnummer, Postleitzahl und Ort können geändert werden. Andere Felder, insbesondere Kontoadresse, Firmenname, Paket, Betrag und Status, sind über diesen Endpunkt nicht änderbar. Bei einer zwischenzeitlich geänderten Adresse wird ein veralteter Speicherversuch abgewiesen.
- **Logo:** Die vorhandene Verwaltung für PNG/JPEG bis 2 MB ist im eigenen Bereich erreichbar.

Adressänderungen werden unmittelbar in den Sponsor-Stammdaten der Organisation gespeichert und mit Vorher-/Nachherwerten protokolliert. Bereits freigegebene oder unterzeichnete Vertrags-Snapshots bleiben unverändert. Eine allgemeine Dateiablage und Rechnungsdokumente sind kein Bestandteil dieses Ausbaus.

## Zugriff und Migration

Die Migration `20260914100000_sponsor_self_service_access` ergänzt eine SELECT-Policy und einen Index für unbeanspruchte, bestätigte Unterzeichnungen. Sie erstellt keine Konten, verschickt keine E-Mails und übernimmt keine Sponsorzugänge im Voraus.

`20260914120000_direct_sponsor_invitations` macht die bisher erforderliche Verknüpfung einer Sponsor-Einladung mit einem Überführungsvorschlag optional. Ein zusätzlicher Index verhindert doppelte direkte Einladungen für denselben Sponsor und dieselbe E-Mail. Bestehende Vorschlagseinladungen bleiben verknüpft. Die Migration selbst versendet keine E-Mails.

Die Zuordnung erfolgt beim verifizierten Login: gleicher Unterzeichner-Empfänger, bestätigte Unterzeichnung, noch nicht beanspruchter Zugang. Das Ende der Einmallink-Gültigkeit verhindert eine erneute Unterzeichnung, beendet aber nicht die Möglichkeit, als verifizierte unterzeichnende Person den Space zu aktivieren. Wiederholte Logins erstellen keine zusätzlichen Zugänge. Eine abweichende Kontaktperson erhält dadurch nicht automatisch Zugriff.

Adressänderungen prüfen zusätzlich zur Anmeldung die Kombination aus Organisation, Sponsor und Kontoinhaber. Die Datenbank erzwingt weiterhin die Mandantentrennung. Der Signaturlink selbst ist kein dauerhaftes Login.

## Prüfung

`npm test` enthält PostgreSQL-Integrationstests mit PGlite, allen Migrationen und einer Rolle ohne RLS-Ausnahme. Geprüft werden insbesondere bestätigte/unbestätigte Konten, falsche Empfänger, nicht unterzeichnete und widerrufene Anfragen, abgelaufene Signaturlinks nach erfolgreicher Unterzeichnung, wiederholte Zuordnung, fremde Dokumente, fremde Adressänderungen, gespeicherte Adressen, Audit-Nachweise, veraltete Schreibversuche und unveränderte Vertrags-Snapshots.

Die direkten Einladungen werden zusätzlich für fehlende Adminrechte, fremde Organisationen, Sponsoren ohne Vertrag, Altverträge ohne Unterzeichnungsanfrage, E-Mail-Abweichungen, Versandfehler, Ablauf, Wiederholung und verspätete Versandantworten geprüft. Der Versandtest verwendet einen simulierten Mailanbieter und verlangt dessen Versand-ID; es werden keine echten Einladungen versendet.

Prüfstand 14. September 2026: 172 Tests und der Produktions-Build erfolgreich, einschliesslich der deutschen E-Mail-Bestätigung und der einmaligen Token-Verarbeitung. Die öffentlichen Identity-Einstellungen von `mittragen.ch` bestätigen `disable_signup: false` und `autoconfirm: false`: Kontoerstellung ist aktiviert und die E-Mail muss bestätigt werden. Dieser Einladungsablauf setzt aktivierte Kontoerstellung voraus. Ein vollständiger Browser-/E-Mail-Durchlauf steht noch aus; die Erweiterung ist lokal vorbereitet und noch nicht veröffentlicht.

`npm run build` prüft Frontend und Serverfunktionen mit TypeScript und erzeugt den Produktions-Build. Vor der produktiven Abnahme ist zusätzlich der echte Identity-E-Mail-Rückweg zu prüfen; die lokalen Datenbanktests versenden keine E-Mails.
