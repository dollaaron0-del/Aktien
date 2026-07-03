#!/usr/bin/env node
// Test-Harness für die reinen Funktionen aus docs/app.js (KONZEPT-Abschnitt "Tests").
// Deckt die zwei im KONZEPT genannten Bausteine ab:
//   1. Teil A — die normTopic-Matching-Leiter (Erhalt von Fortschritt über Umbenennungen).
//   2. Teil B — den Ausdrucks-Evaluator (Arithmetik, deutsche Zahlen, Toleranz).
//
// Die Funktionen werden ZUR LAUFZEIT aus docs/app.js extrahiert (kein Copy-Paste),
// damit der Test nicht von der Quelle driften kann. app.js bleibt einzige Wahrheit.
// Läuft ohne Abhängigkeiten:  node scripts/test-pure.js   (oder: npm test)

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'docs', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

// ── Extraktion ──────────────────────────────────────────────────────────────
// Top-Level-Funktionsdeklaration `function NAME(...) { ... }` per Klammer-Matching.
function extractFn(name) {
  const m = src.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error(`Funktion ${name} nicht in app.js gefunden`);
  let i = src.indexOf('{', m.index);
  if (i < 0) throw new Error(`Kein Body für ${name}`);
  let depth = 0;
  // Klammern NUR im Code zählen – Kommentare und String-Literale (die '{' oder
  // '}' enthalten dürfen, z. B. `// schließende "}"`) überspringen, sonst kappt
  // der Matcher den Body zu früh oder zu spät.
  let mode = 'code'; // code | line | block | sq | dq | tpl
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (mode === 'line')  { if (c === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; j++; } continue; }
    if (mode === 'sq' || mode === 'dq' || mode === 'tpl') {
      if (c === '\\') { j++; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; j++; continue; }
    if (c === '/' && n === '*') { mode = 'block'; j++; continue; }
    if (c === "'") { mode = 'sq'; continue; }
    if (c === '"') { mode = 'dq'; continue; }
    if (c === '`') { mode = 'tpl'; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error(`Body für ${name} nicht geschlossen`);
}
// Einzeilige `const NAME = ...;`-Deklaration (z. B. isTopicUid).
function extractConst(name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=[^\\n]*;'));
  if (!m) throw new Error(`const ${name} nicht in app.js gefunden`);
  return m[0];
}

const FN_DECLS = [
  'normTopic', 'jaccardTokens', 'parseNum', 'evalExpr', 'numEqual', 'numericCheck', 'applyNumericVerdict',
  'newTopicUid', 'topicId', 'topicKey', 'resolveKey', 'topicMaxLevel',
  'dedupeTopicUids', 'reconcileTopicUids', 'ensureTopicUids', 'scanDiff', 'repairOrphanedProgress', 'retainLearnedTopics',
  'scanDirectiveBlock', 'mergeCoverageAdditions',
  'md', 'renderTable',
  'inkBoundingBox', 'enhanceInkContrast', 'catmullRomPts',
  'repairJson', 'repairUnescapedQuotes', 'parseJsonLoose', 'parseJsonResponse', 'salvageTruncatedJson',
];
const CONST_DECLS = ['isTopicUid', 'formatScanDiff', 'EMBED_MATCH_THRESHOLD', 'DIFF_IDX', 'diffIdx', 'INK_CELL', 'INK_MIN_PIXELS', 'INK_WHITE_CUTOFF', 'INK_GAMMA', 'SPLINE_SEG'];

const assembled = [
  ...CONST_DECLS.map(extractConst),
  ...FN_DECLS.map(extractFn),
].join('\n\n');

// In einen Scope hängen, der die Modul-globalen Bindings (topicUids, self/crypto,
// pathTopics) bereitstellt — genau die, auf die die extrahierten Funktionen zugreifen.
const factory = new Function('self', 'katex', `
  let topicUids = {};
  let learnedTopics = [];
  let topicMeta = {};
  let moduleStructure = null;
  let __path = [];
  function pathTopics() { return moduleStructure?.kapitel?.length ? moduleStructure.kapitel.flatMap(k => k.themen) : __path; }
  ${assembled}
  return {
    normTopic, jaccardTokens, parseNum, evalExpr, numEqual, numericCheck, applyNumericVerdict, isTopicUid,
    newTopicUid, topicId, topicKey, resolveKey, topicMaxLevel,
    dedupeTopicUids, reconcileTopicUids, ensureTopicUids, scanDiff, formatScanDiff, repairOrphanedProgress, retainLearnedTopics,
    scanDirectiveBlock, mergeCoverageAdditions,
    md, renderTable,
    inkBoundingBox, enhanceInkContrast, catmullRomPts,
    repairJson, repairUnescapedQuotes, parseJsonLoose, parseJsonResponse, salvageTruncatedJson,
    _setUids: m => { topicUids = m; },
    _getUids: () => topicUids,
    _setPath: p => { __path = p; },
    _setLearned: l => { learnedTopics = l; },
    _getLearned: () => learnedTopics,
    _setStruct: s => { moduleStructure = s; },
    _getStruct: () => moduleStructure,
    _setMeta: m => { topicMeta = m; },
    _getMeta: () => topicMeta,
  };
`);
// katex-Stub: markiert, dass eine Formel an KaTeX ging (display-Flag im Marker).
const katexStub = { renderToString: (latex, opts) => `⟦KTX d=${opts.displayMode ? 1 : 0}:${latex}⟧` };
const M = factory({ crypto: require('crypto').webcrypto }, katexStub);

// ── Mini-Test-Runner ─────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(Object.is(a, b) || a === b, `${msg}  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`); }
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-6, `${msg}  (erwartet ≈${b}, war ${a})`); }
function group(name, fn) { console.log('• ' + name); fn(); }

// ── Teil A: normTopic-Matching-Leiter ─────────────────────────────────────────
group('normTopic — Normalisierung', () => {
  eq(M.normTopic('Die Lichtreaktion'), 'lichtreaktion', 'führender Artikel entfernt');
  eq(M.normTopic('LICHTREAKTION!'), 'lichtreaktion', 'lowercase + Satzzeichen weg');
  eq(M.normTopic('  Lichtreaktion  '), 'lichtreaktion', 'getrimmt');
  eq(M.normTopic('Energieübertragung'), 'energieubertragung', 'Umlaut → ASCII');
  eq(M.normTopic('Lineare   Algebra'), 'lineare algebra', 'Mehrfach-Whitespace kollabiert');
  // Re-Scan-Stabilität: Schreibvarianten kollabieren auf denselben Schlüssel.
  eq(M.normTopic('Die Photosynthese'), M.normTopic('photosynthese'), 'Artikel-Variante == Basis');
});

