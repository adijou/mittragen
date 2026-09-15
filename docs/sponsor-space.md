# Persönlicher Sponsor-Space

Nach der Bestätigung über einen Vertrags-Einmallink kann die unterzeichnende Person direkt ihren persönlichen Space einrichten. Auf der Bestätigungsseite stehen die Kontoerstellung und die Anmeldung mit einem bestehenden Konto zur Verfügung. Die E-Mail-Adresse wird vorausgefüllt; sie dient in der Oberfläche nur als Eingabehilfe.

Bei einem neuen Konto erfolgt die E-Mail-Bestätigung über Netlify Identity. Erst die verifizierte Konto-E-Mail berechtigt zur automatischen Zuordnung des unterzeichneten Sponsorings. Die Administration muss keine zusätzliche Einladung auslösen. Bestehende Einladungen und vorhandene Kontozugänge funktionieren weiterhin.

Der dauerhafte Einstieg ist `/sponsor`. Nach einem normalen Login werden vorhandene Sponsorzugänge ebenfalls erkannt. Nach einer E-Mail-Bestätigung erscheint **E-Mail-Adresse erfolgreich bestätigt** mit **Weiter zu meinem Space**. Die Zuordnung wird auch dann erkannt, wenn der Bestätigungslink in einem neuen Tab ohne den ursprünglichen Formularzustand geöffnet wurde.

Sponsorinnen und Sponsoren benötigen einen geschützten Login für ihren Space, aber keine eigene Organisation und keine Verwaltungsrolle. Der Einstieg heisst **Sponsor-Zugang einrichten**. Nach Login oder Passwort-Wiederherstellung sowie beim direkten Aufruf von `/workspace` werden reine Sponsorzugänge nach `/sponsor` geführt. Eine fehlgeschlagene Zugangsprüfung zeigt einen erneuten Prüfversuch und öffnet keine Organisationserfassung. Konten mit einer zusätzlichen Organisationsrolle behalten ihren bisherigen Workspace-Einstieg, sofern kein Sponsor-Einstieg gewählt wurde.

Netlify Identity kann serverseitig ein verkürztes, geprüftes JWT-Benutzerobjekt ohne `confirmedAt` liefern. In diesem Fall liest der Claim-Endpunkt das Identity-Profil über `/user` mit dem eigenen Sitzungstoken des angemeldeten Kontos. Benutzer-ID und E-Mail müssen übereinstimmen, und das Profil muss `confirmed_at` enthalten. Ein Operator-Token und vom Benutzer änderbare Metadaten werden dafür nicht verwendet. Eine nicht erreichbare Identity-Prüfung wird getrennt von einer tatsächlich unbestätigten E-Mail behandelt.

## Bestehenden Sponsor aus der Administration einladen

1. Im Workspace **Sponsoren** öffnen und beim gewünschten Sponsor **Zugang einrichten** wählen. Derselbe Bereich steht im Bearbeitungsformular unter den Stammdaten bereit.
2. Die vorausgefüllte Kontakt-E-Mail prüfen oder eine andere berechtigte Empfängeradresse eintragen. Eine abweichende Einladungsadresse ändert die Stammdaten nicht.
3. **Einladung senden** wählen. Die E-Mail führt zum Sponsor-Space. Dort erstellt die Person ihr Konto und bestätigt die E-Mail-Adresse oder meldet sich mit ihrem bestehenden Konto an.

Die Einladung funktioniert ohne Vertrag, bei importierten Altverträgen und unabhängig von Überführungsvorschlägen. Sie berechtigt zum Space genau dieses Sponsors und verleiht keine Organisations- oder Teamrolle. Der Empfänger erhält keinen neuen Vertragsabschluss durch die Einladung.

**Zugänge und Einladungen** zeigt bestehende Kontozugänge sowie direkte Einladungen mit Versand- und Annahmestatus. Mit **Status aktualisieren** wird die Anzeige neu geladen. **Erneut senden** verlängert die Einladung auf sieben Tage. Eine offene Einladung ist nach Ablauf nicht mehr aktivierbar; bereits eingerichtete Kontozugänge bleiben erhalten. Fehlgeschlagener Versand wird als Fehler ausgewiesen, nicht als Erfolg. Erfolg bedeutet Annahme durch den Mailanbieter, nicht garantierte Zustellung ins Postfach.

