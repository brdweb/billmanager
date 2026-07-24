import type { ReleaseNote } from './releaseNotes';

export const germanReleaseNotes: ReleaseNote[] = [
  {
    version: '4.4.1',
    date: '2026-07-19',
    title: 'Abhängigkeits- und Toolchain-Wartung',
    sections: [
      {
        heading: 'Verbesserungen',
        items: [
          'Die Laufzeit-, Navigations-, Formular-, Symbol-, Lokalisierungs- und Build-Pakete von Expo SDK 57 entsprechen jetzt den validierten Versionen für interne iOS- und Android-Builds',
          'Compiler-, Lint-, Symbol- und Lokalisierungsabhängigkeiten der Webanwendung wurden aktualisiert und GitHub Actions verwendet jetzt die aktuelle Node-Einrichtungsaktion',
        ],
      },
      {
        heading: 'Backend-Zuverlässigkeit',
        items: [
          'Die Resend- und Stripe-SDKs wurden für zusätzliche API-Funktionen, korrigierte Antwort- und Fehlerbehandlung sowie eine geringere Startlatenz des Stripe-Clients aktualisiert',
          'Die Abhängigkeitsprüfungen fanden keine bekannten Schwachstellen; für diese Wartungsversion ist keine Datenbank- oder API-Migration erforderlich',
        ],
      },
    ],
  },
  {
    version: '4.4.0',
    date: '2026-07-16',
    title: 'Sicheres Löschen und zuverlässiges Self-Hosting',
    sections: [
      {
        heading: 'Hinweis für Administratoren',
        items: [
          'Beim ersten Start nach dem Upgrade ersetzt die PostgreSQL-Migration 20260716_01 drei Fremdschlüssel und kann Schreibzugriffe kurz blockieren, während vorhandene Zeilen geprüft werden; verwenden Sie ein reguläres Wartungsfenster und starten Sie bei mehreren Replikaten zunächst nur eine Anwendungsinstanz',
          'Es sind weder manuelle SQL-Befehle noch eine Datenkonvertierung erforderlich; die Migration gleicht das Löschen von Rechnungsfreigaben, Kategoriebudgets und registrierten Geräten an das von BillManager vorgesehene Schema an',
        ],
      },
      {
        heading: 'Sicherheit und Datenintegrität',
        items: [
          'Das vollständige Löschen eines Kontos umfasst jetzt verschachtelte verwaltete Nutzer und deren Rechnungsgruppen, beendet aktive Stripe-Abonnements zuerst und bewahrt lokale Daten, wenn Stripe die Kündigung nicht bestätigen kann',
          'Beim Löschen von Nutzern, Rechnungen und Rechnungsgruppen werden abhängige Authentifizierungs-, Freigabe-, Eigentums- und Prüfdatensätze bereinigt, ohne weiter abrechenbare Abonnements oder Fremdschlüsselfehler zu hinterlassen',
        ],
      },
      {
        heading: 'Verbesserungen für Self-Hosting',
        items: [
          'Archivierte Rechnungen sind wieder erreichbar, der Zugriff auf geteilte Rechnungen funktioniert außerhalb des SaaS-Modus und die Erinnerungsleiste ist vollständig übersetzt',
          'Die vollständige Backend-Testsuite läuft jetzt unabhängig im Self-Hosted- und SaaS-Modus, um installationsspezifische Regressionen zu erkennen',
        ],
      },
    ],
  },
  {
    version: '4.3.3',
    date: '2026-07-15',
    title: 'BillManager Mobile Alpha-1',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'BillManager Mobile ist jetzt als 1.0.0-alpha.1 (Alpha-1) für interne iOS- und Android-Tests markiert – mit nativer Navigation, verschlüsselten Offline-Daten, lokalen Erinnerungen, Biometrie, Passkeys und Widgets',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Mobile Einstellungen und Versionsdetails zeigen den Alpha-1-Meilenstein an, während generierte native Builds die store-kompatible Version 1.0.0 beibehalten',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Einmalige Rechnungen enden jetzt nach ihrem geplanten Auftreten in mobilen Erinnerungen, Kalender, Analysen und der optimistischen Zahlungsbehandlung',
          'Einladungen zu geteilten Rechnungen zeigen jetzt die kanonischen Angaben zu Eigentümer und Empfänger an und bleiben zu älteren Servern kompatibel',
        ],
      },
    ],
  },
  {
    version: '4.3.2',
    date: '2026-07-15',
    title: 'Sicherheits- und Datenintegritätsabdeckung',
    sections: [
      {
        heading: 'Sicherheit',
        items: [
          'Neue Regressionstests stellen sicher, dass Rechnungsverschiebungen, Budgetänderungen und Zahlungsänderungen keine Rechnungsgruppen-Grenzen überschreiten können',
        ],
      },
      {
        heading: 'Datenintegrität',
        items: [
          'Neue Regressionstests für die Offline-Synchronisierung weisen gruppenübergreifende Änderungen zurück und bewahren neuere Serverdaten bei veralteten Clients',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Die v2-Verwaltung von Rechnungsgruppen wurde angeglichen, einschließlich der Zugriffsauflistung vor dem Löschen und Kontozugriffskontrollen',
        ],
      },
    ],
  },
  {
    version: '4.3.1',
    date: '2026-07-15',
    title: 'Einheitliche Einstellungen und Lokalisierungsfehlerbehebungen',
    sections: [
      {
        heading: 'Verbesserungen',
        items: [
          'Kontoeinstellungen und Verwaltung befinden sich jetzt in einem gemeinsamen ganzseitigen Arbeitsbereich; reguläre Nutzer sehen die Einstellungen, während Administratoren zusätzlich auf die Tabs Nutzer und Rechnungsgruppen zugreifen können',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Bei der Auswahl von Englisch wird jetzt USD und bei der Auswahl von Deutsch EUR verwendet, auch wenn eine gespeicherte Spracheinstellung nach dem Neuladen wiederhergestellt wird',
          'Beim Löschen einer Rechnungsgruppe können die betroffenen Nutzer vor der Bestätigung wieder über den v2-Datenbankzugriffs-Endpunkt aufgelistet werden',
        ],
      },
    ],
  },
  {
    version: '4.3.0',
    date: '2026-07-10',
    title: 'Internationalisierung und Flexibilität für Self-Hosting',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Wählen Sie in den Einstellungen Englisch oder Deutsch; Oberflächentexte, Datumsangaben, Exporte und Druckausgaben folgen der gewählten Sprache',
          'Selbst gehostete Installationen können DEFAULT_CURRENCY und DEFAULT_LOCALE setzen, um Beträge für ihre Region zu formatieren',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Erinnerungen befinden sich jetzt unten rechts und werden ausgeblendet, solange ihre Seitenschublade geöffnet ist',
          'Web- und Mobile-Bibliotheken, Python-Werkzeuge sowie die unterstützten Node.js- und PostgreSQL-Laufzeiten wurden aktualisiert',
        ],
      },
    ],
  },
  {
    version: '4.2.2',
    date: '2026-07-08',
    title: 'Analyse-Arbeitsbereich und Leistungsupdate',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Analysebereiche können jetzt eingeklappt und neu angeordnet werden; das Layout wird pro Nutzer gespeichert',
          'Die Cashflow-Prognose befindet sich jetzt zusammen mit den anderen Planungsansichten im Analysebereich',
          'Erinnerungen erscheinen jetzt als schwebendes Glockensymbol und werden in einer Seitenschublade geöffnet',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Kategorieausgaben werden jetzt als gestapelte Balken- und Flächendiagramme statt als Budgetkarten dargestellt',
          'Das Web-Bundle ist nach Routen, Modalfenstern und Anbieterbereichen aufgeteilt, um die Warnung zu großen Bundles zu beseitigen und das anfängliche App-Bundle zu verkleinern',
          'Mantine, Recharts, Python-Abhängigkeiten, PostgreSQL-Standards und die Python-Produktionslaufzeit wurden aktualisiert',
        ],
      },
    ],
  },
  {
    version: '4.2.1',
    date: '2026-07-08',
    title: 'Bessere Lesbarkeit von Erinnerungen im Dunkelmodus',
    sections: [
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Erinnerungskarten verwenden jetzt designsensitive Flächen, damit Rechnungsnamen im Dunkelmodus lesbar bleiben',
          'Karten für überfällige Rechnungen verwenden dieselbe für den Dunkelmodus geeignete Darstellung',
        ],
      },
    ],
  },
  {
    version: '4.2.0',
    date: '2026-07-08',
    title: 'Anbieterneutraler E-Mail-Versand',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Selbst gehostete Installationen können Nachrichten zu Passwortzurücksetzung, Bestätigung, Einladungen, geteilten Rechnungen und E-Mail-OTP per SMTP senden',
          'Der E-Mail-Versand kann jetzt mit EMAIL_PROVIDER=smtp, resend oder none ausgewählt werden',
          'Die SMTP-Konfiguration unterstützt Host, Port, STARTTLS, SSL, optionale Authentifizierung, Zeitüberschreitung, Absender und App-URL',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Bestehende Resend-Konfigurationen funktionieren für gehostete und vorhandene Bereitstellungen weiterhin',
          'Admin-Oberfläche, Docker Compose, Umgebungsbeispiele und README beschreiben jetzt den allgemeinen E-Mail-Versand statt nur Resend',
          'Die Dokumentation für selbst gehostete Installationen stellt klar, dass BillManager keinen produktionsreifen SMTP-Server mitliefert und ein E-Mail-Anbieter oder vorhandenes Relay verwendet werden sollte',
        ],
      },
    ],
  },
  {
    version: '4.1.1',
    date: '2026-07-08',
    title: 'Selbst gehostete OIDC-Anbieter',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Generische OIDC-Anmeldung für selbst gehostete Anbieter wie Authelia, Authentik, Keycloak und andere OpenID-Connect-Identitätsanbieter',
          'Konfigurierbare Client-Authentifizierung am Token-Endpunkt mit client_secret_post, client_secret_basic, none oder auto',
          'Konfigurierbare Zuordnung von OIDC-Claims für E-Mail-Adresse, Benutzername und Anzeigename',
        ],
      },
      {
        heading: 'Sicherheit',
        items: [
          'Der OIDC-Autorisierungscode-Ablauf verwendet PKCE, Nonce-Validierung, signierten State, JWKS-ID-Token-Prüfung und Schutz vor State-Wiederverwendung',
          'Die Anmeldung mit verknüpften Konten ordnet bestehende Nutzer sicher anhand des Anbieter-Subjekts oder einer bestätigten E-Mail-Adresse zu',
          'Für vertrauenswürdige selbst gehostete Anbieter ohne email_verified-Claim kann die E-Mail-Bestätigung optional übersprungen werden',
        ],
      },
    ],
  },
  {
    version: '4.1.0',
    date: '2026-06-08',
    title: 'Planung, Budgets und Abrechnungen geteilter Rechnungen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Kategoriebudgets mit monatlichen Limits, Fortschrittsanzeige und Hinweisen bei Budgetüberschreitung im Analysebereich',
          'Cashflow-Prognose mit Startguthaben, Zeiträumen von 30, 60 oder 90 Tagen, prognostizierten Salden und anstehenden Geldbewegungen',
          'Abrechnungsseite für geteilte Rechnungen mit Forderungen, Verbindlichkeiten, Nettosalden pro Person und zuletzt beglichenen Anteilen',
          'Erinnerungseinstellungen pro Rechnung für anstehende, heute fällige, eingehende und überfällige Zahlungen',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Rechnungen unterstützen jetzt Kategorien und Notizen beim Erstellen, Bearbeiten, Filtern, Exportieren und Synchronisieren',
          'Verbindlichkeiten aus geteilten Rechnungen fließen in Cashflow-Prognosen ein, damit anteilige Ausgaben vor der Zahlung sichtbar sind',
          'Erinnerungen im Dashboard berücksichtigen jetzt die für jede Rechnung festgelegten Zeitfenster',
        ],
      },
    ],
  },
  {
    version: '4.0.2',
    date: '2026-03-30',
    title: 'Sicherheitshärtung und stabile Veröffentlichungen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Social Login (OIDC) – Anmeldung mit Google, Apple, Microsoft oder einem beliebigen OIDC-Anbieter',
          'Microsoft-Anmeldung mit mandantenübergreifender Azure-AD-Unterstützung',
          'Generische OIDC-/SSO-Integration für selbst gehostete Bereitstellungen wie Keycloak, Authentik oder Okta',
          'Konfigurierbare Claim-Zuordnung für benutzerdefinierte OIDC-Anbieter',
          'Zwei-Faktor-Authentifizierung mit E-Mail-OTP und Passkey-Unterstützung (WebAuthn)',
          'Wiederherstellungscodes als 2FA-Ausweichmöglichkeit',
          'Verwaltung verknüpfter Konten zum Verbinden und Trennen von OAuth-Anbietern',
          'Sicherheitseinstellungen zur Verwaltung von 2FA und Passkeys',
        ],
      },
      {
        heading: 'Sicherheit',
        items: [
          'Prüfung der ID-Token-Signatur für unterstützte Social-Login-Anbieter',
          'Kryptografisch sichere OTP-Erzeugung',
          'Schutz vor Wiederverwendung von OAuth-State-Tokens',
          'Brute-Force-Schutz bei der 2FA-Verifizierung',
          'Normalisierung von E-Mail-Adressen für eine konsistente Kontoverknüpfung',
        ],
      },
    ],
  },
  {
    version: '3.8.1',
    date: '2026-02-09',
    title: 'Überarbeitetes Dashboard und neue Analysen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Neues Dashboard mit Statistik-Karten, anstehenden Rechnungen und letzten Zahlungen',
          'Neue Kalenderseite mit Mehrmonatsansicht und Markierungen für Fälligkeitstermine',
          'Neue Analyseseite mit Ausgabentrends, Kontoaufschlüsselung, Jahresvergleich und Jahresübersicht',
          'Anklickbare Statistik-Karten im Dashboard öffnen die entsprechend gefilterte Rechnungsansicht',
          'Ein Filterhinweis auf der Rechnungsseite zeigt aktive Filter mit einer Schaltfläche zum Zurücksetzen',
          'Der Zahlungsverlauf ist jetzt ein eigener Eintrag in der Seitennavigation',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Ein Klick auf den Seitenleistenkalender öffnet die nach dem gewählten Datum gefilterte Rechnungsseite',
          'Filter für anstehende Rechnungen in der Seitenleiste öffnen die Rechnungsseite',
          'Die Seite „Alle Zahlungen“ verwendet standardmäßig die letzten 30 Tage',
          'Die Statistik-Karte für die Monatssumme zeigt bezahlte und verbleibende Beträge',
          'Karten der Jahresübersicht zeigen beschriftete Summen für Ausgaben, Einzahlungen und Netto',
          'Versions- und Lizenzangaben sind am unteren Rand der Seitenleiste fixiert',
          'Der Hilfe-Link ist auf jeder Seite in der Fußzeile der Seitenleiste sichtbar',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Das Bearbeiten von Zahlungen auf der Seite „Alle Zahlungen“ speichert Änderungen jetzt korrekt',
          'Nach dem Löschen von Zahlungen auf der Seite „Alle Zahlungen“ wird die Liste jetzt aktualisiert',
          'Der zu helle Hintergrund der Jahresübersicht im Dunkelmodus wurde korrigiert',
          'Abgeschnittener Text der Schaltfläche „Heute“ auf der Kalenderseite wurde korrigiert',
        ],
      },
    ],
  },
  {
    version: '3.7.0',
    date: '2026-01-19',
    title: 'Ansicht für alle Rechnungsgruppen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Alle Rechnungsgruppen in einer Ansicht anzeigen und verwalten',
          'Beim Anzeigen aller Rechnungsgruppen können neue Rechnungen einer Gruppe zugewiesen werden',
          'Bestehende Rechnungen können beim Bearbeiten zwischen Gruppen verschoben werden',
          'Monatsstatistiken werden über alle zugänglichen Datenbanken zusammengefasst',
          'Die mobile App unterstützt die Ansicht aller Rechnungsgruppen einschließlich Gruppenauswahl vollständig',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Im Dialog zum Bearbeiten von Nutzern werden Rechnungsgruppen jetzt korrekt vorausgewählt',
          'Die Datenbankauswahl wird unmittelbar nach einer Änderung der Nutzerberechtigungen aktualisiert',
        ],
      },
    ],
  },
  {
    version: '3.6.1',
    date: '2026-01-15',
    title: 'Sicherheitshärtung',
    sections: [
      {
        heading: 'Sicherheit',
        items: [
          'Die Offenlegung von Ausnahmeinformationen in API-Antworten wurde verhindert',
          'Abhängigkeiten wurden zur Behebung von Sicherheitslücken aktualisiert',
          'Die Eingabevalidierung an API-Endpunkten wurde verbessert',
        ],
      },
      {
        heading: 'Fehlerbehebungen',
        items: [
          'Probleme mit der Testdatenbank-Konfiguration in CI wurden behoben',
          'TypeScript-Fehler im API-Client wurden behoben',
        ],
      },
    ],
  },
  {
    version: '3.6.0',
    date: '2026-01-10',
    title: 'Geteilte Rechnungen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Rechnungen für geteilte Ausgaben mit anderen Nutzern teilen',
          'Aufteilung nach Prozentsatz, festem Betrag oder zu gleichen Teilen konfigurieren',
          'Nachverfolgen, wann Beteiligte ihren Anteil als bezahlt markieren',
          'Zahlungen von Beteiligten erscheinen als Einnahmen in den Trends',
          'Ausstehende Einladungen zu geteilten Rechnungen können angenommen oder abgelehnt werden',
        ],
      },
      {
        heading: 'Verbesserungen',
        items: [
          'Erweiterter Zahlungsverlauf mit Markierungen für geteilte Zahlungen',
          'Neuer Bereich für geteilte Rechnungen in der mobilen App',
        ],
      },
    ],
  },
  {
    version: '3.5.0',
    date: '2025-12-20',
    title: 'Mobile App und Push-Benachrichtigungen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Native mobile App für Android; iOS folgt in Kürze',
          'Push-Benachrichtigungen für Rechnungserinnerungen',
          'Offline-Synchronisierung mit Konfliktauflösung',
          'Geräteverwaltung in den Kontoeinstellungen',
        ],
      },
      {
        heading: 'API',
        items: [
          'Neue JWT-basierte API v2 für mobile Apps',
          'Delta-Synchronisierungsendpunkt für effiziente Datenübertragung',
          'Geräteregistrierung für Push-Benachrichtigungen',
        ],
      },
    ],
  },
  {
    version: '3.4.0',
    date: '2025-12-01',
    title: 'Nutzereinladungen',
    sections: [
      {
        heading: 'Neue Funktionen',
        items: [
          'Nutzereinladungen per E-Mail',
          'Nutzer mit vorkonfiguriertem Zugriff auf Rechnungsgruppen einladen',
          'Eingeladene Nutzer legen bei der ersten Anmeldung ein eigenes Passwort fest',
          'Ausstehende Einladungen im Admin-Bereich verwalten',
        ],
      },
    ],
  },
];

export default germanReleaseNotes;
