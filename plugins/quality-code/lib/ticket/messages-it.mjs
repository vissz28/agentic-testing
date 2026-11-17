// Italian text for ticket authors: messages.mjs and jira.mjs pick it when the config's first language is "it".

export function defaults(labels, pre, config) {
  return {
    ac_present: {
      title: 'Criteri di accettazione',
      missing: 'Non abbiamo trovato i criteri di accettazione.',
      add: [
        'Puoi copiare questo esempio e adattarlo al tuo caso. Vanno bene entrambi i formati. Un breve elenco sotto il titolo "Criteri di accettazione", un risultato per riga:',
        '',
        '## Criteri di accettazione',
        '- Dopo il salvataggio, l\'elenco mostra il nuovo elemento con il suo nome e la data di oggi, e il contatore sopra l\'elenco aumenta di uno.',
        '',
        'Oppure Dato / Quando / Allora, ciascuno all\'inizio della riga:',
        '',
        'Dato un elenco vuoto',
        'Quando salvo un nuovo elemento',
        'Allora l\'elenco mostra una riga con quell\'elemento',
      ].join('\n'),
      question: 'Cosa deve essere vero quando questo è fatto? Frasi semplici (almeno 150 caratteri), oppure Dato / Quando / Allora.',
      example: 'Dopo il salvataggio, l\'elenco mostra il nuovo elemento con il suo nome e la data di oggi, e il contatore sopra l\'elenco aumenta di uno. Il resto dell\'elenco non cambia.',
      label: 'criteri di accettazione (Dato / Quando / Allora, o un elenco sotto il titolo Criteri di accettazione)',
    },
    ac_testable: {
      title: 'Criteri di accettazione: risultati precisi',
      missing: 'Un criterio di accettazione non indica un risultato concreto.',
      add: [
        'Evita "funziona" o "come previsto". Basta un numero o il testo esatto sullo schermo, per esempio:',
        '',
        '- L\'elenco mostra esattamente 5 righe',
        'Allora il messaggio è "Nessun elemento trovato"',
      ].join('\n'),
      question: 'Un criterio di accettazione è vago. Riscrivilo con qualcosa che un test può vedere (un\'etichetta, un numero di righe, un messaggio), almeno 150 caratteri, oppure come Dato / Quando / Allora.',
      example: 'L\'elenco mostra esattamente 5 righe dopo il filtro per codice 22, una per ogni elemento trovato, e il contatore sopra l\'elenco indica 5 risultati. Le righe con codice 220 non sono mostrate.',
      label: 'criteri di accettazione verificabili: ogni Allora o criterio è un risultato visibile, non "funziona correttamente"',
    },
    feature_label: {
      title: 'Etichetta della funzionalità',
      missing: 'Il ticket non ha un\'etichetta di funzionalità, quindi non sappiamo quale schermata aprire.',
      add: labels.length
        ? ['Aggiungi una di queste etichette esistenti (non crearne una nuova):', labels.join(', ')].join('\n')
        : 'Aggiungi un\'etichetta di funzionalità che esiste già (non crearne una nuova).',
      question: labels.length ? `Quale schermata è? Una tra: ${labels.join(', ')}` : 'Quale schermata è?',
      example: labels[0] ?? '',
      label: 'un\'etichetta di funzionalità tra quelle configurate',
    },
    qa_plan_found: {
      title: 'Piano QA',
      missing: 'Non c\'è un piano QA per questa funzionalità.',
      label: 'un piano QA per la funzionalità',
    },
    steps: {
      title: 'Passi per riprodurre',
      missing: 'Manca la sezione Passi per riprodurre (o la storia utente).',
      add: [
        'Basta un breve elenco numerato. Puoi adattare questo:',
        '',
        '## Passi per riprodurre',
        '1. Apri l\'elenco',
        '2. Filtra per codice 22',
        '3. Guarda le righe restituite',
      ].join('\n'),
      question: 'Come si riproduce? Un passo per riga.',
      example: 'Apri l\'elenco\nFiltra per un codice che non esiste\nGuarda l\'elenco vuoto',
      label: 'passi per riprodurre (Bug) o una storia utente (Story)',
    },
    expected_defined: {
      title: 'Risultato atteso ed effettivo',
      missing: 'Risultato atteso e Risultato effettivo non sono compilati entrambi.',
      add: [
        'Aggiungi entrambe le sezioni, per esempio:',
        '',
        '## Risultato atteso',
        'Viene mostrato solo il codice 22',
        '',
        '## Risultato effettivo',
        'Viene mostrato anche il codice 220',
      ].join('\n'),
      question: 'Cosa dovresti vedere, e cosa vedi adesso? Scrivi: atteso | effettivo',
      example: 'Viene mostrato il messaggio "Nessun elemento trovato" | L\'elenco è vuoto',
      label: 'comportamento atteso chiaro (Risultato atteso ed effettivo, o criteri di accettazione presenti)',
    },
    context: {
      title: 'Sommario',
      missing: 'Manca la sezione Sommario o Contesto.',
      add: [
        'Bastano un paio di frasi, per esempio:',
        '',
        '## Sommario',
        'Quando il filtro è vuoto, l\'elenco mantiene le righe precedenti invece di svuotarsi.',
      ].join('\n'),
      question: 'In una o due frasi, cosa non va?',
      example: 'Quando il filtro è vuoto, l\'elenco mantiene le righe precedenti invece di svuotarsi.',
      label: 'una sezione Contesto / Sommario',
    },
    title_prefix: {
      title: 'Prefisso del titolo',
      missing: pre.length
        ? `Il titolo non inizia con ${pre.join(', ')}.`
        : 'Il titolo non inizia con un prefisso.',
      add: pre.length ? `Fai iniziare il titolo con uno tra ${pre.join(', ')}.` : 'Fai iniziare il titolo con un prefisso.',
      question: pre.length ? `Quale prefisso va bene? Scrivi uno tra ${(config.titlePrefixes || []).join(', ')}.` : 'Quale prefisso va bene?',
      example: (config.titlePrefixes || [])[0] ?? '',
      label: 'un prefisso nel titolo',
    },
    attachments: {
      title: 'Allegato',
      missing: 'Non c\'è un allegato (screenshot, video o file) sul ticket.',
      add: 'Allega uno screenshot, un video o un file che mostri il problema o il design, direttamente sul ticket Jira.',
      question: 'Allega uno screenshot, un video o un file sul ticket Jira (il pulsante Allega, o trascinalo sul ticket). Quando c\'è, rispondi: fatto',
      example: 'fatto',
      label: 'un allegato (uno screenshot, un video o un file sul ticket)',
    },
    links: {
      title: 'Link',
      missing: 'Non c\'è un link sul ticket (nessun ticket collegato e nessun link web).',
      add: 'Aggiungi un link: un ticket collegato, o un link web al design (Figma), alla specifica (Confluence) o alla pagina.',
      question: 'Incolla un indirizzo web utile: il design Figma, la pagina Confluence o la pagina di cui si parla.',
      example: 'https://www.figma.com/design/abc123/Orders',
      label: 'un link (un ticket collegato, o un link web come Figma o Confluence)',
    },
    environment: {
      title: 'Ambiente',
      missing: 'Manca la sezione Ambiente con Env: …',
      add: [
        'Indica quale ambiente hai usato (prod, staging o local):',
        '',
        '## Ambiente',
        'Env: staging',
      ].join('\n'),
      question: 'Quale ambiente hai usato (prod, staging o local)?',
      example: 'staging',
      label: 'contesto dell\'ambiente',
    },
  }
}