group('jaccardTokens — Rename-Ähnlichkeit', () => {
  approx(M.jaccardTokens('lineare algebra grundlagen', 'lineare algebra'), 2 / 3, '2/3 Überlappung');
  eq(M.jaccardTokens('foo', 'bar'), 0, 'keine Überlappung → 0');
  eq(M.jaccardTokens('', 'x'), 0, 'leer → 0');
  eq(M.jaccardTokens('a b', 'a b'), 1, 'identisch → 1');
});

group('topicId / topicKey / resolveKey — Fallback & Auflösung', () => {
  M._setUids({});
  eq(M.topicId('Die Lichtreaktion'), 'lichtreaktion', 'ohne UID: Fallback auf normName (v155)');
  eq(M.topicKey('Die Lichtreaktion', 'mittel'), 'lichtreaktion::mittel', 'Key = normName::diff');

  M._setUids({ lichtreaktion: 't_abc123' });
  eq(M.topicId('Lichtreaktion!'), 't_abc123', 'mit UID: stabile ID');
  eq(M.topicKey('Lichtreaktion', 'schwer'), 't_abc123::schwer', 'Key = uid::diff');
  // Alt-Eintrag (Name::diff) UND ID-Eintrag lösen auf dieselbe ID auf → #2/#6:
  eq(M.resolveKey('Lichtreaktion::mittel'), 't_abc123::mittel', 'Legacy-Key → uid');
  eq(M.resolveKey('t_abc123::mittel'), 't_abc123::mittel', 'ID-Key bleibt');
  eq(M.resolveKey('Lichtreaktion'), 't_abc123::einsteiger', 'Key ohne diff → einsteiger');
});

group('reconcileTopicUids — Erhalt über Re-Scan (#7)', () => {
  // 1) exakt/normalisiert: gleicher (umbenannter mit Artikel) Name behält UID.
  M._setUids({ photosynthese: 't_p1' });
  M.reconcileTopicUids(['Photosynthese'], ['Die Photosynthese']);
  eq(M.topicId('Die Photosynthese'), 't_p1', 'Artikel-Rename behält UID (normalisiert-Treffer)');

  // 2) Ähnlichkeit ≥ 0.6: Teil-Rename matcht das alte Thema.
  M._setUids({ 'lineare algebra grundlagen': 't_la' });
  M.reconcileTopicUids(['Lineare Algebra Grundlagen'], ['Lineare Algebra']);
  eq(M.topicId('Lineare Algebra'), 't_la', 'ähnlicher Name (≥0.6) erbt UID');

  // 3) kein Match: echtes neues Thema bekommt frische, eigene UID.
  M._setUids({ photosynthese: 't_p1' });
  M.reconcileTopicUids(['Photosynthese'], ['Quantenmechanik']);
  const fresh = M.topicId('Quantenmechanik');
  ok(M.isTopicUid(fresh) && fresh !== 't_p1', 'fremdes Thema → neue, eigene UID');

  // 4) Mehrere neue Themen konkurrieren nicht um dieselbe alte UID (used-Set).
  M._setUids({ 'lineare algebra grundlagen': 't_la' });
  M.reconcileTopicUids(['Lineare Algebra Grundlagen'], ['Lineare Algebra', 'Lineare Algebra Vertiefung']);
  ok(M.topicId('Lineare Algebra') !== M.topicId('Lineare Algebra Vertiefung'), 'zwei neue Themen → verschiedene UIDs');

  // 5) Gesenkte Schwelle (0.4): Überlappung zwischen 0.4 und 0.6 erbt jetzt die UID.
  M._setUids({ 'alpha delta': 't_ad' });
  M.reconcileTopicUids(['Alpha Delta'], ['Alpha Beta Gamma Delta']);  // Jaccard 0.5, kein Teilstring
  eq(M.topicId('Alpha Beta Gamma Delta'), 't_ad', 'Jaccard 0.5 (≥0.4) erbt UID');

  // 6) Containment-Bonus: umformuliertes Thema mit wenig Token-Overlap, aber Teilstring.
  M._setUids({ regression: 't_reg' });
  M.reconcileTopicUids(['Regression'], ['Lineare Regression Analyse']);  // Jaccard 1/3 <0.4, aber enthält "regression"
  eq(M.topicId('Lineare Regression Analyse'), 't_reg', 'Containment erbt UID trotz Jaccard <0.4');
});

group('reconcileTopicUids — semantisches (Embedding-)Matching (v216)', () => {
  // Fake-sim simuliert die Embedding-Cosine-Funktion: Token-Jaccard wäre hier 0 (kein
  // gemeinsames Token, kein Teilstring) → Token-Matching würde den Fortschritt verlieren.
  const sim = (a, b) => {
    const m = {
      'binomialverteilung definition|wahrscheinlichkeitsberechnung binomial': 0.86,
    };
    return m[`${a}|${b}`] ?? m[`${b}|${a}`] ?? 0.1;
  };
  // Über Schwelle (0.86 ≥ 0.75): erbt UID trotz 0 Token-Overlap.
  M._setUids({ 'binomialverteilung definition': 't_bv' });
  M.reconcileTopicUids(['Binomialverteilung Definition'], ['Wahrscheinlichkeitsberechnung Binomial'], sim);
  eq(M.topicId('Wahrscheinlichkeitsberechnung Binomial'), 't_bv', 'Cosine ≥0.75 erbt UID (semantisch)');

  // Unter Schwelle (0.1 < 0.75): echtes neues Thema → frische UID, kein False-Merge.
  M._setUids({ 'binomialverteilung definition': 't_bv' });
  M.reconcileTopicUids(['Binomialverteilung Definition'], ['Lineare Optimierung'], sim);
  const fresh = M.topicId('Lineare Optimierung');
  ok(M.isTopicUid(fresh) && fresh !== 't_bv', 'Cosine <0.75 → neue UID (kein semantischer False-Merge)');
});