Nur Rollen mit `sponsors:write` dürfen den Zugangsbereich aufrufen und Einladungen versenden. Erst ein angemeldetes Konto mit bestätigter, passender E-Mail übernimmt eine erfolgreich versandte, noch gültige Einladung. Wiederholte Logins erzeugen keine zusätzlichen Zuordnungen. Versandvorbereitung, Versandergebnis und Aktivierung werden protokolliert.

## Im Space

- **Dokumente:** Freigegebene und bestätigte Sponsoringverträge können als PDF heruntergeladen werden. Ausstehende Vertragsbestätigungen und vorhandene Überführungsvorschläge bleiben erreichbar.
- **Meine Angaben:** Firmen-/Sponsorname, Name der Kontaktperson, Kontakt-E-Mail, Telefon und Website lassen sich im Formular „Name und Kontakt“ pflegen. Strasse/Hausnummer, Postleitzahl und Ort bleiben im separaten Adressformular erreichbar. Optionale Kontaktdaten können geleert werden. Parallele Änderungen werden erkannt und veraltete Speicherversuche abgewiesen.

Die Kontakt-E-Mail dient der Kommunikation mit der Organisation. Die bestätigte Login-Adresse und bestehende Sponsorzugänge bleiben unverändert; eine neue Kontaktadresse erteilt keiner anderen Person Zugriff. Die Login-Adresse ist direkt beim E-Mail-Feld erklärt. Änderungen sind ausschliesslich für den eigenen Sponsor möglich; Paket, Betrag, Status, Rollen und Vertragsfelder sind nicht über diesen Endpunkt änderbar.
- **Logo:** Die gemeinsame Verwaltung für PNG/JPEG bis 2 MB ist im Sponsor-Space und im Adminbereich erreichbar. Beide Zugänge verwenden denselben gespeicherten Stand.

Adress- und Kontaktänderungen werden unmittelbar in den Sponsor-Stammdaten der Organisation gespeichert und mit Vorher-/Nachherwerten protokolliert. Bereits freigegebene oder unterzeichnete Vertrags-Snapshots bleiben unverändert. Eine allgemeine Dateiablage und Rechnungsdokumente sind kein Bestandteil dieses Ausbaus.

## Website und weitere Felder

Die Website ist optional. Eine Eingabe wie `www.beispiel.ch` wird mit `https://` gespeichert; andere Protokolle sowie eingebettete Zugangsdaten werden abgewiesen. Leer speichern entfernt die Website aus den aktuellen Stammdaten.

`shared/sponsor-contact.ts` definiert die ausdrücklich freigegebenen Felder, Labels, Eingabetypen und Längen für Formular und API. Ein zusätzliches Feld benötigt einen Eintrag dort und eine passende Datenbankspalte, gegebenenfalls eine Migration und fachliche Validierung. Neue Felder werden damit automatisch im Formular und beim Lesen/Speichern berücksichtigt. Unbekannte Felder, Rollen und Vertragswerte bleiben gesperrt. Teiländerungen und ältere geöffnete Formulare überschreiben keine nicht mitgesendeten Felder.

## Logos im Adminbereich

In **Sponsoren** zeigt die erste Spalte die Logo-Vorschau oder **Logo fehlt**. Der Filter **Logo-Status → Ohne Logo** zeigt alle noch offenen Einträge. Bei Schreibberechtigung öffnet ein Klick auf die Vorschau die Logo-Verwaltung; dieselbe Verwaltung steht oben in **Bearbeiten**.

Logos können hochgeladen, ersetzt und entfernt werden. Eigentümer und Sponsoring-Administratoren dürfen ändern; Finance, Fulfillment und Viewer dürfen die Logos ihrer Organisation ansehen. Sponsorzugänge gelten weiterhin ausschliesslich für ihren eigenen Space. Die gemeinsame Implementierung unter `netlify/functions/_shared/sponsor-logo.ts` prüft bei jedem Zugriff Organisation und Berechtigung, liefert Bilder privat aus und protokolliert Änderungen samt Quelle und ausführender Person. Speicherpfade werden nicht in der Sponsorenliste offengelegt.

## Zugriff und Migration

Die Migration `20260914100000_sponsor_self_service_access` ergänzt eine SELECT-Policy und einen Index für unbeanspruchte, bestätigte Unterzeichnungen. Sie erstellt keine Konten, verschickt keine E-Mails und übernimmt keine Sponsorzugänge im Voraus.