export const STORY = {
  steps: {
    title: 'Storia utente',
    missing: 'Manca la riga della storia utente.',
    add: [
      'Basta una riga. Puoi adattare questa:',
      '',
      '## Storia utente',
      'Come utente, voglio filtrare l\'elenco per periodo così da trovare subito il mese scorso.',
    ].join('\n'),
    question: 'Chi vuole cosa, e perché? Una riga.',
    example: 'Come utente, voglio filtrare l\'elenco per periodo così da trovare subito il mese scorso.',
  },
  context: {
    title: 'Contesto',
    missing: 'Manca la sezione Contesto.',
    add: [
      'Bastano due o tre frasi, per esempio:',
      '',
      '## Contesto',
      'Per trovare un elemento nell\'elenco bisogna scorrere tutta la pagina. Un filtro per codice lo eviterebbe.',
    ].join('\n'),
    question: 'In due o tre frasi, perché serve?',
    example: 'Per trovare un elemento nell\'elenco bisogna scorrere tutta la pagina.',
  },
}

// The wording around the blocks of a Jira comment.
export const COMMENT = {
  hello: 'Ciao, a questo ticket servono ancora alcune informazioni prima di poter iniziare i controlli.',
  whatToAdd: 'Ecco cosa aggiungere:',
  footer: 'Grazie, possiamo continuare appena queste informazioni sono sul ticket.',
  template: (kind, path) => `Il template completo ${kind === 'bug' ? 'Bug' : 'Story'} si trova in ${path}.`,
  fallback: 'Aggiungi Passi per riprodurre, Risultato atteso, Risultato effettivo e Dato / Quando / Allora.',
  fillMark: '_Aggiunto durante il controllo di prontezza di quality-code._',
  risk: (score, threshold) => `Per questo ticket sono stati scritti dei test anche se non è completo: ha ${score} punti e ne servono ${threshold}.`,
  riskWarning: '🔴 [RISCHIO / SCONSIGLIATO] I test verificano quello che il ticket dice oggi. Finché non vengono aggiunte le parti mancanti, potrebbero verificare la cosa sbagliata.',
  stillMissing: 'Manca ancora:',
  riskFooter: 'Registrato da quality-code: i test sono stati scritti su un ticket incompleto.',
}