group('repairOrphanedProgress — verwaisten Fortschritt zurück-verknüpfen (v214)', () => {
  // Zustand NACH einem alten Re-Scan (Schwelle 0.6): zwei Themen wurden umbenannt und
  // bekamen eine NEUE Live-UID, der Fortschritt hängt aber noch an der ALTEN (verwaisten)
  // UID. Ein drittes Thema ist unverändert (Fortschritt auf Live-UID), ein viertes neu.
  M._setUids({
    'bayes theorem': 't_aa1',                  // alt (verwaist)
    'bayes theorem im detail': 't_bb2',        // aktuell (live) – Containment
    'hypothesentest fehler': 't_cc3',          // alt (verwaist)
    'fehler hypothesentest alpha beta': 't_dd4', // aktuell (live) – Jaccard 0.5
    'zufallsvariable': 't_ee5',                // unverändert (live)
    'bootstrap verfahren': 't_ff6',            // brandneu (live)
  });
  M._setPath(['Das Bayes-Theorem im Detail', 'Fehler Hypothesentest Alpha Beta', 'Zufallsvariable', 'Bootstrap Verfahren']);
  M._setLearned(['t_aa1::pruefungsnah', 't_cc3::pruefungsnah', 't_ee5::pruefungsnah']);
  M._setMeta({ 't_aa1::pruefungsnah': { ts: 1, attempts: 2 }, 't_cc3::pruefungsnah': { ts: 2, attempts: 1 } });

  const r = M.repairOrphanedProgress();
  eq(r.healed, 2, '2 verwaiste Themen geheilt');

  const learned = M._getLearned();
  ok(learned.includes('t_bb2::pruefungsnah'), 'Bayes-Fortschritt auf Live-UID umgehängt (Containment)');
  ok(learned.includes('t_dd4::pruefungsnah'), 'Hypothesentest-Fortschritt auf Live-UID umgehängt (Jaccard 0.5)');
  ok(learned.includes('t_ee5::pruefungsnah'), 'unveränderter Live-Fortschritt bleibt');
  ok(!learned.some(k => k.startsWith('t_aa1') || k.startsWith('t_cc3')), 'verwaiste UIDs sind raus');
  ok(M._getMeta()['t_bb2::pruefungsnah'] && M._getMeta()['t_dd4::pruefungsnah'], 'topicMeta mit umgehängt');

  // Server-Sync: alte Keys zum Löschen, neue zum Posten gemeldet.
  ok(r.removed.includes('t_aa1::pruefungsnah') && r.removed.includes('t_cc3::pruefungsnah'), 'removed = verwaiste Keys');
  ok(r.added.includes('t_bb2::pruefungsnah')   && r.added.includes('t_dd4::pruefungsnah'),   'added = neue Live-Keys');

  // Idempotent: zweiter Lauf findet keine Waisen mehr.
  eq(M.repairOrphanedProgress().healed, 0, 'zweiter Lauf heilt nichts mehr');

  // Kein False-Heal: ein wirklich fremder Fortschritt (kein ähnliches Live-Thema) bleibt verwaist.
  M._setUids({ 'integralrechnung': 't_int', 'bootstrap verfahren': 't_ff6' });
  M._setPath(['Bootstrap Verfahren']);
  M._setLearned(['t_int::mittel']);
  M._setMeta({});
  eq(M.repairOrphanedProgress().healed, 0, 'fremdes Thema (kein Match ≥0.4) wird NICHT geheilt');
  ok(M._getLearned().includes('t_int::mittel'), 'fremder Fortschritt bleibt unangetastet');
});

group('repairOrphanedProgress — semantisches Heilen + Score-Greedy (v216)', () => {
  // Verwaister Fortschritt, dessen alter Name token-fremd zum aktuellen Thema ist
  // (Jaccard 0, kein Teilstring) → nur Embedding-Cosine kann ihn heilen.
  const sim = (a, b) => {
    const m = {
      'normalverteilung standardnormalverteilung|normalverteilung eigenschaften': 0.84,
    };
    return m[`${a}|${b}`] ?? m[`${b}|${a}`] ?? 0.1;
  };
  M._setUids({
    'normalverteilung standardnormalverteilung': 't_aaa',   // verwaist
    'normalverteilung eigenschaften': 't_bbb',              // aktuell
  });
  M._setPath(['Normalverteilung Eigenschaften']);
  M._setLearned(['t_aaa::mittel']);
  M._setMeta({ 't_aaa::mittel': { ts: 1 } });
  const r = M.repairOrphanedProgress(sim);
  eq(r.healed, 1, 'semantischer Treffer (Cosine 0.84) wird geheilt');
  ok(M._getLearned().includes('t_bbb::mittel'), 'Fortschritt auf Live-UID umgehängt');
  ok(M._getMeta()['t_bbb::mittel'], 'topicMeta semantisch mit umgehängt');

  // Score-Greedy: zwei Waisen wollen dasselbe Ziel → der höhere Cosine gewinnt,
  // der schwächere bleibt verwaist (kein erzwungener Zweitbest-Merge).
  const sim2 = (a, b) => {
    const m = {
      'binomialverteilung definition|wahrscheinlichkeitsberechnung binomial': 0.86, // stark
      'binomialkoeffizienten berechnen|wahrscheinlichkeitsberechnung binomial': 0.80, // schwächer
    };
    return m[`${a}|${b}`] ?? m[`${b}|${a}`] ?? 0.1;
  };
  M._setUids({
    'binomialverteilung definition': 't_ccc',
    'binomialkoeffizienten berechnen': 't_ddd',
    'wahrscheinlichkeitsberechnung binomial': 't_eee',
  });
  M._setPath(['Wahrscheinlichkeitsberechnung Binomial']);
  M._setLearned(['t_ccc::mittel', 't_ddd::mittel']);
  M._setMeta({});
  const r2 = M.repairOrphanedProgress(sim2);
  eq(r2.healed, 1, 'nur die stärkere Waise beansprucht das Ziel');
  ok(M._getLearned().includes('t_eee::mittel'), 'stärkere Waise (0.86) gewinnt das Ziel');
  ok(M._getLearned().includes('t_ddd::mittel'), 'schwächere Waise bleibt verwaist (kein Zweitbest-Merge)');
});

