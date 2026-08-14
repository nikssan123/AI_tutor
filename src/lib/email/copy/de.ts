import type { EmailStrings } from "./en";

/**
 * German. Machine-assisted draft, not yet read by a native speaker —
 * HUMAN-REVIEW.md carries the open item.
 *
 * "Sie" throughout. A German learning product could defensibly use "du", but
 * the choice has to be made once and kept: mixing the two inside a thread is
 * the tell that copy was written by four different people, and half of these
 * messages are security mail where sounding institutional is a feature.
 */
export const de: EmailStrings = {
  brand: "MeritKeep",

  paste: "Oder fügen Sie diesen Link in Ihren Browser ein:",

  codeLabel: "Ihr Code",

  system: {
    verifyCode: {
      subject: "Ihr Bestätigungscode · {brand}",
      heading: "Bestätigen Sie Ihre E-Mail-Adresse",
      body: [
        "Geben Sie diesen Code auf der Seite ein, die Sie geöffnet gelassen haben, um diese Adresse zu bestätigen.",
        "Er gilt {duration} und nur ein einziges Mal.",
      ],
      footer:
        "Sie haben das nicht angefordert? Ignorieren Sie es. Ohne diesen Code kann niemand etwas mit Ihrer Adresse anfangen.",
    },

    verifyEmail: {
      subject: "Bestätigen Sie Ihre E-Mail-Adresse · {brand}",
      heading: "Bestätigen Sie Ihre E-Mail-Adresse",
      body: [
        "Bestätigen Sie diese Adresse, damit wir Ihnen ein neues Passwort schicken können, falls Sie es einmal brauchen.",
        "Der Link gilt {duration}.",
      ],
      action: "Diese Adresse bestätigen",
      footer:
        "Falls Sie dieses Konto nicht erstellt haben, ignorieren Sie diese E-Mail — es passiert nichts, solange der Link nicht benutzt wird.",
    },

    resetPassword: {
      subject: "Passwort zurücksetzen · {brand}",
      heading: "Passwort zurücksetzen",
      body: [
        "Jemand hat für dieses Konto ein neues Passwort angefordert. Wenn Sie das waren, legen Sie hier eines fest.",
        "Der Link gilt {duration} und kann nur einmal verwendet werden.",
      ],
      action: "Neues Passwort festlegen",
      footer:
        "Sie haben das nicht angefordert? Ignorieren Sie es. Ihr Passwort wurde nicht geändert, und wer die Anfrage gestellt hat, kann diese E-Mail nicht sehen.",
    },

    changeEmail: {
      subject: "Bestätigen Sie Ihre neue E-Mail-Adresse · {brand}",
      heading: "Bestätigen Sie Ihre neue E-Mail-Adresse",
      body: [
        "Sie haben darum gebeten, die E-Mail-Adresse dieses Kontos von {oldEmail} auf {newEmail} zu ändern.",
        "Es ändert sich nichts, bis Sie es von dieser Adresse aus bestätigen. Der Link gilt {duration}.",
      ],
      action: "Änderung bestätigen",
      footer:
        "Sie haben das nicht angefordert? Benutzen Sie den Link nicht und ändern Sie Ihr Passwort. Möglicherweise ist jemand anderes in Ihrem Konto angemeldet.",
    },
  },

  operator: {
    welcome: {
      subject: "Willkommen bei {brand}, {name}",
      heading: "Willkommen bei {brand}",
      body: [
        "Hallo {name} — danke für Ihre Anmeldung.",
        "{brand} beruht auf einer Idee: Anerkennung gibt es nicht dafür, eine Lektion angesehen zu haben, sondern für Arbeit, die einer Bewertung standhält. Am schnellsten finden Sie also heraus, ob es zu Ihnen passt, indem Sie etwas abgeben.",
        "Wenn etwas unklar ist oder nicht das tut, was Sie erwartet haben, antworten Sie einfach auf diese E-Mail. Sie kommt direkt bei mir an.",
      ],
      action: "Dort weitermachen, wo Sie aufgehört haben",
      signature: "— {sender}",
      footer:
        "Sie erhalten diese E-Mail, weil Sie ein {brand}-Konto angelegt haben. Antworten Sie jederzeit.",
    },

    checkIn: {
      subject: "Wie läuft es mit {goal}?",
      heading: "Wie läuft es?",
      body: [
        "Hallo {name} — Sie wollten an {goal} arbeiten, und es ist eine Weile still geblieben.",
        "Das ist kein Vorwurf: Mich interessiert wirklich, ob etwas dazwischengekommen ist oder ob der Plan, den wir gebaut haben, schlicht nicht der richtige war. Beide Antworten helfen, und die zweite ist ein Fehler, den ich beheben kann.",
      ],
      action: "Sehen, wie weit Sie gekommen sind",
      signature: "— {sender}",
      footer:
        "Sie erhalten diese E-Mail, weil Sie bei {brand} ein aktives Ziel haben. Antworten Sie, dass Sie das nicht möchten, und ich schreibe nicht wieder.",
    },

    packReady: {
      subject: "{topic} ist bei {brand} verfügbar",
      heading: "{topic} ist fertig",
      body: [
        "Hallo {name} — Sie hatten nach {topic} gefragt, und es ist jetzt fertig: eine Kompetenzkarte, bewertete Arbeit und ein Plan, der sich daran anpasst, was Sie bereits zeigen können.",
        "Es beginnt mit einer kurzen Einstufung statt mit Lektion eins, damit Sie alles überspringen, was Sie schon können.",
      ],
      action: "{topic} beginnen",
      signature: "— {sender}",
      footer:
        "Sie erhalten diese E-Mail, weil Sie nach diesem Thema gefragt haben.",
    },

    reply: {
      subject: "Re: {subject}",
      heading: "",
      body: ["Hallo {name},", "{message}"],
      signature: "— {sender}, {brand}",
      footer:
        "Antworten Sie einfach auf diese E-Mail — sie landet direkt bei uns.",
    },

    resolved: {
      subject: "Re: {subject}",
      heading: "",
      body: [
        "Hallo {name},",
        "{message}",
        "Von unserer Seite betrachte ich die Sache damit als erledigt — falls doch nicht, antworten Sie einfach und sie wird wieder geöffnet.",
      ],
      signature: "— {sender}, {brand}",
      footer:
        "Antworten Sie einfach auf diese E-Mail — sie landet direkt bei uns.",
    },
  },
};
