export type HelpSection = "overview" | "sponsors" | "packages" | "dossier" | "events" | "transitions" | "contracts" | "imports" | "team" | "settings";

type HelpArticle = {
  id: string;
  question: string;
  answer: string;
  steps?: string[];
  note?: string;
  keywords?: string;
};

export type HelpTopic = {
  id: string;
  title: string;
  section: HelpSection;
  sectionLabel: string;
  permission?: string;
  articles: HelpArticle[];
};

// Keep instructions next to the UI code and update them when a workflow changes.
export const workspaceHelpTopics: HelpTopic[] = [
  {
    id: "start", title: "Einstieg & Übersicht", section: "overview", sectionLabel: "Übersicht",
    articles: [
      {
        id: "first-steps", question: "Wie richte ich unseren Verein zum ersten Mal ein?",
        answer: "Beginnen Sie mit den Vereinsangaben und dem Angebot. Danach können Sie Sponsoren erfassen und Verträge vorbereiten.",
        steps: [
          "Wählen Sie oben die richtige Organisation. Für einen weiteren Verein verwenden Sie «Neue Organisation» und erfassen Name, Kurzname und Typ.",
          "Vervollständigen Sie unter «Organisation» Kontakt, rechtliche Angaben, Logo und Farben.",
          "Erstellen und veröffentlichen Sie unter «Pakete» Ihre Angebote mit den zugehörigen Leistungen.",
          "Erfassen Sie Sponsoren unter «Sponsoren» oder übernehmen Sie eine bestehende Liste über «Datenübernahme».",
          "Verbinden Sie unter «Verträge» einen Sponsor mit einem Paket. Teammitglieder können Sie unter «Team» einladen.",
        ],
        note: "Für einen produktiven Verein lassen Sie die optionalen Beispiel-Sponsoren beim Anlegen weg.",
        keywords: "Onboarding Start Reihenfolge Setup Verein anlegen",
      },
      {
        id: "switch-club", question: "Wie wechsle ich den Verein und was zeigt die Übersicht?",
        answer: "Die Auswahl «Organisation» oben bestimmt, für welchen Verein Sie arbeiten. Die Übersicht zeigt dessen Sponsorenanzahl, jährlichen Zielwert und Ihre Rolle mit den verfügbaren Berechtigungen.",
        steps: ["Wählen Sie den gewünschten Verein in der Organisationsauswahl.", "Prüfen Sie den Vereinsnamen, bevor Sie Daten bearbeiten, importieren oder Einladungen versenden."],
        note: "Der jährliche Zielwert berücksichtigt Sponsoren aller Status. Er ist kein Nachweis eingegangener Zahlungen. Daten und Rollen werden je Organisation getrennt geführt.",
        keywords: "mehrere Vereine Mandant wechseln Kennzahlen Dashboard",
      },
      {
        id: "invoices", question: "Wo finde ich Rechnungen, Zahlungsstatus und weitere Leistungserfüllung?",
        answer: "Eine vollständige Rechnungsverwaltung und Zahlungsübersicht gehören zum weiteren Ausbau. Aktuell verwalten Sie Pakete, Verträge und Matchball-Zuordnungen. Andere Leistungen können im Paket beschrieben werden; eine eigene Erfüllungsverwaltung dafür ist noch nicht vorhanden.",
        note: "Die Zahlungsart «Rechnung» bei Matchbällen erstellt noch keine Rechnung. Auch eine Finanzrolle oder eine Verlängerungsklausel im Vertrag bedeutet nicht, dass Rechnungsversand oder automatische Vertragsverlängerungen bereits ausgeführt werden.",
        keywords: "Finanzen bezahlt Zahlung Banden Inserate Verlängerung",
      },
      {
        id: "save-problem", question: "Was prüfe ich, wenn sich eine Änderung nicht speichern lässt?",
        answer: "Die Rückmeldung am Formular zeigt, ob Angaben fehlen, Ihre Berechtigung nicht ausreicht oder ein technischer Fehler vorliegt.",
        steps: ["Lesen Sie die Fehlermeldung und prüfen Sie die markierten Pflichtfelder sowie Ihre Rolle unter «Übersicht».", "Bei einer abgelaufenen Sitzung melden Sie sich erneut an und wählen wieder die richtige Organisation.", "Wenn Daten zwischenzeitlich geändert wurden, laden Sie den aktuellen Stand und gleichen Ihre Änderung damit ab, bevor Sie erneut speichern.", "Bleibt der Fehler bestehen, geben Sie dem Support den Verein, den betroffenen Arbeitsschritt und die Fehlermeldung mit einer gegebenenfalls angezeigten technischen Referenz an."],
        keywords: "Fehler speichern Konflikt Sitzung Support Problem",
      },
    ],
  },
  {
    id: "sponsors", title: "Sponsoren & Logos", section: "sponsors", sectionLabel: "Sponsoren",
    articles: [
      {
        id: "create-sponsor", question: "Wie erfasse oder ändere ich einen Sponsor?",
        answer: "Die Sponsorenliste ist der zentrale Ort für Firmen- und Kontaktdaten.",
        steps: ["Öffnen Sie «Sponsoren» und wählen Sie «Sponsor erfassen» oder beim vorhandenen Eintrag «Bearbeiten».", "Erfassen Sie Firmenname, Kontaktperson, Kontakt-E-Mail, Telefon, Website und Adresse. Herkunft und interne Notizen können Sie ergänzen.", "Klicken Sie auf «Sponsor speichern» beziehungsweise «Änderungen speichern»."],
        note: "Paket und Jahreswert legen Sie unter «Verträge» fest. Änderungen an den Stammdaten ändern bereits unterzeichnete Vertragsdokumente nicht.",
      },
      {
        id: "sponsor-logo", question: "Wie sehe ich fehlende Logos und lade ein Logo hoch?",
        answer: "Die erste Spalte der Sponsorenliste zeigt das aktuelle Logo. Administration und Sponsor-Space verwenden dasselbe Logo.",
        steps: ["Wählen Sie im Filter «Logo-Status» bei Bedarf «Ohne Logo».", "Klicken Sie in der Liste auf das Logo beziehungsweise den Platzhalter. Alternativ öffnen Sie «Bearbeiten» beim Sponsor.", "Wählen Sie eine PNG- oder JPEG-Datei bis 2 MB und klicken Sie auf «Logo speichern».", "Zum Ersetzen laden Sie eine neue Datei hoch; über «Logo entfernen» können Sie das aktuelle Logo nach Bestätigung entfernen."],
        keywords: "Bild Upload Firmenlogo Sponsorlogo",
      },
      {
        id: "sponsor-package-export", question: "Wie erhalte ich eine Liste aller Sponsoren mit ihren Paketen?",
        answer: "Unter «Sponsoren» öffnet «Paketübersicht» die Zuordnungen aus bestätigten Verträgen einschliesslich Altbestand. Jede Paketspalte zeigt den vereinbarten Jahreswert. CHF 0 bedeutet kostenlos; ein Strich bedeutet keine Zuordnung.",
        steps: ["Wählen Sie die richtige Organisation und öffnen Sie «Sponsoren».", "Öffnen Sie «Paketübersicht» für die Bildschirmansicht.", "Mit «Alle Sponsoren exportieren» laden Sie eine Excel-kompatible CSV-Datei mit allen Sponsoren und Paketspalten herunter, unabhängig von Such- und Logo-Filtern."],
        note: "Entwürfe und aufgehobene Verträge sind nicht enthalten. Mehrere bestätigte Verträge desselben Pakets werden pro Sponsor addiert. Die Übersicht ist kein Zahlungsnachweis.",
      },
      {
        id: "find-sponsor", question: "Wie finde ich einen Sponsor oder ändere seinen Status?",
        answer: "Suche und Logo-Filter lassen sich kombinieren.",
        steps: ["Suchen Sie unter «Sponsoren» nach Firma, Kontakt oder Ort.", "Falls kein Treffer erscheint, prüfen Sie auch den eingestellten Logo-Status.", "Öffnen Sie zum Ändern des Status «Bearbeiten», wählen Sie den gewünschten Status und speichern Sie die Änderung."],
        note: "Ein Sponsorstatus ersetzt weder eine Vertragsbestätigung noch einen Zahlungsnachweis.",
      },
    ],
  },
  {
    id: "space", title: "Sponsor-Space & Zugang", section: "sponsors", sectionLabel: "Sponsoren",
    articles: [
      {
        id: "invite-sponsor", question: "Wie lade ich einen Sponsor in seinen Space ein?",
        answer: "Das geht direkt beim Sponsor, auch für Bestandssponsoren ohne digital unterzeichneten Vertrag.",
        steps: ["Öffnen Sie «Sponsoren» und klicken Sie beim gewünschten Sponsor auf «Zugang einrichten».", "Prüfen Sie «E-Mail für die Einladung». Diese Person erhält Zugang zu diesem Sponsor.", "Klicken Sie auf «Einladung senden». Unter «Zugänge und Einladungen» können Sie den Status aktualisieren.", "Der Sponsor öffnet den persönlichen Link, richtet seinen Zugang ein oder meldet sich mit dem bestehenden Konto der Empfängeradresse an."],
        note: "Die Einladung ändert die Kontakt-E-Mail in den Stammdaten nicht. Sponsoren benötigen ihren Sponsor-Zugang; sie müssen keine eigene Organisation anlegen und werden nicht als Teammitglied eingeladen.",
        keywords: "Altvertrag Bestand einladen Benutzer Konto Registrierung",
      },
      {
        id: "resend-access", question: "Was tun, wenn Einladung oder Aktivierungslink fehlen?",
        answer: "Sponsor-Einladung und Kontoaktivierung sind zwei unterschiedliche Schritte.",
        steps: ["Für eine fehlende Sponsor-Einladung öffnen Sie beim Sponsor «Zugang einrichten», prüfen die Adresse und verwenden «Sponsor-Einladung erneut senden» beim betreffenden Eintrag.", "Für ein bereits angelegtes, aber nicht aktiviertes Konto verwendet der Sponsor auf der Anmeldeseite «Aktivierungslink erneut senden» und danach «Neuen Aktivierungslink senden».", "Der Sponsor öffnet nur die neueste passende E-Mail und setzt sein Passwort, wenn die Seite dazu auffordert. Hinweise zu einer Wartefrist sind zu beachten.", "Prüfen Sie bei ausbleibender Mail Empfängeradresse, Spamordner und gegebenenfalls die Firmenquarantäne. Bei Versandfehlern kontrollieren Sie den angezeigten Status."],
        note: "Ein erfolgreicher Versandstatus belegt noch keine Zustellung ins Postfach. Mit «Passwort vergessen?» auf der Anmeldeseite kann ein bestehender Zugang wiederhergestellt werden.",
        keywords: "Mail Email nicht bestätigt ungültig abgelaufen Login Passwort Recovery",
      },
      {
        id: "space-self-service", question: "Was kann der Sponsor in seinem Space selbst bearbeiten?",
        answer: "Im Sponsor-Space sind Vertragsdokumente sowie die eigenen Kontakt-, Adress- und Logoangaben zugänglich.",
        steps: ["Unter «Dokumente» kann der Sponsor seine bereitgestellten Verträge ansehen und herunterladen.", "Unter «Meine Angaben» kann er Firmenname, Kontaktperson, Kontakt-E-Mail, Telefon und Website ändern und «Kontaktdaten speichern» wählen.", "Die Adresse wird im eigenen Adressformular gespeichert. Im Logobereich kann eine PNG- oder JPEG-Datei bis 2 MB hinterlegt oder ersetzt werden."],
        note: "Die geänderte Kontakt-E-Mail ist keine neue Login-Adresse. Für die Anmeldung bleibt das bisherige Konto massgebend. Bereits unterzeichnete Verträge behalten ihren ursprünglichen Stand.",
        keywords: "Name E-Mail Adresse Telefonnummer Homepage Logo ändern Dokumente PDF",
      },
      {
        id: "wrong-account", question: "Warum wird ein persönlicher Link mit einem anderen Konto abgewiesen?",
        answer: "Ein persönlicher Sponsor-Link gehört zum vorgesehenen Sponsor und benötigt das dafür berechtigte Konto. Ein bereits angemeldeter anderer Sponsor darf dadurch keinen Zugang erhalten.",
        steps: ["Prüfen Sie die auf der Seite angezeigte E-Mail-Adresse.", "Wählen Sie bei einem anderen Konto den angebotenen Kontowechsel beziehungsweise «Abmelden und Link prüfen».", "Melden Sie sich mit der Empfängeradresse der Einladung an und öffnen Sie den vollständigen Link erneut."],
        note: "Bei älteren allgemeinen Space-Links wird zuerst eine bewusste Kontoauswahl verlangt. Bleibt der Zugang gesperrt, prüfen Sie als Administration den Empfänger unter «Zugang einrichten».",
        keywords: "Sicherheit falscher Sponsor Kontowechsel Zugriff verweigert",
      },
    ],
  },
  {
    id: "packages", title: "Pakete & Leistungen", section: "packages", sectionLabel: "Pakete",
    articles: [
      {
        id: "create-package", question: "Wie erstelle und veröffentliche ich ein Sponsoringpaket?",
        answer: "Ein neues Paket startet als bearbeitbarer Entwurf.",
        steps: ["Öffnen Sie «Pakete» → «Neues Paket». Erfassen Sie Name, Beschreibung, Preis, Laufzeit, Zahlungsplan, Sichtbarkeit und gegebenenfalls Gültigkeit oder Kapazität.", "Klicken Sie auf «Paket erstellen» und ergänzen Sie über «Leistung hinzufügen» die enthaltenen Rechte und Leistungen.", "Prüfen Sie Mengen, Termine, Verantwortlichkeiten und allfällige Exklusivitäten. Speichern Sie jede Leistung sowie Änderungen an der Version.", "Klicken Sie nach der Prüfung auf «Version veröffentlichen». Die Ausgabe kann anschliessend für Verträge verwendet werden."],
        note: "Für ein öffentliches Dossier muss die Sichtbarkeit «Für Sponsoren sichtbar» sein. Der Online-Direktabschluss benötigt zusätzlich eine eigene Freigabe.",
      },
      {
        id: "package-versions", question: "Wann verwende ich «Paket duplizieren» oder «Neue Version erstellen»?",
        answer: "«Paket duplizieren» erzeugt ein eigenständiges Angebot. «Neue Version erstellen» entwickelt ein bestehendes Paket weiter.",
        steps: ["Wählen Sie das Paket und unter «Paketausgabe» die gewünschte Ausgangsversion.", "Verwenden Sie «Paket duplizieren» für ein neues Angebot oder «Neue Version erstellen» für eine Folgeversion.", "Bearbeiten und speichern Sie den neuen Entwurf, prüfen Sie die Leistungen und veröffentlichen Sie die neue Ausgabe."],
        note: "Veröffentlichte Ausgaben werden nicht direkt bearbeitet. Bestehende Vertragsstände werden durch die Paketpflege nicht nachträglich umgeschrieben.",
      },
      {
        id: "package-rights", question: "Wie ändere oder entferne ich eine Leistung?",
        answer: "Leistungen bearbeiten Sie in einer Paketversion mit Status «Entwurf».",
        steps: ["Erstellen Sie bei einem bereits veröffentlichten Paket zuerst eine neue Version.", "Wählen Sie unter «Rechte und Leistungen» bei der gewünschten Leistung «Bearbeiten».", "Passen Sie Menge, Beschreibung oder weitere Angaben an und klicken Sie auf «Leistung speichern».", "Zum Entfernen wählen Sie «Leistung entfernen» und bestätigen «Endgültig entfernen»."],
        note: "Kapazität und Exklusivität begrenzen die Vergabe. Verwenden Sie für denselben exklusiven Bereich einen einheitlichen Exklusivitäts-Schlüssel.",
      },
      {
        id: "discard-package", question: "Wie entferne ich einen irrtümlich angelegten Paketentwurf?",
        answer: "Ein unbenutzter Versionsentwurf kann verworfen werden.",
        steps: ["Wählen Sie die Ausgabe mit Status «Entwurf» und klicken Sie auf «Entwurf verwerfen».", "Lesen Sie die Rückfrage und bestätigen Sie nur den tatsächlich unerwünschten Entwurf mit «Endgültig verwerfen»."],
        note: "Bei der einzigen Version wird auch das noch unveröffentlichte Paket entfernt. Frühere veröffentlichte Ausgaben und bestehende Verträge bleiben erhalten. Bei bestehenden Verknüpfungen kann die Anwendung das Verwerfen ablehnen.",
        keywords: "löschen entfernen",
      },
    ],
  },
  {
    id: "dossier", title: "Dossier & Onlineabschluss", section: "dossier", sectionLabel: "Dossier",
    articles: [
      {
        id: "dossier-pdf", question: "Wie erstelle ich das Sponsoringdossier als PDF?",
        answer: "Das Dossier verbindet das Klubprofil mit den aktuell gültigen, veröffentlichten und öffentlich sichtbaren Paketen.",
        steps: ["Öffnen Sie «Dossier» und ergänzen Sie Titel, Einleitung, Klubporträt und Wirkung des Sponsorings. Saison und Reichweite können Sie zusätzlich erfassen.", "Klicken Sie auf «Klubprofil speichern». Kontakt, Logo und Farben pflegen Sie zentral unter «Organisation».", "Kontrollieren Sie die angezeigten offenen Angaben und die im Dossier aufgeführten Pakete.", "Wenn der Status «Bereit» erscheint, wählen Sie «Dossier als PDF erstellen»."],
        note: "Fehlt ein Paket, prüfen Sie dessen Veröffentlichung, Sichtbarkeit und Gültigkeitszeitraum unter «Pakete».",
      },
      {
        id: "online-checkout", question: "Wie können Sponsoren ein Paket über unseren Vereinslink abschliessen?",
        answer: "Für den Onlineabschluss wird jede angebotene Paketversion ausdrücklich freigegeben.",
        steps: ["Öffnen Sie unter «Pakete» eine veröffentlichte Ausgabe mit Sichtbarkeit «Für Sponsoren sichtbar».", "Prüfen Sie im Bereich «Online-Direktabschluss» Preis, Laufzeit und Leistungen. Setzen Sie die Bestätigung und wählen Sie «Für Online-Abschluss freigeben».", "Öffnen Sie «Dossier» und verwenden Sie im Bereich «Vereinslink» die Aktion «Link kopieren» oder «Öffnen».", "Interessierte wählen dort ihr Paket und geben ihre Daten ein. Die Kontaktperson gilt als unterzeichnende Person, sofern keine andere angegeben wird.", "Verfolgen Sie den erzeugten Vertrag unter «Verträge»; dort ist er als Online-Direktabschluss gekennzeichnet."],
        note: "«Online-Abschluss deaktivieren» nimmt diese Ausgabe aus dem Onlineangebot. Es hebt vorhandene Verträge nicht auf.",
        keywords: "öffentlich Website Buchung Partnerschaft Akquise Anmeldung",
      },
    ],
  },
  {
    id: "contracts", title: "Verträge", section: "contracts", sectionLabel: "Verträge",
    articles: [
      {
        id: "legacy-list", question: "Wie übernehme ich mehrere bestehende Verträge aus einer Liste?",
        answer: "Unter «Verträge» können Sie «Mehrere Altverträge aus einer Liste übernehmen» öffnen. Die Übernahme ordnet ausschliesslich bereits vorhandene Sponsoren und Pakete zu und versendet keine E-Mails.",
        steps: ["Bereiten Sie eine CSV- oder Excel-Datei mit einer Zuordnung pro Zeile vor: Sponsor, Paket, Jahreswert CHF, Abschlussdatum, Unterzeichnende Person, Nachweis.", "Verwenden Sie eindeutige bestehende Sponsor- und Paketnamen sowie Abschlussdaten im Format JJJJ-MM-TT. Fehlende Daten oder unterzeichnende Personen bleiben leer und werden als unbekannt dokumentiert.", "Prüfen Sie die Vorschau, die Jahreswerte und die Nachweise. Interne Paketentwürfe können für Altbestand verwendet werden.", "Bestätigen Sie die geprüften Angaben und wählen Sie «Geprüfte Altverträge übernehmen». Identische vorhandene Zuordnungen werden übersprungen. Bei einem abweichenden bestehenden Vertrag stoppt die Übernahme zur Prüfung."],
        note: "Dieser Weg dokumentiert bestehende Abschlüsse. Er ersetzt weder einen neuen Vertragsabschluss noch eine fehlende Zustimmung. Auch bei der Einzelerfassung lassen sich unbekannte Abschlussdaten und unterzeichnende Personen ausdrücklich kennzeichnen.",
      },

      {
        id: "contract-create", question: "Wie erstelle ich einen Vertrag aus Sponsor und Paket?",
        answer: "Der Sponsor muss erfasst und eine passende Paketversion veröffentlicht sein.",
        steps: ["Öffnen Sie «Verträge» und wählen Sie unter «Sponsor und Paket verbinden» den Sponsor und das Sponsoringpaket.", "Prüfen Sie den vorgeschlagenen Jahreswert, passen Sie ihn bei Bedarf an und wählen Sie «Entwurf erstellen».", "Ergänzen Sie Dokumenttitel und besondere Vereinbarungen. Speichern Sie den Entwurf und prüfen Sie ihn über «PDF öffnen».", "Vervollständigen Sie offene Organisationsangaben. Bestätigen Sie die Prüfung und wählen Sie «Unveränderlich freigeben»."],
        note: "Die Freigabe fixiert den Vertragsstand. Der Versand zur Bestätigung erfolgt als eigener Schritt.",
      },
      {
        id: "contract-send", question: "Wie lasse ich einen freigegebenen Vertrag bestätigen?",
        answer: "Nach der Freigabe kann der Vertrag an die unterzeichnende Person versendet werden.",
        steps: ["Öffnen Sie den Vertrag und den Abschnitt «Vertrag zur Bestätigung senden».", "Prüfen Sie E-Mail-Adresse, Name und gegebenenfalls Funktion der unterzeichnenden Person.", "Klicken Sie auf «Zur Bestätigung senden». Die Anwendung wählt je nach vorhandenem Konto den passenden Zugangsweg.", "Prüfen Sie danach den Vertragsstatus und das Ereignisprotokoll. Bei Bedarf verwenden Sie «Erneut zur Bestätigung senden»."],
        note: "«Freigegeben» beziehungsweise «versendet» bedeutet noch nicht «bestätigt». Erst der abgeschlossene Bestätigungsvorgang weist den Abschluss nach.",
      },
      {
        id: "legacy-contract", question: "Wie übernehme ich einen bestehenden Papier- oder Altvertrag?",
        answer: "Ein bereits abgeschlossener Vertrag kann als Altbestand dokumentiert werden, ohne eine neue Bestätigungsmail auszulösen.",
        steps: ["Öffnen Sie unter «Verträge» den Bereich «Altvertrag für einen Sponsor erfassen».", "Wählen Sie Sponsor, Paket und Jahreswert. Für Altbestand sind auch interne Paketentwürfe möglich. Ergänzen Sie Abschlussdatum und unterzeichnende Person oder kennzeichnen Sie fehlende Angaben als unbekannt. Halten Sie den Nachweis fest.", "Gleichen Sie die Angaben mit dem vorhandenen Vertrag ab, setzen Sie die Bestätigung und klicken Sie auf «Altvertrag direkt übernehmen».", "Richten Sie einen benötigten Sponsor-Space separat unter «Sponsoren» → «Zugang einrichten» ein."],
        note: "Diese Erfassung dokumentiert einen vorhandenen Abschluss. Sie ersetzt keine fehlende Zustimmung und lädt keine gescannte Vertragsdatei hoch.",
        keywords: "Altbestand importieren Papiervertrag",
      },
      {
        id: "contract-copy", question: "Wo finde ich die Vertragskopie und den Nachweis der Bestätigung?",
        answer: "Öffnen Sie den gewünschten Vertrag im Vertragscenter. Dort finden Sie PDF, Status, Bestätigungsangaben und Ereignisprotokoll.",
        steps: ["Klicken Sie auf «PDF öffnen», um das Dokument anzusehen oder herunterzuladen.", "Prüfen Sie unter dem Bestätigungsnachweis die unterzeichnende Person und den Zeitpunkt.", "Bei bestätigten Verträgen mit digitaler Unterzeichnungsanfrage können Sie unter «Zugang und Vertragskopie» eine «PDF-Kopie senden» oder den «Zugang einrichten»."],
        note: "Bei einem übernommenen Altvertrag fehlt dieser digitale Folgebereich gegebenenfalls. Den Space-Zugang richten Sie dann direkt beim Sponsor ein.",
      },
      {
        id: "contract-correction", question: "Wie korrigiere ich einen bereits freigegebenen oder bestätigten Vertrag?",
        answer: "Die Korrektur erfolgt über einen neuen Entwurf, damit der bisherige Stand nachvollziehbar bleibt.",
        steps: ["Öffnen Sie den Vertrag und tragen Sie unter «Neue Vertragsversion erstellen» den «Grund der Korrektur» ein.", "Klicken Sie auf «Korrekturentwurf erstellen» und bearbeiten Sie die übernommenen Angaben.", "Speichern und prüfen Sie den Entwurf. Geben Sie ihn erst frei, wenn die Korrektur vollständig ist.", "Senden Sie die neue Version anschliessend zur Bestätigung."],
        note: "Mit der Freigabe der Korrekturversion wird der vorherige Vertragsstand automatisch aufgehoben. Das blosse Anlegen des Korrekturentwurfs hebt ihn noch nicht auf.",
      },
      {
        id: "contract-remove", question: "Wie lösche ich einen Entwurf oder hebe einen Vertrag auf?",
        answer: "Entwürfe und bereits freigegebene Verträge werden unterschiedlich behandelt.",
        steps: ["Öffnen Sie den Vertrag und gehen Sie zum Abschnitt «Entfernen».", "Tragen Sie eine Begründung ein und prüfen Sie die angebotene Aktion.", "Ein Entwurf kann mit «Entwurf endgültig löschen» entfernt werden. Bei einem freigegebenen oder bestätigten Vertrag verwenden Sie «Vertrag nachvollziehbar aufheben».", "Aufgehobene Verträge finden Sie unter «Archivierte Verträge»."],
        note: "Beim endgültigen Löschen eines Entwurfs wird auch dessen Entwurfsprotokoll entfernt. Ein aufgehobener Vertrag bleibt dagegen mit Grund und Zeitpunkt dokumentiert.",
        keywords: "stornieren Archiv",
      },
    ],
  },
  {
    id: "events", title: "Events & Matchbälle", section: "events", sectionLabel: "Events",
    articles: [
      {
        id: "event-create", question: "Wie erfasse ich ein Spiel und mache es öffentlich buchbar?",
        answer: "Unter «Events» verwalten Sie das Matchball-Sponsoring. Öffentlich sichtbar sind veröffentlichte Spiele bei aktiviertem Formular.",
        steps: ["Erfassen Sie unter «Spiel erfassen» Mannschaft, Gegner, Datum und Anpfiff, Spielort sowie Preis und optionalen Zuschlag für die FN-Verdankung.", "Bei einer noch offenen Anspielzeit setzen Sie den entsprechenden Hinweis. Wählen Sie bei Bedarf «Spiel direkt öffentlich anbieten» und speichern Sie mit «Spiel erfassen».", "Ein Owner pflegt unter «Öffentliche Seite» die Texte, aktiviert «Öffentliches Formular aktivieren» und speichert die Einstellungen.", "Teilen Sie den Link aus «Link für Interessierte». Über «Formular öffnen» können Sie die öffentliche Ansicht prüfen."],
        note: "Einzelne Spiele lassen sich in der Spielübersicht «Veröffentlichen» oder «Ausblenden».",
      },
      {
        id: "matchball-booking", question: "Wie kommen direkte Matchball-Buchungen ins Adminpanel?",
        answer: "Interessierte verwenden den öffentlichen Matchball-Link ohne Konto. Pro Spiel sind mehrere Sponsoren möglich.",
        steps: ["Kopieren Sie unter «Events» den öffentlichen Link und geben Sie ihn den Interessierten weiter.", "Nach der Buchung finden Sie die Zuordnung am betreffenden Spiel mit Sponsor, Referenz, Betrag, Kontaktdaten und Zahlungsart.", "Prüfen Sie die Liste vor dem Spiel und verwenden Sie bei einer irrtümlichen Zuordnung «Entfernen»."],
        note: "Eine gewählte Zahlungsart dokumentiert weder eine erfolgte Zahlung noch den Versand einer Rechnung.",
      },
      {
        id: "matchball-allocation", question: "Wie ordne ich einen im Paket enthaltenen Matchball zu?",
        answer: "Paketleistungen werden einem Spiel zugeordnet und gegen das verfügbare Saisonkontingent gezählt.",
        steps: ["Prüfen Sie, dass dem Sponsor ein passendes Paket zugeordnet ist oder ein freigegebener beziehungsweise bestätigter Vertrag mit diesem Paket vorliegt.", "Öffnen Sie unter «Events» beim gewünschten Spiel «Sponsorenleistung zuordnen».", "Wählen Sie unter «Sponsor und Matchball-Kontingent» eine verfügbare Leistung, ergänzen Sie bei Bedarf eine Bemerkung und klicken Sie auf «Paketleistung einsetzen».", "Kontrollieren Sie die Zuordnung am Spiel. Eine falsche Zuordnung können Sie über «Entfernen» zurücknehmen."],
        note: "Fehlt eine Leistung, prüfen Sie Paketzuordnung, Sponsorstatus und Leistungsbezeichnung: Name oder Beschreibung muss «Matchball» enthalten. Ausgeschöpfte oder am selben Spiel bereits zugeordnete Leistungen sind nicht erneut auswählbar.",
        keywords: "Kontingent Saison enthalten reservieren",
      },
      {
        id: "matchinfo", question: "Wie erstelle ich die Matchinfo für den Spieltag?",
        answer: "Das Matchinfo-PDF enthält die Spielangaben und zugeordneten Sponsoren im Vereinsauftritt.",
        steps: ["Öffnen Sie beim Spiel «Matchinfo bearbeiten».", "Ergänzen Sie Trainer, Schiedsrichter, Matchcenter- beziehungsweise Aufstellungs-URL und gegebenenfalls einen Speaker-Hinweis.", "Klicken Sie auf «Matchinfo speichern» und öffnen Sie danach «Matchinfo PDF»."],
        note: "Logo und Farben stammen aus «Organisation». Prüfen Sie die Sponsorenzuordnungen vor der Ausgabe.",
      },
    ],
  },
  {
    id: "imports", title: "Datenübernahme", section: "imports", sectionLabel: "Datenübernahme", permission: "sponsors:write",
    articles: [
      {
        id: "import-sponsors", question: "Wie übernehme ich eine Excel- oder CSV-Sponsorenliste?",
        answer: "Der Import wird zuerst vorbereitet und geprüft. Erst der letzte Schritt legt die Sponsoren an.",
        steps: ["Öffnen Sie «Datenübernahme» und wählen Sie eine XLSX- oder UTF-8-CSV-Datei bis 2 MB und maximal 1’000 Zeilen. Wählen Sie bei mehreren Tabellenblättern das passende Blatt.", "Vergeben Sie eine Bezeichnung und klicken Sie auf «Import vorbereiten».", "Ordnen Sie unter «Spalten zuordnen» die passenden Dateispalten zu und klicken Sie auf «Zuordnung prüfen».", "Ordnen Sie vorhandene Paketbezeichnungen veröffentlichten Paketen zu oder wählen Sie bewusst «Nur als Text übernehmen». Bestätigen Sie die Paketzuordnung.", "Prüfen Sie Vorschau, Fehler und mögliche Dubletten. Sobald alle Zeilen gültig und die Zuordnungen bestätigt sind, klicken Sie auf «Sponsoren übernehmen» mit der angezeigten Anzahl."],
        note: "Ohne eigenen Jahreswert wird bei einer Paketzuordnung der Paketpreis verwendet. Ein Datenimport allein ist noch keine Vertragsunterzeichnung. Den Übernahmestatus sehen Sie unter «Bisherige Importe».",
        keywords: "XLSX CSV Excel Import Migration Liste Upload",
      },
      {
        id: "remove-demo", question: "Wie entferne ich die Beispiel-Sponsoren vor dem Echtimport?",
        answer: "Owner können die beim Anlegen der Organisation erzeugten Beispieldaten gezielt entfernen.",
        steps: ["Öffnen Sie «Datenübernahme». Wenn Beispiel-Sponsoren vorhanden sind, erscheint der Bereich «Vor dem Echtimport».", "Wählen Sie «Beispieldaten löschen» und tragen Sie den angezeigten Organisationsnamen zur Bestätigung ein.", "Prüfen Sie die Anzahl und bestätigen Sie das endgültige Löschen der Beispieldaten."],
        note: "Diese Aktion betrifft ausschliesslich die Onboarding-Beispiele, nicht eigene oder importierte Sponsoren.",
      },
    ],
  },
  {
    id: "transitions", title: "Überführung", section: "transitions", sectionLabel: "Überführung",
    articles: [
      {
        id: "transition-prepare", question: "Wie bereite ich den Wechsel in eine neue Paketwelt vor?",
        answer: "Eine Überführungskampagne hält die Ausgangslage fest und ermöglicht persönliche Vorschläge für bestehende Sponsorings.",
        steps: ["Prüfen Sie zuerst Sponsoren, bisherige Pakete und Beträge. Legen Sie die neuen Zielpakete unter «Pakete» an und veröffentlichen Sie sie.", "Öffnen Sie «Überführung» → «Neue Kampagne». Erfassen Sie Name, Zielperiode und gegebenenfalls Antwortfrist; klicken Sie auf «Ausgangslage übernehmen».", "Ordnen Sie unter «Paket-Mapping» jeder bisherigen Paketgruppe ein veröffentlichtes Zielpaket zu und wählen Sie «Mapping speichern».", "Öffnen Sie unter «Vorschläge und Ausnahmen» die einzelnen Sponsoren über «Bearbeiten». Prüfen Sie Vorschlag, Bearbeitungsstatus und gegebenenfalls die interne Begründung; klicken Sie auf «Vorschlag speichern»."],
        note: "Die beim Anlegen übernommene Ausgangslage bleibt erhalten. Normale neue Verträge können Sie unabhängig davon direkt im Vertragscenter erstellen.",
        keywords: "Fusion Migration Mapping Paketwechsel",
      },
      {
        id: "transition-send", question: "Wie versende ich Überführungsvorschläge und verfolge die Antworten?",
        answer: "Vor dem Versand müssen die internen Prüfungen abgeschlossen sein.",
        steps: ["Prüfen Sie offene Vorschläge, Ausnahmen, Empfängeradressen und die Verknüpfung mit veröffentlichten Paketen.", "Setzen Sie die Kampagne auf «Versandbereit». Die Anwendung weist auf noch fehlende Voraussetzungen hin.", "Kontrollieren Sie die angezeigte Anzahl, wählen Sie «Einladungen versenden» und bestätigen Sie den Versand.", "Verfolgen Sie in der Kampagne Status und Antworten der Sponsoren. Rückfragen und Ablehnungen bearbeiten Sie individuell.", "Für eine bestätigte Überführung ohne Vertrag erstellen Sie im Vertragscenter unter «Aus Überführung» einen Entwurf und führen den Vertragsablauf fort."],
        note: "Eine bestätigte Überführung und ein bestätigter Vertrag sind getrennte Schritte. Prüfen Sie nach dem Versand auch die Zahl der fehlgeschlagenen Einladungen.",
      },
    ],
  },
  {
    id: "team", title: "Team & Berechtigungen", section: "team", sectionLabel: "Team", permission: "members:manage",
    articles: [
      {
        id: "team-invite", question: "Wie lade ich jemanden zur Mitarbeit im Verein ein?",
        answer: "Teamzugänge sind für Personen gedacht, die den Verein verwalten. Die Teamverwaltung steht Ownern zur Verfügung.",
        steps: ["Öffnen Sie «Team» und tragen Sie unter «Einladung senden» die E-Mail-Adresse ein.", "Wählen Sie die passende Rolle anhand der Rollenübersicht und klicken Sie auf «Einladung versenden».", "Prüfen Sie unter «Offene Einladungen» den Status. Bei Bedarf können Sie die Einladung «Erneut senden».", "Nach Annahme erscheint die Person unter «Mitglieder»."],
        note: "Für einen Sponsor verwenden Sie stattdessen «Sponsoren» → «Zugang einrichten». Eine Teamrolle gewährt Verwaltungsrechte für den Verein.",
      },
      {
        id: "team-roles", question: "Wie ändere ich eine Rolle und warum fehlen einzelne Aktionen?",
        answer: "Die Rolle bestimmt die verfügbaren Aktionen. Owner verwalten Organisation und Team; Sponsoring-Admins pflegen Sponsoren, Pakete, Verträge und Events. Die Rolle «Sponsoringleistungen» kann Events bearbeiten, «Lesen» keine Daten verändern.",
        steps: ["Als Owner öffnen Sie «Team» und wählen unter «Mitglieder» bei der betreffenden Person die neue Rolle.", "Klicken Sie daneben auf «Speichern».", "Die eigenen Berechtigungen können alle Teammitglieder unter «Übersicht» nachsehen. Lassen Sie fehlende Rechte vom Owner des ausgewählten Vereins prüfen."],
        note: "Die Rolle «Finanzen» ist für Finanzaufgaben vorgesehen; eine vollständige Rechnungs- und Zahlungsverwaltung ist noch im Ausbau. Rollen gelten je Organisation.",
        keywords: "Zugriffsrechte Berechtigung gesperrt deaktiviert Benutzer Verwaltung",
      },
    ],
  },
  {
    id: "settings", title: "Organisation & Auftritt", section: "settings", sectionLabel: "Organisation",
    articles: [
      {
        id: "organization-details", question: "Wo pflege ich Vereinsname, Kontakt und rechtliche Angaben?",
        answer: "Owner pflegen diese Angaben zentral unter «Organisation».",
        steps: ["Passen Sie Anzeigename und Organisationstyp an und klicken Sie auf «Name und Typ speichern».", "Ergänzen Sie unter «Öffentlicher Kontakt» Kontaktperson beziehungsweise Team, E-Mail, Telefon und Website.", "Prüfen Sie unter «Rechtliche Angaben» Rechtsträger, Adresse, vertretungsberechtigte Person und Funktion sowie Verlängerungsregel und gegebenenfalls Gerichtsstand.", "Klicken Sie auf «Organisationsprofil speichern» und prüfen Sie die Bereitschaftsanzeige für Dossier und Verträge."],
        note: "Der technische Kurzname bleibt stabil. Freigegebene Vertragsdokumente behalten die zum Freigabezeitpunkt übernommenen Angaben.",
      },
      {
        id: "organization-brand", question: "Wie ändere ich Vereinslogo und Farben?",
        answer: "Der Vereinsauftritt wird für Dossier, Dokumente und öffentliche Sponsoringseiten zentral gepflegt.",
        steps: ["Öffnen Sie «Organisation» → «Logo und Dossierfarben».", "Wählen Sie eine PNG- oder JPEG-Datei bis 2 MB. Transparente PNGs sind möglich.", "Prüfen Sie die vorgeschlagenen Primär- und Akzentfarben und passen Sie sie bei Bedarf an.", "Speichern Sie ein neues Logo mit «Logo und Farben speichern». Reine Farbänderungen speichern Sie über «Organisationsprofil speichern»."],
        note: "Das Vereinslogo ist vom Logo eines Sponsors getrennt. Sponsorlogos verwalten Sie in der Sponsorenliste oder im Sponsor-Space.",
        keywords: "Branding Erscheinungsbild Clublogo Farbe",
      },
    ],
  },
];

export function normalizeHelpQuery(value: string) {
  return value.toLocaleLowerCase("de-CH").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").trim();
}

export function filterHelpTopics(query: string, topicId = "all") {
  const words = normalizeHelpQuery(query).split(/\s+/).filter(Boolean);
  return workspaceHelpTopics.filter((topic) => topicId === "all" || topic.id === topicId).map((topic) => ({
    ...topic,
    articles: topic.articles.filter((article) => {
      const text = normalizeHelpQuery([topic.title, article.question, article.answer, ...(article.steps ?? []), article.note, article.keywords].filter(Boolean).join(" "));
      return words.every((word) => text.includes(word));
    }),
  })).filter((topic) => topic.articles.length > 0);
}