group('retainLearnedTopics — gelernte Themen überleben den Re-Scan (v255)', () => {
  // sim: alte Namen ↔ neue Namen/Titel; Schwelle 0.75. PESTEL findet KEINE Entsprechung
  // (0.5) → muss zurückgeholt werden; Marktanteil findet eine (0.9) → nicht doppeln.
  const sim = (a, b) => {
    const m = {
      'pestel umfeldanalyse|situationsanalyse': 0.5,
      'marktanteil|marktanteil analyse': 0.9,
      'strategie|strategie': 1,
    };
    return m[`${a}|${b}`] ?? m[`${b}|${a}`] ?? 0.1;
  };
  M._setUids({ 'pestel umfeldanalyse': 't_aa1', 'marktanteil': 't_bb2', 'werbung': 't_cc3' });
  M._setLearned(['t_aa1::mittel', 't_bb2::schwer']);   // Werbung wurde NIE gelernt
  M._setMeta({});
  const prev = { kapitel: [{ titel: 'Strategie', lernziel: 'Z', themen: ['PESTEL Umfeldanalyse', 'Marktanteil', 'Werbung'] }] };
  M._setStruct({ kapitel: [{ titel: 'Strategie', themen: ['Situationsanalyse', 'Marktanteil Analyse'] }] });

  const n = M.retainLearnedTopics(prev, sim);
  eq(n, 1, 'nur das gelernte, entfallene PESTEL wird zurückgeholt');
  const themen = M._getStruct().kapitel.flatMap(k => k.themen);
  ok(themen.includes('PESTEL Umfeldanalyse'), 'PESTEL mit altem Anzeigenamen wieder in der Struktur');
  ok(!themen.includes('Werbung'), 'nie gelerntes Thema wird NICHT zurückgeholt');
  eq(themen.filter(t => M.normTopic(t) === 'marktanteil').length, 0, 'gematchtes Thema nicht doppelt (kein PESTEL-Klon)');
  eq(M._getStruct().kapitel.find(k => k.titel === 'Strategie').themen.includes('PESTEL Umfeldanalyse'), true, 'ins best-passende (namensgleiche) Kapitel einsortiert');

  // Kein passendes neues Kapitel → altes Kapitel wird neu angelegt (Fortschritt bleibt sichtbar).
  M._setUids({ 'pestel umfeldanalyse': 't_aa1' });
  M._setLearned(['t_aa1::mittel']);
  M._setStruct({ kapitel: [{ titel: 'Ganz Anderes Kapitel', themen: ['Irgendwas'] }] });
  const n2 = M.retainLearnedTopics({ kapitel: [{ titel: 'Strategie', lernziel: 'Z', themen: ['PESTEL Umfeldanalyse'] }] }, sim);
  eq(n2, 1, 'auch ohne passendes Kapitel zurückgeholt');
  ok(M._getStruct().kapitel.some(k => k.titel === 'Strategie' && k.themen.includes('PESTEL Umfeldanalyse')), 'altes Kapitel für das Waisen-Thema neu angelegt');
});

group('scanDirectiveBlock — destillierte Vorgaben als verbindlicher Scan-Block (v215)', () => {
  eq(M.scanDirectiveBlock(''), '', 'leer → kein Block');
  eq(M.scanDirectiveBlock('   '), '', 'nur Whitespace → kein Block');
  const b = M.scanDirectiveBlock('WEGLASSEN: Thema A, Thema B\nSCHWERPUNKT: Thema C\nUMFANG: —');
  ok(b.includes('WEGLASSEN: Thema A, Thema B'), 'übernimmt die Vorgaben wörtlich');
  ok(/VORRANG vor Vollständigkeit/i.test(b), 'macht Vorrang vor Vollständigkeit explizit');
  ok(/Lasse unter WEGLASSEN genannte Themen WEG/i.test(b), 'verbietet weggelassene Themen explizit');
});

group('dedupeTopicUids — Selbstheilung kollabierter IDs', () => {
  M._setUids({ a: 't_x', b: 't_x' });          // zwei Namen, eine UID (Bug-Zustand)
  const changed = M.dedupeTopicUids();
  ok(changed, 'erkennt Kollision');
  ok(M._getUids().a !== M._getUids().b, 'Dubletten bekommen verschiedene UIDs');

  M._setUids({ a: 't_x', b: 't_y' });
  ok(!M.dedupeTopicUids(), 'saubere Map: keine Änderung');
});

group('newTopicUid — eindeutig & wohlgeformt', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) { const u = M.newTopicUid(); ok(M.isTopicUid(u), 'gültiges Format'); ids.add(u); }
  eq(ids.size, 1000, '1000 IDs alle eindeutig (kein Millisekunden-Kollaps)');
});

group('scanDiff — Re-Scan-Diff (#7)', () => {
  M._setUids({});
  // Erstscan: alles neu.
  eq(JSON.stringify(M.scanDiff([], ['A', 'B', 'C'])), JSON.stringify({ added: 3, removed: 0, unchanged: 0 }), 'Erstscan → alles neu');
  // Keine Änderung.
  eq(JSON.stringify(M.scanDiff(['A', 'B'], ['A', 'B'])), JSON.stringify({ added: 0, removed: 0, unchanged: 2 }), 'identisch → alles unverändert');
  // Eins dazu, eins weg (über normalisierte Namen, ohne UIDs).
  eq(JSON.stringify(M.scanDiff(['A', 'B'], ['A', 'C'])), JSON.stringify({ added: 1, removed: 1, unchanged: 1 }), 'A bleibt, B weg, C neu');
  // Normalisierung: Artikel-Variante zählt als unverändert.
  eq(JSON.stringify(M.scanDiff(['Photosynthese'], ['Die Photosynthese'])), JSON.stringify({ added: 0, removed: 0, unchanged: 1 }), 'Artikel-Rename → unverändert');

  // Rename mit erhaltener UID (Zustand nach reconcileTopicUids) → unverändert, nicht neu+weg.
  M._setUids({ 'lineare algebra grundlagen': 't_la', 'lineare algebra': 't_la' });
  eq(JSON.stringify(M.scanDiff(['Lineare Algebra Grundlagen'], ['Lineare Algebra'])), JSON.stringify({ added: 0, removed: 0, unchanged: 1 }), 'Rename mit gleicher UID → unverändert');
  M._setUids({});

  eq(M.formatScanDiff({ added: 3, removed: 2, unchanged: 18 }), '3 neu · 2 entfernt · 18 unverändert', 'Format-String');
});

// ── Teil B: Ausdrucks-Evaluator ───────────────────────────────────────────────
group('parseNum — deutsche Zahlen & Einheiten', () => {
  eq(M.parseNum(42), 42, 'Zahl bleibt Zahl');
  approx(M.parseNum('3,14'), 3.14, 'Dezimal-Komma');
  approx(M.parseNum('1.234,56'), 1234.56, 'Tausenderpunkt + Komma');
  approx(M.parseNum('540 €'), 540, 'Einheiten-Suffix abgetrennt');
  approx(M.parseNum('1.000.000'), 1000000, 'mehrere Tausenderpunkte');
  ok(Number.isNaN(M.parseNum('keine zahl')), 'kein Treffer → NaN');
  ok(Number.isNaN(M.parseNum(null)), 'null → NaN');
});