`20260914120000_direct_sponsor_invitations` macht die bisher erforderliche Verknüpfung einer Sponsor-Einladung mit einem Überführungsvorschlag optional. Ein zusätzlicher Index verhindert doppelte direkte Einladungen für denselben Sponsor und dieselbe E-Mail. Bestehende Vorschlagseinladungen bleiben verknüpft. Die Migration selbst versendet keine E-Mails.

Die Zuordnung erfolgt beim verifizierten Login: gleicher Unterzeichner-Empfänger, bestätigte Unterzeichnung, noch nicht beanspruchter Zugang. Das Ende der Einmallink-Gültigkeit verhindert eine erneute Unterzeichnung, beendet aber nicht die Möglichkeit, als verifizierte unterzeichnende Person den Space zu aktivieren. Wiederholte Logins erstellen keine zusätzlichen Zugänge. Eine abweichende Kontaktperson erhält dadurch nicht automatisch Zugriff.

Adress- und Kontaktänderungen prüfen zusätzlich zur Anmeldung die Kombination aus Organisation, Sponsor und Kontoinhaber. Die Datenbank erzwingt weiterhin die Mandantentrennung. Der Signaturlink selbst ist kein dauerhaftes Login.

## Prüfung

`npm test` enthält PostgreSQL-Integrationstests mit PGlite, allen Migrationen und einer Rolle ohne RLS-Ausnahme. Geprüft werden insbesondere bestätigte/unbestätigte Konten, falsche Empfänger, nicht unterzeichnete und widerrufene Anfragen, abgelaufene Signaturlinks nach erfolgreicher Unterzeichnung, wiederholte Zuordnung, fremde Dokumente, fremde Adressänderungen, gespeicherte Adressen, Audit-Nachweise, veraltete Schreibversuche und unveränderte Vertrags-Snapshots.

Die direkten Einladungen werden zusätzlich für fehlende Adminrechte, fremde Organisationen, Sponsoren ohne Vertrag, Altverträge ohne Unterzeichnungsanfrage, E-Mail-Abweichungen, Versandfehler, Ablauf, Wiederholung und verspätete Versandantworten geprüft. Der Versandtest verwendet einen simulierten Mailanbieter und verlangt dessen Versand-ID; es werden keine echten Einladungen versendet.

Prüfstand 15. September 2026: 197 Tests und der Produktions-Build erfolgreich. Der Mailversand über Resend und die Freischaltung des Logins wurden vom Auftraggeber bestätigt. Ergänzt wurden Tests für fehlende serverseitige Profildaten, wirklich unbestätigte E-Mails, fremde Identitäten, Identity-Ausfälle und die automatische Zuordnung ohne Organisationsrolle. Ein zusätzlicher Test ruft den tatsächlichen API-Handler für Zugangszuordnung und Space-Abruf auf, sodass auch die vorgelagerte Bestätigungsprüfung abgedeckt ist. Der Sponsor-Space wurde mit dem betroffenen Konto produktiv geprüft: Dokumente, Adresse und Logo laden; der allgemeine Arbeitsbereich leitet in den Sponsor-Space weiter. Dieser Einladungsablauf setzt aktivierte Kontoerstellung und E-Mail-Bestätigung voraus.

Die zusätzliche Kontaktpflege ist mit realen Migrationen und RLS geprüft: Speichern und Leeren optionaler Felder, fremde Sponsoren, parallele Änderungen, Audit-Nachweis sowie unveränderte Verträge, Einladungen und Zugangsrechte. Die Handler-Tests prüfen zudem die Netlify-Routenregistrierung, die Herkunft der Anfrage und die Eingabeprüfung. Logo-Tests verwenden die echte API und SQL mit RLS sowie einen isolierten Blob-Speicher: Leserechte, Schreibrechte, fremde Organisationen, gemeinsamer Stand, Ersetzen, Entfernen, Audit und Fehler beim Upload sind abgedeckt.

`npm run build` prüft Frontend und Serverfunktionen mit TypeScript und erzeugt den Produktions-Build. Vor der produktiven Abnahme ist zusätzlich der echte Identity-E-Mail-Rückweg zu prüfen; die lokalen Datenbanktests versenden keine E-Mails.
