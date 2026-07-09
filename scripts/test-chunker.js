#!/usr/bin/env node
// Test-Harness für den lokalen, kostenfreien KB-Chunker aus server/server.js.
// Deckt structureDocumentLocal + Helfer (guessChunkKind, looksLikeHeading,
// cleanHeading) ab – die reine, API-freie Indexierungslogik (USE_LOCAL_KB_INDEX).
//
// Wie scripts/test-pure.js werden die Funktionen ZUR LAUFZEIT aus der Quelle
// extrahiert (kein Copy-Paste), damit der Test nicht von server.js driften kann.
// Läuft ohne Abhängigkeiten:  node scripts/test-chunker.js

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

// Top-Level-Funktion per Klammer-Matching extrahieren (Kommentare/Strings überspringen).
function extractFn(name) {
  const m = SRC.match(new RegExp('function\\s+' + name + '\\s*\\('));
  if (!m) throw new Error(`Funktion ${name} nicht in server.js gefunden`);
  let i = SRC.indexOf('{', m.index), depth = 0, mode = 'code';
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j], n = SRC[j + 1];
    if (mode === 'line') { if (c === '\n') mode = 'code'; continue; }
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
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(m.index, j + 1); }
  }
  throw new Error(`Body für ${name} nicht geschlossen`);
}

const bundle = ['guessChunkKind', 'looksLikeHeading', 'cleanHeading', 'structureDocumentLocal']
  .map(extractFn).join('\n\n');
const M = new Function(bundle + `
  return { guessChunkKind, looksLikeHeading, cleanHeading, structureDocumentLocal };`)();

// ── Mini-Runner ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, `${msg}  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`); }
function group(name, fn) { console.log('• ' + name); fn(); }

const MATH_LO = 0x1D400, MATH_HI = 0x1D7FF;
const hasMathU = s => { for (const ch of s) { const c = ch.codePointAt(0); if (c >= MATH_LO && c <= MATH_HI) return true; } return false; };

group('guessChunkKind — Heuristik', () => {
  eq(M.guessChunkKind('Der Deckungsbeitrag $= p - k_v$ ist zentral.'), 'formel', 'LaTeX → formel');
  eq(M.guessChunkKind('Die Elastizität wird durch ≤ begrenzt und = 0.'), 'formel', 'Mathe-Zeichen → formel');
  eq(M.guessChunkKind('Ein Monopol ist definiert als Alleinanbieter.'), 'definition', 'definiert als → definition');
  eq(M.guessChunkKind('Beispiel: Ein Cola-Anbieter erhöht den Preis.'), 'beispiel', 'Beispiel: → beispiel');
  eq(M.guessChunkKind('Was ist Inflation? Wie entsteht sie?'), 'pruefungsfrage', 'zwei Fragen → pruefungsfrage');
  eq(M.guessChunkKind('Der Markt koordiniert Angebot und Nachfrage.'), 'konzept', 'Fließtext → konzept');
});

group('looksLikeHeading — konservative Erkennung', () => {
  ok(M.looksLikeHeading('# Einleitung'), 'Markdown-H1');
  ok(M.looksLikeHeading('## 2.2 Preispolitik'), 'Markdown mit Nummer');
  ok(M.looksLikeHeading('Kapitel 3: Elastizität'), 'Kapitel-Präfix');
  ok(M.looksLikeHeading('1.2 Nachfragefunktion'), 'Dezimal-Nummerierung');
  ok(M.looksLikeHeading('Preisdifferenzierung'), 'kurze Titelzeile ohne Satzzeichen');
  ok(!M.looksLikeHeading('Der Preis wird durch Angebot und Nachfrage bestimmt.'), 'Satz mit Punkt ist keine Überschrift');
  ok(!M.looksLikeHeading('1.2 ist der Wert des Multiplikators.'), 'Nummer + Satzende ≠ Überschrift');
  ok(!M.looksLikeHeading(''), 'Leerzeile keine Überschrift');
  ok(!M.looksLikeHeading('a'.repeat(120)), 'zu lange Zeile keine Überschrift');
});

group('cleanHeading — Präfixe strippen', () => {
  eq(M.cleanHeading('## 2.2 Preispolitik'), 'Preispolitik', 'Markdown+Nummer entfernt');
  eq(M.cleanHeading('3.1.4 Deckungsbeitrag'), 'Deckungsbeitrag', 'mehrstufige Nummer entfernt');
  eq(M.cleanHeading('# Einleitung'), 'Einleitung', 'H1-Marker entfernt');
});

group('structureDocumentLocal — NFKC-Normalisierung (QM3-Mathe-Unicode)', () => {
  // Mathematical Alphanumeric Symbols aus der PDF-Textebene müssen zu ASCII falten.
  const raw = 'Nullhypothese\n\u{1D43B}\u{1D43B} 0 : Beide Kampagnen gleich; \u{1D438}\u{1D438} \u{1D44B}\u{1D44B} = 0 als Erwartungswert der Teststatistik.';
  ok(hasMathU(raw), 'Testeingabe enthält tatsächlich Mathe-Unicode');
  const { chunks } = M.structureDocumentLocal(raw, 'QM3-komprimiert.pdf');
  ok(chunks.length >= 1, 'mindestens ein Chunk');
  ok(chunks.every(c => !hasMathU(c.content)), 'kein Chunk enthält nach NFKC noch Mathe-Unicode');
  ok(chunks.some(c => /HH 0/.test(c.content)), '𝐻𝐻 0 → "HH 0" gefaltet');
});

group('structureDocumentLocal — Struktur & Grenzen', () => {
  const doc = [
    '# Preispolitik',
    'Die Preispolitik gewinnt an Bedeutung. '.repeat(3).trim(),
    '',
    '## Preisdifferenzierung',
    'Es gibt mehrere Formen. '.repeat(4).trim(),
  ].join('\n');
  const { chunks, budgetHit, truncated } = M.structureDocumentLocal(doc, 'Kapitel 8.pdf');
  ok(chunks.length >= 1, 'Chunks erzeugt');
  eq(budgetHit, false, 'lokaler Chunker meldet nie budgetHit');
  eq(truncated, 0, 'lokaler Chunker schneidet nie ab');
  ok(chunks.some(c => c.topic === 'Preispolitik'), 'Überschrift wird Topic');
  ok(chunks.some(c => c.topic === 'Preisdifferenzierung'), 'zweite Überschrift wird Topic');
  ok(chunks.every(c => c.content.length >= 40), 'keine Rausch-Fragmente (<40 Zeichen)');
  ok(chunks.every(c => c.source_ref.startsWith('Kapitel 8.pdf')), 'source_ref trägt Dateinamen');
});

group('structureDocumentLocal — große Absätze werden gesplittet', () => {
  const big = 'Dieser Satz beschreibt einen Sachverhalt ausführlich. '.repeat(120); // ~6300 Zeichen
  const { chunks } = M.structureDocumentLocal(big, 'gross.pdf');
  ok(chunks.length >= 3, `langer Text in mehrere Chunks (${chunks.length})`);
  ok(chunks.every(c => c.content.length <= 1450), 'jeder Chunk innerhalb der MAX-Grenze');
});

group('structureDocumentLocal — leere/Rausch-Eingabe', () => {
  eq(M.structureDocumentLocal('', 'leer.pdf').chunks.length, 0, 'leerer Text → 0 Chunks');
  eq(M.structureDocumentLocal('kurz', 'x.pdf').chunks.length, 0, 'Fragment <40 Zeichen → 0 Chunks');
});

console.log(`\n${fail ? '✗' : '✓'} ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