group('evalExpr — Arithmetik ohne eval', () => {
  approx(M.evalExpr('500 * 0.08'), 40, 'Multiplikation');
  approx(M.evalExpr('500 + 40'), 540, 'Addition');
  approx(M.evalExpr('2 + 3 * 4'), 14, 'Punkt vor Strich');
  approx(M.evalExpr('(2 + 3) * 4'), 20, 'Klammern');
  approx(M.evalExpr('2^10'), 1024, 'Potenz (^)');
  approx(M.evalExpr('2 hoch 8'), 256, '"hoch" → ^');
  approx(M.evalExpr('sqrt(144)'), 12, 'sqrt');
  approx(M.evalExpr('wurzel(16)'), 4, '"wurzel" → sqrt');
  approx(M.evalExpr('10 % 3'), 1, 'Modulo');
  approx(M.evalExpr('100 - 30 - 20'), 50, 'Links-Assoziativität Minus');
  approx(M.evalExpr('2 ^ 3 ^ 2'), 512, 'Potenz rechts-assoziativ');
  approx(M.evalExpr('6 · 7'), 42, 'Mal-Punkt ·');
  approx(M.evalExpr('84 ÷ 2'), 42, 'Geteilt ÷');
  // Deutsche Zahlen direkt im Ausdruck:
  approx(M.evalExpr('1.000,5 + 0,5'), 1001, 'Tausenderpunkt + Dezimal-Komma im Term');
  ok(Number.isNaN(M.evalExpr(null)), 'null → NaN');
  ok(Number.isNaN(M.evalExpr('+')), 'Müll → NaN');
});

group('numEqual — Toleranz', () => {
  ok(M.numEqual(540, 540.1, 0.01), '0,1 von 540 innerhalb 1%');
  ok(!M.numEqual(40, 44, 0.01), '44 ≠ 40 (10% > 1%)');
  ok(M.numEqual(0, 0.004), 'absoluter Boden (~0,005) fängt Null-Nähe');
  ok(!M.numEqual(100, 102, 0.01), '2 von 100 außerhalb 1%');
  ok(M.numEqual(100, 100.5, 0.01), '0,5 von 100 innerhalb 1%');
  ok(!M.numEqual(NaN, 5), 'NaN → false');
});

// ── Teil B (Integration): applyNumericVerdict — Score-Zusammensetzung (KONZEPT B.6) ──
// Die Verhaltensgarantie: das deterministische Zahl-Verdikt überstimmt das LLM-Urteil.
// ev wird mutiert (score/understood/feedback). diff steuert die Toleranz.
group('applyNumericVerdict — Zahl überstimmt LLM (#4)', () => {
  // Falsche Zahl trotz LLM-score=2 → Deckelung auf 1, understood=false, Notiz.
  let ev = { score: 2, understood: true, feedback: 'Sauberer Weg', endergebnis: 540, schueler_endergebnis: 500 };
  const note = M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'falsches Endergebnis deckelt score 2→1');
  eq(ev.understood, false, 'understood wird false');
  ok(/weicht ab/.test(note) && /weicht ab/.test(ev.feedback), 'Abweichungs-Notiz angehängt');
  ok(/Sauberer Weg/.test(ev.feedback), 'bestehendes Feedback bleibt erhalten');

  // Richtige Zahl → score unverändert, ✓-Notiz, understood bleibt.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: 540 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'korrektes Endergebnis lässt score=2');
  eq(ev.understood, true, 'understood bleibt true');
  ok(/✓/.test(ev.feedback), '✓-Notiz gesetzt');

  // endergebnis_rechnung (Ausdruck) ist alleinige Referenz, wenn keine endergebnis-Zahl da ist.
  ev = { score: 0, understood: false, feedback: '', endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 540 };
  M.applyNumericVerdict(ev, true, 'mittel');
  ok(/✓/.test(ev.feedback), 'Referenz aus nachgerechnetem Ausdruck (540) bei fehlender endergebnis-Zahl');

  // B.5 In-Band-Doppelcheck: Ausdruck (540) und endergebnis (999) widersprechen sich →
  // Ground Truth unsicher → KEIN Override, LLM-Urteil bleibt stehen.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 999, endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 540 };
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'widersprüchliche Referenz → keine Notiz/kein Verdikt');
  eq(ev.score, 2, 'widersprüchliche Referenz → score bleibt (LLM-Urteil)');
  // Stimmen Ausdruck und endergebnis überein, greift das Verdikt normal.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, endergebnis_rechnung: '500 * 1.08', schueler_endergebnis: 500 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'konsistente Referenz (540==540) + falsche Schülerzahl → Deckelung');

  // Falsche Zahl bei bereits niedrigem score → bleibt (kein Hochstufen), understood=false.
  ev = { score: 0, understood: false, feedback: '', endergebnis: 540, schueler_endergebnis: 1 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 0, 'score=0 wird nicht angehoben');
  eq(ev.understood, false, 'understood bleibt false');

  // Keine Rechenaufgabe → keine Mutation, leere Notiz (Konzept-Themen bleiben LLM-bewertet).
  ev = { score: 2, understood: true, feedback: 'gut', endergebnis: 540, schueler_endergebnis: 500 };
  eq(M.applyNumericVerdict(ev, false, 'mittel'), '', 'Nicht-Rechenaufgabe → keine Notiz');
  eq(ev.score, 2, 'Nicht-Rechenaufgabe: score unangetastet');

  // Schüler nennt keine Zahl → LLM-Urteil bleibt stehen (kein deterministisches Verdikt).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: null };
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'kein Schüler-Endergebnis → keine Übersteuerung');
  eq(ev.score, 2, 'ohne Schülerzahl: score unangetastet');

  // Niveau-abhängige Toleranz: 1%-Abweichung besteht bei "mittel" (2%), scheitert bei "pruefungsnah" (0,5%).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 101 };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, '1%-Abweichung bei "mittel" toleriert');
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 101 };
  M.applyNumericVerdict(ev, true, 'pruefungsnah');
  eq(ev.score, 1, '1%-Abweichung bei "pruefungsnah" gedeckelt');

  // Re-Check-Stabilität: dasselbe falsche ev erneut geprüft bleibt ≤1 (deterministisch).
  ev = { score: 2, understood: true, feedback: '', endergebnis: 540, schueler_endergebnis: 500 };
  M.applyNumericVerdict(ev, true, 'mittel');
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'Re-Check zementiert kein Fehlurteil – bleibt 1');

  // Deutsche Schülerzahl mit Einheit wird korrekt geparst.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 1234.56, schueler_endergebnis: '1.234,56 €' };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'deutsche Zahl "1.234,56 €" == 1234.56');
});

group('numericCheck — Einzelvergleich + In-Band-Doppelcheck (B.5)', () => {
  eq(M.numericCheck('500*1.08', 540, 540, 0.02).verdict, 'ok', 'konsistent + richtig → ok');
  eq(M.numericCheck('500*1.08', 540, 500, 0.02).verdict, 'abweichung', 'konsistent + falsch → abweichung');
  eq(M.numericCheck('500*1.08', 999, 540, 0.02).verdict, null, 'Ausdruck≠endergebnis → null (unsicher)');
  eq(M.numericCheck('', 540, 540, 0.02).verdict, 'ok', 'nur endergebnis-Zahl als Referenz');
  eq(M.numericCheck('500*1.08', null, 540, 0.02).verdict, 'ok', 'nur Ausdruck als Referenz');
  eq(M.numericCheck('500*1.08', 540, null, 0.02).verdict, null, 'keine Schülerzahl → null');
  eq(M.numericCheck('', '', '', 0.02).verdict, null, 'gar keine Referenz → null');
});

group('applyNumericVerdict — Teilaufgaben (B.5, Verdikt pro Teil)', () => {
  // Ein falscher Teil deckelt den Gesamt-Score; Notiz nennt genau diesen Teil.
  let ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis_rechnung: '2+2', endergebnis: 4, schueler_endergebnis: 4 },
    { label: 'b', endergebnis_rechnung: '10*3', endergebnis: 30, schueler_endergebnis: 25 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'ein falscher Teil → Gesamt-score gedeckelt');
  eq(ev.understood, false, 'understood=false bei falschem Teil');
  ok(/b\)/.test(ev.feedback) && !/a\)/.test(ev.feedback), 'Notiz nennt nur den falschen Teil b)');

  // Alle Teile korrekt → score bleibt, Sammel-✓.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: 4 },
    { label: 'b', endergebnis: 30, schueler_endergebnis: 30 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 2, 'alle Teile korrekt → score bleibt 2');
  ok(/✓/.test(ev.feedback), 'Sammel-✓ gesetzt');

  // Mehrere falsche Teile werden alle aufgeführt.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: 9 },
    { label: 'b', endergebnis: 30, schueler_endergebnis: 25 },
  ]};
  M.applyNumericVerdict(ev, true, 'mittel');
  ok(/a\)/.test(ev.feedback) && /b\)/.test(ev.feedback), 'beide falschen Teile genannt');

  // Teile ohne belastbares Verdikt (keine Schülerzahl) → keine Übersteuerung.
  ev = { score: 2, understood: true, feedback: '', teilergebnisse: [
    { label: 'a', endergebnis: 4, schueler_endergebnis: null },
  ]};
  eq(M.applyNumericVerdict(ev, true, 'mittel'), '', 'kein belastbares Teil-Verdikt → keine Notiz');
  eq(ev.score, 2, 'kein belastbares Teil-Verdikt → score bleibt');

  // teilergebnisse hat Vorrang vor den Einzelfeldern.
  ev = { score: 2, understood: true, feedback: '', endergebnis: 100, schueler_endergebnis: 100,
         teilergebnisse: [{ label: 'a', endergebnis: 4, schueler_endergebnis: 5 }] };
  M.applyNumericVerdict(ev, true, 'mittel');
  eq(ev.score, 1, 'teilergebnisse überschreibt die Einzelfeld-Auswertung');
});

// ── md() — Rendering von Rechenzeichen & Tabellen ─────────────────────────────
group('md — Mathe-Delimiter ($, \\(\\), \\[\\])', () => {
  eq(M.md('$E=mc^2$'), '<span class="math-inline">⟦KTX d=0:E=mc^2⟧</span>',
     'Inline $…$ → KaTeX inline');
  eq(M.md('$$\\int x$$'), '<div class="math-block">⟦KTX d=1:\\int x⟧</div>',
     'Block $$…$$ → KaTeX display');
  // Claude nutzt trotz Prompt oft \(…\) und \[…\] — müssen ebenfalls rendern.
  ok(/math-inline">⟦KTX d=0:E = mc\^2⟧/.test(M.md('Text \\(E = mc^2\\) Ende')),
     '\\(…\\) → KaTeX inline');
  ok(/math-block">⟦KTX d=1:.*frac/.test(M.md('\\[ \\frac{1}{3} \\]')),
     '\\[…\\] → KaTeX display');
  // Roher LaTeX-Backslash darf NICHT als Klartext überleben:
  ok(!M.md('\\(a+b\\)').includes('\\('), 'kein roher \\(-Delimiter im Output');
});

group('md — Multiplikation vs. Kursiv', () => {
  eq(M.md('3 * 4 = 12'), '3 * 4 = 12', 'Stern mit Leerzeichen bleibt Multiplikation');
  eq(M.md('a * b * c'), 'a * b * c', 'mehrere Multiplikationen unangetastet');
  eq(M.md('*wichtig*'), '<em>wichtig</em>', 'echtes Kursiv funktioniert weiter');
  eq(M.md('**fett**'), '<strong>fett</strong>', 'Fett funktioniert weiter');
});

group('md — GFM-Tabellen', () => {
  const html = M.md('| A | B |\n|---|---|\n| 1 | 2 |');
  ok(/<table class="md-table">/.test(html), 'erzeugt <table class="md-table">');
  ok(/<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>/.test(html), 'Kopfzeile als <th>');
  ok(/<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/.test(html), 'Datenzeile als <td>');
  ok(!html.includes('|'), 'keine rohen Pipe-Zeichen mehr im Output');

  // Ausrichtung aus der Trennzeile (:--:, --:, :--).
  const al = M.md('| L | C | R |\n|:--|:--:|--:|\n| a | b | c |');
  ok(/<th style="text-align:center">C<\/th>/.test(al), 'zentrierte Spalte');
  ok(/<th style="text-align:right">R<\/th>/.test(al), 'rechtsbündige Spalte');

  // Math-Platzhalter in Zellen überleben bis zur KaTeX-Ersetzung.
  const mt = M.md('| Formel |\n|---|\n| $x^2$ |');
  ok(/<td><span class="math-inline">⟦KTX d=0:x\^2⟧<\/span><\/td>/.test(mt),
     'Formel in Tabellenzelle wird gerendert');

  // Kein Fehlalarm: normaler Text mit Pipe bleibt unverändert (keine Trennzeile).
  ok(!/<table/.test(M.md('a | b ohne Trennzeile')), 'Pipe ohne Separator → keine Tabelle');
});

group('inkBoundingBox — Despeckle gegen Phantom-Pixel (#4)', () => {
  const CW = 200, CH = 200;
  const mk = pts => {
    const d = new Uint8ClampedArray(CW * CH * 4);
    for (const [x, y] of pts) d[(y * CW + x) * 4 + 3] = 255;
    return d;
  };
  const block = (x0, y0, w, h) => {
    const pts = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) pts.push([x, y]);
    return pts;
  };

  eq(M.inkBoundingBox(mk([]), CW, CH).ink, false, 'leeres Bild → ink:false');

  const one = M.inkBoundingBox(mk(block(40, 40, 20, 20)), CW, CH);
  ok(one.ink && one.minX === 40 && one.minY === 40 && one.maxX === 59 && one.maxY === 59,
     'kompakter Block → enge Box');

  // Block + ferner 1-Pixel-Phantom-Tupfer → Tupfer verworfen, Box reicht NICHT
  // bis zum Tupfer (bei 180); sie ist auf der Tupfer-Seite zell-gerastert (≤71).
  const ph = M.inkBoundingBox(mk([...block(40, 40, 20, 20), [180, 180]]), CW, CH);
  ok(ph.maxX < 100 && ph.maxY < 100, 'Phantom-Tupfer zieht die Box NICHT auf');

  // Nur ein winziger Tupfer (< INK_MIN_PIXELS) → Fallback auf rohe Box (kein Verlust).
  const sp = M.inkBoundingBox(mk([[100, 100], [101, 100], [102, 100]]), CW, CH);
  ok(sp.ink && sp.minX === 100 && sp.maxX === 102, 'einziger Tupfer → rohe Box (kein Verlust)');

  // Zwei echte, weit getrennte Blöcke → beide bleiben, Box umspannt beide.
  const two = M.inkBoundingBox(mk([...block(24, 24, 20, 20), ...block(120, 120, 20, 20)]), CW, CH);
  ok(two.minX === 24 && two.maxX === 139, 'zwei echte Blöcke → Box umspannt beide');
});

group('enhanceInkContrast — Lesbarkeit dünner Striche (#5)', () => {
  const px = (r, g, b, a = 255) => { const d = new Uint8ClampedArray([r, g, b, a]); M.enhanceInkContrast(d); return d; };
  eq(px(255, 255, 255)[0], 255, 'reines Weiß bleibt weiß');
  const near = px(250, 250, 250);
  ok(near[0] === 255 && near[1] === 255 && near[2] === 255, 'nahezu Weiß (≥cutoff) → reines Weiß (Halo weg)');
  ok(px(200, 200, 200)[0] < 180, 'blasses Grau wird deutlich dunkler');
  ok(px(0, 0, 0)[0] <= 2, 'tiefes Schwarz bleibt schwarz');
  eq(px(120, 120, 120, 177)[3], 177, 'Alpha-Kanal bleibt unverändert');
});

group('catmullRomPts — Spline-Glättung der Striche (#6)', () => {
  // < 3 Punkte → unveränderte Kopie (neue Referenz, gleiche Werte).
  const tiny = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const tinyOut = M.catmullRomPts(tiny);
  eq(tinyOut.length, 2, '<3 Punkte → unverändert (Länge)');
  ok(tinyOut !== tiny && tinyOut[1].x === 10, '<3 Punkte → Kopie, Werte erhalten');

  // Kollineare Punkte bleiben kollinear, werden aber dichter; Endpunkt exakt.
  const line = M.catmullRomPts([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }]);
  ok(line.length > 3, 'lange Segmente werden unterteilt (dichter)');
  ok(line.every(p => Math.abs(p.y) < 1e-6), 'kollinear bleibt kollinear (y≈0)');
  approx(line[line.length - 1].x, 160, 'Endpunkt bleibt exakt erhalten');
  approx(line[10].x, 80, 'verläuft durch den mittleren Stützpunkt');

  // Dichte (langsame) Striche: kurze Segmente → keine zusätzliche Unterteilung.
  const dense = M.catmullRomPts([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }]);
  eq(dense.length, 3, 'kurze Segmente bleiben unverändert (keine Aufblähung)');

  // Druck p wird mitinterpoliert, wenn vorhanden – sonst gar nicht gesetzt.
  const withP = M.catmullRomPts([{ x: 0, y: 0, p: 0.2 }, { x: 80, y: 0, p: 0.8 }, { x: 160, y: 0, p: 0.4 }]);
  ok(withP.every(p => typeof p.p === 'number'), 'Druck bleibt an allen Punkten gesetzt');
  ok(withP[5].p > 0.2 && withP[5].p < 0.8, 'Druck wird zwischen Stützpunkten interpoliert');
  const noP = M.catmullRomPts([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 0 }]);
  ok(noP.every(p => p.p === undefined), 'ohne Druck-Eingabe kein p-Feld');
});

group('parseJsonResponse — JS-String-Konkatenation & SVG-Erhalt (v238)', () => {
  // Kernfall: Modell splittet einen langen Wert per JS-Konkatenation ("…" + "<svg…>").
  // Ungültiges JSON → früher kappte salvage genau am '+' und das eingebettete SVG
  // (plus Folgefelder) ging verloren. repairJson führt die Literale jetzt zusammen.
  const concat = '{"was":"Erklärung Teil eins.\\n\\n" + "<svg viewBox=\'0 0 300 260\'><line x1=\'0\' y1=\'0\' x2=\'9\' y2=\'9\'/></svg>","warum":"weil wichtig","beispiel":"konkret"}';
  const d = M.parseJsonResponse(concat);
  ok(d && d.was && d.warum && d.beispiel, 'alle drei Felder überleben die Konkatenation');
  ok(/<svg/.test(d.was || ''), 'eingebettetes SVG bleibt im Wert erhalten');
  eq(d.warum, 'weil wichtig', 'Folgefeld nach dem SVG geht nicht verloren');

  // Mehrfach-Konkatenation in einem Wert.
  const triple = M.parseJsonResponse('{"x":"a" + "b" + "c"}');
  eq(triple.x, 'abc', 'mehrere + zusammengeführt');

  // Regression: sauberes JSON bleibt unangetastet.
  eq(JSON.stringify(M.parseJsonResponse('{"a":"hi","b":2}')), '{"a":"hi","b":2}', 'sauberes JSON unverändert');
  // Regression: ein escaptes Quote-Plus-Quote als String-INHALT wird NICHT
  // fälschlich als Konkatenation gemerged (Lookbehind schützt das \\").
  eq(M.parseJsonResponse('{"x":"sag \\" + \\" ende"}').x, 'sag " + " ende', 'escaptes \\" + \\" bleibt Inhalt');
  // Newline-in-String (bestehender repairJson-Pfad) funktioniert weiter.
  eq(M.parseJsonResponse('{"t":"zeile1\nzeile2"}').t, 'zeile1\nzeile2', 'literaler Zeilenumbruch im String gerettet');
});

group('repairUnescapedQuotes — unescapte "-Zeichen in Stringwerten (v261)', () => {
  // Realfall (Experte-Fallvignette): Firmenname gemischt „…" – typografisch auf,
  // ASCII zu. Das nackte " beendete den JSON-String → parse-fail → "Aufgabe
  // konnte nicht erstellt werden", obwohl die Antwort inhaltlich komplett war.
  const vignette = '{\n  "aufgabe": "FALLSTUDIE: MARKTEINGANG VON „FRESHCYCLE" – EINEM VERLEIHSYSTEM\\n\\nTeil a) Analysieren Sie. (8 Punkte)"\n}';
  const v = M.parseJsonLoose(vignette);
  ok(/FRESHCYCLE"/.test(v.aufgabe), 'inneres ASCII-Quote als Inhalt gerettet');
  ok(/8 Punkte/.test(v.aufgabe), 'Rest des Werts bleibt erhalten');

  // Auch der parseJsonResponse-Pfad (Erklärungen, code-fenced) nutzt die Stufe.
  const fenced = '```json\n{"was":"Das Modell „X" erklärt Y.","warum":"wichtig"}\n```';
  const f = M.parseJsonResponse(fenced);
  eq(f.warum, 'wichtig', 'Folgefeld nach dem inneren Quote überlebt');
  ok(/„X"/.test(f.was), 'inneres Quote im Wert erhalten');

  // Echte Abschluss-Quotes (vor , } ] :) bleiben Delimiter.
  eq(M.repairUnescapedQuotes('{"a":"x","b":"y"}'), '{"a":"x","b":"y"}', 'sauberes JSON unverändert');
  // Bereits escapte Quotes werden nicht doppelt escaped.
  eq(M.parseJsonLoose('{"a":"sag \\"hi\\" laut"}').a, 'sag "hi" laut', 'escapte Quotes unangetastet');
  // Mehrere innere Quotes in einem Wert.
  eq(M.parseJsonLoose('{"a":"„Alpha" und „Beta" GmbH"}').a, '„Alpha" und „Beta" GmbH', 'mehrere innere Quotes gerettet');
  // parseJsonLoose wirft weiterhin bei hoffnungslosem Input (Caller-Verträge).
  let threw = false;
  try { M.parseJsonLoose('kein json'); } catch { threw = true; }
  ok(threw, 'parseJsonLoose wirft bei Nicht-JSON weiterhin');
});

group('mergeCoverageAdditions — Scan-Abdeckungs-Check fügt Lücken ein (v253)', () => {
  const base = () => ({ kapitel: [
    { titel: 'Geldpolitik', lernziel: 'x', themen: ['Geldmenge und Inflation'] },
    { titel: 'Wachstum', lernziel: 'y', themen: ['Produktivität und Kapitalstock'] },
  ] });

  // Neues Thema in bestehendes Kapitel.
  const a = M.mergeCoverageAdditions(base(), [{ kapitel: 'Geldpolitik', themen: ['Zentralbankoperationen'] }]);
  eq(a.kapitel[0].themen.length, 2, 'Thema im bestehenden Kapitel ergänzt');
  eq(a.kapitel[0].themen[1], 'Zentralbankoperationen', 'neues Thema angehängt');

  // Unbekanntes Kapitel wird angelegt (der reale Preisblasen-Fall).
  const b = M.mergeCoverageAdditions(base(), [{ kapitel: 'Vermögensmärkte', themen: ['Preisblasen Entstehung', 'Blasen platzen Folgen'] }]);
  eq(b.kapitel.length, 3, 'neues Kapitel angelegt');
  eq(b.kapitel[2].titel, 'Vermögensmärkte', 'Kapiteltitel übernommen');
  eq(b.kapitel[2].themen.length, 2, 'beide Themen im neuen Kapitel');

  // Normalisiert bereits vorhandene Themen werden NICHT doppelt eingefügt.
  const c = M.mergeCoverageAdditions(base(), [{ kapitel: 'Geldpolitik', themen: ['Die Geldmenge und Inflation'] }]);
  eq(c.kapitel[0].themen.length, 1, 'Beinah-Duplikat (Artikel-Präfix) übersprungen');

  // maxAdd deckelt die Gesamtzahl neuer Themen.
  const many = [{ kapitel: 'Neu', themen: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'] }];
  const d = M.mergeCoverageAdditions(base(), many, 3);
  eq(d.kapitel[2].themen.length, 3, 'maxAdd begrenzt die Ergänzungen');

  // Kein Kapiteltitel → Sammel-Kapitel "Weitere Themen"; zweiter Aufruf-Eintrag
  // ohne Titel landet im selben Sammel-Kapitel statt ein zweites anzulegen.
  const e = M.mergeCoverageAdditions(base(), [{ themen: ['Extra A'] }, { themen: ['Extra B'] }]);
  eq(e.kapitel.length, 3, 'nur EIN Sammel-Kapitel');
  eq(e.kapitel[2].titel, 'Weitere Themen', 'Fallback-Titel');
  eq(e.kapitel[2].themen.join(','), 'Extra A,Extra B', 'beide titellosen Ergänzungen gebündelt');

  // Defensive: kaputte Eingaben lassen die Struktur unverändert.
  const f = M.mergeCoverageAdditions(base(), 'quatsch');
  eq(f.kapitel.length, 2, 'Nicht-Array-Ergänzungen → unverändert');
  const g = M.mergeCoverageAdditions(base(), [{ kapitel: 'X', themen: [42, null, ''] }]);
  eq(g.kapitel.length, 2, 'nur unbrauchbare Themen → kein leeres Kapitel');
});

// ── Ergebnis ──────────────────────────────────────────────────────────────────
console.log(`\n${fail ? '✗' : '✓'} ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
