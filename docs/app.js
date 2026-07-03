'use strict';

// Einzige Quelle der Wahrheit für die laufende Version. Wird unten ins
// #app-version-Label geschrieben → zeigt, welcher app.js wirklich geladen ist
// (statt eines fest verdrahteten, veraltenden Texts in index.html). Bei jedem
// Asset-Bump hier UND in index.html (?v=) UND in sw.js erhöhen.
const APP_VERSION = '256';
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('app-version');
  if (!el) return;
  el.textContent = 'v' + APP_VERSION;
});

// ── Global error safety net ───────────────────────────────────────────────
window.addEventListener('error', e => {
  console.error('App error:', e.message, e.filename, e.lineno);
  // Only show auth if no screen is visible (blank screen), not on every JS error
  try {
    if (!document.querySelector('.screen.active')) showScreen('auth-screen');
  } catch (_) {}
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise:', e.reason);
  try {
    if (!document.querySelector('.screen.active')) showScreen('auth-screen');
  } catch (_) {}
});

// ── AI Progress simulation ────────────────────────────────────────────────
function startProgress(barId, pctId, durationMs = 20000) {
  const bar = document.getElementById(barId);
  const pct = document.getElementById(pctId);
  if (!bar || !pct) return () => {};
  let current = 0;
  // Disable CSS transition during increments so each tick shows immediately
  bar.style.transition = 'none';
  bar.style.width = '0%'; pct.textContent = '0%';
  // Decay factor: reaches ~80% at durationMs, ~60% at half of durationMs
  const TICK = 200;
  const ticks = Math.max(durationMs / TICK, 1);
  const f = 1 - Math.pow(1 / 9, 1 / ticks);
  const timer = setInterval(() => {
    current += (90 - current) * f;
    if (current > 89) current = 89;
    bar.style.width = current.toFixed(1) + '%';
    pct.textContent = Math.round(current) + '%';
  }, TICK);
  return () => {
    clearInterval(timer);
    // Smooth slide to 100% instead of hard jump
    bar.style.transition = 'width 0.5s ease-out';
    bar.style.width = '100%'; pct.textContent = '100%';
    setTimeout(() => { bar.style.transition = 'none'; }, 600);
  };
}

// ── Toast notifications ────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { error: '⚠️', success: '✅', info: 'ℹ️', warn: '⚠️' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  container.appendChild(el);
  const remove = () => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

// App-eigener Bestätigungs-Dialog (ersetzt native confirm()): styling-bar,
// blockiert nicht den JS-Thread und passt in die PWA. Gibt ein Promise<boolean>.
function confirmDialog(message, {
  title = 'Bestätigen', okText = 'OK', cancelText = 'Abbrechen', danger = false,
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        <div class="confirm-title"></div>
        <div class="confirm-msg"></div>
        <div class="confirm-actions">
          <button class="confirm-cancel" type="button"></button>
          <button class="confirm-ok${danger ? ' danger' : ''}" type="button"></button>
        </div>
      </div>`;
    // Texte via textContent setzen → kein HTML-Injection-Risiko bei Dateinamen etc.
    overlay.querySelector('.confirm-title').textContent  = title;
    overlay.querySelector('.confirm-msg').textContent    = message;
    overlay.querySelector('.confirm-cancel').textContent = cancelText;
    overlay.querySelector('.confirm-ok').textContent     = okText;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    let done = false;
    const close = val => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('show');
      const drop = () => overlay.remove();
      overlay.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 300); // Fallback, falls transitionend ausbleibt
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter')  { e.preventDefault(); close(true);  }
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { haptic(20); close(true); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('.confirm-ok').focus();
  });
}

// ── PDF.js worker ──────────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── Mermaid ────────────────────────────────────────────────────────────────
mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });

// ── Constants ──────────────────────────────────────────────────────────────
const ICONS  = ['📐','📊','🧪','🔬','🧬','📚','🖥️','⚖️','💰','🌍','🎨','🎵','🏥','🏛️','✈️','🔧','📡','🧮','⚗️','🔭','🤖','🧠','💡','🎯','🌱','🏋️'];
const COLORS = ['#5856d6','#007aff','#34c759','#ff9500','#ff3b30','#ff2d55','#30b0c7','#a2845e'];

// ── Auth ───────────────────────────────────────────────────────────────────
let authToken    = localStorage.getItem('auth_token')    || '';
let authUsername = localStorage.getItem('auth_username') || '';
let authIsAdmin  = localStorage.getItem('auth_is_admin') === '1';
let authMode = 'login';

function authHeaders() {
  return authToken ? { 'content-type': 'application/json', 'authorization': `Bearer ${authToken}` }
                   : { 'content-type': 'application/json' };
}

function switchAuthTab(mode) {
  authMode = mode;
  document.getElementById('auth-tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
  document.getElementById('auth-error').classList.add('hidden');
}

let approvalPollInterval = null;

function stopApprovalPolling() {
  if (approvalPollInterval) { clearInterval(approvalPollInterval); approvalPollInterval = null; }
}

function startApprovalPolling(username, password) {
  stopApprovalPolling();
  approvalPollInterval = setInterval(async () => {
    try {
      const r = await fetch(`/api/auth/approval-status?username=${encodeURIComponent(username)}`); // raw-fetch-ok: Polling vor Login, noch kein Token
      if (!r.ok) return;
      const data = await r.json();
      if (!data.approved) return;
      stopApprovalPolling();
      // Auto-login with stored credentials
      const lr = await fetch('/api/auth/login', { // raw-fetch-ok: Login erzeugt erst das Token
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!lr.ok) return;
      const ld = await lr.json();
      authToken    = ld.token;
      authUsername = ld.username;
      authIsAdmin  = ld.is_admin || false;
      localStorage.setItem('auth_token',    authToken);
      localStorage.setItem('auth_username', authUsername);
      localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
      toast('✅ Dein Konto wurde freigeschaltet!', 'success', 4000);
      onAuthSuccess();
    } catch (_) {}
  }, 10000);
}

document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden');
  if (!username || !password) { errEl.textContent = 'Bitte alle Felder ausfüllen.'; errEl.classList.remove('hidden'); return; }
  try {
    stopApprovalPolling();
    document.getElementById('auth-submit-btn').textContent = '…';
    const r = await fetch(`/api/auth/${authMode}`, { // raw-fetch-ok: Login/Register vor Token, eigenes 202-Pending-Handling
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (r.status === 202 && data.pending) {
      errEl.style.color = '#34c759';
      errEl.textContent = '⏳ ' + data.message;
      errEl.classList.remove('hidden');
      switchAuthTab(authMode);
      startApprovalPolling(username, password);
      return;
    }
    errEl.style.color = '';
    if (!r.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); switchAuthTab(authMode); return; }
    authToken    = data.token;
    authUsername = data.username;
    authIsAdmin  = data.is_admin || false;
    localStorage.setItem('auth_token',    authToken);
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
    onAuthSuccess();
  } catch (e) { errEl.textContent = 'Verbindungsfehler.'; errEl.classList.remove('hidden'); switchAuthTab(authMode); }
});

['auth-username','auth-password'].forEach(id =>
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-submit-btn')?.click();
  })
);

// Demo ansehen: meldet sich am festen, vorab freigeschalteten Demo-Account an
// (ohne Registrierung/Telegram-Freischaltung). Existiert noch kein Demo-Fach,
// wird es einmalig automatisch geseedet, damit die Demo sofort gefüllt ist.
document.getElementById('auth-demo-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('auth-demo-btn');
  const errEl = document.getElementById('auth-error');
  errEl.classList.add('hidden'); errEl.style.color = '';
  btn.disabled = true; const label = btn.textContent; btn.textContent = '…';
  try {
    stopApprovalPolling();
    const r = await fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' } }); // raw-fetch-ok: erzeugt erst das Token
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Demo nicht verfügbar.'; errEl.classList.remove('hidden'); return; }
    authToken    = data.token;
    authUsername = data.username;
    authIsAdmin  = false;
    localStorage.setItem('auth_token',    authToken);
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', '0');
    onAuthSuccess();
    // Demo-Fach nur beim allerersten Mal anlegen – danach ist es im Account vorhanden.
    const subs = await DB.subjects();
    if (!subs.length) await loadDemoSubject();
  } catch (e) {
    errEl.textContent = 'Verbindungsfehler.'; errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  authToken = ''; authUsername = '';
  localStorage.removeItem('auth_token'); localStorage.removeItem('auth_username');
  localforage.removeItem('subjects_cache').catch(() => {}); // kein Fremd-Fächer-Flash beim nächsten Login
  showScreen('auth-screen');
});

function onAuthSuccess() {
  sessionExpiredHandled = false;  // a fresh session can expire again later
  document.getElementById('auth-username-badge').textContent = '👤 ' + authUsername;
  const adminPanel = document.getElementById('admin-panel');
  if (adminPanel) adminPanel.classList.toggle('hidden', !authIsAdmin);
  showScreen('setup-screen');
  if (authIsAdmin) loadUsage();
  loadSubjects();
}

async function checkAuth() {
  if (!authToken) { showScreen('auth-screen'); return; }
  try {
    const r = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${authToken}` } }); // raw-fetch-ok: Token-Validierung, eigene 401-Logik
    if (!r.ok) { authToken = ''; localStorage.removeItem('auth_token'); showScreen('auth-screen'); return; }
    const data = await r.json();
    authUsername = data.username;
    authIsAdmin  = data.is_admin || false;
    localStorage.setItem('auth_username', authUsername);
    localStorage.setItem('auth_is_admin', authIsAdmin ? '1' : '0');
    onAuthSuccess();
  } catch { showScreen('auth-screen'); }
}

// ── State ──────────────────────────────────────────────────────────────────
let sessionId      = null;
let sessionMeta    = null;
let sessionTxt     = '';
let kbReady        = false;   // Wissensbasis des Fachs ist serverseitig „ready" → Generierung nutzt schlanken KB-Kontext
let examDocContext  = '';
let customPrompt    = '';
let prefCalculator  = '';
let currentFeature  = 'chat';
let selIcon      = ICONS[0];
let selColor     = COLORS[0];
let selDiff      = 'mittel';
let selAufgabenDiff = 'mittel';
let examAnsVis   = false;
let blitzIdx       = 0;
let blitzResults   = [];
let blitzNext      = null;      // Prefetch: { promise, forIdx } – nächste Blitz-Frage vorab geladen
let scannedTopics  = [];
let moduleStructure = null; // { kapitel: [{titel, lernziel, themen:[...]}], ids:{normName:tid} }
let topicUids      = {};    // { normName: "t_xxxxxxxx" } – stabile IDs, an denen Fortschritt hängt
let selTopic       = null;
let selAufgabenType = 'uebung';
let aufgabenAnsVis  = false;
let currentAufgabe  = '';
let currentCheatText     = '';
let currentAufgabenResult = '';
let currentExamText      = '';
let learnedTopics        = [];
let currentExplainerTopic = null;
let currentUnit          = null;   // aktuelle Lerneinheit (1 Thema ODER zusammengesetzt, s. pathUnits)
let rechnenDiff     = 'mittel';
let rechnenLastFeedback = '';   // letztes Prüf-Feedback derselben Aufgabe (konsistente Re-Prüfung)
let rechnenAttempts = 0;        // wie oft dieselbe Aufgabe schon geprüft wurde → Eskalations-Bremse beim Re-Check
let rechnenLastCheckSig = '';   // Signatur (Striche+Text+Aufgabe) der zuletzt geprüften Lösung → Re-Check ohne Änderung spart den API-Call
let rechnenNextTask = null;     // Prefetch: { promise, diff, forSession } – nächste Aufgabe vorab geladen
let rechnenLoesung  = null;     // Prefetch: { aufgabe, promise, text } – Musterlösung vorab generiert
let mathCtx         = null;
let isDrawingCanvas = false;
let isErasing       = false;
let canvasLastX     = 0, canvasLastY = 0;
let canvasLastMidX  = 0, canvasLastMidY = 0; // letzter Kurven-Mittelpunkt (Glättung)
let canvasPtBuf     = [];             // gepufferte Punkte, einmal pro Frame gezeichnet (rAF)
let canvasRaf       = 0;              // laufende requestAnimationFrame-ID (0 = keine)
// Striche als Vektoren (Punkt-Listen) statt Bitmap-Snapshots. Damit kostet das
// Strich-Ende KEIN getImageData mehr (auf dem iPad ~24 MB GPU-Readback, der beim
// schnellen Schreiben zwischen jedem kurzen Strich stockte). Undo/Redo = neu zeichnen.
let strokes         = [];             // committete Striche: { tool, color, size, pts:[{x,y,p}] }
let redoStrokes     = [];             // für Redo zurückgelegte Striche
let currentStroke   = null;           // gerade in Arbeit
let baseImage       = null;           // geladenes PNG (Vorsession) als Hintergrund-Ebene
let canvasStylusId  = null;           // touch.identifier des aktuell zeichnenden Stifts (null = keiner)
let canvasJumpSkips = 0;              // aufeinanderfolgend verworfene Ausreißer-Samples (Handballen-Sprung)
let lastInkTs       = 0;              // Zeitstempel des letzten Schreib-Ereignisses – Tab-Klick-Schutz gegen Handflächen-Taps
let fingerScrollId  = null;           // touch.identifier des Fingers, der gerade scrollt
let fingerStartY    = 0;
let wrapScrollStart = 0;
let savedCanvasData = null;
let penColor        = '#1c1c1e';
let penSize         = 'medium';   // 'fine' | 'medium' | 'thick'
let activeTool      = 'pen';      // 'pen' | 'eraser' | 'highlighter' | 'line'

// ── DB (server-backed) ────────────────────────────────────────────────────
// Session-expiry handling. A 401 from any api() call means the token is gone or
// expired; without this the many `.catch(() => [])` call sites would just show
// empty data with no hint to re-login. Idempotent so parallel 401s (e.g. the
// burst of loads on a page open) only redirect once.
let sessionExpiredHandled = false;
function handleAuthExpired() {
  // Kein Token gesendet ⇒ keine abgelaufene Sitzung, sondern nie eingeloggt:
  // ein 401 auf einem ungeschützten Pfad (z.B. Streak-Load beim ersten Öffnen)
  // darf KEINEN "Sitzung abgelaufen"-Toast auslösen.
  if (!authToken) return;
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  authToken = ''; authUsername = '';
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  localStorage.removeItem('auth_is_admin');
  localforage.removeItem('subjects_cache').catch(() => {}); // kein Fremd-Fächer-Flash beim nächsten Login
  stopApprovalPolling();
  showScreen('auth-screen');
  toast('Deine Sitzung ist abgelaufen – bitte melde dich neu an.', 'warn', 5000);
}

const api = (url, opts = {}) =>
  fetch(url, {
    headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
    ...opts,
  }).then(r => {
    if (r.status === 401) { handleAuthExpired(); throw new Error('Sitzung abgelaufen'); }
    return r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.status); });
  });

const DB = {
  // ── Server ──────────────────────────────────────────────────────────────
  subjects:     () => api('/api/subjects').catch(() => []),
  addSubject:   s  => api('/api/subjects', { method: 'POST', body: JSON.stringify({ id: s.id, name: s.name, emoji: s.icon || s.emoji || '📚', color: s.color || '#5856d6' }) }),
  delSubject:   id => api(`/api/subjects/${id}`, { method: 'DELETE' }),

  messages:     id => api(`/api/subjects/${id}/messages`).catch(() => []),
  addMessage:   (id, role, content) => api(`/api/subjects/${id}/messages`, {
    method: 'POST', body: JSON.stringify({ role, content }),
  }).catch(() => {}),
  clearMessages: id => api(`/api/subjects/${id}/messages`, { method: 'DELETE' }),

  cards:    id    => api(`/api/subjects/${id}/cards`).catch(() => []),
  setCards: (id, cards) => api(`/api/subjects/${id}/cards`, {
    method: 'POST', body: JSON.stringify({ cards }),
  }),

  addQuizResult: (id, score, total) => api(`/api/subjects/${id}/quiz`, {
    method: 'POST', body: JSON.stringify({ score, total }),
  }).catch(() => {}),
  quizResults: id => api(`/api/subjects/${id}/quiz`).catch(() => []),

  streak: async () => {
    try { const s = await api('/api/streak'); return { count: s.count, lastDate: s.last_date }; }
    catch { return { count: 0, lastDate: null }; }
  },
  setStreak: v => api('/api/streak', {
    method: 'POST', body: JSON.stringify({ count: v.count, last_date: v.lastDate }),
  }).catch(() => {}),

  setGlossar: (id, terms) => api(`/api/subjects/${id}/glossar`, {
    method: 'POST', body: JSON.stringify({ terms }),
  }),

  stats: id => api(`/api/subjects/${id}/stats`).catch(() => null),

  // ── Local-only (ephemeral / preferences) ────────────────────────────────
  darkMode:    () => localforage.getItem('dark_mode'),
  setDarkMode: v  => localforage.setItem('dark_mode', v),
  meta:        id => localforage.getItem(`meta_${id}`),
  setMeta:     (id, v) => localforage.setItem(`meta_${id}`, v),
  content:     id => localforage.getItem(`cnt_${id}`).then(v => v || ''),
  setContent:  (id, v) => localforage.setItem(`cnt_${id}`, v),

  savedAufgaben: id => api(`/api/subjects/${id}/aufgaben`).catch(() => []),
  saveAufgabe: (id, entry) => api(`/api/subjects/${id}/aufgaben`, {
    method: 'POST', body: JSON.stringify(entry),
  }).catch(() => {}),
  delAufgabe: (id, entryId) => api(`/api/subjects/${id}/aufgaben/${entryId}`, {
    method: 'DELETE',
  }).catch(() => {}),

  async del(id) {
    await Promise.all([
      this.delSubject(id),
      localforage.removeItem(`meta_${id}`),
      localforage.removeItem(`cnt_${id}`),
      api(`/api/subjects/${id}/cheat`,  { method: 'DELETE' }).catch(() => {}),
      api(`/api/subjects/${id}/topics`, { method: 'DELETE' }).catch(() => {}),
    ]);
  },
};

// ── Streak ─────────────────────────────────────────────────────────────────
async function touchStreak() {
  const s = await DB.streak();
  const today = new Date().toDateString();
  const yest  = new Date(Date.now() - 86400000).toDateString();
  if (s.lastDate === today) return s.count;
  s.count = (s.lastDate === yest) ? s.count + 1 : 1;
  s.lastDate = today;
  await DB.setStreak(s);
  renderStreak(s.count);
  return s.count;
}

async function renderStreak(count) {
  if (count === undefined) {
    const s = await DB.streak();
    const today = new Date().toDateString();
    const yest  = new Date(Date.now() - 86400000).toDateString();
    count = (s.lastDate === today || s.lastDate === yest) ? s.count : 0;
  }
  const el = document.getElementById('streak-badge');
  if (!el) return;
  el.textContent = count > 0 ? `🔥 ${count}` : '';
  el.classList.toggle('hidden', count === 0);
}

// ── Anthropic API (via server proxy) ──────────────────────────────────────
function friendlyApiError(errStr, status) {
  if (status === 529 || (errStr && errStr.includes('overloaded')))
    return 'Claude ist gerade überlastet – bitte kurz warten und erneut versuchen.';
  if (status === 429 || (errStr && errStr.includes('Tageslimit')))
    return errStr || 'Tageslimit erreicht.';
  return errStr || `Serverfehler ${status}`;
}

async function claude(messages, systemBlocks, maxTokens = 1500, opts = {}) {
  const body = { messages, system: systemBlocks, max_tokens: maxTokens, feature: currentFeature };
  // Server-RAG nur anfordern, wenn wir NICHT ohnehin die vollen Unterlagen mitschicken.
  if (!opts.noRag) body.subject_id = sessionId;
  // Phase 3: erlaubt dem Server, bei bereiter Wissensbasis auf das günstige Haiku zu wechseln.
  if (opts.kbChat) body.kb_chat = true;
  const r = await fetch('/api/claude', { // raw-fetch-ok: eigene friendlyApiError-Behandlung + content[0].text
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(friendlyApiError(e.error, r.status));
  }
  return (await r.json()).content[0].text;
}

// ── Local model via Ollama (free, for batch tasks) ────────────────────────
async function claudeLocal(messages, systemBlocks, maxTokens = 2000, opts = {}) {
  const r = await fetch('/api/local', { // raw-fetch-ok: eigene Fehlerbehandlung + content[0].text
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens, feature: currentFeature, ...opts }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// Generierungs-Pfade (Aufgaben/Quiz/Musterlösung/Antwort-Bewertung): Bei bereiter
// Wissensbasis schickt der Client NICHT mehr den vollen 40k-Doku-Dump, sondern lässt
// den Server den schlanken, semantisch passenden KB-Kontext injizieren (omitDocs +
// subject_id + kb_query). Ist die KB nicht bereit (oder fehlt eine Query), exakt das
// bisherige Verhalten: volle Unterlagen im System-Prompt.
function claudeLocalKb(messages, prompt, maxTokens = 2000, query = '', opts = {}) {
  const q = String(query || '').trim();
  if (kbReady && q) {
    const body = { subject_id: sessionId, kb_query: q.slice(0, 500) };
    if (opts.kbK) body.kb_k = opts.kbK;
    return claudeLocal(messages, sysBlocks(prompt, { omitDocs: true }), maxTokens, body);
  }
  return claudeLocal(messages, sysBlocks(prompt), maxTokens);
}

// Escape the most common local-model JSON breakage: literal newline/CR/tab
// characters inside string values, which make JSON.parse throw.
function repairJson(s) {
  // Manche Modelle splitten lange Werte als JS-String-Konkatenation
  // ("...text\n\n" + "<svg …>") – in JSON ungültig, JSON.parse stirbt am '+'
  // und salvageTruncatedJson kappt den Wert genau davor (→ eingebettetes SVG/
  // Diagramm + Folgefelder gehen verloren). Zwei per '+' verbundene String-
  // Literale zu einem zusammenführen. Negativer Lookbehind schützt ein
  // escaptes Quote (\") davor, fälschlich als Stringgrenze gewertet zu werden.
  s = s.replace(/(?<!\\)"\s*\+\s*"/g, '');
  let inStr = false, esc = false, out = '';
  for (const c of s) {
    if (esc)        { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true;  continue; }
    if (c === '"')  { out += c; inStr = !inStr; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
}

// Tolerant JSON.parse for an already-extracted object/array string: retries
// once with the repair pass. Throws (like JSON.parse) if still unparseable, so
// callers' existing try/catch keep working — but the common newline case now
// recovers instead of failing the whole feature.
function parseJsonLoose(str) {
  try { return JSON.parse(str); } catch {}
  return JSON.parse(repairJson(str));
}

// Extract and parse the first JSON object from a model response.
// Handles plain JSON, code-fenced ```json...``` blocks, and the most common
// local-model failure mode: literal newline/CR characters inside string values.
function parseJsonResponse(raw) {
  function tryParse(s) {
    try { return JSON.parse(s); } catch {}
    try { return JSON.parse(repairJson(s)); } catch {}
    return null;
  }
  const cb = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (cb) { const r = tryParse(cb[1]); if (r) return r; }
  const ob = raw.match(/\{[\s\S]*\}/);
  if (ob) { const r = tryParse(ob[0]); if (r) return r; }
  // Last resort: max_tokens hat das JSON mitten im String gekappt (keine
  // schließende "}") – längsten gültigen Präfix retten, offene Strings/Klammern
  // schließen. Rettet z.B. eine Blitz-Frage, deren "explanation" abgeschnitten ist.
  return salvageTruncatedJson(raw) || null;
}

// True, wenn sich das Roh-JSON NUR per Salvage retten ließ (kein sauber schließendes
// Objekt) – Indiz, dass max_tokens den Inhalt abgeschnitten hat und hintere Felder/
// Texte fehlen. Genutzt, um abgehackte Erklärungen NICHT dauerhaft zu cachen.
function jsonWasTruncated(raw) {
  const ob = String(raw || '').match(/\{[\s\S]*\}/);
  if (!ob) return true;
  try { JSON.parse(ob[0]); return false; } catch {}
  try { JSON.parse(repairJson(ob[0])); return false; } catch {}
  return true;
}

// Versucht, ein abgeschnittenes JSON-Objekt zu reparieren: kürzt vom Ende her,
// schließt einen offenen String und die offenen {} / [] und parst den längsten
// Teil, der noch valide ist. Gibt null zurück, wenn nichts zu retten ist.
function salvageTruncatedJson(raw) {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  const s = raw.slice(start);
  for (let end = s.length; end > 1; end--) {
    const frag = s.slice(0, end);
    let inStr = false, esc = false;
    const stack = [];
    for (const c of frag) {
      if (esc)        { esc = false; continue; }
      if (c === '\\') { esc = true;  continue; }
      if (c === '"')  { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    let cand = frag;
    if (inStr) cand += '"';
    cand = cand.replace(/[,:]\s*$/, '');       // hängendes Komma/Doppelpunkt kappen
    for (let i = stack.length - 1; i >= 0; i--) cand += stack[i];
    try { return JSON.parse(cand); } catch {}
    try { return JSON.parse(repairJson(cand)); } catch {}
  }
  return null;
}

async function claudeLocalStream(messages, systemBlocks, maxTokens = 3000, onToken) {
  const r = await fetch('/api/local/stream', { // raw-fetch-ok: SSE-Streaming, liest body als Stream
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Serverfehler ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = '', buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // Keep the trailing (possibly incomplete) line for the next chunk.
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const d = line.slice(6).trim();
      if (d === '[DONE]') return full;
      let parsed;
      try { parsed = JSON.parse(d); }
      catch { continue; }   // ignore malformed/partial lines, never abort the stream
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.token) { full += parsed.token; onToken(full); }
    }
  }
  return full;
}

// ── Local vision via Ollama (falls back to cloud if model not available) ──
async function claudeLocalVision(base64, textPrompt, systemBlocks, maxTokens = 1500) {
  try {
    const r = await fetch('/api/local/vision', { // raw-fetch-ok: eigener Cloud-Fallback bei Fehler
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ base64, media_type: 'image/png', text: textPrompt,
                             system: systemBlocks, max_tokens: maxTokens }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`);
    return (await r.json()).content[0].text;
  } catch {
    return claudeVision(base64, textPrompt, systemBlocks, maxTokens);
  }
}

// ── Anthropic Vision API (via server proxy) ────────────────────────────────
async function claudeVision(base64, textPrompt, systemBlocks, maxTokens = 1500) {
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: textPrompt },
    ],
  }];
  const r = await fetch('/api/claude', { // raw-fetch-ok: Vision-Aufruf, eigene friendlyApiError-Behandlung
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ messages, system: systemBlocks, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Serverfehler ${r.status}`);
  }
  return (await r.json()).content[0].text;
}

// ── PDF Extraction ─────────────────────────────────────────────────────────
// Eine Seite gilt als Bild-/Scan-Seite, wenn ihre Textebene weniger als
// PDF_OCR_MIN_CHARS Nicht-Whitespace-Zeichen liefert → dann wird sie gerendert
// und per Vision-OCR gelesen. Die Render-Auflösung zielt auf PDF_OCR_TARGET_EDGE
// (längste Kante in px), gedeckelt durch PDF_OCR_MAX_SCALE (Speicher/Token).
const PDF_OCR_MIN_CHARS   = 20;
const PDF_OCR_TARGET_EDGE = 2000;
const PDF_OCR_MAX_SCALE   = 3;
// Grafik-Slide-Erkennung: Vorlesungsfolien tragen oft eine Fußzeile (Name/©/
// Seitenzahl) auf JEDER Seite. Ein Schaubild (z. B. SMART-Pyramide, BCG-Matrix)
// liegt dann als seitenfüllendes Bild vor, während die Textebene nur die
// Fußzeile liefert → die <20-Zeichen-Regel greift nicht und der Bildinhalt geht
// verloren. Deshalb: Seiten mit einem großen Bild (≥ PDF_OCR_IMG_COVERAGE der
// Seitenfläche) UND spärlicher Textebene (< PDF_OCR_SPARSE_CHARS, i. d. R. nur
// Fußzeile/Titel) ebenfalls per OCR lesen. PDF_OCR_MAX_IMG_PAGES deckelt die
// Kosten pro Dokument (jede OCR-Seite ist ein Vision-Call).
const PDF_OCR_SPARSE_CHARS  = 200;
const PDF_OCR_IMG_COVERAGE  = 0.45;
const PDF_OCR_MAX_IMG_PAGES = 40;
// Unter dieser Zahl Nicht-Whitespace-Zeichen (ohne den "=== Datei ==="-Header) gilt
// ein extrahiertes Dokument als faktisch leer und wird NICHT gespeichert: solche
// Docs (Bild-PDFs, deren OCR fehlschlug) lieferten bisher weder RAG-Kontext noch
// Themen, tauchten aber als "erfolgreich hochgeladen" auf – 13 Stück im Bestand.
const PDF_MIN_USABLE_CHARS  = 40;
const PDF_OCR_SYS = 'Du bist eine präzise OCR-Engine für deutschsprachige Studien- und Schulunterlagen. Du gibst den Text einer Dokumentseite exakt und vollständig wieder.';
const PDF_OCR_PROMPT = `Transkribiere den GESAMTEN Inhalt dieser Dokumentseite als reinen Text – exakt so, wie er dasteht. Gib NUR den Inhalt zurück: keine Einleitung, keine Kommentare, keine Code-Fences. Behalte Überschriften, Absätze, Aufzählungen und Tabellenzeilen in sinnvoller Lesereihenfolge bei. Formeln in Klartext bzw. LaTeX. Rein bildliche Abbildungen (Fotos, Grafiken ohne Text) NICHT beschreiben. Ist die Seite leer, antworte mit gar nichts.`;

// Eine PDF-Seite ohne verwertbare Textebene als Bild rendern und per Vision-OCR
// transkribieren – so werden gescannte/abfotografierte PDFs trotzdem erfasst.
async function ocrPdfPage(page) {
  const base     = page.getViewport({ scale: 1 });
  const scale    = Math.min(PDF_OCR_MAX_SCALE, PDF_OCR_TARGET_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas   = document.createElement('canvas');
  canvas.width   = Math.max(1, Math.round(viewport.width));
  canvas.height  = Math.max(1, Math.round(viewport.height));
  const ctx      = canvas.getContext('2d');
  ctx.fillStyle  = '#ffffff';   // weißer Grund, falls die Seite transparente Bereiche hat
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const txt    = await claudeLocalVision(base64, PDF_OCR_PROMPT, [{ type: 'text', text: PDF_OCR_SYS }], 2000);
  return (txt || '').trim();
}

// Bild-Operatoren, deren gezeichnete Fläche wir gegen die Seitenfläche messen.
const PDF_IMAGE_OPS = new Set([
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintInlineImageXObject,
  pdfjsLib.OPS.paintImageMaskXObject,
  pdfjsLib.OPS.paintImageXObjectRepeat,
].filter(v => v != null));

// Größter Anteil der Seitenfläche, den ein einzelnes Bild bedeckt (0…1). Wir
// verfolgen dazu die aktuelle Transformationsmatrix (CTM) durch die Operator-
// liste; Bilder werden im Einheitsquadrat [0,1]² gezeichnet, ihre Kantenlänge in
// Nutzereinheiten ist also die Skalierung der CTM.
async function pageImageCoverage(page) {
  let opList;
  try { opList = await page.getOperatorList(); } catch { return 0; }
  const OPS = pdfjsLib.OPS;
  const vp = page.getViewport({ scale: 1 });
  const pageArea = vp.width * vp.height;
  if (!pageArea) return 0;
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1],       a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],       a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let maxFrac = 0;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ctm, opList.argsArray[i]);
    else if (PDF_IMAGE_OPS.has(fn)) {
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      const frac = (w * h) / pageArea;
      if (frac > maxFrac) maxFrac = frac;
    }
  }
  return maxFrac;
}

async function extractPDF(file, onProgress) {
  const ab  = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text  = `\n\n=== ${file.name} ===\n`;
  let ocrPages    = 0;   // Seiten, deren Text durch OCR ersetzt wurde
  let ocrFailed   = 0;   // Seiten, die OCR brauchten, aber keinen Text lieferten
  let imgOcrTries = 0;   // Grafik-Slide-OCR-Versuche (kostengedeckelt)
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    let pageText  = content.items.map(it => it.str).join(' ').trim();
    const nonWs   = pageText.replace(/\s/g, '').length;
    // Bild-/Scan-Seite: kaum extrahierbarer Text → Seite per Vision-OCR lesen.
    let needOcr = nonWs < PDF_OCR_MIN_CHARS;
    // Grafik-Slide mit nur Fußzeilen-Text: großes Bild + spärliche Textebene →
    // der Bildinhalt (Schaubilder) ginge sonst verloren. Kosten gedeckelt.
    if (!needOcr && nonWs < PDF_OCR_SPARSE_CHARS && imgOcrTries < PDF_OCR_MAX_IMG_PAGES) {
      const cov = await pageImageCoverage(page).catch(() => 0);
      if (cov >= PDF_OCR_IMG_COVERAGE) { needOcr = true; imgOcrTries++; }
    }
    if (needOcr) {
      if (onProgress) onProgress(i - 1, pdf.numPages, 'ocr');
      const ocr = await ocrPdfPage(page).catch(() => '');
      // OCR liest die ganze Seite inkl. Fußzeile → längeres Ergebnis übernehmen,
      // damit der Grafik-Inhalt hinzukommt statt den Fußzeilentext zu ersetzen.
      if (ocr.length > pageText.length) { pageText = ocr; ocrPages++; }
      // Bild-Seite blieb trotz OCR (praktisch) leer → zählen, damit der Upload das
      // ehrlich melden kann statt eine stumm halbleere Datei als Erfolg zu verkaufen.
      if (pageText.replace(/\s/g, '').length < PDF_OCR_MIN_CHARS) ocrFailed++;
    }
    text += pageText + '\n';
    if (onProgress) onProgress(i, pdf.numPages);
  }
  return { text: text.trim(), pages: pdf.numPages, name: file.name, ocrPages, ocrFailed };
}

// ── System prompt builder ──────────────────────────────────────────────────
// Liefert den Lernstoff für Prompts. Bei sehr großem Material (viele Dokumente)
// wird gleichmäßig über Anfang, Mitte und Ende gesampelt, damit ALLE Themen
// abgedeckt sind – nicht nur die ersten Seiten des ersten Dokuments.
function docsForPrompt(limit = 40000) {
  if (!sessionTxt) {
    return '(noch keine Dokumente hochgeladen – weise den Studenten darauf hin, Unterlagen hochzuladen)';
  }
  if (sessionTxt.length <= limit) return sessionTxt;
  const headLen = Math.floor(limit * 0.45);
  const midLen  = Math.floor(limit * 0.30);
  const tailLen = limit - headLen - midLen;
  const midStart = Math.floor(sessionTxt.length / 2 - midLen / 2);
  const head = sessionTxt.slice(0, headLen);
  const mid  = sessionTxt.slice(midStart, midStart + midLen);
  const tail = sessionTxt.slice(sessionTxt.length - tailLen);
  return `${head}\n\n[…Auszug aus der Mitte der Unterlagen…]\n\n${mid}\n\n[…Auszug vom Ende der Unterlagen…]\n\n${tail}`;
}

// Fetches a short snippet from EVERY document individually → breadth-first coverage.
// Fixes the bias where docsForPrompt() would return only the first documents' content.
async function buildDocOverview() {
  if (!sessionId) return null;
  try {
    const docs = await api(`/api/subjects/${sessionId}/documents/snippets`);
    if (!Array.isArray(docs) || !docs.length) return null;
    return docs.map(d => `[Dokument: ${d.filename}]\n${d.snippet}`).join('\n\n---\n\n');
  } catch { return null; }
}

// Persönliche Anweisungen des Studenten als anhängbarer Prompt-Block (oder '',
// wenn keine gesetzt sind). Damit fließen sie auch in Pfade ein, die nicht über
// sysBlocks laufen – z.B. Phase 1 der Lernstruktur-Analyse (Hauptthemen-Wahl).
function persInstrText() {
  return customPrompt
    ? '\n\n--- PERSÖNLICHE ANWEISUNGEN DES STUDENTEN (berücksichtigen!) ---\n' + customPrompt + '\n--- ENDE ---'
    : '';
}

// Vorstufe für den Themen-Scan (v215): die freien "Persönlichen Anweisungen" zu einer
// klaren Liste themen-auswahl-relevanter Vorgaben destillieren (Weglassen / Schwerpunkt /
// Umfang). Vager Fließtext wird so zu harten Regeln, die der Scan tatsächlich befolgen
// kann. Liefert den Vorgaben-Text oder '' (nichts Auswahl-Relevantes / kein Prompt).
async function distillScanDirectives() {
  const txt = (customPrompt || '').trim();
  if (!txt) return '';
  try {
    const raw = await claudeLocal(
      [{ role: 'user', content: txt }],
      [{ type: 'text', text: `Du extrahierst aus den persönlichen Anweisungen eines Studenten NUR die Aussagen, die die AUSWAHL der Lernthemen betreffen: welche Themen/Kapitel weggelassen werden sollen, welche besonders wichtig oder klausurrelevant sind, welcher Stoffumfang gilt. Ignoriere alles andere (Bewertungsstil, Taschenrechner, reine Formalia).
Antworte als kompakte Stichpunktliste auf Deutsch, exakt in diesen drei Zeilen:
WEGLASSEN: <Themen/Bereiche, die NICHT vorkommen sollen – oder —>
SCHWERPUNKT: <Themen, die unbedingt rein müssen / betont werden – oder —>
UMFANG: <Einschränkungen wie bestimmte Kapitel/Bereiche – oder —>
Wenn KEINE themen-auswahl-relevante Aussage existiert, antworte exakt mit: KEINE` }],
      300
    );
    const out = (raw || '').trim();
    return (!out || /^KEINE\b/i.test(out)) ? '' : out;
  } catch { return ''; }
}

// Aus den destillierten Vorgaben einen verbindlichen Prompt-Block bauen (oder '').
// Eigene reine Funktion → testbar. Macht klar, dass diese Vorgaben VORRANG vor der
// Vollständigkeit haben, damit "weglassen"-Wünsche nicht von "decke alles ab" überstimmt werden.
function scanDirectiveBlock(directives) {
  const d = (directives || '').trim();
  if (!d) return '';
  return `\n\nVERBINDLICHE VORGABEN DES STUDENTEN (aus seinen Anweisungen abgeleitet) – diese haben VORRANG vor Vollständigkeit:\n${d}\nBefolge sie strikt: Lasse unter WEGLASSEN genannte Themen WEG, auch wenn sie in den Unterlagen vorkommen. Nimm die unter SCHWERPUNKT genannten unbedingt auf und stelle sie voran.`;
}

function sysBlocks(extra = '', opts = {}) {
  // Hebel 1 (Chat-Sparmodus): Statt der vollen Unterlagen nur ein Hinweis, dass die
  // relevanten Auszüge separat geliefert werden (Server-RAG bei /api/claude). Spart
  // den großen ~12k-Token-Doku-Block. NUR für den Chat-Pfad nutzen – /api/local hat
  // keine Server-RAG und braucht die vollen Unterlagen.
  const omitDocs = opts.omitDocs === true;
  const docsSection = omitDocs
    ? 'Die für die aktuelle Frage relevanten Auszüge aus den Unterlagen werden dir separat als "Dokumenten-Kontext" bereitgestellt. Nutze AUSSCHLIESSLICH diese Auszüge als Wissensquelle. Findest du dort nichts Passendes, sage das offen und bitte den Studenten, gezielter mit konkreten Stichwörtern nachzufragen.'
    : docsForPrompt();
  const head = {
      type: 'text',
      text: `Du bist ein erfahrener Nachhilfelehrer für das Fach "${sessionMeta?.name || ''}". Du verwendest gezielt moderne lernpsychologische Methoden.

WICHTIG – QUELLENREGEL:
Beantworte Fragen AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen und der persönlichen Anweisungen des Studenten.
Nutze KEIN Allgemeinwissen, keine Lehrbücher und keine Informationen aus dem Internet.
Wenn eine Frage mit den vorhandenen Unterlagen nicht beantwortet werden kann, sage klar: "Das steht so nicht in deinen Unterlagen – lade bitte das entsprechende Dokument hoch."
Halte dich bei Erklärungen an die Formulierungen und Definitionen aus den Unterlagen, da der Dozent diese Art der Darstellung in Prüfungen erwartet.

RECHNERISCHE WAHRHEIT (bei Aufgaben mit konkretem Ergebnis):
• Eine Rechnung hat genau EIN richtiges Endergebnis. Verschiedene Lösungswege müssen alle zu genau diesem Ergebnis führen.
• Führen zwei Wege zu unterschiedlichen Ergebnissen, ist mindestens einer falsch. Behaupte NIEMALS, beide seien richtig – das wäre ein Fehler, kein Entgegenkommen.
• Wirst du gefragt, ob mehrere Wege/Ergebnisse stimmen: Rechne das Ergebnis Schritt für Schritt NEU nach, lege dich auf das eine korrekte Ergebnis fest und zeige konkret, an welcher Stelle sich der falsche Weg verrechnet hat. Gefälligkeit ("beide stimmen", "kommt aufs Gleiche raus") ist hier verboten.

DEINE LEHRPHILOSOPHIE:
• Verständnis vor Auswendiglernen: Erkläre immer das WARUM und den Hintergrund eines Konzepts
• Konkrete Beispiele: Verankere abstrakte Theorie immer in realen, greifbaren Alltagssituationen
• Analogien & Metaphern: Nutze bildhafte Vergleiche um schwierige Konzepte intuitiv verständlich zu machen
• Vorwissen aktivieren: Baue neue Konzepte bewusst auf bereits bekannten Ideen auf ("Das kennst du bereits von X – hier ist es ähnlich, nur…")
• Socratic Method: Führe Lernende durch gezielte Fragen zur Erkenntnis, statt Antworten nur zu servieren
• Fehler als Lernchance: Erkläre präzise wo das Denken schiefgelaufen ist – wertschätzend und konstruktiv
• Chunking: Zerlege komplexe Themen in kleine, verdauliche Einheiten mit klarer Struktur
• Elaboration: Verknüpfe neues Wissen mit anderen Konzepten aus dem Fach ("Das hängt zusammen mit…")
• Retrieval fördern: Rege aktives Erinnern an statt passives Lesen ("Was weißt du noch über…?")
• Lernpsychologie: Kennst du Erkenntnisse aus der Kognitionspsychologie (Arbeitsgedächtnis, Cognitive Load, Spaced Repetition) und wendest sie praktisch an

ANTWORTFORMAT IM CHAT:
1. Kurze Kernaussage (1–2 Sätze)
2. Erklärung mit konkretem Beispiel aus der Praxis
3. Den Hintergrund / das "Warum funktioniert das so?"
4. Optional: eine einprägsame Eselsbrücke oder Verknüpfung zu anderen Konzepten

--- UNTERLAGEN (einzige erlaubte Wissensquelle) ---
${docsSection}
--- ENDE DER UNTERLAGEN ---

DIAGRAMME: Wenn es das Verständnis fördert, erstelle Mermaid-Diagramme in \`\`\`mermaid ... \`\`\` Blöcken.
Verfügbare Typen: flowchart TD (Abläufe/Strukturen), mindmap (Konzepte), sequenceDiagram (Prozesse/Interaktionen).
Halte Diagramme einfach – max. 8 Knoten. Nur einsetzen wenn es wirklich hilft.

MATHEMATIK: Für mathematische Formeln und Gleichungen verwende LaTeX-Notation.
Inline-Formeln NUR mit Dollarzeichen: $E = mc^2$  |  Block-Formeln (zentriert, groß): $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$
Verwende NIEMALS \\( \\) oder \\[ \\] als Formel-Begrenzer – ausschließlich $ … $ bzw. $$ … $$.
Auch einzelne Rechenzeichen/Terme in Mathe-Kontext gehören in $…$ (z.B. $3 \\cdot 4 = 12$, $\\frac{a}{b}$, $x^2$), damit sie sauber gerendert werden.
Verwende LaTeX immer wenn Formeln, Gleichungen, Summen, Integrale, Matrizen oder griechische Buchstaben vorkommen.

TABELLEN: Für Vergleiche/Gegenüberstellungen nutze Markdown-Tabellen im Pipe-Format mit Trennzeile, z.B.:
| Aspekt | A | B |
|---|---|---|
| Ort | … | … |
Jede Zeile in einer eigenen Textzeile, keine Tabellen in Fließtext quetschen.

Antworte immer auf Deutsch.${prefCalculator ? `\n\nTASCHENRECHNER: Der Student nutzt einen ${prefCalculator}. Gib bei Rechenaufgaben gezielte Tipps wie man die Berechnung auf diesem Modell effizient eingibt — Tasten, Menüpfade, Modi, nützliche eingebaute Funktionen. Erwähne konkrete Schritte (z.B. "Drücke MENU → 4 → 2" beim Casio).` : ''}${customPrompt ? '\n\n--- PERSÖNLICHE ANWEISUNGEN DES STUDENTEN ---\n' + customPrompt + '\n--- ENDE ---' : ''}`,
  };
  // Sparmodus-Block ist klein → kein Caching (unter der Mindestgröße sowieso
  // nicht cachebar); voller Doku-Block wird 1h gecacht.
  if (!omitDocs) head.cache_control = { type: 'ephemeral', ttl: '1h' };
  const blocks = [head];
  // Aufruf-spezifische Instruktionen (z.B. Quiz-Prompt mit der Liste bereits
  // gestellter Fragen) wechseln pro Anfrage. Sie kommen in einen EIGENEN, nicht
  // gecachten Block NACH dem Cache-Breakpoint – so bleibt der teure Unterlagen-
  // Block byte-identisch und der Prompt-Cache greift über alle Fragen hinweg.
  if (extra) blocks.push({ type: 'text', text: extra });
  return blocks;
}

// Hebel 1 – entscheidet pro Chat-Nachricht, ob die VOLLEN Unterlagen mitgehen
// (teuer, aber vollständig) oder nur die Server-RAG-Auszüge (billig).
const CHAT_FULLDOCS_MAX = 16000;   // kleine Fächer (<= ~4k Tokens): immer voll, ist eh billig
// Klare Vertiefungs-/Nachhak-Marker zur vorigen Antwort.
const CHAT_DEEPEN_RE = /(genauer|ausführlich|detaillier|im detail|tiefer|mehr dazu|noch mehr|nochmal|noch mal|schritt für schritt|vollständig|überblick|zusammenfass|was meinst|wie meinst|versteh.* ich nicht|nicht ganz|kapier)/i;
function chatWantsFullDocs(message) {
  // Kleine Fächer: immer komplett mitschicken (Qualität ohne Mehrkosten).
  if (!sessionTxt || sessionTxt.length <= CHAT_FULLDOCS_MAX) return true;
  const m = (message || '').trim().toLowerCase();
  // Vertiefung/Nachhaken: Begrenzung für diese eine Antwort aufheben.
  if (CHAT_DEEPEN_RE.test(m)) return true;
  // Kurze Nachricht = kaum Inhaltswörter ("warum ist das so?", "und dann?") →
  // die schlagwortbasierte RAG würde kaum greifen, daher volle Unterlagen.
  if (m.split(/\s+/).filter(Boolean).length <= 5) return true;
  return false;
}

// Phase 3 (Admin-Schalter): Chat läuft über die Wissensbasis und darf serverseitig
// auf das günstige Haiku-Modell wechseln, sobald die KB für das Fach bereit ist.
function isKbChatHaiku() { return authIsAdmin && localStorage.getItem('kb_chat_haiku') === '1'; }

// ── Dark Mode ──────────────────────────────────────────────────────────────
async function initDarkMode() {
  try {
    const dark = await DB.darkMode();
    applyDarkMode(dark === true);
  } catch (_) {
    applyDarkMode(false);
  }
}

function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('btn-dark-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

document.getElementById('btn-dark-toggle')?.addEventListener('click', async () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyDarkMode(!isDark);
  await DB.setDarkMode(!isDark);
});

// ── Screens ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sheet-overlay').forEach(o => o.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  else document.querySelector('.screen')?.classList.add('active');
}

// ══ SETUP SCREEN ══════════════════════════════════════════════════════════

document.getElementById('save-key-btn')?.addEventListener('click', saveApiKey);

async function saveApiKey() {
  // Legacy: kept for compatibility, but no API key needed when using server
  showScreen('subjects-screen');
  loadSubjects();
}


async function loadUsage() {
  try {
    const u = await api('/api/usage');
    if (!u.is_admin) return;
    const pct = Math.min(100, (u.today.cost_eur / u.limit_eur) * 100);
    const color = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--green)';
    document.getElementById('usage-cost').textContent = `${u.today.cost_eur.toFixed(3)}€`;
    document.getElementById('usage-cost').style.color = color;
    document.getElementById('usage-limit').textContent = `${u.limit_eur.toFixed(2)}€ / Tag`;
    document.getElementById('usage-bar').style.width = pct + '%';
    document.getElementById('usage-bar').style.background = color;
    const inp = document.getElementById('admin-limit-input');
    if (inp && !inp.value) inp.value = u.limit_eur.toFixed(2);
    const kbToggle = document.getElementById('kb-chat-haiku-toggle');
    if (kbToggle) kbToggle.checked = localStorage.getItem('kb_chat_haiku') === '1';
    loadAdminUserStats();
    // Show pending user count badge
    api('/api/admin/pending-count').then(r => {
      const btn = document.getElementById('admin-users-btn');
      if (btn && r.count > 0) btn.textContent = `👥 Benutzer verwalten · ${r.count} ausstehend ⚠️`;
      else if (btn) btn.textContent = '👥 Benutzer verwalten';
    }).catch(() => {});
  } catch { /* ignore */ }
}


async function loadAdminUserStats() {
  const el = document.getElementById('admin-user-stats');
  if (!el) return;
  try {
    const { users, limit } = await api('/api/admin/user-stats');
    if (!users.length) { el.innerHTML = '<span style="font-size:13px;color:var(--text2);">Keine Nutzer</span>'; return; }
    el.innerHTML = users.map(u => {
      const pct = Math.min(100, (u.today_cost / limit) * 100);
      const col  = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--accent)';
      const status = !u.approved ? '⏳' : '✅';
      return `<div style="background:var(--bg);border-radius:10px;padding:8px 10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-weight:600;font-size:13px;">${status} ${esc(u.username)}</span>
          <span style="font-size:12px;color:var(--text2);">${u.today_cost.toFixed(3)}€ heute · ${u.total_cost.toFixed(2)}€ gesamt</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${pct.toFixed(1)}%;background:${col};border-radius:2px;transition:width .4s;"></div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px;">${u.today_calls} Aufrufe heute · ${u.total_calls} gesamt</div>
      </div>`;
    }).join('');
  } catch (e) { if (el) el.innerHTML = `<span style="color:var(--red);font-size:13px;">${e.message}</span>`; }
}


document.getElementById('kb-chat-haiku-toggle')?.addEventListener('change', e => {
  localStorage.setItem('kb_chat_haiku', e.target.checked ? '1' : '0');
  toast(e.target.checked
    ? 'Chat nutzt jetzt die Wissensbasis + günstiges Modell (wo die KB bereit ist)'
    : 'Chat wieder auf Standard (Sonnet, volle Unterlagen)', 'info');
});

document.getElementById('admin-set-limit-btn')?.addEventListener('click', async () => {
  const val = parseFloat(document.getElementById('admin-limit-input')?.value);
  if (isNaN(val) || val <= 0) { toast('Ungültiger Betrag', 'error'); return; }
  try {
    await api('/api/admin/set-limit', { method: 'POST', body: JSON.stringify({ limit: val }) });
    toast(`Tageslimit auf ${val.toFixed(2)}€ gesetzt`, 'success');
    loadUsage();
  } catch (e) { toast(e.message, 'error'); }
});

// ── Admin user management ──────────────────────────────────────────────────
document.getElementById('admin-users-btn')?.addEventListener('click', () => {
  document.getElementById('admin-users-sheet').classList.remove('hidden');
  loadAdminUsers();
});
document.getElementById('admin-users-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('admin-users-sheet').classList.add('hidden');
});

async function loadAdminUsers() {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '<p style="color:var(--label-secondary);text-align:center;">Lädt…</p>';
  try {
    const users = await api('/api/admin/users');
    list.innerHTML = '';
    users.forEach(u => list.appendChild(buildUserRow(u)));
  } catch (e) {
    list.innerHTML = `<p style="color:var(--red);">${e.message}</p>`;
  }
}

function buildUserRow(u) {
  const isSelf = u.username === authUsername;
  const div = document.createElement('div');
  div.id = `user-row-${u.id}`;
  div.style.cssText = 'background:var(--surface);border-radius:12px;padding:12px 14px;';

  const statusColor = u.approved ? 'var(--green)' : 'var(--yellow)';
  const statusText  = u.approved ? '✅ Aktiv' : '⏳ Ausstehend';
  const adminBadge  = u.is_admin ? '<span style="font-size:11px;background:var(--purple);color:#fff;border-radius:6px;padding:2px 7px;margin-left:6px;">Admin</span>' : '';
  const selfBadge   = isSelf    ? '<span style="font-size:11px;background:var(--blue);color:#fff;border-radius:6px;padding:2px 7px;margin-left:6px;">Du</span>' : '';

  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <span style="font-weight:700;font-size:15px;">👤 ${u.username}</span>${adminBadge}${selfBadge}
      </div>
      <span style="font-size:12px;color:${statusColor};font-weight:600;">${statusText}</span>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      ${!u.approved ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;" onclick="adminApprove(${u.id})">✅ Freischalten</button>` : ''}
      ${!isSelf ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;" onclick="adminToggleAdmin(${u.id},${!u.is_admin})">${u.is_admin ? '⬇️ Admin entfernen' : '⬆️ Admin machen'}</button>` : ''}
      ${!isSelf ? `<button class="btn-secondary" style="font-size:13px;padding:5px 12px;color:var(--red);" onclick="adminDeleteUser(${u.id},'${u.username}')">🗑 Löschen</button>` : ''}
    </div>`;
  return div;
}

async function adminApprove(id) {
  try {
    const r = await api(`/api/admin/users/${id}/approve`, { method: 'POST' });
    toast(`${r.username} wurde freigeschaltet`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminToggleAdmin(id, makeAdmin) {
  try {
    const r = await api(`/api/admin/users/${id}/admin`, {
      method: 'PATCH', body: JSON.stringify({ is_admin: makeAdmin }),
    });
    toast(`${r.username} ist jetzt ${r.is_admin ? 'Admin' : 'kein Admin mehr'}`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminDeleteUser(id, username) {
  if (!await confirmDialog(`Benutzer "${username}" wirklich löschen? Alle Daten werden entfernt.`,
      { title: 'Benutzer löschen', okText: 'Löschen', danger: true })) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast(`${username} gelöscht`, 'success');
    loadAdminUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ══ SUBJECTS SCREEN ════════════════════════════════════════════════════════

function renderSubjects(list) {
  const grid  = document.getElementById('subj-grid');
  const empty = document.getElementById('subj-empty');
  grid.innerHTML = '';
  if (!list.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.forEach(s => grid.appendChild(makeCard(s)));
}

async function loadSubjects() {
  // 1) Sofort aus lokalem Cache zeichnen – kein leerer Screen während des
  //    Server-Roundtrips (stale-while-revalidate).
  let shownCache = false;
  try {
    const cached = await localforage.getItem('subjects_cache');
    if (cached) { renderSubjects(cached); shownCache = true; }
  } catch {}
  // 2) Frische Liste vom Server holen und still aktualisieren. Bei Server-Fehler
  //    bleibt die gecachte Ansicht stehen, statt sie fälschlich zu leeren.
  let list;
  try { list = await api('/api/subjects'); }
  catch { if (!shownCache) renderSubjects([]); return; }
  renderSubjects(list);
  localforage.setItem('subjects_cache', list).catch(() => {});
}

function makeCard(s) {
  const div = document.createElement('div');
  div.className = 'subj-card';
  div.style.borderTopColor = s.color || '#5856d6';
  // Use server-side counts (doc_count/quiz_count) with fallback to local fields
  const docCount  = s.doc_count  ?? s.fileCount  ?? 0;
  const quizCount = s.quiz_count ?? s.quizCount  ?? 0;
  const avgScore  = s.avg_score  ?? s.lastScore  ?? null;
  const meta = docCount
    ? `${docCount} Dok. · ${quizCount ? quizCount + ' Fragen' : 'kein Quiz'}`
    : 'Noch keine Dokumente';
  const scoreHtml = avgScore !== null
    ? `<span class="card-score" style="background:${scoreColor(avgScore)}">${avgScore}%</span>` : '';
  div.innerHTML = `
    <button class="card-del" data-id="${s.id}">×</button>
    <div class="card-icon">${s.emoji || s.icon || '📚'}</div>
    <div class="card-name">${esc(s.name)}</div>
    <div class="card-meta">${meta}</div>
    ${scoreHtml}`;
  div.addEventListener('click', e => { if (!e.target.closest('.card-del')) openSubject(s); });
  div.querySelector('.card-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (!await confirmDialog(`"${s.name}" löschen? Alle Daten gehen verloren.`,
        { title: 'Fach löschen', okText: 'Löschen', danger: true })) return;
    await DB.del(s.id);
    loadSubjects();
  });
  return div;
}

document.getElementById('btn-new-subject')?.addEventListener('click', showSubjModal);
document.getElementById('btn-first-subject')?.addEventListener('click', showSubjModal);

function scoreColor(p) {
  return p >= 70 ? 'var(--green)' : p >= 40 ? 'var(--yellow)' : 'var(--red)';
}

// ══ SUBJECT MODAL ══════════════════════════════════════════════════════════

function buildIconGrid() {
  const g = document.getElementById('icon-grid');
  g.innerHTML = '';
  ICONS.forEach(ic => {
    const b = document.createElement('button');
    b.className = 'icon-btn' + (ic === selIcon ? ' selected' : '');
    b.textContent = ic;
    b.addEventListener('click', () => {
      selIcon = ic;
      g.querySelectorAll('.icon-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
    });
    g.appendChild(b);
  });
}

function buildColorRow() {
  const r = document.getElementById('color-row');
  r.innerHTML = '';
  COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (c === selColor ? ' selected' : '');
    sw.style.background = c;
    sw.addEventListener('click', () => {
      selColor = c;
      r.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      sw.classList.add('selected');
    });
    r.appendChild(sw);
  });
}

function showSubjModal() {
  selIcon = ICONS[0]; selColor = COLORS[0];
  buildIconGrid(); buildColorRow();
  document.getElementById('subj-name').value = '';
  const btn = document.getElementById('subj-create-btn');
  btn.disabled = false;
  btn.textContent = 'Fach erstellen';
  document.getElementById('subj-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('subj-name').focus(), 350);
}

document.getElementById('subj-modal')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('subj-modal').classList.add('hidden');
});

document.getElementById('subj-create-btn')?.addEventListener('click', createSubject);
document.getElementById('subj-name')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') createSubject();
});

async function createSubject() {
  const name = document.getElementById('subj-name').value.trim();
  if (!name) { document.getElementById('subj-name').focus(); return; }

  const btn = document.getElementById('subj-create-btn');
  btn.disabled = true;
  btn.textContent = '…';

  try {
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const subj = { id, name, icon: selIcon, color: selColor,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      fileCount: 0, quizCount: 0, lastScore: null };

    const meta = { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
    await Promise.all([DB.addSubject(subj), DB.setMeta(id, meta)]);

    btn.disabled = false;
    btn.textContent = 'Fach erstellen';
    document.getElementById('subj-modal').classList.add('hidden');
    await openSubject(subj);
  } catch (e) {
    toast('Fehler beim Erstellen: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Fach erstellen';
  }
}

// ══ DEMO / PRÄSENTATION ════════════════════════════════════════════════════

const DEMO_DOC = `Die Photosynthese

1. Überblick
Die Photosynthese ist der Prozess, mit dem grüne Pflanzen, Algen und einige Bakterien aus Lichtenergie chemische Energie gewinnen. Dabei werden Kohlenstoffdioxid (CO2) und Wasser (H2O) mithilfe von Lichtenergie in Glucose (Traubenzucker, C6H12O6) und Sauerstoff (O2) umgewandelt. Die Photosynthese ist damit eine endergone Reaktion: Es wird Energie (Licht) aufgenommen und in den chemischen Bindungen der Glucose gespeichert.

Wortgleichung:
Kohlenstoffdioxid + Wasser  --Lichtenergie-->  Glucose + Sauerstoff
6 CO2 + 6 H2O  -->  C6H12O6 + 6 O2

2. Ort der Photosynthese
Die Photosynthese findet in den Chloroplasten statt. Diese enthalten den grünen Farbstoff Chlorophyll, der das Sonnenlicht absorbiert. Ein Chloroplast ist von einer Doppelmembran umgeben und besteht im Inneren aus den Thylakoiden (scheibenförmige Membranstapel, die zu Grana gestapelt sind) und dem umgebenden Stroma (Grundsubstanz). Chlorophyll absorbiert vor allem rotes und blaues Licht und reflektiert grünes Licht – deshalb erscheinen Blätter grün.

3. Die zwei Teilreaktionen
3.1 Lichtreaktion (an den Thylakoidmembranen)
Lichtenergie wird vom Chlorophyll absorbiert und spaltet Wasser (Fotolyse). Dabei entstehen Sauerstoff, ATP (Energieträger) und NADPH (Reduktionsmittel). Der Sauerstoff wird als Nebenprodukt an die Umgebung abgegeben. Die Lichtreaktion ist also der Schritt, der Lichtenergie in chemisch nutzbare Energie (ATP, NADPH) umwandelt.

3.2 Dunkelreaktion / Calvin-Zyklus (im Stroma)
Mit der Energie aus ATP und NADPH wird CO2 schrittweise zu Glucose aufgebaut (CO2-Fixierung). Diese Reaktion benötigt kein Licht direkt, läuft aber meist tagsüber ab, weil sie auf die Produkte der Lichtreaktion angewiesen ist. Das Schlüsselenzym ist die RuBisCO.

Vergleich der Teilreaktionen:
- Lichtreaktion: Ort Thylakoidmembran; braucht Licht + Wasser; liefert O2, ATP, NADPH.
- Calvin-Zyklus: Ort Stroma; braucht CO2, ATP, NADPH; liefert Glucose.

4. Bedeutung
Die Photosynthese ist die Grundlage fast aller Nahrungsketten (Produzenten bilden die erste Trophiestufe) und liefert den Sauerstoff unserer Atmosphäre. Sie bindet CO2 und ist damit zentral für den globalen Kohlenstoffkreislauf und das Klima. Die Photosynthese ist die Umkehrung der Zellatmung: Was bei der Photosynthese aufgebaut wird (Glucose, O2), wird bei der Zellatmung wieder abgebaut, um Energie freizusetzen.

5. Einflussfaktoren auf die Photosyntheserate
Die Photosyntheserate hängt von mehreren Faktoren ab:
- Lichtintensität: Bei wenig Licht steigt die Rate mit der Lichtmenge, ab einem Sättigungspunkt nicht mehr.
- CO2-Konzentration: Mehr CO2 erhöht die Rate bis zur Sättigung.
- Temperatur: Da Enzyme beteiligt sind, gibt es ein Optimum (meist 20–30 °C); zu hohe Temperaturen schädigen die Enzyme.
Es gilt das Gesetz des Minimums (Liebig): Der knappste Faktor begrenzt die Gesamtrate – die übrigen Faktoren können sie dann nicht weiter steigern (limitierende Faktoren).

6. Nachweis
Der gebildete Sauerstoff lässt sich z. B. an einer Wasserpflanze (Wasserpest) durch aufsteigende Gasbläschen nachweisen. Die Glucose bzw. die daraus gebildete Stärke kann man mit der Jod-Stärke-Probe (Blaufärbung) im Blatt nachweisen.`;

const DEMO_CARDS = [
  { front: 'Wo in der Pflanzenzelle findet die Photosynthese statt?',
    back: 'In den **Chloroplasten** – genauer an den Thylakoiden (Lichtreaktion) und im Stroma (Calvin-Zyklus). Sie enthalten den Farbstoff Chlorophyll.' },
  { front: 'Wie lautet die Wortgleichung der Photosynthese?',
    back: 'Kohlenstoffdioxid + Wasser → Glucose + Sauerstoff\n\n6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂ (mit Lichtenergie).' },
  { front: 'Was passiert in der Lichtreaktion?',
    back: 'An den Thylakoidmembranen wird Wasser durch Lichtenergie gespalten (Fotolyse). Es entstehen **Sauerstoff**, **ATP** und **NADPH**.' },
  { front: 'Was geschieht im Calvin-Zyklus (Dunkelreaktion)?',
    back: 'Im Stroma wird CO₂ mithilfe der Energie aus ATP und NADPH zu **Glucose** aufgebaut. Direktes Licht ist dafür nicht nötig.' },
  { front: 'Welche Faktoren begrenzen die Photosyntheserate?',
    back: 'Lichtintensität, CO₂-Konzentration und Temperatur (limitierende Faktoren nach dem Gesetz des Minimums).' },
];

const DEMO_GLOSSAR = [
  { term: 'Chlorophyll',  definition: 'Grüner Blattfarbstoff in den Chloroplasten, der das Sonnenlicht für die Photosynthese absorbiert.' },
  { term: 'Chloroplast',  definition: 'Zellorganell der Pflanzen, in dem die Photosynthese abläuft. Enthält Thylakoide und Stroma.' },
  { term: 'Thylakoid',    definition: 'Membransystem im Chloroplasten; Ort der Lichtreaktion. Zu Stapeln (Grana) angeordnet.' },
  { term: 'Stroma',       definition: 'Flüssigkeit im Inneren des Chloroplasten; Ort des Calvin-Zyklus (Dunkelreaktion).' },
  { term: 'Calvin-Zyklus', definition: 'Dunkelreaktion der Photosynthese: Aufbau von Glucose aus CO₂ mithilfe von ATP und NADPH.' },
  { term: 'Fotolyse',     definition: 'Spaltung von Wasser durch Lichtenergie in der Lichtreaktion; setzt Sauerstoff frei.' },
];

const DEMO_STRUCTURE = {
  kapitel: [
    { titel: 'Grundlagen der Photosynthese',
      lernziel: 'Du kannst erklären, was Photosynthese ist und warum sie für das Leben wichtig ist.',
      themen: ['Definition Photosynthese', 'Wortgleichung', 'Bedeutung für Ökosysteme'] },
    { titel: 'Ort & Aufbau',
      lernziel: 'Du kannst den Chloroplasten und seine Bestandteile beschreiben.',
      themen: ['Chloroplast', 'Chlorophyll', 'Thylakoide & Stroma'] },
    { titel: 'Die zwei Teilreaktionen',
      lernziel: 'Du kannst Licht- und Dunkelreaktion unterscheiden und zuordnen.',
      themen: ['Lichtreaktion', 'Fotolyse des Wassers', 'Calvin-Zyklus'] },
    { titel: 'Einflussfaktoren',
      lernziel: 'Du kannst die limitierenden Faktoren der Photosyntheserate nennen.',
      themen: ['Lichtintensität', 'CO₂-Konzentration', 'Temperatur'] },
  ],
};
const DEMO_TOPICS = DEMO_STRUCTURE.kapitel.flatMap(k => k.themen);

// Zweites Dokument: eine "Altklausur" → schaltet den prüfungsnahen Modus frei
// (hasExamDocs erkennt das Wort "Altklausur" im Dateinamen) und liefert dem
// Klausur-Generator echten Stil-/Aufgabenkontext (doc_type=altklausur).
const DEMO_ALTKLAUSUR = `Altklausur Biologie – Thema: Photosynthese
Bearbeitungszeit: 45 Minuten · Erreichbare Punkte: 30

Aufgabe 1 (6 P): Erkläre in eigenen Worten, was man unter Photosynthese versteht, und gib die Wortgleichung an.

Aufgabe 2 (8 P): Beschrifte einen Chloroplasten (Doppelmembran, Thylakoide/Grana, Stroma) und ordne den Bestandteilen die jeweilige Teilreaktion zu.

Aufgabe 3 (10 P): Vergleiche Lichtreaktion und Calvin-Zyklus tabellarisch (Ort, Ausgangsstoffe, Produkte, Lichtabhängigkeit).

Aufgabe 4 (6 P): In einem Versuch wird eine Wasserpest bei steigender Lichtintensität beobachtet. Erkläre den erwarteten Verlauf der Photosyntheserate und nenne das zugrunde liegende Prinzip (limitierende Faktoren).`;

// Vorab gespeicherte Übungs-Aufgaben (Reiter "Aufgaben" → Gespeicherte Aufgaben).
// fullResult enthält den Trenner "--- ## Musterlösungen", damit Lösungen separat
// ein-/ausblendbar sind (siehe restoreAufgabe).
const DEMO_AUFGABEN = [
  {
    id: 9000001,
    topic: 'Lichtreaktion & Calvin-Zyklus',
    type: 'uebung',
    tasksPart: `## Übungsaufgaben: Lichtreaktion & Calvin-Zyklus

1. Nenne den Ort, an dem die Lichtreaktion abläuft, und die drei Produkte, die dabei entstehen.
2. Erkläre, warum der Calvin-Zyklus auf die Lichtreaktion angewiesen ist, obwohl er selbst kein Licht benötigt.
3. Ordne zu: Welche Stoffe sind Ausgangsstoffe, welche Produkte des Calvin-Zyklus?
4. Begründe, warum bei der Photosynthese Sauerstoff entsteht und woher dieser stammt.`,
    fullResult: `## Übungsaufgaben: Lichtreaktion & Calvin-Zyklus

1. Nenne den Ort, an dem die Lichtreaktion abläuft, und die drei Produkte, die dabei entstehen.
2. Erkläre, warum der Calvin-Zyklus auf die Lichtreaktion angewiesen ist, obwohl er selbst kein Licht benötigt.
3. Ordne zu: Welche Stoffe sind Ausgangsstoffe, welche Produkte des Calvin-Zyklus?
4. Begründe, warum bei der Photosynthese Sauerstoff entsteht und woher dieser stammt.

---

## Musterlösungen

1. Die Lichtreaktion läuft an den **Thylakoidmembranen** ab. Produkte: **Sauerstoff (O₂)**, **ATP** und **NADPH**.
2. Der Calvin-Zyklus benötigt **ATP und NADPH** aus der Lichtreaktion als Energie- und Reduktionsmittel, um CO₂ zu Glucose aufzubauen. Ohne diese Produkte fehlt ihm die Energie – deshalb läuft er praktisch nur, wenn zuvor die Lichtreaktion stattgefunden hat.
3. **Ausgangsstoffe:** CO₂, ATP, NADPH. **Produkte:** Glucose (Zucker), ADP und NADP⁺ (werden zur Lichtreaktion zurückgeführt).
4. Der Sauerstoff entsteht bei der **Fotolyse**, also der Spaltung von **Wasser (H₂O)** in der Lichtreaktion. Der freigesetzte O₂ stammt damit aus dem Wasser, nicht aus dem CO₂.`,
    createdAt: '2026-06-10T09:15:00.000Z',
  },
  {
    id: 9000002,
    topic: 'Einflussfaktoren der Photosyntheserate',
    type: 'klausur',
    tasksPart: `## Mini-Klausur: Einflussfaktoren der Photosyntheserate

1. (4 P) Nenne die drei wichtigsten Faktoren, die die Photosyntheserate beeinflussen.
2. (3 P) Erkläre das "Gesetz des Minimums" am Beispiel einer Pflanze bei viel Licht, aber wenig CO₂.
3. (3 P) Skizziere (in Worten) den Verlauf der Photosyntheserate bei steigender Lichtintensität und erkläre den Sättigungsbereich.`,
    fullResult: `## Mini-Klausur: Einflussfaktoren der Photosyntheserate

1. (4 P) Nenne die drei wichtigsten Faktoren, die die Photosyntheserate beeinflussen.
2. (3 P) Erkläre das "Gesetz des Minimums" am Beispiel einer Pflanze bei viel Licht, aber wenig CO₂.
3. (3 P) Skizziere (in Worten) den Verlauf der Photosyntheserate bei steigender Lichtintensität und erkläre den Sättigungsbereich.

---

## Lösungsschlüssel

1. **Lichtintensität**, **CO₂-Konzentration** und **Temperatur**. (Je Faktor 1 P, + 1 P für Vollständigkeit.)
2. Der **knappste Faktor begrenzt** die Gesamtrate. Steht viel Licht, aber wenig CO₂ zur Verfügung, kann die Pflanze das viele Licht nicht nutzen – die Rate wird durch das fehlende CO₂ begrenzt. Mehr Licht steigert die Rate dann **nicht** weiter.
3. Bei **wenig Licht** steigt die Rate zunächst **annähernd linear** mit der Lichtintensität. Ab einem bestimmten Punkt (Sättigung) wird ein anderer Faktor (z. B. CO₂ oder Temperatur) limitierend, sodass die Kurve **abflacht** und trotz mehr Licht **konstant** bleibt.`,
    createdAt: '2026-06-12T16:40:00.000Z',
  },
];

// Vorab gespeicherte Probeklausur (Reiter "Klausur" → gespeicherte Klausuren).
const DEMO_KLAUSUR = {
  id: 9100001,
  diff: 'pruefungsnah',
  content: `# Probeklausur: Photosynthese
Bearbeitungszeit: 45 Minuten · Erreichbare Punkte: 30

**Aufgabe 1 (6 P)** – Definiere den Begriff Photosynthese und gib die vollständige Reaktionsgleichung (mit Summenformeln) an.

**Aufgabe 2 (8 P)** – Beschreibe den Aufbau eines Chloroplasten und ordne den Bestandteilen Thylakoid und Stroma die jeweils dort ablaufende Teilreaktion zu.

**Aufgabe 3 (10 P)** – Vergleiche Lichtreaktion und Calvin-Zyklus in einer Tabelle (Ort, Ausgangsstoffe, Produkte, Lichtabhängigkeit).

**Aufgabe 4 (6 P)** – Eine Wasserpest wird bei zunehmender Lichtintensität beobachtet. Beschreibe den erwarteten Verlauf der Photosyntheserate und erkläre ihn mit dem Prinzip der limitierenden Faktoren.

---

## Lösungsschlüssel

**Aufgabe 1 (6 P):** Photosynthese = Aufbau von Glucose aus CO₂ und H₂O mithilfe von Lichtenergie, wobei O₂ frei wird (3 P). Gleichung: 6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂ (3 P).

**Aufgabe 2 (8 P):** Chloroplast: Doppelmembran außen (1 P), innen Thylakoide (zu Grana gestapelt) (2 P) und Stroma (2 P). Zuordnung: Lichtreaktion an der **Thylakoidmembran** (1,5 P), Calvin-Zyklus im **Stroma** (1,5 P).

**Aufgabe 3 (10 P):** Lichtreaktion: Ort Thylakoidmembran, Ausgangsstoffe H₂O + Licht, Produkte O₂/ATP/NADPH, lichtabhängig. Calvin-Zyklus: Ort Stroma, Ausgangsstoffe CO₂/ATP/NADPH, Produkt Glucose, nicht direkt lichtabhängig. (Je korrekter Zelleintrag ca. 1 P.)

**Aufgabe 4 (6 P):** Bei wenig Licht steigt die Rate annähernd linear (2 P). Ab dem Sättigungspunkt flacht sie ab, weil ein anderer Faktor (CO₂/Temperatur) limitierend wird (2 P). Prinzip: der knappste Faktor begrenzt die Gesamtrate – Gesetz des Minimums (2 P).`,
};

function showDemoSheet() {
  const st = document.getElementById('demo-status');
  st.classList.add('hidden'); st.textContent = '';
  const btn = document.getElementById('demo-load-btn');
  btn.disabled = false; btn.textContent = '📚 Demo-Fach laden';
  document.getElementById('demo-sheet').classList.remove('hidden');
}

async function loadDemoSubject() {
  const btn = document.getElementById('demo-load-btn');
  const st  = document.getElementById('demo-status');
  btn.disabled = true; btn.textContent = 'Wird angelegt…';
  st.className = 'sheet-status info'; st.classList.remove('hidden');
  st.textContent = 'Lege Demo-Fach an…';

  try {
    const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const subj = { id, name: 'Biologie – Photosynthese', icon: '🌿', color: '#34c759',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      fileCount: 2, quizCount: 0, lastScore: null };
    const meta = { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
    await Promise.all([DB.addSubject(subj), DB.setMeta(id, meta)]);

    // Dokumente hochladen. skipCards:true verhindert die serverseitige
    // KI-Kartenerzeugung im Hintergrund – sonst würden die fertig geseedeten
    // 5 Demo-Karten nachträglich von ~12 KI-Karten überschrieben/ergänzt.
    st.textContent = 'Lade Dokumente (Skript + Altklausur)…';
    const now = Date.now();
    await api(`/api/subjects/${id}/documents/text`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'Photosynthese – Skript (Demo).txt', content: DEMO_DOC, skipCards: true }),
    });
    const altklausurDoc = await api(`/api/subjects/${id}/documents/text`, {
      method: 'POST',
      body: JSON.stringify({ filename: 'Altklausur Photosynthese (Demo).txt', content: DEMO_ALTKLAUSUR, skipCards: true }),
    });
    // Altklausur als Klausur-Dokument taggen → liefert dem Klausur-Generator
    // Stilkontext und schaltet zusätzlich den prüfungsnahen Modus frei.
    if (altklausurDoc?.id != null) {
      await api(`/api/subjects/${id}/documents/${altklausurDoc.id}`, {
        method: 'PATCH', body: JSON.stringify({ doc_type: 'altklausur' }),
      }).catch(() => {});
    }

    st.textContent = 'Lade Karten, Glossar, Aufgaben & Klausur…';
    await Promise.all([
      // Lokalen Dokumenttext setzen → sessionTxt wird in openSubject daraus
      // gefüllt. Ohne das sieht der Prompt (docsForPrompt/sysBlocks) keine
      // Unterlagen, und Quiz/Chat/Klausur fordern fälschlich zum Upload auf.
      DB.setContent(id, `${DEMO_DOC}\n\n${DEMO_ALTKLAUSUR}`),
      DB.setCards(id, DEMO_CARDS.map(c => ({ front: c.front, back: c.back, ef: 2.5, interval: 1, repetitions: 0, due: now }))),
      DB.setGlossar(id, DEMO_GLOSSAR),
      DB.addQuizResult(id, 4, 5).catch(() => {}),
      // Themen + Lernpfad-Struktur vorab seeden → Aufgaben/Lernpfad zeigen sofort
      // Themen, ohne dass in der Präsentation ein KI-Scan abgewartet werden muss.
      api(`/api/subjects/${id}/structure`, {
        method: 'POST',
        body: JSON.stringify({ structure: DEMO_STRUCTURE, topics: DEMO_TOPICS }),
      }).catch(() => {}),
      // Fertige Übungsaufgaben vorab speichern (erscheinen unter "Gespeicherte Aufgaben").
      ...DEMO_AUFGABEN.map(a => DB.saveAufgabe(id, a)),
      // Fertige Probeklausur vorab speichern (erscheint unter "Gespeicherte Klausuren").
      api(`/api/subjects/${id}/klausuren`, {
        method: 'POST',
        body: JSON.stringify({ id: DEMO_KLAUSUR.id, diff: DEMO_KLAUSUR.diff, content: DEMO_KLAUSUR.content }),
      }).catch(() => {}),
    ]);

    st.className = 'sheet-status success';
    st.textContent = '✓ Demo-Fach „Biologie – Photosynthese" ist bereit!';
    document.getElementById('demo-sheet').classList.add('hidden');
    toast('Demo-Fach geladen 🌿', 'success');
    await openSubject(subj);
  } catch (e) {
    st.className = 'sheet-status error';
    st.textContent = 'Fehler: ' + e.message;
    btn.disabled = false; btn.textContent = '📚 Demo-Fach laden';
  }
}

document.getElementById('btn-demo')?.addEventListener('click', showDemoSheet);
document.getElementById('demo-load-btn')?.addEventListener('click', loadDemoSubject);
document.getElementById('demo-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('demo-sheet').classList.add('hidden');
});

// ══ OPEN SUBJECT ═══════════════════════════════════════════════════════════

// v231: Nach dieser Ruhezeit wird der Chat beim Öffnen frisch gestartet. Verhindert,
// dass eine alte Sitzung samt selbst-generiertem (evtl. verrechnetem) Kontext als
// Anker in neue Antworten zurückfließt. 12h = neuer Lern-Tag startet sauber.
const CHAT_IDLE_RESET_MS = 12 * 60 * 60 * 1000;

async function openSubject(subj) {
  sessionId = subj.id;
  const [savedMeta, serverMsgs, quizRows, serverDocs] = await Promise.all([
    DB.meta(subj.id),
    DB.messages(subj.id),
    DB.quizResults(subj.id),
    api(`/api/subjects/${subj.id}/documents`).catch(() => []),
  ]);
  sessionMeta = savedMeta || { ...subj, files: [], chatHistory: [], quizStats: { questions: [] }, currentQuestion: null };
  // created_at dient NUR der Alters-Prüfung und wird NICHT in die chatHistory
  // übernommen (die Claude-API erwartet reine {role,content}-Objekte). Ist die letzte
  // Nachricht zu alt, serverseitig löschen → Reset gilt geräteübergreifend.
  if (serverMsgs.length) {
    const lastAt = new Date(serverMsgs[serverMsgs.length - 1].created_at || 0).getTime();
    if (lastAt && Date.now() - lastAt > CHAT_IDLE_RESET_MS) {
      DB.clearMessages(subj.id).catch(() => {});
      sessionMeta.chatHistory = [];
    } else {
      sessionMeta.chatHistory = serverMsgs.map(({ role, content }) => ({ role, content }));
    }
  }
  if (quizRows.length) {
    sessionMeta.quizStats.questions = quizRows.map(r => ({
      score: r.score, topic: '', blitz: false,
    }));
  }
  if (serverDocs.length) {
    sessionMeta.files = serverDocs.map(d => ({ name: d.filename, uploadedAt: d.uploaded_at }));
  }
  sessionTxt = await DB.content(subj.id);
  // Fallback: Der Prompt-Kontext (sessionTxt) liegt nur lokal (localforage).
  // Auf einem frischen Browser/Gerät – oder im geteilten Demo-Account – ist er
  // leer, obwohl der Server Dokumente hat (serverDocs). Dann Volltext vom
  // Server nachladen und lokal cachen, damit Quiz/Chat/Klausur Kontext sehen.
  if (!sessionTxt && serverDocs.length) {
    const rows = await api(`/api/subjects/${subj.id}/documents/content`).catch(() => null);
    if (Array.isArray(rows) && rows.length) {
      sessionTxt = rows.map(r => r.content).filter(Boolean).join('\n\n');
      if (sessionTxt) DB.setContent(subj.id, sessionTxt).catch(() => {});
    }
  }
  // Ist die Wissensbasis bereit, laufen Generierungs-Pfade über den schlanken,
  // serverseitig injizierten KB-Kontext statt des vollen 40k-Doku-Dumps.
  kbReady = false;
  api(`/api/subjects/${subj.id}/kb`).then(kb => { kbReady = !!kb && kb.status === 'ready'; }).catch(() => {});
  examDocContext = await loadExamDocContext(subj.id);
  customPrompt = subj.custom_prompt || '';
  const serverTopics = await api(`/api/subjects/${subj.id}/topics`).catch(() => null);
  scannedTopics = dedupeTopics((serverTopics && serverTopics.length)
    ? serverTopics
    : (await localforage.getItem(`st_${subj.id}`).catch(() => null)) || []);

  const serverStruct = await api(`/api/subjects/${subj.id}/structure`).catch(() => null);
  // Beinah-Duplikate (gleiches Thema, anderer Name) auch in bereits gespeicherten
  // Strukturen entfernen – sonst doppeln sie im Lernpfad bis zum nächsten Re-Scan.
  moduleStructure = dedupeStructure(serverStruct || (await localforage.getItem(`ms_${subj.id}`).catch(() => null)));

  // Stabile Themen-IDs laden (geteilte Struktur hat Vorrang vor lokalem Cache),
  // fehlende für aktuelle Pfad-Themen vergeben und einmalig zurückschreiben. Muss
  // VOR der Learned/Meta-Auflösung stehen – die hängt jetzt an diesen IDs.
  topicUids = {
    ...((await localforage.getItem(`tuid_${subj.id}`).catch(() => null)) || {}),
    ...((moduleStructure && moduleStructure.ids) || {}),
  };
  // Kollabierte IDs (HTTP-randomUUID-Bug) reparieren, fehlende vergeben, dann 1× zurückschreiben.
  let tuidChanged = dedupeTopicUids();
  if (ensureTopicUids()) tuidChanged = true;
  if (tuidChanged) persistTopicUids(subj.id);

  const serverLearned = await api(`/api/subjects/${subj.id}/learned-topics`).catch(() => null);
  const localLearned  = (await localforage.getItem(`lt_${subj.id}`).catch(() => null)) || [];
  // Server UND lokal VEREINEN statt "Server gewinnt": ein offline (oder bei
  // fehlgeschlagenem POST) gelerntes Thema ging sonst beim Neuladen verloren.
  // Alt-Format (nur Name) → name::einsteiger normalisieren.
  const normLT = t => (t.includes('::') ? t : t + '::einsteiger');
  learnedTopics = [...new Set([...(serverLearned || []).map(normLT), ...localLearned.map(normLT)])];
  localforage.setItem(`lt_${subj.id}`, learnedTopics).catch(() => {});
  // Server heilen: lokal vorhandene, server-seitig fehlende Einträge nachreichen
  // (nur wenn der Server erreichbar war – sonst spart man sich die Fehlversuche).
  if (serverLearned) {
    const serverSet = new Set(serverLearned.map(normLT));
    learnedTopics.filter(t => !serverSet.has(t)).forEach(t =>
      api(`/api/subjects/${subj.id}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: t }),
      }).catch(() => {}));
  }
  // topicMeta-Keys (Wiederholungs-Termine) beim Laden auf normalisierte Namen
  // heben, damit sie – wie der Done-Status – ein Umbenennen/Re-Scan überstehen.
  const rawMeta = (await localforage.getItem(`ltmeta_${subj.id}`).catch(() => null)) || {};
  topicMeta = {};
  for (const [k, v] of Object.entries(rawMeta)) topicMeta[normFullKey(k)] = v;
  // Reparatur (v214/v216): durch Re-Scans verwaisten Fortschritt auf die aktuellen
  // Themen zurück-verknüpfen, damit schon gelernte (umbenannte) Themen wieder als
  // abgehakt erscheinen. Embedding-Matching (semantisch) ist auf der CPU-VM langsam →
  // nicht-blockierend: das Fach öffnet sofort, das Heilen ploppt danach nach + re-rendert.
  // Nur, wenn es überhaupt Waisen gibt (sonst kein teurer Embedding-Aufruf).
  if (orphanOldNames().length) {
    (async () => {
      const sim = await embedSimFn([...orphanOldNames(), ...pathTopics()]);
      if (sessionId !== subj.id) return;                 // Nutzer hat inzwischen gewechselt → nichts anfassen
      const repair = repairOrphanedProgress(sim);
      if (!repair.healed) return;
      localforage.setItem(`lt_${subj.id}`, learnedTopics).catch(() => {});
      saveTopicMeta();
      repair.added.forEach(t => api(`/api/subjects/${subj.id}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: t }),
      }).catch(() => {}));
      repair.removed.forEach(t => api(`/api/subjects/${subj.id}/learned-topics/${encodeURIComponent(t)}`, {
        method: 'DELETE',
      }).catch(() => {}));
      renderMilestone();
      loadLernpfad();
      toast(`✅ ${repair.healed} bereits gelernte${repair.healed === 1 ? 's Thema' : ' Themen'} wieder als erledigt verknüpft.`, 'success', 4500);
    })().catch(() => {});
  }
  selTopic = null;
  currentAufgabe = ''; savedCanvasData = null; mathCtx = null; strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  rechnenNextTask = null; rechnenLoesung = null; blitzNext = null; // Prefetches des vorigen Fachs verwerfen

  document.getElementById('header-label').textContent = `${subj.emoji || subj.icon || '📚'}  ${subj.name}`;
  updateXpChip();
  const appHeader = document.querySelector('.app-header');
  if (appHeader && subj.color) appHeader.style.borderTopColor = subj.color;
  updateHeaderPages();

  const q = sessionMeta.quizStats.questions;
  const sc = q.reduce((a, x) => a + x.score, 0);
  if (q.length) { Object.assign(window, { quizTotal: q.length, quizScore: sc }); }
  else { Object.assign(window, { quizTotal: 0, quizScore: 0 }); }
  updateScoreChip();

  document.getElementById('chat-messages').innerHTML = `
    <div class="welcome">
      <div class="welcome-icon">${subj.emoji || subj.icon || '📚'}</div>
      <p>Stelle mir Fragen zu <strong>${esc(subj.name)}</strong>.<br>Ich erkläre alles geduldig!</p>
    </div>`;

  const noFiles = !sessionMeta.files.length;
  document.getElementById('no-docs-banner').classList.toggle('hidden', !noFiles);
  updatePruefungsnahBtns();

  showQuizState(document.getElementById('quiz-idle'));
  if (q.length) {
    document.getElementById('quiz-summary').textContent =
      `${q.length} Fragen · ${sc}/${q.length * 3} Pkt.`;
    document.getElementById('quiz-summary').classList.remove('hidden');
  } else {
    document.getElementById('quiz-summary').classList.add('hidden');
  }

  const target = sessionMeta.targetScore || 75;
  const slider = document.getElementById('lernziel-slider');
  if (slider) { slider.value = target; document.getElementById('lernziel-val').textContent = target + '%'; }

  refreshAnalysisState();
  switchMode('chat');
  showScreen('main-screen');
  updateSettingsBadge();

  if (noFiles) {
    showUploadSheet();
  } else {
    showWeakTopicsNote();
  }
}

function updateHeaderPages() {
  const fc = sessionMeta?.files?.length || 0;
  document.getElementById('header-pages').textContent =
    fc ? `${fc} Dokument${fc !== 1 ? 'e' : ''}` : 'Keine Dokumente';
}

async function syncSubjectSummary() {
  // Stats are now live from server — nothing to sync locally
}

// ── Schwächen-Awareness ───────────────────────────────────────────────────

function getWeakTopics(questions) {
  const byTopic = {};
  questions.filter(q => !q.blitz).forEach(q => {
    if (!q.topic) return;
    if (!byTopic[q.topic]) byTopic[q.topic] = [];
    byTopic[q.topic].push(q.score);
  });
  return Object.entries(byTopic)
    .filter(([, scores]) => scores.length >= 2 && scores.reduce((a, b) => a + b, 0) / scores.length < 1.5)
    .map(([topic]) => topic);
}

function showWeakTopicsNote() {
  const q = sessionMeta?.quizStats?.questions || [];
  if (!q.length) return;
  const weak = getWeakTopics(q);
  if (!weak.length) return;
  const msgs = document.getElementById('chat-messages');
  const note = document.createElement('div');
  note.className = 'message assistant';
  note.innerHTML = `<div class="bubble weak-note">⚠️ <strong>Schwächen erkannt:</strong> Bei ${esc(weak.join(', '))} hast du tiefe Lücken. Frag mich gerne dazu!</div>`;
  msgs.appendChild(note);
  msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
}

// ══ SETTINGS SHEET ═════════════════════════════════════════════════════════

function updateCalcChip() {
  const chip = document.getElementById('calc-saved-chip');
  const name = document.getElementById('calc-saved-name');
  if (!chip || !name) return;
  if (prefCalculator) {
    name.textContent = prefCalculator;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

document.getElementById('btn-settings')?.addEventListener('click', async () => {
  document.getElementById('custom-prompt-ta').value = customPrompt;
  document.getElementById('calc-model-input').value = prefCalculator;
  updateCalcChip();
  document.getElementById('settings-sheet').classList.remove('hidden');
  // Load user's own daily usage
  try {
    const u = await api('/api/my-usage');
    const el = document.getElementById('settings-usage-bar-fill');
    const lbl = document.getElementById('settings-usage-label');
    const section = document.getElementById('settings-usage-section');
    if (el && lbl && section) {
      const pct = Math.min(100, (u.cost_eur / u.limit) * 100);
      el.style.width = pct.toFixed(1) + '%';
      el.style.background = pct >= 90 ? 'var(--red)' : pct >= 60 ? 'var(--yellow)' : 'var(--accent)';
      lbl.textContent = `${u.cost_eur.toFixed(3)}€ / ${u.limit.toFixed(2)}€ heute`;
      section.style.display = '';
    }
  } catch (_) {}
});
document.getElementById('settings-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('settings-sheet').classList.add('hidden');
});
document.getElementById('settings-close-btn')?.addEventListener('click', () =>
  document.getElementById('settings-sheet').classList.add('hidden'));
function settingsSave() {
  const val  = document.getElementById('custom-prompt-ta').value.trim();
  const calc = document.getElementById('calc-model-input').value.trim();
  customPrompt   = val;
  prefCalculator = calc;
  document.getElementById('settings-sheet').classList.add('hidden');
  toast(calc ? `✅ ${calc} gespeichert.` : 'Einstellungen gespeichert.', 'success');
  updateSettingsBadge();
  Promise.all([
    api(`/api/subjects/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ custom_prompt: val }),
    }),
    localforage.setItem('pref_calculator', calc),
  ]).catch(e => toast('Speichern fehlgeschlagen: ' + e.message, 'error'));
}
document.getElementById('settings-save-btn')?.addEventListener('click', settingsSave);

function updateSettingsBadge() {
  const btn = document.getElementById('btn-settings');
  let badge = btn.querySelector('.settings-active-badge');
  if (customPrompt && !badge) {
    badge = document.createElement('span');
    badge.className = 'settings-active-badge';
    btn.appendChild(badge);
  } else if (!customPrompt && badge) {
    badge.remove();
  }
}

// ══ UPLOAD SHEET ═══════════════════════════════════════════════════════════

document.getElementById('back-btn')?.addEventListener('click', () => {
  sessionId = null; sessionMeta = null; sessionTxt = ''; kbReady = false; examDocContext = ''; customPrompt = '';
  showScreen('subjects-screen'); loadSubjects();
});
document.getElementById('btn-add-docs')?.addEventListener('click', showUploadSheet);
document.getElementById('no-docs-btn')?.addEventListener('click', showUploadSheet);
document.getElementById('upload-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) hideUploadSheet();
});

function showUploadSheet() {
  document.getElementById('upload-status').classList.add('hidden');
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('upload-title').textContent =
    sessionMeta ? `Dokumente für "${sessionMeta.name}"` : 'Dokumente hochladen';
  document.getElementById('upload-sheet').classList.remove('hidden');
  renderDocList();
  renderKbStatus();
}

function hideUploadSheet() {
  document.getElementById('upload-sheet').classList.add('hidden');
}

const DOC_TYPES = [
  { value: '',                label: '— Kein Typ' },
  { value: 'skript',          label: '📘 Vorlesungsskript' },
  { value: 'formelsammlung',  label: '🧮 Formelsammlung' },
  { value: 'klausur',         label: '📋 Klausur' },
  { value: 'altklausur',      label: '📋 Altklausur' },
  { value: 'uebungsblatt',    label: '✏️ Übungsblatt' },
  { value: 'zusammenfassung', label: '📄 Zusammenfassung' },
  { value: 'lehrbuch',        label: '📚 Lehrbuch' },
];

// ── Doc-meta localforage helpers ──────────────────────────────────────────
function docMetaKey() { return `docmeta_${sessionId}`; }
async function loadDocMeta() {
  return (await localforage.getItem(docMetaKey()).catch(() => null)) || [];
}
async function saveDocMeta(meta) {
  await localforage.setItem(docMetaKey(), meta).catch(() => {});
}

async function renderDocList() {
  const wrap = document.getElementById('doc-list-wrap');
  const list = document.getElementById('doc-list');
  if (!sessionId) return;

  // Try server first; fall back to localforage docmeta
  let docs = await api(`/api/subjects/${sessionId}/documents`).catch(() => []);
  let fromServer = docs.length > 0;
  if (!fromServer) {
    const meta = await loadDocMeta();
    docs = meta.map(m => ({ id: m.localId, filename: m.name, doc_type: m.docType, uploaded_at: m.uploadedAt }));
  }
  if (!docs.length) { wrap.classList.add('hidden'); return; }

  wrap.classList.remove('hidden');
  list.innerHTML = '';

  // Nicht lesbare Dokumente: leere Hüllen (nur Dateiname-Header, kein Text) –
  // typisch für alte Uploads, deren OCR still fehlschlug. usable_chars kommt vom
  // Server; bei rein lokalen (localforage) Docs kennen wir den Inhalt nicht.
  const isUnreadable = d => fromServer && typeof d.usable_chars === 'number'
    && d.usable_chars < PDF_MIN_USABLE_CHARS;
  const unreadableCount = docs.filter(isUnreadable).length;
  if (unreadableCount) {
    const note = document.createElement('div');
    note.className = 'doc-unreadable-note';
    note.innerHTML = `⚠️ ${unreadableCount} von ${docs.length} Dokument${docs.length !== 1 ? 'en' : ''} `
      + `${unreadableCount === 1 ? 'ist' : 'sind'} nicht lesbar (kein Text erkannt). `
      + `Bitte als PDF mit Textebene neu hochladen.`;
    list.appendChild(note);
  }

  docs.forEach(doc => {
    const unreadable = isUnreadable(doc);
    const date = new Date(doc.uploaded_at).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: '2-digit',
    });
    const optionsHtml = DOC_TYPES.map(t =>
      `<option value="${t.value}"${doc.doc_type === t.value ? ' selected' : ''}>${t.label}</option>`
    ).join('');
    const row = document.createElement('div');
    row.className = 'doc-row' + (unreadable ? ' doc-row--unreadable' : '');
    row.innerHTML = `
      <div class="doc-row-info">
        <span class="doc-row-icon">${unreadable ? '⚠️' : '📄'}</span>
        <div>
          <div class="doc-row-name">${esc(doc.filename)}${unreadable
            ? ' <span class="doc-badge-unreadable" title="Beim Upload konnte kein Text gelesen werden – bitte als PDF mit Textebene neu hochladen.">nicht lesbar</span>'
            : ''}</div>
          <div class="doc-row-date">${date}</div>
        </div>
      </div>
      <select class="doc-type-sel" title="Dokumenttyp">${optionsHtml}</select>
      <button class="doc-del-btn" title="Löschen">🗑</button>`;
    row.querySelector('.doc-type-sel').addEventListener('change', async e => {
      const newType = e.target.value;
      // Update server if doc has a real server ID
      if (fromServer) {
        await api(`/api/subjects/${sessionId}/documents/${doc.id}`, {
          method: 'PATCH', body: JSON.stringify({ doc_type: newType }),
        }).catch(() => {});
      }
      // Always update localforage docmeta
      const meta = await loadDocMeta();
      const entry = meta.find(m => m.name === doc.filename);
      if (entry) { entry.docType = newType; await saveDocMeta(meta); }
      // Refresh exam context so new tag is used immediately in task generation
      examDocContext = await loadExamDocContext(sessionId);
    });
    row.querySelector('.doc-del-btn').addEventListener('click', async () => {
      if (!await confirmDialog(`"${doc.filename}" löschen?`,
          { title: 'Dokument löschen', okText: 'Löschen', danger: true })) return;
      if (fromServer) {
        await api(`/api/subjects/${sessionId}/documents/${doc.id}`, { method: 'DELETE' });
      }
      // Remove from localforage docmeta
      const meta = await loadDocMeta();
      const idx = meta.findIndex(m => m.name === doc.filename);
      if (idx !== -1) { meta.splice(idx, 1); await saveDocMeta(meta); }
      renderDocList();
    });
    list.appendChild(row);
  });
}

// ── Wissensbasis-Status (Admin) ─────────────────────────────────────────────
const KB_STATE = {
  ready:    ['✅ bereit',     'var(--green)'],
  indexing: ['⏳ indexiert…', 'var(--purple)'],
  pending:  ['⏸ ausstehend',  '#888'],
  error:    ['⚠️ Fehler',      '#e5484d'],
  none:     ['– keine',        '#888'],
};
let kbPollTimer = null;

async function renderKbStatus() {
  const box = document.getElementById('kb-status');
  if (!box) return;
  // Nur für Admins und server-gestützte Fächer (die KB liegt serverseitig).
  if (!authIsAdmin || !sessionId) { box.classList.add('hidden'); return; }
  let kb;
  try { kb = await api(`/api/subjects/${sessionId}/kb`); }
  catch { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const [label, color] = KB_STATE[kb.status] || KB_STATE.none;
  document.getElementById('kb-status-badge').innerHTML =
    `<span style="background:${color};color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;">${label}</span>`;
  document.getElementById('kb-status-info').textContent = kb.status === 'none'
    ? 'Noch nicht aufgebaut – „Neu indexieren" erstellt die Wissensbasis aus den Dokumenten.'
    : `${kb.chunks || 0} Häppchen · ${kb.embedded || 0} eingebettet${kb.updated_at ? ' · ' + new Date(kb.updated_at).toLocaleString('de-DE') : ''}`;
  const btn = document.getElementById('kb-reindex-btn');
  btn.disabled = kb.status === 'indexing';
  btn.textContent = kb.status === 'indexing' ? '⏳ läuft…' : '🔄 Neu indexieren';
  // Läuft gerade → automatisch weiter pollen, bis fertig.
  if (kb.status === 'indexing' && !kbPollTimer) startKbPolling();
}

function startKbPolling() {
  clearInterval(kbPollTimer);
  kbPollTimer = setInterval(async () => {
    let kb; try { kb = await api(`/api/subjects/${sessionId}/kb`); } catch { return; }
    if (kb.status !== 'indexing') {
      clearInterval(kbPollTimer); kbPollTimer = null;
      renderKbStatus();
      kbReady = kb.status === 'ready';   // Generierung darf ab sofort den KB-Kontext nutzen
      if (kb.status === 'ready') toast('Wissensbasis aktualisiert ✅', 'success');
      else if (kb.status === 'error') toast('Indexierung fehlgeschlagen', 'error');
    }
  }, 4000);
}

document.getElementById('kb-reindex-btn')?.addEventListener('click', async () => {
  if (!sessionId) return;
  const btn = document.getElementById('kb-reindex-btn');
  btn.disabled = true; btn.textContent = '⏳ läuft…';
  try {
    const r = await api(`/api/subjects/${sessionId}/kb/reindex`, { method: 'POST' });
    toast(`Indexierung gestartet (${r.documents} Dok.)`, 'info');
    startKbPolling();
  } catch (e) {
    toast('Fehler: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = '🔄 Neu indexieren';
  }
});

document.getElementById('upload-input')?.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  if (files.length) handleUpload(files);
  e.target.value = '';
});

const dropZone = document.getElementById('drop-zone');
dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
  if (pdfs.length) handleUpload(pdfs);
});

async function handleUpload(files) {
  const prog    = document.getElementById('upload-progress');
  const status  = document.getElementById('upload-status');
  const label   = document.getElementById('upload-prog-label');
  const bar     = document.getElementById('upload-prog-bar');
  const pct     = document.getElementById('upload-prog-pct');
  prog.classList.remove('hidden'); status.classList.add('hidden');

  try {
    let added = ''; const newFiles = [];
    const failedExtract = [];  // PDFs that could not be read at all
    const failedServer  = [];  // stored locally but the server rejected the save
    const partialOcr    = [];  // gespeichert, aber einzelne Bild-Seiten blieben unlesbar
    let ocrTotal = 0;          // Seiten, die per Vision-OCR statt Textebene gelesen wurden
    for (let i = 0; i < files.length; i++) {
      const fileLabel = files.length > 1 ? `${files[i].name} (${i + 1}/${files.length})` : files[i].name;
      label.textContent = `Verarbeite ${fileLabel}…`;
      bar.style.width = '0%'; pct.textContent = '0%';
      let text, pages, name, ocrPages = 0, ocrFailed = 0;
      try {
        ({ text, pages, name, ocrPages, ocrFailed } = await extractPDF(files[i], (done, total, phase) => {
          const p = Math.round((done / total) * 100);
          bar.style.width = p + '%'; pct.textContent = p + '%';
          label.textContent = phase === 'ocr'
            ? `Verarbeite ${fileLabel}… (Texterkennung Seite ${done + 1})`
            : `Verarbeite ${fileLabel}…`;
        }));
      } catch {
        // One unreadable PDF must not discard the others in the batch.
        failedExtract.push(files[i].name);
        continue;
      }
      // Faktisch leere Extraktion (nur der "=== Datei ==="-Header übrig): NICHT
      // speichern, sondern als Fehlschlag melden. Sonst liegt ein totes Dokument
      // in der Sammlung, das der Themen-Scan und RAG still ignorieren – der Nutzer
      // erfährt nie, dass sein Upload inhaltlich nie angekommen ist.
      const usable = text.replace(/^===.*===$/m, '').replace(/\s/g, '').length;
      if (usable < PDF_MIN_USABLE_CHARS) {
        failedExtract.push(files[i].name + (ocrFailed
          ? ' (Texterkennung fehlgeschlagen – bitte später erneut hochladen)'
          : ' (kein lesbarer Text – Scan-/Bild-PDF?)'));
        continue;
      }
      // Teilweise gelesen: einzelne Bild-Seiten blieben trotz OCR leer → warnen,
      // damit der Nutzer weiß, dass diese Seiten fehlen (Neu-Upload holt sie nach).
      if (ocrFailed > 0) {
        partialOcr.push(`${name}: ${ocrFailed} ${ocrFailed === 1 ? 'Seite' : 'Seiten'} nicht lesbar`);
      }
      added += '\n\n' + text;
      ocrTotal += ocrPages;
      const uploadedAt = new Date().toISOString();
      newFiles.push({ name, pages, uploadedAt });
      // Save snippet to localforage docmeta for doc-type filtering
      const meta = await loadDocMeta();
      if (!meta.find(m => m.name === name)) {
        meta.push({ localId: `local_${Date.now()}_${name}`, name, uploadedAt, docType: '', snippet: text.slice(0, 2000) });
        await saveDocMeta(meta);
      }
      // Save to server for RAG + auto-card generation. Await it so a failed save
      // (401, payload too large, 5xx, offline) is surfaced instead of being
      // silently swallowed and reported as success.
      try {
        const r = await fetch(`/api/subjects/${sessionId}/documents/text`, { // raw-fetch-ok: prüft r.ok selbst, sammelt Fehlschläge
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ filename: name, content: text }),
        });
        if (!r.ok) throw new Error(String(r.status));
      } catch {
        failedServer.push(name);
      }
    }

    // Commit whatever was processed successfully — even on a partial failure,
    // so local state never diverges from what was already written to docmeta.
    if (newFiles.length) {
      sessionTxt = (sessionTxt || '') + added;
      sessionMeta.files = [...(sessionMeta.files || []), ...newFiles];
      sessionMeta.updatedAt = new Date().toISOString();
      updatePruefungsnahBtns();
      renderRechnenDocs();

      // Keep existing topics/structure – user can re-scan manually if needed
      if (scannedTopics.length || moduleStructure) {
        toast('Neues Dokument hinzugefügt. Themen neu erkennen? → Lernen-Tab → "Themen erkennen"', 'info', 5000);
      }

      // KB-Index ist nach dem Upload veraltet: die neuen Dokumente sind zwar
      // serverseitig gespeichert, aber noch nicht eingebettet. Wir stoßen darum
      // eine Neu-Indexierung an; startKbPolling() hält kbReady aktuell, sobald die
      // Einbettung steht. kbReady wird NICHT global auf false gezwungen: das würde
      // die ganze Session auf den teuren Voll-Inline-Pfad schalten (~90k Token /
      // Erklärung, 25–30 s), bis die Indexierung durch ist. Der schlanke KB-Pfad
      // bleibt nutzbar; für die kurze Indexierungs-Spanne nimmt er den (leicht
      // veralteten) Index in Kauf – ein guter Tausch gegen den Dauer-Heavy-Pfad.
      const savedToServer = newFiles.some(f => !failedServer.includes(f.name));
      if (savedToServer && kbReady) {
        api(`/api/subjects/${sessionId}/kb/reindex`, { method: 'POST' })
          .then(() => startKbPolling())
          .catch(() => {});
      }

      await Promise.all([DB.setContent(sessionId, sessionTxt), DB.setMeta(sessionId, sessionMeta)]);
      updateHeaderPages();
      document.getElementById('no-docs-banner').classList.add('hidden');
      renderDocList();
    }

    prog.classList.add('hidden');

    if (!newFiles.length) {
      status.textContent = 'Fehler: ' + (failedExtract.length
        ? `${failedExtract.join(', ')} konnte nicht gelesen werden.`
        : 'Keine Datei verarbeitet.');
      status.className = 'sheet-status error';
      status.classList.remove('hidden');
      return;
    }

    const okNames = newFiles.map(f => f.name).join(', ');
    const ocrNote = ocrTotal ? ` (${ocrTotal} ${ocrTotal === 1 ? 'Seite' : 'Seiten'} per Texterkennung gelesen)` : '';
    if (failedServer.length || failedExtract.length || partialOcr.length) {
      // Some files only made it into local storage (or not at all): say so
      // clearly instead of a misleading success message.
      const parts = [`✓ ${okNames} gespeichert${ocrNote}`];
      if (failedServer.length)  parts.push(`⚠️ nicht auf Server gesichert: ${failedServer.join(', ')} (nur auf diesem Gerät, keine Karteikarten/RAG)`);
      if (failedExtract.length) parts.push(`⚠️ nicht lesbar: ${failedExtract.join(', ')}`);
      if (partialOcr.length)    parts.push(`⚠️ unvollständig gelesen: ${partialOcr.join(', ')}`);
      status.textContent = parts.join(' · ');
      status.className = 'sheet-status error';
      status.classList.remove('hidden');
    } else {
      status.textContent = `✓ ${okNames} hochgeladen${ocrNote} · Karteikarten werden generiert…`;
      status.className = 'sheet-status success';
      status.classList.remove('hidden');
      setTimeout(hideUploadSheet, 2000);
    }
  } catch (err) {
    prog.classList.add('hidden');
    status.textContent = 'Fehler: ' + err.message;
    status.className = 'sheet-status error';
    status.classList.remove('hidden');
  }
}

// ══ MODE TABS ══════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(b =>
  b.addEventListener('click', () => {
    // Ein Handflächen-/Phantom-Tap während (oder unmittelbar nach) dem Schreiben darf den
    // Tab NICHT wechseln. Beim Schreiben mit dem Pencil oben am Canvas rutscht die Handfläche
    // sonst auf die Tab-Leiste und löst dort einen echten Klick aus.
    if (isDrawingCanvas || isDrawingLernen || Date.now() - lastInkTs < 500) return;
    switchMode(b.dataset.mode);
  }));

function switchMode(mode) {
  currentFeature = mode;
  // Save canvas if it's been initialized
  if (mathCtx) {
    const canvas = document.getElementById('math-canvas');
    if (canvas) {
      savedCanvasData = canvas.toDataURL('image/png');
      localforage.setItem(`canvas_${sessionId}`, savedCanvasData).catch(() => {});
    }
  }
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${mode}`));
  if (mode === 'ueben')    { activateSubpanel('panel-ueben', 'aufgaben-content'); initAufgaben(); }
  if (mode === 'karten')   initKarten();
  if (mode === 'exam')     { loadSavedKlausuren(); updateExamRecBanner(); }
  if (mode === 'material') { activateSubpanel('panel-material', 'cheat'); loadSavedCheat(); }
  if (mode === 'lernen')   initLernen();
  if (mode === 'analyse')  refreshAnalysisState();
}

function switchToAnalysis() {
  switchMode('analyse');
}

function switchToLoesen() {
  switchMode('ueben');
  activateSubpanel('panel-ueben', 'loesen-content');
  initRechnen();
}

function activateSubpanel(panelId, subId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  panel.querySelectorAll('.subpanel-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === subId));
  panel.querySelectorAll('.subpanel').forEach(p => p.classList.toggle('hidden', p.dataset.subid !== subId));
}

// Sub-panel tab switching
document.querySelectorAll('.subpanel-nav').forEach(nav => {
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.subpanel-btn');
    if (!btn) return;
    const panelId = btn.closest('.panel').id;
    const sub = btn.dataset.sub;
    activateSubpanel(panelId, sub);
    if (sub === 'dashboard')       initDashboard();
    if (sub === 'fehler')          renderFehlerkatalog();
    if (sub === 'cheat')           loadSavedCheat();
    if (sub === 'glossar')         loadSavedGlossar();
    if (sub === 'aufgaben-content') initAufgaben();
    if (sub === 'loesen-content')   initRechnen();
  });
});

// ══ SCORE CHIP ════════════════════════════════════════════════════════════

function updateScoreChip() {
  const q   = sessionMeta?.quizStats?.questions || [];
  const tot = q.length;
  const sc  = q.reduce((a, x) => a + x.score, 0);
  const chip = document.getElementById('score-chip');
  if (!tot) { chip.classList.add('hidden'); return; }
  const pct = Math.round(sc / (tot * 3) * 100);
  chip.textContent = pct + '%';
  chip.style.background = scoreColor(pct);
  chip.classList.remove('hidden');
}

// ══ CHAT ══════════════════════════════════════════════════════════════════

const chatMessages = document.getElementById('chat-messages');
const chatInput    = document.getElementById('chat-input');

document.getElementById('chat-send')?.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
chatInput.addEventListener('input', () => autoResize(chatInput));

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || !sessionMeta) return;
  chatInput.value = ''; autoResize(chatInput);
  document.getElementById('chat-send').disabled = true;
  addMsg(chatMessages, 'user', text);
  const typ = addTyping(chatMessages);
  sessionMeta.chatHistory.push({ role: 'user', content: text });
  DB.addMessage(sessionId, 'user', text);
  try {
    // Phase 3: Ist der KB-Chat-Modus (Admin) an, läuft der Chat immer über die KB
    // (omitDocs + Server-Retrieval) und darf serverseitig auf Haiku wechseln.
    // Sonst Hebel-1-Verhalten: große Fächer per RAG, Vertiefungsfragen mit vollen Doks.
    const kbHaiku  = isKbChatHaiku();
    const fullDocs = !kbHaiku && chatWantsFullDocs(text);
    const reply = await claude(sessionMeta.chatHistory, sysBlocks(
      'Erkläre mit echtem Verständnis – nicht nur Definitionen. Nutze Beispiele aus dem echten Leben, Analogien und erkläre den Hintergrund. ' +
      'Wenn etwas unklar wirkt, gehe tiefer. Wenn sinnvoll, stelle am Ende eine Denkfrage um das Verständnis zu festigen.',
      { omitDocs: !fullDocs }
    ), 1500, { noRag: fullDocs, kbChat: kbHaiku });
    sessionMeta.chatHistory.push({ role: 'assistant', content: reply });
    DB.addMessage(sessionId, 'assistant', reply);
    if (sessionMeta.chatHistory.length > 20) {
      sessionMeta.chatHistory = await compressHistory(sessionMeta.chatHistory);
    }
    await DB.setMeta(sessionId, sessionMeta);
    typ.remove();
    addMsg(chatMessages, 'assistant', reply, () => rephraseReply(reply));
  } catch (e) {
    // Keep the user's message in history: it is already rendered in the DOM and
    // persisted server-side (DB.addMessage above, and server messages are the
    // source of truth on reload). Popping it here would desync the in-memory
    // context from what the user sees, so a retry/follow-up would omit it.
    typ.remove(); addMsg(chatMessages, 'assistant', '⚠️ ' + e.message);
  }
  document.getElementById('chat-send').disabled = false;
  chatInput.focus();
}

// v231: Erkennt rechen-/reasoning-lastige Inhalte (mehrschrittige Mathematik), bei
// denen sich die vorige Antwort verrechnet haben kann. Wird genutzt, um beim
// "Anders erklären" NICHT die kontaminierte Historie anzuhängen, sondern frisch zu
// lösen. (Kein Server-Pendant mehr – das Rechen-Modell-Routing wurde verworfen,
// nachdem das Eval zeigte, dass Haiku saubere Aufgaben fehlerfrei rechnet.)
const COMPUTE_RE = /\b(rechne|berechn|errechne|ausrechn|löse|lös |bestimme|ergebnis|gleichung|ableit|leite ab|integr|stammfunktion|nullstell|grenzwert|wahrscheinlich|prozent|zinsen?|matrix|matrizen|vektor|determinant|vereinfache|umstell|umform|faktorisier|ausklammer|kürze|bruch|wurzel|logarithm|potenz|exponent|quadratisch|herleit|beweise?|sinus|cosinus|tangens|mittelwert|standardabweich|formel\b|rechenweg|lösungsweg)/i;
function looksComputational(text) {
  const s = typeof text === 'string' ? text : '';
  if (COMPUTE_RE.test(s)) return true;
  if (/\d\s*[+\-*/×·:^=]\s*[\d(a-zA-Z]/.test(s)) return true; // "12 * 3", "x = 5 + 2"
  return false;
}

async function rephraseReply(originalReply) {
  // RAG-Query = die ursprüngliche Frage des Studenten (semantisch näher am Stoff als
  // die Synthese-Anweisung); Fallback auf die zu paraphrasierende Antwort selbst.
  const lastUser = [...(sessionMeta.chatHistory || [])].reverse().find(m => m.role === 'user');
  const ragQuery = (typeof lastUser?.content === 'string' && lastUser.content) || originalReply || '';
  // v231: Bei Rechnungen die Historie NICHT mitschicken. Sie enthält die vorige (evtl.
  // verrechnete) Antwort und verleitet das Modell, seine eigene Zahl zu wiederholen oder
  // zwei widersprüchliche Ergebnisse nebeneinanderzustellen. Stattdessen die Originalfrage
  // unabhängig und KB-gegroundet NEU lösen – ohne Anker an der alten Antwort.
  const compute = looksComputational(ragQuery) || looksComputational(originalReply);
  const rephrasePrompt = compute
    ? [{ role: 'user', content: `${ragQuery}\n\nLöse diese Aufgabe Schritt für Schritt komplett NEU und unabhängig – ignoriere frühere Lösungsversuche vollständig. Rechne jeden Schritt sorgfältig nach. Es gibt genau EIN korrektes Endergebnis; lege dich darauf fest und nenne nur dieses (keine zwei nebeneinander). Wähle bewusst einen anderen, anschaulichen Erklär-Zugang.` }]
    : [
        ...sessionMeta.chatHistory,
        { role: 'user', content: 'Erkläre dasselbe Thema nochmal komplett anders – andere Analogie, anderes Beispiel, anderen Einstieg. Ziel: mir einen neuen Zugang ermöglichen.' },
      ];
  const typ = addTyping(chatMessages);
  try {
    const rephrase = await claudeLocalKb(rephrasePrompt, '', 1000, ragQuery);
    typ.remove();
    addMsg(chatMessages, 'assistant', rephrase, () => rephraseReply(rephrase));
  } catch (e) {
    typ.remove();
    addMsg(chatMessages, 'assistant', '⚠️ ' + e.message);
  }
}

document.getElementById('btn-diagram')?.addEventListener('click', () => {
  chatInput.value = 'Erkläre den aktuellen Sachverhalt als Mermaid-Diagramm (flowchart TD). Zeige Zusammenhänge, Abläufe oder Strukturen visuell.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-mindmap')?.addEventListener('click', () => {
  chatInput.value = 'Erstelle eine Mermaid-Mind-Map (mindmap) zu dem Thema, das wir gerade besprochen haben. Zeige Hauptkonzept und alle wichtigen Unterthemen.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('btn-formula')?.addEventListener('click', () => {
  chatInput.value = 'Liste die wichtigsten Formeln zu dem Thema, das wir gerade besprochen haben. Schreibe jede Formel in LaTeX-Notation ($$...$$) und erkläre kurz was jede Variable bedeutet.';
  autoResize(chatInput);
  sendChat();
});

document.getElementById('chat-reset')?.addEventListener('click', async () => {
  sessionMeta.chatHistory = [];
  await DB.setMeta(sessionId, sessionMeta);
  chatMessages.innerHTML = `<div class="welcome"><div class="welcome-icon">🔄</div><p>Chat gelöscht.</p></div>`;
});

// ══ QUIZ ══════════════════════════════════════════════════════════════════

document.getElementById('quiz-start-btn')?.addEventListener('click', fetchQuestion);
document.getElementById('quiz-submit')?.addEventListener('click',    submitAnswer);
document.getElementById('quiz-next')?.addEventListener('click',      fetchQuestion);
document.getElementById('quiz-stop')?.addEventListener('click',      () => switchToAnalysis());
document.getElementById('quiz-retry-btn')?.addEventListener('click', fetchQuestion);
document.getElementById('quiz-back-btn')?.addEventListener('click',  () => showQuizState(document.getElementById('quiz-idle')));
document.getElementById('quiz-answer')?.addEventListener('keydown',  e => { if (e.key === 'Enter' && e.ctrlKey) submitAnswer(); });
// Konfidenz-Buttons: einblenden sobald der Nutzer schreibt, deaktivieren bei Löschen
document.getElementById('quiz-answer')?.addEventListener('input', e => {
  const hasText = e.target.value.trim().length > 5;
  const confEl = document.getElementById('quiz-confidence');
  if (confEl) confEl.classList.toggle('hidden', !hasText);
  if (!hasText) { quizConfidence = 0; document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active')); }
});
document.querySelectorAll('.conf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quizConfidence = parseInt(btn.dataset.conf, 10);
    document.querySelectorAll('.conf-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.getElementById('quiz-reset-btn')?.addEventListener('click', async () => {
  if (!await confirmDialog('Dein bisheriger Quiz-Fortschritt wird gelöscht.',
      { title: 'Quiz zurücksetzen', okText: 'Zurücksetzen', danger: true })) return;
  sessionMeta.quizStats = { questions: [] };
  sessionMeta.currentQuestion = null;
  await DB.setMeta(sessionId, sessionMeta);
  await syncSubjectSummary();
  updateScoreChip();
  document.getElementById('quiz-summary').classList.add('hidden');
  showQuizState(document.getElementById('quiz-idle'));
  refreshAnalysisState();
});
document.getElementById('quiz-blitz-btn')?.addEventListener('click', startBlitz);
document.getElementById('fb-deepen-btn')?.addEventListener('click', () => deepenWeakTopic(lastFbTopicName));

function showQuizState(el) {
  document.querySelectorAll('#panel-quiz .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

// Baut den (zustandsabhängigen) Prompt für die nächste Quiz-Frage.
// `done` = Anzahl bereits beantworteter Fragen → bestimmt Nummer, Avoid-Liste
// und Schwerpunkt. Als eigene Funktion, damit Prefetch und fetchQuestion exakt
// denselben Prompt erzeugen.
function buildQuestionPrompt(done, extraAvoid) {
  const avoidList = sessionMeta.quizStats.questions.slice(-8).map(q => q.question);
  // Beim frühen Prefetch ist die aktuelle Frage noch nicht in der Historie –
  // sie wird zusätzlich übergeben, damit die nächste Frage sie nicht wiederholt.
  if (extraAvoid) avoidList.push(extraAvoid);
  const avoid = avoidList.join('\n- ');
  // Gezieltes Retrieval: gelernte Themen abfragen festigt sie (Testing-Effekt),
  // schwache Themen brauchen die meiste Übung.
  const learnedNames = [...new Set(learnedTopics.map(t => t.split('::')[0]))]
    .filter(t => scannedTopics.includes(t));
  const weak = getWeakTopics(sessionMeta.quizStats.questions).slice(0, 4);
  let focusInstr = '';
  // KB-Retrieval-Query: das Schwerpunktthema (falls vorhanden) holt gezielt dessen
  // Auszüge; sonst greift der mitgelieferte Themen-Überblick für die Breite.
  let query = sessionMeta.name || '';
  if (weak.length && done % 2 === 0) {
    focusInstr = `\nSCHWERPUNKT: Stelle die Frage zu einem dieser Themen, bei denen der Student noch Schwächen zeigt: ${weak.join(', ')}.`;
    query = weak.join(', ');
  } else if (learnedNames.length) {
    const pick = learnedNames[Math.floor(Math.random() * learnedNames.length)];
    focusInstr = `\nSCHWERPUNKT: Stelle die Frage zum kürzlich gelernten Thema "${pick}" – aktives Erinnern festigt das Wissen.`;
    query = pick;
  }

  const prompt = `Stelle EINE Prüfungsfrage für "${sessionMeta.name}" (Frage ${done + 1}).
${focusInstr}
Bevorzuge Fragen die echtes Verständnis testen:
- "Erkläre warum…" / "Was passiert wenn…"
- Transferfragen: Konzept auf neue Situation anwenden
- Zusammenhänge: "Wie hängt X mit Y zusammen?"
- Kein reines Faktenwissen oder Definitionen auswendig lernen

Abwechslung: Mix aus Verständnis, Anwendung und Zusammenhängen.
${avoid ? `Bereits gestellte Fragen vermeiden:\n- ${avoid}` : ''}
Antworte NUR mit der Frage, ohne Kommentar.`;
  return { prompt, query };
}

// Holt eine Frage vom Modell. Modell-/Netzfehler sind oft kurzlebig → einmal
// automatisch neu versuchen. Wirft erst, wenn beide Versuche scheitern.
// `p` ist das Objekt aus buildQuestionPrompt ({ prompt, query }).
async function generateQuestionText(p) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await claudeLocalKb([{ role: 'user', content: 'Nächste Frage.' }], p.prompt, 300, p.query);
      if (!r || !r.trim()) throw new Error('Leere Antwort');
      return r.trim();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Frage konnte nicht geladen werden');
}

// Prefetch: lädt die nächste Frage schon während der Nutzer das Feedback liest.
// Best-effort – Fehler werden geschluckt, fetchQuestion lädt dann normal nach.
function prefetchNextQuestion() {
  if (!sessionMeta || !sessionId) return;
  const done = sessionMeta.quizStats.questions.length;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === done) return; // läuft schon
  const promise = generateQuestionText(buildQuestionPrompt(done));
  promise.catch(() => {}); // keine unhandled rejection bis fetchQuestion awaitet
  nextQ = { promise, forDone: done, forSession: sessionId };
}

// Früher Prefetch: lädt die nächste Frage schon, WÄHREND der Nutzer die aktuelle
// beantwortet (nicht erst beim Feedback). forDone = der Stand NACH dem Beantworten
// der aktuellen Frage – passt damit zum done, das fetchQuestion danach berechnet.
function prefetchUpcomingQuestion(currentQ) {
  if (!sessionMeta || !sessionId) return;
  const upcomingDone = sessionMeta.quizStats.questions.length + 1;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === upcomingDone) return; // läuft schon
  const promise = generateQuestionText(buildQuestionPrompt(upcomingDone, currentQ));
  promise.catch(() => {});
  nextQ = { promise, forDone: upcomingDone, forSession: sessionId };
}

async function fetchQuestion() {
  if (!sessionMeta) return;
  // Reset confidence for each new question
  quizConfidence = 0;
  document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('quiz-confidence')?.classList.add('hidden');
  document.getElementById('q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-submit').disabled = true;
  // Frage-Eingabe zeigen, evtl. übrige Fehler-Buttons ausblenden
  document.getElementById('quiz-a-area')?.classList.remove('hidden');
  document.getElementById('quiz-q-error-btns')?.classList.add('hidden');
  showQuizState(document.getElementById('quiz-q'));

  const done = sessionMeta.quizStats.questions.length;

  // Vorab geladene Frage nutzen (oder den laufenden Prefetch abwarten statt einen
  // zweiten Request zu starten). Nur wenn sie zu genau diesem Fach+Stand passt.
  let promise;
  if (nextQ && nextQ.forSession === sessionId && nextQ.forDone === done) {
    promise = nextQ.promise;
  } else {
    promise = generateQuestionText(buildQuestionPrompt(done));
  }
  nextQ = null;

  let q;
  try { q = await promise; }
  catch (e) { showQuizError(e?.message || 'Frage konnte nicht geladen werden'); return; }

  sessionMeta.currentQuestion = q;
  await DB.setMeta(sessionId, sessionMeta);
  document.getElementById('q-box').textContent = q;
  const qsc = sessionMeta.quizStats.questions;
  const sc  = qsc.reduce((a, x) => a + x.score, 0);
  document.getElementById('q-num').textContent   = `Frage ${done + 1}`;
  document.getElementById('q-score').textContent = qsc.length ? `${sc}/${qsc.length * 3} Pkt.` : '';
  document.getElementById('quiz-submit').disabled = false;
  document.getElementById('quiz-answer').focus();

  // Nächste Frage schon laden, während der Nutzer DIESE beantwortet – so ist sie
  // beim "Weiter" praktisch immer fertig (der Feedback-Prefetch greift dann nur
  // noch als Fallback, falls dieser hier scheitern sollte).
  prefetchUpcomingQuestion(q);
}

// Frage konnte nicht geladen werden: Eingabe verstecken, Wiederholen/Zurück anbieten,
// damit der Nutzer nicht das ganze Fach verlassen muss.
function showQuizError(msg) {
  document.getElementById('q-box').textContent = '⚠️ ' + msg;
  document.getElementById('quiz-a-area')?.classList.add('hidden');
  document.getElementById('quiz-q-error-btns')?.classList.remove('hidden');
}

async function submitAnswer() {
  const answer = document.getElementById('quiz-answer').value.trim();
  if (!answer || !sessionMeta?.currentQuestion) return;
  document.getElementById('quiz-submit').disabled = true;

  const evalPrompt = `Bewerte die Antwort STRENG UND PESSIMISTISCH – Prüfungen verzeihen nichts.

Skala (im Zweifel den NIEDRIGEREN Wert wählen):
• 3 = vollständig korrekt, präzise, ALLE wesentlichen Punkte, keine Fehler
• 2 = Kernaussage stimmt, aber wichtige Details fehlen ODER kleinere Fehler
• 1 = Grundidee erkennbar, aber erhebliche Lücken oder mehrere Fehler
• 0 = falsch, am Thema vorbei, oder so lückenhaft dass es nicht zählt

Im "feedback"-Feld:
- Erkläre konkret was gefehlt hat oder warum es falsch war
- Erkläre den Hintergrund / das Warum der richtigen Antwort (nicht nur was richtig ist, sondern warum)
- Wertschätzend aber ehrlich – Fehler sind Lernchancen

Im "correct_answer"-Feld: Gib eine vollständige Musterantwort mit Hintergrunderklärung.

Antworte NUR als JSON:
{"score":<0-3>,"correct":<true|false>,"topic":"<Thema max 4 Wörter>","feedback":"<2-3 Sätze mit Hintergrund>","correct_answer":"<Musterantwort mit Erklärung>"}`;

  try {
    const raw = await claudeLocalKb(
      [{ role: 'user', content: `Frage: ${sessionMeta.currentQuestion}\n\nAntwort: ${answer}` }],
      evalPrompt, 1200,  // 700 schnitt Feedback+Musterantwort ab → JSON unvollständig
      `${sessionMeta.currentQuestion}\n${answer}`,
    );
    // Robust parsen wie beim Blitz (v140): handhabt ```json-Fences und kaputte
    // Zeilenumbrüche in Strings – sonst scheitert die Bewertung unnötig oft.
    const ev = parseJsonResponse(raw);
    if (!ev) throw new Error('Ungültige Modellantwort');
    // Harden the model's score: clamp to a valid 0–3 integer so array lookups
    // (labels/classes), XP and the stored quiz result can't break on
    // out-of-range, string or null values.
    let score = Math.round(Number(ev.score));
    if (!Number.isFinite(score)) score = 0;
    ev.score = Math.max(0, Math.min(3, score));
    ev.correct = !!ev.correct;
    haptic(ev.score >= 2 ? 40 : [80,40,80]);

    const savedConf = quizConfidence;
    const isOverconfident = savedConf === 3 && ev.score <= 1;
    const isSureAndRight  = savedConf === 3 && ev.score >= 2;
    lastFbTopicName = ev.topic || '';

    sessionMeta.quizStats.questions.push({
      question: sessionMeta.currentQuestion, userAnswer: answer,
      correct: ev.correct, score: ev.score, topic: ev.topic,
      correctAnswer: ev.correct_answer, feedback: ev.feedback,
      confidence: savedConf,
      ts: Date.now(), blitz: false,
    });
    sessionMeta.currentQuestion = null;
    DB.addQuizResult(sessionId, ev.score, 3);
    await DB.setMeta(sessionId, sessionMeta);
    await syncSubjectSummary();
    updateScoreChip();
    touchStreak();

    // Konfidenz-adjustierte XP: überzeugtes Richtig → Bonus; überzeugtes Falsch → keine XP
    if (!isOverconfident && ev.score > 0) addXP(ev.score * 5);

    const labels  = ['❌ Falsch (0/3)', '⚠️ Ansatz (1/3)', '🔶 Teilweise (2/3)', '✅ Korrekt (3/3)'];
    const classes = ['c0', 'c1', 'c2', 'c3'];
    document.getElementById('fb-score').textContent = labels[ev.score];
    document.getElementById('fb-score').className   = `fb-score ${classes[ev.score]}`;
    document.getElementById('fb-text').textContent  = ev.feedback;
    document.getElementById('fb-correct').innerHTML = `<strong>Musterantwort:</strong> ${esc(ev.correct_answer)}`;

    // Konfidenz-Feedback
    const confEl = document.getElementById('fb-confidence');
    if (confEl && savedConf > 0) {
      const confLabels = ['', '🤔 Unsicher', '🙂 Eher sicher', '😎 Sehr sicher'];
      if (isOverconfident) {
        confEl.className = 'fb-confidence fb-confidence--alarm';
        confEl.innerHTML = `<strong>⚠️ Fehleinschätzung!</strong> Du warst sehr sicher, aber die Antwort war falsch. Das deutet auf eine echte Wissenslücke hin – dieses Thema solltest du unbedingt vertiefen.`;
      } else if (isSureAndRight) {
        confEl.className = 'fb-confidence fb-confidence--bonus';
        confEl.innerHTML = `<strong>🎯 Sicher &amp; Korrekt!</strong> Gute Kalibrierung – du weißt was du weißt. +Bonus XP.`;
      } else {
        confEl.className = 'fb-confidence fb-confidence--info';
        confEl.textContent = `Selbsteinschätzung: ${confLabels[savedConf]}`;
      }
      confEl.classList.remove('hidden');
    } else if (confEl) { confEl.classList.add('hidden'); }

    // "Thema vertiefen" anbieten – schon beim ersten Patzer, nicht erst beim
    // Wiederholungstäter (genau dann bringt Aufteilen am meisten).
    const deepEl = document.getElementById('fb-deepen');
    if (deepEl) {
      const weakNow = getWeakTopics(sessionMeta.quizStats.questions);
      const offer = !!lastFbTopicName &&
        (ev.score <= 1 || isOverconfident || weakNow.includes(lastFbTopicName));
      deepEl.classList.toggle('hidden', !offer);
      // Bei Fehleinschätzung (sicher + falsch) dringlicher hervorheben.
      deepEl.classList.toggle('fb-deepen--urgent', offer && isOverconfident);
      const hintEl = document.getElementById('fb-deepen-hint');
      if (hintEl) hintEl.textContent = isOverconfident
        ? 'Hier klafft eine Wissenslücke – soll ich das Thema in kleinere, leichtere Häppchen zerlegen?'
        : 'Dieses Thema hakt noch – soll ich es in kleinere, leichtere Häppchen zerlegen?';
    }

    showQuizState(document.getElementById('quiz-fb'));
    // Nächste Frage schon laden, während der Nutzer das Feedback liest – beim
    // Klick auf "Weiter" erscheint sie dann praktisch sofort.
    prefetchNextQuestion();
    refreshAnalysisState();
    sessionTick('quiz');
    if (!isOverconfident && ev.score >= 2) {
      const xpBonus = isSureAndRight ? (ev.score === 3 ? 20 : 13) : (ev.score === 3 ? 15 : 10);
      addXP(xpBonus); comboUp();
    } else {
      if (!isOverconfident && ev.score === 1) addXP(5);
      comboReset();
    }
  } catch (e) {
    document.getElementById('quiz-submit').disabled = false;
    document.getElementById('q-box').textContent = '⚠️ ' + e.message;
    showQuizState(document.getElementById('quiz-q'));
  }
}

// ── Schwaches Thema in Unterteile aufteilen ────────────────────────────────
async function deepenWeakTopic(topicName) {
  if (!topicName || !sessionId) return;
  const btn = document.getElementById('fb-deepen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const raw = await claudeLocalKb(
      [{ role: 'user', content: `Teile das Thema "${topicName}" in 3–4 Unterteile auf.` }],
      `Du bist ein Lernassistent für das Fach "${sessionMeta?.name || ''}".
Teile das Thema "${topicName}" in 3–4 klar abgegrenzte Unterteile auf, die ein Student schrittweise lernen kann.
Die Unterteile sollen KURZE Thementitel sein (max. 5 Wörter je Titel), keine Aufgaben.
Antworte NUR als JSON: {"subtopics":["<Titel 1>","<Titel 2>","<Titel 3>"]}`,
      300,
      topicName
    );
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Keine Subtopics erhalten');
    const data = parseJsonLoose(m[0]);
    if (!Array.isArray(data.subtopics) || !data.subtopics.length) throw new Error('Leere Subtopics');
    const subs = data.subtopics.map(s => `${topicName}: ${s}`);
    const idx  = scannedTopics.indexOf(topicName);
    if (idx >= 0) scannedTopics.splice(idx + 1, 0, ...subs);
    else          scannedTopics.push(...subs);
    await localforage.setItem(`topics_${sessionId}`, scannedTopics).catch(() => {});
    loadLernpfad();
    document.getElementById('fb-deepen')?.classList.add('hidden');
    toast(`${subs.length} Unterteile zu "${topicName}" im Lernpfad hinzugefügt`, 'success', 3500);
  } catch (e) {
    toast('Fehler: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ In Häppchen aufteilen'; }
  }
}

// ── Blitz-Quiz ─────────────────────────────────────────────────────────────

function startBlitz() {
  blitzIdx = 0;
  blitzResults = [];
  blitzNext = null;
  fetchBlitzQuestion();
}

// Holt EINE Blitz-Frage vom Modell. Lokale Modelle liefern gelegentlich kaputtes
// JSON – bis zu zweimal automatisch neu versuchen, bevor wir aufgeben (wirft dann).
async function genBlitzQuestion() {
  const blitzPrompt = `Erstelle EINE Multiple-Choice-Frage für "${sessionMeta.name}".
Teste echtes Verständnis, nicht reines Faktenwissen.
Antworte NUR als JSON (kein Text davor oder danach):
{"question":"<Frage>","options":["A: <Text>","B: <Text>","C: <Text>","D: <Text>"],"correct":0,"explanation":"<Kurze Erklärung warum richtig>"}
"correct" ist der 0-basierte Index der richtigen Option (0=A, 1=B, 2=C, 3=D).`;

  let data, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 400 schnitt Frage+Optionen+Erklärung gelegentlich ab → JSON ohne
      // schließende "}" → parseJsonResponse lieferte null → "Ungültige Antwort"
      // bei jedem Versuch (deterministisch). 800 gibt genug Luft.
      const raw = await claudeLocalKb([{ role: 'user', content: 'MC-Frage.' }], blitzPrompt, 800, sessionMeta.name);
      const parsed = parseJsonResponse(raw);
      if (!parsed) throw new Error('Ungültige Antwort');
      if (!Array.isArray(parsed.options) || parsed.options.length < 2) throw new Error('Ungültige Antwortoptionen');
      // Local models sometimes encode the index as a string ("2") or letter ("C")
      // instead of a number — normalise so the strict i===correct compare works.
      let correct = parsed.correct;
      if (typeof correct === 'string') {
        const t = correct.trim().toUpperCase();
        correct = /^[A-D]$/.test(t) ? t.charCodeAt(0) - 65 : parseInt(t, 10);
      }
      if (!Number.isInteger(correct) || correct < 0 || correct >= parsed.options.length)
        throw new Error('Ungültiger Lösungsindex');
      parsed.correct = correct;
      data = parsed; break;
    } catch (e) { lastErr = e; }
  }
  if (!data) throw (lastErr || new Error('Frage konnte nicht geladen werden'));
  return data;
}

// Prefetch: lädt die nächste Blitz-Frage schon, während der Nutzer die aktuelle
// beantwortet. Best-effort – Fehler werden geschluckt, fetchBlitzQuestion lädt
// dann normal nach.
function prefetchBlitzQuestion(forIdx) {
  if (!sessionMeta) return;
  if (blitzNext && blitzNext.forIdx === forIdx) return; // läuft schon
  const promise = genBlitzQuestion();
  promise.catch(() => {});
  blitzNext = { promise, forIdx };
}

async function fetchBlitzQuestion() {
  showQuizState(document.getElementById('quiz-blitz-q'));
  document.getElementById('blitz-q-num').textContent = `Frage ${blitzIdx + 1}/5`;
  document.getElementById('blitz-q-score').textContent = blitzResults.length
    ? `${blitzResults.filter(r => r.correct).length}/${blitzResults.length} richtig` : '';
  document.getElementById('blitz-q-box').innerHTML =
    '<div class="typing-dots"><span></span><span></span><span></span></div>';
  document.getElementById('mc-grid').innerHTML = '';
  document.getElementById('blitz-error-btns')?.classList.add('hidden');

  // Vorab geladene Frage nutzen, falls sie zu genau diesem Stand passt – sonst
  // (oder bei Prefetch-Fehler) frisch laden.
  let data;
  try {
    if (blitzNext && blitzNext.forIdx === blitzIdx) {
      const p = blitzNext.promise; blitzNext = null;
      data = await p;
    } else {
      blitzNext = null;
      data = await genBlitzQuestion();
    }
  } catch (e) { showBlitzError(e?.message || 'Frage konnte nicht geladen werden'); return; }

  document.getElementById('blitz-q-box').textContent = data.question;
  const grid = document.getElementById('mc-grid');
  data.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'mc-btn';
    const label = opt.replace(/^[A-D]:\s*/, '');
    btn.innerHTML = `<span class="mc-letter">${['A','B','C','D'][i]}</span>${esc(label)}`;
    btn.addEventListener('click', () =>
      selectBlitzAnswer(i, data.correct, data.question, data.explanation, grid, data.options));
    grid.appendChild(btn);
  });

  // Nächste Frage schon vorab laden, während der Nutzer antwortet (außer der letzten).
  if (blitzIdx + 1 < 5) prefetchBlitzQuestion(blitzIdx + 1);
}

// Blitz-Frage fehlgeschlagen: Wiederholen/Zurück anbieten statt Sackgasse.
function showBlitzError(msg) {
  document.getElementById('blitz-q-box').textContent = '⚠️ ' + msg;
  document.getElementById('mc-grid').innerHTML = '';
  document.getElementById('blitz-error-btns')?.classList.remove('hidden');
}

function selectBlitzAnswer(chosen, correct, question, explanation, grid, options) {
  grid.querySelectorAll('.mc-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === correct) btn.classList.add('mc-correct');
    if (i === chosen && chosen !== correct) btn.classList.add('mc-wrong');
  });

  const isCorrect = chosen === correct;
  haptic(isCorrect ? 40 : [80,40,80]);
  blitzResults.push({ correct: isCorrect });

  sessionMeta.quizStats.questions.push({
    question,
    userAnswer: (options[chosen] || '').replace(/^[A-D]:\s*/, ''),
    correct: isCorrect, score: isCorrect ? 3 : 0, topic: 'Blitz',
    correctAnswer: (options[correct] || '').replace(/^[A-D]:\s*/, '') + (explanation ? ' – ' + explanation : ''),
    feedback: explanation || '', ts: Date.now(), blitz: true,
  });
  touchStreak();

  blitzIdx++;
  if (blitzIdx < 5) {
    setTimeout(fetchBlitzQuestion, 1200);
  } else {
    DB.setMeta(sessionId, sessionMeta);
    syncSubjectSummary();
    updateScoreChip();
    refreshAnalysisState();
    setTimeout(endBlitz, 1200);
  }
}

function endBlitz() {
  const correct = blitzResults.filter(r => r.correct).length;
  const pct = Math.round(correct / 5 * 100);
  const color = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('blitz-result-card').innerHTML = `
    <div class="blitz-score" style="color:${color}">${correct}/5</div>
    <div class="blitz-label">Richtige Antworten</div>
    <div class="blitz-rows">${blitzResults.map((r, i) =>
      `<div class="blitz-row ${r.correct ? 'ok' : 'fail'}">${r.correct ? '✅' : '❌'} Frage ${i + 1}</div>`
    ).join('')}</div>`;
  showQuizState(document.getElementById('quiz-blitz-done'));
  sessionTick('quiz-complete');
  if (correct > 0) addXP(correct * 8, `Blitz-Quiz: ${correct}/5`);
}

document.getElementById('blitz-again-btn')?.addEventListener('click', startBlitz);
document.getElementById('blitz-stop-btn')?.addEventListener('click', () => switchToAnalysis());
document.getElementById('blitz-stop-btn2')?.addEventListener('click', () => switchToAnalysis());
document.getElementById('blitz-retry-btn')?.addEventListener('click', fetchBlitzQuestion);
document.getElementById('blitz-back-btn')?.addEventListener('click', () => showQuizState(document.getElementById('quiz-idle')));

// ══ EXAM ══════════════════════════════════════════════════════════════════

function hasExamDocs() {
  if (!sessionMeta?.files?.length) return false;
  const kw = ['klausur', 'altklausur', 'probeklausur', 'prüfung', 'exam'];
  return sessionMeta.files.some(f => kw.some(k => f.name.toLowerCase().includes(k)));
}

function updatePruefungsnahBtns() {
  const has = hasExamDocs();
  ['diff-pruefungsnah', 'adiff-pruefungsnah'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !has;
    btn.title = has ? '' : 'Lade zuerst Probe- oder Altklausuren hoch';
  });
}

document.querySelectorAll('.diff-btn').forEach(b => b.addEventListener('click', () => {
  selDiff = b.dataset.diff;
  document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

document.querySelectorAll('.diff-btn-a').forEach(b => b.addEventListener('click', () => {
  selAufgabenDiff = b.dataset.adiff;
  document.querySelectorAll('.diff-btn-a').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
document.getElementById('exam-gen-btn')?.addEventListener('click', generateExam);
document.getElementById('exam-new-btn')?.addEventListener('click', () => {
  document.getElementById('exam-idle').classList.remove('hidden');
  document.getElementById('exam-result').classList.add('hidden');
  loadSavedKlausuren();
});
document.getElementById('exam-ans-btn')?.addEventListener('click', toggleExamAns);

async function loadSavedKlausuren() {
  const wrap = document.getElementById('exam-saved-wrap');
  const list = document.getElementById('exam-saved-list');
  if (!wrap || !list || !sessionId) return;
  try {
    const items = await api(`/api/subjects/${sessionId}/klausuren`);
    if (!items.length) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    list.innerHTML = '';
    const diffLabels = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer', pruefungsnah: '📋 Prüfungsnah', experte: '💪 Experte' };
    items.forEach(k => {
      const date = new Date(k.created_at).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
      const row = document.createElement('div');
      row.className = 'saved-aufg-row';
      row.innerHTML = `
        <div class="saved-aufg-info">
          <span class="saved-aufg-type">📋 Klausur</span>
          <span class="saved-aufg-topic">${esc(diffLabels[k.diff] || k.diff || '')}</span>
          <span class="saved-aufg-date">${date}</span>
        </div>
        <div class="saved-aufg-btns">
          <button class="btn-secondary btn-sm">Öffnen</button>
          <button class="btn-icon-sm saved-del-btn">🗑</button>
        </div>`;
      row.querySelector('.btn-secondary').addEventListener('click', () => restoreKlausur(k));
      row.querySelector('.saved-del-btn').addEventListener('click', async () => {
        await api(`/api/subjects/${sessionId}/klausuren/${k.id}`, { method: 'DELETE' });
        loadSavedKlausuren();
      });
      list.appendChild(row);
    });
  } catch (_) {}
}

function restoreKlausur(k) {
  currentExamText = k.content;
  const body = document.getElementById('exam-body');
  const sepIdx = k.content.search(/---\s*\n+##\s*Lösungsschlüssel/i);
  if (sepIdx > -1) {
    body.innerHTML = safeHtml(md(k.content.slice(0, sepIdx)) +
      `<div class="ans-section">${md(k.content.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
  } else {
    body.innerHTML = safeHtml(md(k.content));
  }
  examAnsVis = false;
  body.closest('.exam-content').classList.add('answers-hidden');
  document.getElementById('exam-ans-btn').textContent = 'Lösungen anzeigen';
  document.getElementById('exam-idle').classList.add('hidden');
  document.getElementById('exam-result').classList.remove('hidden');
}

async function generateExam() {
  ['exam-idle','exam-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('exam-loading').classList.remove('hidden');
  const examDone = startProgress('exam-progress-bar', 'exam-progress-pct', 25000);
  examAnsVis = false;

  const diffInstructions = {
    leicht:       'Schwierigkeit: Leicht – Grundbegriffe, einfache Definitionen, direkte Fragen.',
    mittel:       'Schwierigkeit: Mittel – Verständnisfragen, einfache Anwendungen.',
    schwer:       'Schwierigkeit: Schwer – komplexe Anwendungen, Zusammenhänge erklären.',
    pruefungsnah: `Schwierigkeit: Prüfungsnah – orientiere dich STRIKT an den hochgeladenen Probe-/Altklausuren.
Analysiere deren Format, Aufgabentypen, Punkteverteilung und Formulierungsstil und bilde das so genau wie möglich nach.`,
    experte:      `Schwierigkeit: EXPERTE – bewusst schwerer als die echte Prüfung, um maximale Sicherheit aufzubauen.
Kombiniere mehrere Konzepte pro Aufgabe, teste Grenzfälle und Ausnahmen, verlange Transferdenken in ungewohnten Kontexten.
Zeitdruck: kompakter und dichter als normal.`,
  };

  // Klausur an den Lernpfad koppeln: genau die Themen abfragen, die der/die
  // Studierende im Lern-Bereich durcharbeitet → die Lernaufgaben "zahlen" sichtbar
  // auf die Klausur ein, keine fremden/lückenhaften Fragen.
  const curriculum = moduleStructure?.kapitel?.length
    ? `\n\nDECKE GENAU DIESE THEMEN AB (das ist der Lernpfad des/der Studierenden – stelle KEINE Fragen zu Themen außerhalb dieser Liste, aber decke die Breite ab):\n${moduleStructure.kapitel.map(k => `- ${k.titel}: ${k.themen.join(', ')}`).join('\n')}`
    : '';

  const examPrompt = `Erstelle eine Probeklausur für "${sessionMeta.name}".
${diffInstructions[selDiff] || diffInstructions.mittel}${curriculum}

# Probeklausur – ${sessionMeta.name}
**Bearbeitungszeit:** XX Min | **Punkte:** XX

## Teil A – Multiple Choice (je 1 Punkt)
[Min. 5 Fragen mit Optionen a–d]

## Teil B – Kurzantworten (je 3 Punkte)
[Min. 3 Fragen]

## Teil C – Ausführliche Antworten (je 6-8 Punkte)
[Min. 2 Fragen]

---
## Lösungsschlüssel
[Vollständige Lösungen]`;

  try {
    const exam = await claudeLocalKb([{ role: 'user', content: 'Klausur erstellen.' }], examPrompt, 3000, sessionMeta.name, { kbK: 12 });
    currentExamText = exam;
    api(`/api/subjects/${sessionId}/klausuren`, {
      method: 'POST',
      body: JSON.stringify({ id: Date.now().toString(), diff: selDiff, content: exam }),
    }).catch(() => {});
    const body = document.getElementById('exam-body');
    const sepIdx = exam.search(/---\s*\n+##\s*Lösungsschlüssel/i);
    if (sepIdx > -1) {
      body.innerHTML = safeHtml(md(exam.slice(0, sepIdx)) +
        `<div class="ans-section">${md(exam.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
    } else {
      body.innerHTML = safeHtml(md(exam));
    }
    body.closest('.exam-content').classList.add('answers-hidden');
    document.getElementById('exam-ans-btn').textContent = 'Lösungen anzeigen';
    examDone();
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-result').classList.remove('hidden');
  } catch (e) {
    examDone();
    document.getElementById('exam-loading').classList.add('hidden');
    document.getElementById('exam-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
  }
}

function toggleExamAns() {
  examAnsVis = !examAnsVis;
  document.getElementById('exam-body').closest('.exam-content')
    .classList.toggle('answers-hidden', !examAnsVis);
  document.getElementById('exam-ans-btn').textContent =
    examAnsVis ? 'Lösungen verbergen' : 'Lösungen anzeigen';
}

// ══ ANALYSIS ══════════════════════════════════════════════════════════════

document.getElementById('analysis-btn')?.addEventListener('click', runAnalysis);
document.getElementById('analysis-refresh')?.addEventListener('click', runAnalysis);

document.getElementById('lernziel-slider')?.addEventListener('input', async e => {
  const val = parseInt(e.target.value, 10);
  document.getElementById('lernziel-val').textContent = val + '%';
  if (sessionMeta) {
    sessionMeta.targetScore = val;
    await DB.setMeta(sessionId, sessionMeta);
  }
});

// Lernbereich-Stand pro Pfad-Thema (für die Analyse + das Freischalten):
// höchstes Niveau, Versuche, letzte Bewertung, Wiederholung fällig → daraus
// Buckets (wackelig / nur niedrig / nie angefasst / sicher / fällig).
const DIFF_NAMES = ['Einsteiger', 'Grundlagen', 'Lernender', 'Fortgeschritten', 'Prüfungsnah'];
function collectLernStats() {
  const topics = pathTopics();
  const per = topics.map(name => {
    const id = topicId(name);
    let attempts = 0, due = false, score = null;
    for (const k of Object.keys(topicMeta)) {
      const r = resolveKey(k); const i = r.lastIndexOf('::');
      if (i < 0 || r.slice(0, i) !== id) continue;
      const m = topicMeta[k] || {};
      attempts = Math.max(attempts, m.attempts || 0);
      if (typeof m.score === 'number') score = score === null ? m.score : Math.min(score, m.score);
      if (topicReviewDue(k)) due = true;
    }
    return { name, maxLevel: topicMaxLevel(name), attempts, due, score };
  });
  const weak  = per.filter(t => t.maxLevel >= 0 && (t.attempts >= 2 || (t.score !== null && t.score <= 1)));
  const low   = per.filter(t => t.maxLevel >= 0 && t.maxLevel <= 1 && !weak.includes(t));
  const solid = per.filter(t => t.maxLevel >= 3);
  const untouched = per.filter(t => t.maxLevel < 0);
  const due   = per.filter(t => t.due);
  const active = per.filter(t => t.maxLevel >= 0).length;
  const lernReadiness = topics.length
    ? Math.round(per.reduce((a, t) => a + Math.max(0, t.maxLevel) / 4, 0) / topics.length * 100) : 0;
  return { per, total: topics.length, active, weak, low, solid, untouched, due, lernReadiness };
}

function refreshAnalysisState() {
  const q    = sessionMeta?.quizStats?.questions || [];
  const ls   = collectLernStats();
  const ready = q.length >= 3 || ls.active >= 3;
  const btn  = document.getElementById('analysis-btn');
  const hint = document.getElementById('analysis-hint');
  btn.disabled = !ready;
  hint.textContent = ready
    ? `${q.length} Quiz-Fragen · ${ls.active}/${ls.total} Lernpfad-Themen bearbeitet – Analyse verfügbar.`
    : `Beantworte 3 Quiz-Fragen ODER bearbeite 3 Themen im Lernpfad für eine Analyse.`;
}

function renderSparkline() {
  const wrap = document.getElementById('spark-wrap');
  if (!wrap) return;
  const questions = (sessionMeta?.quizStats?.questions || []).slice(-20);
  if (!questions.length) { wrap.innerHTML = ''; return; }
  const dotColors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759'];
  const dots = questions.map(q => {
    const c = dotColors[Math.min(q.score, 3)];
    return `<span class="spark-dot" style="background:${c}" title="${esc(q.topic || '')}: ${q.score}/3"></span>`;
  }).join('');
  wrap.innerHTML = `<div class="spark-label">Letzte ${questions.length} Antworten</div><div class="spark-row">${dots}</div>`;
}

async function runAnalysis() {
  if (!sessionMeta) return;
  ['analysis-idle','analysis-result'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('analysis-loading').classList.remove('hidden');
  const analysisDone = startProgress('analysis-progress-bar', 'analysis-progress-pct', 20000);

  const questions = sessionMeta.quizStats.questions || [];
  const ls = collectLernStats();
  const statsText = questions.length
    ? questions.map((q, i) =>
        `${i+1}. [${q.topic}] ${q.score}/3 ${q.correct ? '✓' : '✗'}\n   F: ${q.question}\n   A: ${q.userAnswer}`
      ).join('\n\n')
    : '(keine Quiz-Daten – Einschätzung stützt sich auf den Lernbereich)';
  // Klausurbereitschaft aus BEIDEN Quellen: Quiz-Score und Lernbereich-Höchstlevel.
  const quizRaw = questions.length ? Math.round(questions.reduce((a, q) => a + q.score, 0) / (questions.length * 3) * 100) : null;
  const lernRaw = ls.active ? ls.lernReadiness : null;
  const raw = (quizRaw != null && lernRaw != null) ? Math.round((quizRaw + lernRaw) / 2)
            : (quizRaw != null ? quizRaw : (lernRaw != null ? lernRaw : 0));
  const percent    = Math.max(0, raw - 12);
  const targetScore = sessionMeta.targetScore || 75;
  const names = arr => arr.length ? arr.map(t => t.name).join(', ') : '–';
  const lernText = ls.total
    ? `LERNBEREICH-STAND (im Lernpfad gelöste Aufgaben, ${ls.active}/${ls.total} Themen bearbeitet):
- Wackelig (mehrere Versuche / schwache Bewertung): ${names(ls.weak)}
- Nur auf niedriger Stufe (max. Grundlagen): ${names(ls.low)}
- Noch nicht bearbeitet: ${names(ls.untouched)}
- Sicher (Fortgeschritten/Prüfungsnah erreicht): ${names(ls.solid)}
- Wiederholung fällig: ${names(ls.due)}`
    : '';

  const analysisPrmt = `Erstelle eine KRITISCHE, PESSIMISTISCHE Lernstandsanalyse für "${sessionMeta.name}".

PFLICHT: Sei bewusst streng. Prüfungen verlaufen unter Druck schlechter als Übungen.
Klausurbereitschaft: ${percent}% (pessimistisch korrigiert von ${raw}%; Quiz ${quizRaw ?? '–'}% / Lernbereich ${lernRaw ?? '–'}%).
Lernziel des Schülers: ${targetScore}%.
Vermeide falsche Sicherheit. Sage klar was noch fehlt.

Nutze SOWOHL die Quiz-Ergebnisse ALS AUCH den Lernbereich-Stand. Nenne in "Kritische Lücken" konkret die wackeligen, die nur niedrig bearbeiteten UND die noch nicht bearbeiteten Themen aus dem Lernbereich – nicht nur Quiz-Themen.

Berücksichtige lernpsychologische Erkenntnisse in deinen Empfehlungen:
- Spaced Repetition: Welche Themen müssen wiederholt werden und wann?
- Elaboration: Wo fehlt tiefes Verständnis (nur Auswendiglernen statt echtes Verstehen)?
- Retrieval Practice: Empfehle aktives Abrufen statt passives Lesen
- Interleaving: Welche Themen sollten gemischt geübt werden?
- Concrete Examples: Wo sollte die Person nach realen Anwendungsfällen suchen?

Format:
## Gesamteinschätzung
[Kritische, ehrliche Einschätzung – kein falscher Optimismus]

## Stärken ✓
- [nur was wirklich sicher sitzt – mit echtem Verständnis]

## Kritische Lücken ⚠
- **[Thema]:** [was genau fehlt, warum prüfungsrelevant, und ob es Verständnis- oder Wissenslücke ist]
(mindestens 3 konkrete Punkte)

## Lernstrategie-Empfehlungen
- [Konkrete Methoden: z.B. "Thema X mit eigenen Beispielen erklären", "Y mit Karteikarten via Spaced Repetition üben"]
- [Auf Verständnis fokussieren, nicht auf Auswendiglernen]

## Priorisierter Lernplan
1. [Dringendstes zuerst – mit konkreter Lernmethode]
2. ...

## Prognose
[Realistisch: wie viel Lernaufwand noch nötig ist, und ob das Lernziel von ${targetScore}% erreichbar ist]`;

  try {
    // Analyse wertet ausschließlich die übergebenen Quiz-/Lernstats aus – kein
    // Doku-Korpus nötig. Minimaler System-Block statt sysBlocks() spart den vollen
    // docsForPrompt()-Dump und die hier kontraproduktive QUELLENREGEL.
    const analysis = await claudeLocal(
      [{ role: 'user', content: `Quiz-Ergebnisse:\n${statsText}\n\n${lernText}\n\nQuiz-Rohwert: ${quizRaw ?? '–'}% · Lernbereich: ${lernRaw ?? '–'}% · kombiniert: ${raw}%` }],
      [{ type: 'text', text: `Du bist ein erfahrener Nachhilfelehrer für das Fach "${sessionMeta?.name || ''}".\n\n${analysisPrmt}` }], 2000,
    );
    const color = scoreColor(percent);
    const targetLeft = Math.min(Math.max(targetScore, 0), 100);
    document.getElementById('gauge').innerHTML = `
      <div class="gauge-pct" style="color:${color}">${percent}%</div>
      <div class="gauge-lbl">Geschätzte Klausurbereitschaft</div>
      <div class="gauge-bar">
        <div class="gauge-fill" style="width:${percent}%;background:${color}"></div>
        <div class="gauge-target" style="left:${targetLeft}%">🎯</div>
      </div>
      <div class="gauge-meta">${questions.length} Quiz-Fragen · ${ls.active}/${ls.total} Lernpfad-Themen · Quiz ${quizRaw ?? '–'}% / Lern ${lernRaw ?? '–'}% → ${percent}% · Ziel: ${targetScore}%</div>`;
    document.getElementById('analysis-body').innerHTML = safeHtml(md(analysis));
    renderSparkline();
    renderProgressChart();
    analysisDone();
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-result').classList.remove('hidden');
  } catch (e) {
    analysisDone();
    document.getElementById('analysis-loading').classList.add('hidden');
    document.getElementById('analysis-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
  }
}

// ── Fehlerkatalog ──────────────────────────────────────────────────────────

function renderFehlerkatalog() {
  const list  = document.getElementById('fehler-list');
  const empty = document.getElementById('fehler-empty');
  if (!sessionMeta) return;

  const fragen = (sessionMeta.quizStats.questions || [])
    .filter(q => q.score < 3)
    .slice()
    .reverse();

  if (!fragen.length) {
    empty.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  const scoreLabels  = ['❌ Falsch', '⚠️ Ansatz', '🔶 Teilweise'];
  const scoreClasses = ['c0', 'c1', 'c2'];

  list.innerHTML = fragen.map((q, i) => `
    <div class="fehler-item">
      <div class="fehler-meta">
        <span class="fehler-topic">${esc(q.topic || '–')}</span>
        <span class="fb-score ${scoreClasses[Math.min(q.score, 2)]}" style="font-size:14px">${scoreLabels[Math.min(q.score, 2)]}</span>
      </div>
      <div class="fehler-q">${esc(q.question)}</div>
      <div class="fehler-user"><strong>Deine Antwort:</strong> ${esc(q.userAnswer)}</div>
      ${q.feedback ? `<div class="fehler-feedback">${esc(q.feedback)}</div>` : ''}
      ${q.correctAnswer ? `<div class="fb-correct"><strong>Musterantwort:</strong> ${esc(q.correctAnswer)}</div>` : ''}
      <button class="btn-chat-this" data-question="${esc(q.question)}">💬 Im Chat besprechen</button>
    </div>
  `).join('');

  list.querySelectorAll('.btn-chat-this').forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.getAttribute('data-question');
      switchMode('chat');
      chatInput.value = `Erkläre mir nochmal genau: ${question}`;
      autoResize(chatInput);
      chatInput.focus();
    });
  });
}

// ══ CHAT COMPRESSION ══════════════════════════════════════════════════════

async function compressHistory(history) {
  const keep   = 8;
  const old    = history.slice(0, history.length - keep);
  const recent = history.slice(history.length - keep);

  const convText = old.map(m =>
    `${m.role === 'user' ? 'Schüler' : 'Lehrer'}: ${m.content}`
  ).join('\n\n');

  try {
    const summary = await claudeLocal(
      [{ role: 'user', content: `Fasse dieses Gespräch in max. 150 Wörtern zusammen. Behalte Themen, Konzept-Erklärungen und offene Fragen bei. WICHTIG: Übernimm KEINE konkreten Rechenergebnisse/Zahlenwerte als Fakt – halte nur fest, WELCHE Aufgabe gerechnet wurde, nicht das Ergebnis. So zementiert sich kein eventueller Rechenfehler im Kontext.\n\n${convText}` }],
      [{ type: 'text', text: 'Du fasst Lernunterhaltungen prägnant zusammen.' }],
      400,
    );
    return [
      { role: 'user',      content: `[Zusammenfassung früherer Unterhaltung: ${summary}]` },
      { role: 'assistant', content: 'Alles klar, ich habe den bisherigen Kontext erfasst.' },
      ...recent,
    ];
  } catch {
    return history.slice(-20);
  }
}

// ══ UTILS ═════════════════════════════════════════════════════════════════

function haptic(pattern = 10) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function addMsg(container, role, text, rephraseCallback) {
  const w = document.createElement('div');
  w.className = `message ${role}`;
  const b = document.createElement('div');
  b.className = 'bubble'; b.innerHTML = safeHtml(md(text));
  w.appendChild(b);
  if (role === 'assistant' && rephraseCallback) {
    const btn = document.createElement('button');
    btn.className = 'btn-rephrase';
    btn.textContent = '🔄 Anders erklären';
    btn.addEventListener('click', rephraseCallback);
    w.appendChild(btn);
  }
  container.appendChild(w);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  const mermaidEls = w.querySelectorAll('.mermaid');
  if (mermaidEls.length) mermaid.run({ nodes: mermaidEls });
  return w;
}

function addTyping(container) {
  const el = document.createElement('div');
  el.className = 'message assistant';
  el.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  container.appendChild(el);
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  return el;
}

// Wechselnde Status-Zeile statt statischem "wird geprüft": zeigt nacheinander,
// woran die KI gerade arbeitet. Bleibt am letzten Schritt stehen. Liefert stop().
function cycleStatus(el, steps, intervalMs = 1500) {
  if (!el || !steps || !steps.length) return () => {};
  let i = 0;
  el.textContent = steps[0];
  const timer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    el.textContent = steps[i];
  }, intervalMs);
  return () => clearInterval(timer);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// KaTeX emits SVG + inline styles; allow those while blocking actual XSS.
// Zusätzlich erlauben wir genug SVG-Vokabular für vom Modell gezeichnete
// Koordinaten-Diagramme (IS-LM, Angebot/Nachfrage, Funktionsgraphen).
const PURIFY_CFG = {
  ADD_TAGS: ['svg','path','g','use','defs','clipPath','line','circle','rect','polygon',
             'polyline','ellipse','text','tspan','marker','title','linearGradient','stop'],
  ADD_ATTR: ['viewBox','xmlns','xmlns:xlink','xlink:href','href','d','points','transform',
             'x','y','x1','y1','x2','y2','r','cx','cy','rx','ry','width','height',
             'clip-path','marker-end','marker-start','stroke','stroke-width','stroke-dasharray',
             'stroke-linecap','stroke-linejoin','fill','fill-rule','fill-opacity','stroke-opacity',
             'opacity','font-size','font-family','font-weight','text-anchor','dominant-baseline',
             'dx','dy','preserveAspectRatio','markerWidth','markerHeight','refX','refY','orient',
             'offset','stop-color','stop-opacity','gradientUnits'],
  ALLOW_DATA_ATTR: false,
};
const safeHtml = html => DOMPurify.sanitize(html, PURIFY_CFG);

function md(text) {
  if (!text) return '';
  const e = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Inline-Formatierung (fett/kursiv/code). Läuft auf bereits escaptem Text –
  // wird sowohl im Fließtext als auch in Tabellenzellen verwendet.
  // Kursiv erfordert Nicht-Leerzeichen direkt nach/vor dem * → "3 * 4"
  // (Multiplikation) wird NICHT fälschlich zu Kursiv.
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  // Extract mermaid blocks before HTML escaping
  const mermaidBlocks = [];
  text = text.replace(/```mermaid\n?([\s\S]*?)```/g, (_, code) => {
    mermaidBlocks.push(code.trim());
    return `\x00MBL${mermaidBlocks.length - 1}\x00`;
  });

  // Extract inline SVG before escaping. Das Modell zeichnet Koordinaten-Diagramme
  // (IS-LM, Angebot/Nachfrage, Funktionsgraphen) als rohes <svg>. Ohne Extraktion
  // würde e() es zu Text escapen. Ein optionaler ```svg-Fence wird vorher entfernt.
  const svgBlocks = [];
  text = text.replace(/```svg\s*([\s\S]*?)```/gi, (_, code) => code);
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => {
    const idx = svgBlocks.length;
    // id-Namespacing: Mehrere SVGs im selben Dokument (z.B. je eine Skizze in
    // "was" und "beispiel") definieren oft gleiche marker-/gradient-ids. Der
    // Browser löst url(#id) dokumentweit auf die ERSTE Definition auf → falsche
    // Pfeilspitzen/Verläufe. Wir präfixen jede id und ihre #-Referenzen pro Block.
    const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ids = new Set();
    m.replace(/\bid\s*=\s*['"]([^'"]+)['"]/gi, (_m, id) => (ids.add(id), _m));
    ids.forEach(id => {
      const pre = `s${idx}-${id}`;
      m = m.replace(new RegExp(`(\\bid\\s*=\\s*['"])${reEsc(id)}(['"])`, 'g'), `$1${pre}$2`);
      m = m.replace(new RegExp(`#${reEsc(id)}\\b`, 'g'), `#${pre}`);
    });
    svgBlocks.push(m);
    return `\x00SVG${svgBlocks.length - 1}\x00`;
  });

  // Extract math before HTML escaping. Reihenfolge: längste/eindeutigste zuerst.
  // Claude nutzt trotz Prompt häufig \(...\) und \[...\] statt $...$ – beide werden
  // unterstützt, sonst bleibt roher LaTeX ("Rechenzeichen") stehen.
  const mathParts = [];
  const pushMath = (latex, display) => {
    mathParts.push({ latex: latex.trim(), display });
    return `\x00MTH${mathParts.length - 1}\x00`;
  };
  text = text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, l) => pushMath(l, true))
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, l) => pushMath(l, true))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, l) => pushMath(l, false))
    .replace(/\$([^\$\n]+?)\$/g, (_, l) => pushMath(l, false));

  // Extract GFM-Tabellen (zeilenbasiert) vor dem Escaping. md() kann sie sonst
  // nicht darstellen → Pipe-Wirrwarr. Zellen behalten Math-Platzhalter.
  const tables = [];
  {
    const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('|') && lines[i + 1] != null && isSep(lines[i + 1])) {
        const header = lines[i], align = lines[i + 1], rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
          rows.push(lines[j]); j++;
        }
        tables.push({ header, align, rows });
        out.push(`\x00TBL${tables.length - 1}\x00`);
        i = j - 1;
      } else {
        out.push(lines[i]);
      }
    }
    text = out.join('\n');
  }

  let html = e(text)
    .replace(/^---$/gm, '<hr>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^[\*\-] (.+)$/gm, m => '<li>' + inline(m.slice(2)) + '</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?=\s*(?!<li>))/g, '<ul>$1</ul>');
  html = inline(html)
    .replace(/\n\n/g, '<br><br>')
    .trim();

  mermaidBlocks.forEach((code, i) => {
    html = html.replace(`\x00MBL${i}\x00`,
      `<div class="mermaid-wrap"><div class="mermaid">${code}</div></div>`);
  });

  svgBlocks.forEach((code, i) => {
    html = html.replace(`\x00SVG${i}\x00`, `<div class="svg-diagram">${code}</div>`);
  });

  tables.forEach((t, i) => {
    html = html.replace(`\x00TBL${i}\x00`, renderTable(t, e, inline));
  });

  mathParts.forEach(({ latex, display }, i) => {
    try {
      const rendered = katex.renderToString(latex, { displayMode: display, throwOnError: false, output: 'html' });
      html = html.replace(`\x00MTH${i}\x00`,
        display ? `<div class="math-block">${rendered}</div>` : `<span class="math-inline">${rendered}</span>`);
    } catch {
      html = html.replace(`\x00MTH${i}\x00`, display ? `<div class="math-block">$$${e(latex)}$$</div>` : `$${e(latex)}$`);
    }
  });

  return html;
}

// Rendert eine extrahierte GFM-Tabelle nach HTML. Zellen werden escaped und
// inline-formatiert; Math-Platzhalter (\x00MTH..\x00) überleben und werden
// später global ersetzt. Ausrichtung (:---:, ---:, :---) wird übernommen.
function renderTable(t, e, inline) {
  const splitRow = r => {
    let s = r.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map(c => c.trim());
  };
  const aligns = splitRow(t.align).map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return (l && r) ? 'center' : r ? 'right' : l ? 'left' : '';
  });
  const cell = (c, tag, al) =>
    `<${tag}${al ? ` style="text-align:${al}"` : ''}>${inline(e(c))}</${tag}>`;
  const head = splitRow(t.header).map((c, i) => cell(c, 'th', aligns[i])).join('');
  const body = t.rows.map(r =>
    `<tr>${splitRow(r).map((c, i) => cell(c, 'td', aligns[i])).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ══ AUFGABEN ══════════════════════════════════════════════════════════════

function showAufgabenState(el) {
  document.querySelectorAll('#panel-ueben .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

function initAufgaben() {
  if (scannedTopics.length) {
    renderTopicChips();
    showAufgabenState(document.getElementById('aufgaben-topics'));
  } else {
    showAufgabenState(document.getElementById('aufgaben-idle'));
  }
  renderSavedAufgaben();
}

async function renderSavedAufgaben() {
  const wrap = document.getElementById('saved-aufgaben-list');
  if (!wrap) return;
  const list = await DB.savedAufgaben(sessionId);
  if (!list.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = '<div class="saved-aufg-title">📂 Gespeicherte Aufgaben</div>';
  list.forEach(entry => {
    const typeLabel = entry.type === 'klausur' ? '📋 Klausur' : '📝 Übung';
    const date = new Date(entry.createdAt).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const row = document.createElement('div');
    row.className = 'saved-aufg-row';
    row.innerHTML = `
      <div class="saved-aufg-info">
        <span class="saved-aufg-type">${typeLabel}</span>
        <span class="saved-aufg-topic">${esc(entry.topic)}</span>
        <span class="saved-aufg-date">${date}</span>
      </div>
      <div class="saved-aufg-btns">
        <button class="btn-secondary btn-sm">Öffnen</button>
        <button class="btn-icon-sm saved-del-btn">🗑</button>
      </div>`;
    row.querySelector('.btn-secondary').addEventListener('click', () => restoreAufgabe(entry));
    row.querySelector('.saved-del-btn').addEventListener('click', async () => {
      await DB.delAufgabe(sessionId, entry.id);
      renderSavedAufgaben();
    });
    wrap.appendChild(row);
  });
}

function restoreAufgabe(entry) {
  aufgabenAnsVis = false;
  selTopic = entry.topic;
  selAufgabenType = entry.type;
  const body = document.getElementById('aufgaben-body');
  const sepIdx = entry.fullResult.search(/---\s*\n+##\s*(Lösungsschlüssel|Musterlösungen)/i);
  if (sepIdx > -1) {
    body.innerHTML = safeHtml(md(entry.tasksPart) +
      `<div class="ans-section">${md(entry.fullResult.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
  } else {
    body.innerHTML = safeHtml(md(entry.fullResult));
  }
  injectSolveButtons(entry.tasksPart);
  document.getElementById('aufgaben-rechnen-btn').onclick = () => sendToRechnen(entry.tasksPart.trim());
  body.closest('.aufgaben-content').classList.add('answers-hidden');
  document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
  showAufgabenState(document.getElementById('aufgaben-result'));
}

document.getElementById('aufgaben-scan-btn')?.addEventListener('click', scanTopics);
document.getElementById('aufgaben-rescan-btn')?.addEventListener('click', scanTopics);

async function scanTopics() {
  if (!sessionTxt && !sessionId) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  document.getElementById('aufgaben-loading-txt').textContent = 'Themen werden erkannt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));
  const aufgabenScanDone = startProgress('aufgaben-progress-bar', 'aufgaben-progress-pct', 15000);
  selTopic = null;
  document.getElementById('aufgaben-gen-btn').disabled = true;

  try {
    // Use breadth-first doc overview so all documents are represented
    const overview = await buildDocOverview();
    const overviewText = overview || docsForPrompt(25000);
    const raw = await claudeLocal(
      [{ role: 'user', content: `Hier sind Auszüge aus ALLEN Dokumenten dieser Lernsammlung:\n\n${overviewText}\n\nErstelle eine vollständige Themenliste, die die GESAMTE Breite aller Dokumente abdeckt – nicht nur die ersten.\nAntworte NUR als JSON-Array mit 15–20 kurzen Thema-Strings (max. 4 Wörter je Thema):\n["Thema 1","Thema 2",...]` }],
      [{ type: 'text', text: 'Du listest Lernthemen aus Unterlagen auf. Antworte NUR als JSON-Array.' }],
      700
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Themen erkannt');
    const prevTopics = scannedTopics.slice();
    scannedTopics = dedupeTopics(parseJsonLoose(m[0])).slice(0, 40);
    if (!scannedTopics.length) throw new Error('Keine Themen gefunden');
    // IDs gegen die vorherigen Themen abgleichen (Rename ⇒ ID bleibt ⇒ Fortschritt bleibt).
    // Semantischer Abgleich via Embeddings (robust gegen Umformulierung); null → Token-Fallback.
    const sim = prevTopics.length ? await embedSimFn([...prevTopics, ...scannedTopics]) : null;
    reconcileTopicUids(prevTopics, scannedTopics, sim);
    persistTopicUids(sessionId);
    localforage.setItem(`st_${sessionId}`, scannedTopics).catch(() => {});
    api(`/api/subjects/${sessionId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ topics: scannedTopics }),
    }).catch(() => {});
    aufgabenScanDone();
    renderTopicChips();
    showAufgabenState(document.getElementById('aufgaben-topics'));
    // Re-Scan: statt stiller Überschreibung zeigen, was sich geändert hat (#7).
    if (prevTopics.length) toast(`🔄 Themen aktualisiert: ${formatScanDiff(scanDiff(prevTopics, scannedTopics))}`, 'success', 4000);
  } catch (e) {
    aufgabenScanDone();
    showAufgabenState(document.getElementById('aufgaben-idle'));
    toast('Fehler beim Erkennen: ' + e.message, 'error');
  }
}

function renderTopicChips() {
  const wrap = document.getElementById('topic-chips');
  wrap.innerHTML = '';
  scannedTopics.forEach(topic => {
    const btn = document.createElement('button');
    btn.className = 'topic-chip';
    btn.textContent = topic;
    btn.addEventListener('click', () => {
      selTopic = topic;
      wrap.querySelectorAll('.topic-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('aufgaben-gen-btn').disabled = false;
    });
    wrap.appendChild(btn);
  });
}

document.querySelectorAll('.aufg-type-btn').forEach(b => b.addEventListener('click', () => {
  selAufgabenType = b.dataset.type;
  document.querySelectorAll('.aufg-type-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));

document.getElementById('aufgaben-gen-btn')?.addEventListener('click', generateAufgaben);
document.getElementById('aufgaben-back-btn')?.addEventListener('click', () => {
  showAufgabenState(document.getElementById('aufgaben-topics'));
  renderSavedAufgaben();
});
document.getElementById('aufgaben-ans-btn')?.addEventListener('click', () => {
  aufgabenAnsVis = !aufgabenAnsVis;
  document.getElementById('aufgaben-body').closest('.aufgaben-content')
    .classList.toggle('answers-hidden', !aufgabenAnsVis);
  document.getElementById('aufgaben-ans-btn').textContent =
    aufgabenAnsVis ? 'Lösungen verbergen' : 'Lösungen anzeigen';
});

async function generateAufgaben() {
  if (!selTopic) return;
  aufgabenAnsVis = false;
  document.getElementById('aufgaben-loading-txt').textContent = 'Aufgaben werden erstellt…';
  showAufgabenState(document.getElementById('aufgaben-loading'));
  const aufgabenGenDone = startProgress('aufgaben-progress-bar', 'aufgaben-progress-pct', 20000);

  const isKlausur = selAufgabenType === 'klausur';

  const aufgDiffText = {
    leicht:       'Niveau: Leicht – einfache Definitionen und direkte Fragen.',
    mittel:       'Niveau: Mittel – Verständnis und einfache Anwendung.',
    schwer:       'Niveau: Schwer – komplexe Zusammenhänge und Anwendungen.',
    pruefungsnah: `Niveau: Prüfungsnah – orientiere dich an den hochgeladenen Probe-/Altklausuren.
Übernimm Fragetypen, Formulierungsstil und Punktegewichtung daraus.`,
    experte:      `Niveau: EXPERTE – schwerer als die echte Prüfung.
Kombiniere Konzepte, teste Grenzfälle, verlange Transferdenken. Baut Konfidenz auf.`,
  }[selAufgabenDiff] || '';

  const prompt = isKlausur
    ? `Erstelle eine kompakte Mini-Klausur NUR zum Thema "${selTopic}" aus dem Fach "${sessionMeta.name}".
${aufgDiffText}

# Mini-Klausur: ${selTopic}
**Punkte:** XX | **Zeit:** ca. XX Min

## Teil A – Multiple Choice (je 1 Punkt)
[3 MC-Fragen mit Optionen a–d, nur zu "${selTopic}"]

## Teil B – Kurzantworten (je 3 Punkte)
[2 Kurzantwort-Fragen zu "${selTopic}"]

## Teil C – Ausführliche Antwort (6 Punkte)
[1 tiefe Verständnisfrage zu "${selTopic}"]

---
## Lösungsschlüssel
[Vollständige Lösungen mit Erklärungen]`
    : `Erstelle 5 abwechslungsreiche Übungsaufgaben NUR zum Thema "${selTopic}" aus dem Fach "${sessionMeta.name}".
${aufgDiffText}

Aufgaben sollen echtes Verständnis testen – nicht reines Auswendiglernen:
- Mix aus: Erklären, Anwenden, Vergleichen, Beispiele nennen, Zusammenhänge erläutern
- Jede Aufgabe mit Punktzahl (1–4 Punkte je nach Schwierigkeit)
- Aufsteigende Schwierigkeit

Format:
## Übungsaufgaben: ${selTopic}

**Aufgabe 1 (X Pkt.):** [Aufgabe]

**Aufgabe 2 (X Pkt.):** [Aufgabe]

...

---
## Musterlösungen
[Vollständige Lösungen mit Hintergrundinformationen]`;

  try {
    const result = await claudeLocalKb(
      [{ role: 'user', content: 'Aufgaben erstellen.' }],
      prompt, 2500, selTopic,   // themen-gebunden → gezieltes KB-Retrieval statt 40k-Dump
    );
    currentAufgabenResult = result;
    const body = document.getElementById('aufgaben-body');
    const sepIdx = result.search(/---\s*\n+##\s*(Lösungsschlüssel|Musterlösungen)/i);
    const tasksPart = sepIdx > -1 ? result.slice(0, sepIdx) : result;

    if (sepIdx > -1) {
      body.innerHTML = safeHtml(md(tasksPart) +
        `<div class="ans-section">${md(result.slice(sepIdx).replace(/^---\s*\n+/, ''))}</div>`);
    } else {
      body.innerHTML = safeHtml(md(result));
    }

    // Inject per-task "✏️ Lösen" buttons
    injectSolveButtons(tasksPart);

    // Wire "Im Rechnen lösen" toolbar button to send all tasks
    document.getElementById('aufgaben-rechnen-btn').onclick = () => sendToRechnen(tasksPart.trim());

    // Auto-save
    DB.saveAufgabe(sessionId, {
      id: Date.now(),
      topic: selTopic,
      type: selAufgabenType,
      tasksPart,
      fullResult: result,
      createdAt: new Date().toISOString(),
    }).catch(() => {});

    aufgabenGenDone();
    document.getElementById('aufgaben-body').closest('.aufgaben-content').classList.add('answers-hidden');
    document.getElementById('aufgaben-ans-btn').textContent = 'Lösungen anzeigen';
    showAufgabenState(document.getElementById('aufgaben-result'));
  } catch (e) {
    aufgabenGenDone();
    showAufgabenState(document.getElementById('aufgaben-topics'));
    toast('Fehler: ' + e.message, 'error');
  }
}

function injectSolveButtons(tasksPart) {
  const body = document.getElementById('aufgaben-body');
  // Find individual tasks by splitting on "**Aufgabe N" pattern
  const taskMatches = [...tasksPart.matchAll(/\*\*Aufgabe\s+\d+[^*]*\*\*:?([^\n]*(?:\n(?!\n\*\*Aufgabe)[^\n]*)*)/gi)];

  if (!taskMatches.length) return; // Klausur format — no per-task buttons needed

  // Find all <p> containing bold "Aufgabe N" text in rendered HTML
  body.querySelectorAll('p').forEach((p, i) => {
    const strong = p.querySelector('strong');
    if (!strong || !/^Aufgabe\s+\d+/i.test(strong.textContent.trim())) return;

    // Get this task's raw text from the parsed matches
    const taskText = taskMatches[i] ? taskMatches[i][0] : p.textContent;

    const btn = document.createElement('button');
    btn.className = 'solve-inline-btn';
    btn.innerHTML = '✏️ Lösen';
    btn.addEventListener('click', () => sendToRechnen(taskText.trim()));
    p.appendChild(btn);
  });
}

function sendToRechnen(text) {
  currentAufgabe = text;
  rechnenLastFeedback = '';
  rechnenAttempts = 0;
  rechnenLastCheckSig = '';
  savedCanvasData = null;
  const input = document.getElementById('rechnen-task-input');
  if (input) input.value = text;
  switchToLoesen();
}

// ══ RECHNEN (Freies Lösen mit Pencil) ═════════════════════════════════════

let activeRechnenDoc = null;

function renderRechnenDocs() {
  const chips = document.getElementById('rechnen-doc-chips');
  if (!chips) return;
  chips.innerHTML = '';
  const files = sessionMeta?.files || [];
  files.forEach(f => {
    const chip = document.createElement('button');
    chip.className = 'rechnen-doc-chip' + (activeRechnenDoc === f.name ? ' active' : '');
    chip.title = f.name;
    chip.innerHTML = `<span>📄 ${f.name}</span>`;
    chip.addEventListener('click', () => {
      activeRechnenDoc = activeRechnenDoc === f.name ? null : f.name;
      renderRechnenDocs();
    });
    chips.appendChild(chip);
  });
}

document.getElementById('rechnen-doc-add-btn')?.addEventListener('click', () => showUploadSheet());

async function initRechnen() {
  renderRechnenDocs();
  const input = document.getElementById('rechnen-task-input');
  if (input && currentAufgabe && !input.value) input.value = currentAufgabe;
  initResizeHandle();
  if (!savedCanvasData && sessionId) {
    savedCanvasData = await localforage.getItem(`canvas_${sessionId}`).catch(() => null);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
  // Erste/nächste Aufgabe schon vorladen, sobald die Löse-Ansicht offen ist – so ist
  // der erste "Aufgabe erstellen"-Klick kein kalter LLM-Roundtrip mehr. Dedupt selbst
  // (Fach + Schwierigkeit), läuft also nicht doppelt, wenn schon eine vorgeladen ist.
  if (sessionMeta && sessionId) prefetchRechnenAufgabe();
}

function initResizeHandle() {
  const handle = document.getElementById('rechnen-resize-handle');
  const area   = document.getElementById('rechnen-task-area');
  if (!handle || !area || handle._initDone) return;
  handle._initDone = true;
  let startY = 0, startH = 0;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = area.getBoundingClientRect().height;
  }, { passive: false });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const newH = Math.max(50, Math.min(380, startH + (e.clientY - startY)));
    area.style.height = newH + 'px';
  });
}

const CANVAS_HEIGHT = 2000;

// Das Karo-Raster wird NICHT mehr in die Bitmap gemalt, sondern liegt als
// CSS-Hintergrund (#math-canvas in style.css) hinter der transparenten Canvas.
// Dadurch kann der Radierer es nicht treffen – er löscht nur die Tinte.

function initCanvas() {
  const canvas = document.getElementById('math-canvas');
  const wrap   = document.getElementById('canvas-scroll-wrap');
  const w      = wrap ? wrap.clientWidth : canvas.getBoundingClientRect().width;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.height = CANVAS_HEIGHT + 'px';
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(CANVAS_HEIGHT * dpr);
  mathCtx = canvas.getContext('2d');
  mathCtx.scale(dpr, dpr);
  // Bitmap bleibt transparent (nur Tinte); Weiß + Raster kommen aus dem CSS-Hintergrund.
  strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  if (savedCanvasData) {
    const img = new Image();
    img.onload = () => {
      baseImage = img;                       // Hintergrund-Ebene für späteres Neu-Zeichnen
      mathCtx.drawImage(img, 0, 0, w, CANVAS_HEIGHT);
      applyCtxStyle();
    };
    img.src = savedCanvasData;
    savedCanvasData = null;
  } else {
    applyCtxStyle();
  }
}

// Einen gespeicherten Strich originalgetreu nachzeichnen (für Undo/Redo & Line-Vorschau).
function drawStroke(ctx, s) {
  const pts = s.pts;
  if (!pts || !pts.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1; ctx.strokeStyle = '#000';
  } else if (s.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.35; ctx.strokeStyle = '#FFD60A';
  } else { // pen | line
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1; ctx.strokeStyle = s.color;
  }
  if (s.tool === 'line') {
    ctx.lineWidth = PEN_BASE[s.size] * 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  } else {
    if (s.tool === 'pen' || s.tool === 'highlighter') {
      const r = Math.max(0.5, (pts[0].p || 0.5) * PEN_BASE[s.size]);
      ctx.beginPath();
      ctx.fillStyle = s.tool === 'highlighter' ? 'rgba(255,214,10,0.35)' : s.color;
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Catmull-Rom-geglättete, dichtere Punktfolge (#6) und darüber die gewohnte
    // quadratische Bézier-Glättung durch die Mittelpunkte.
    const sp = catmullRomPts(pts);
    let lx = sp[0].x, ly = sp[0].y, lmx = sp[0].x, lmy = sp[0].y;
    for (let i = 1; i < sp.length; i++) {
      if (s.tool === 'pen')         ctx.lineWidth = Math.max(0.5, (sp[i].p || 0.5) * PEN_BASE[s.size] * 1.8);
      else if (s.tool === 'eraser') ctx.lineWidth = PEN_BASE[s.size] * 12;
      else                          ctx.lineWidth = PEN_BASE[s.size] * 10;
      const mx = (lx + sp[i].x) / 2, my = (ly + sp[i].y) / 2;
      ctx.beginPath();
      ctx.moveTo(lmx, lmy);
      ctx.quadraticCurveTo(lx, ly, mx, my);
      ctx.stroke();
      lmx = mx; lmy = my; lx = sp[i].x; ly = sp[i].y;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// Komplett neu zeichnen: Hintergrund-PNG + alle committeten Striche. Ersetzt die
// teuren Bitmap-Snapshots – Canvas-Zeichnen ist billig (hunderte Striche < 16 ms).
function redrawCanvas() {
  if (!mathCtx) return;
  const r = document.getElementById('math-canvas').getBoundingClientRect();
  mathCtx.globalCompositeOperation = 'source-over';
  mathCtx.globalAlpha = 1;
  mathCtx.clearRect(0, 0, r.width, r.height);
  if (baseImage) mathCtx.drawImage(baseImage, 0, 0, r.width, CANVAS_HEIGHT);
  for (const s of strokes) drawStroke(mathCtx, s);
  applyCtxStyle();
}

const PEN_BASE = { fine: 1.0, medium: 2.0, thick: 4.5 };
// Handballen-Phantom-Schutz: iPadOS schnappt vereinzelt ein Apple-Pencil-Sample
// zur Handfläche (großer Sprung, meist nach unten/rechts) → eine Linie, die der
// Stift nie gezogen hat. Ein Sample, das weiter als CANVAS_MAX_STEP (CSS-px) vom
// laufenden Anker springt, wird als Ausreißer verworfen. Damit ein echter
// schneller Zug nicht dauerhaft abreißt, wird nach CANVAS_MAX_SKIPS verworfenen
// Samples in Folge zwangsweise neu synchronisiert.
const CANVAS_MAX_STEP  = 150;
const CANVAS_MAX_SKIPS = 2;

// Ziffern-Lesehilfe für die Vision-Prüfung (deutsche Handschrift-Konventionen).
// Wird sowohl im Rechnen-Prüf-Prompt (checkHandwriting) als auch im Lernen-Prüf-
// Prompt (EVAL_SYS) eingesetzt, damit beide Pfade Ziffern gleich sorgfältig lesen.
const ZIFFERN_LESEHILFE = `ZIFFERN SORGFÄLTIG LESEN (deutsche Handschrift): Die **1** wird mit einem deutlichen Aufstrich/Anstrich oben geschrieben (sieht der Spitze einer 7 ähnlich) und hat KEINEN waagerechten Balken; die **7** hat oben einen waagerechten Balken und oft einen durchgestrichenen Mittelstrich. Verwechsle 1 und 7 nicht. Achte ebenso auf 4↔9, 0↔6 und 3↔8. Wenn eine Rechnung nur dann aufgeht (das angeschriebene Zwischen-/Endergebnis nur dann stimmt), wenn eine unklare Ziffer anders gelesen wird, bevorzuge die rechnerisch konsistente Lesart – der Schüler hat sich beim Schreiben sehr wahrscheinlich nicht in der eigenen Rechnung verrechnet, sondern nur undeutlich geschrieben.`;

// Despeckle-Bounding-Box der Tinte (Phantom-Pixel-Schutz, Roadmap #4): die rohe
// Box aus „jedes Pixel mit Alpha>10" wird von einem einzelnen Handballen-/Phantom-
// Tupfer weit aufgezogen → der Vision-Zuschnitt wird riesig und überwiegend weiß.
// Stattdessen Tinte je INK_CELL-Gitterzelle zählen, Zellen per 8-Nachbarschaft zu
// Komponenten gruppieren und Komponenten mit weniger als INK_MIN_PIXELS Tinte-Pixeln
// (vereinzelte Tupfer) verwerfen. Überlebt nichts (alles Tupfer), wird auf die rohe
// Box zurückgefallen, damit echter Inhalt nie wegfällt. Reine Funktion → testbar.
const INK_CELL       = 24;
const INK_MIN_PIXELS = 12;
function inkBoundingBox(data, CW, CH) {
  const cols = Math.ceil(CW / INK_CELL), rows = Math.ceil(CH / INK_CELL);
  const cnt = new Int32Array(cols * rows);   // Tinte-Pixel je Gitterzelle
  let any = false, rMinX = CW, rMinY = CH, rMaxX = 0, rMaxY = 0, h = 5381;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (data[(y * CW + x) * 4 + 3] > 10) {
        any = true;
        cnt[((y / INK_CELL) | 0) * cols + ((x / INK_CELL) | 0)]++;
        if (x < rMinX) rMinX = x; if (x > rMaxX) rMaxX = x;
        if (y < rMinY) rMinY = y; if (y > rMaxY) rMaxY = y;
        h = ((h << 5) + h + x * 31 + y) | 0;   // Inhalts-Hash (Änderungserkennung)
      }
    }
  }
  const hash = String(h >>> 0);
  if (!any) return { ink: false, minX: CW, minY: CH, maxX: 0, maxY: 0, hash };

  // Zusammenhängende Zell-Komponenten (8-Nachbarschaft, iterativer Flood-Fill).
  const seen = new Uint8Array(cols * rows);
  const stack = [];
  let kept = false, kMinCx = cols, kMinCy = rows, kMaxCx = -1, kMaxCy = -1;
  for (let c0 = 0; c0 < cnt.length; c0++) {
    if (!cnt[c0] || seen[c0]) continue;
    seen[c0] = 1; stack.length = 0; stack.push(c0);
    const cells = []; let pixels = 0;
    while (stack.length) {
      const idx = stack.pop();
      cells.push(idx); pixels += cnt[idx];
      const cx = idx % cols, cy = (idx / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (cnt[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (pixels < INK_MIN_PIXELS) continue;   // vereinzelter Phantom-Tupfer → verwerfen
    kept = true;
    for (const idx of cells) {
      const cx = idx % cols, cy = (idx / cols) | 0;
      if (cx < kMinCx) kMinCx = cx; if (cx > kMaxCx) kMaxCx = cx;
      if (cy < kMinCy) kMinCy = cy; if (cy > kMaxCy) kMaxCy = cy;
    }
  }
  // Alles war Tupfer → rohe Box, damit echter Inhalt nie verloren geht.
  if (!kept) return { ink: true, minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY, hash };
  // Behaltene Zellen in Pixel umrechnen und mit der rohen Box verschneiden (das
  // Raster ist gröber als die Pixel-Box; der Schnitt zieht sie auf den echten
  // Tinte-Rand zusammen und schließt zugleich entfernte Tupfer aus).
  return {
    ink: true,
    minX: Math.max(rMinX, kMinCx * INK_CELL),
    minY: Math.max(rMinY, kMinCy * INK_CELL),
    maxX: Math.min(rMaxX, (kMaxCx + 1) * INK_CELL - 1),
    maxY: Math.min(rMaxY, (kMaxCy + 1) * INK_CELL - 1),
    hash,
  };
}

// Kontrast-/Lesbarkeits-Anhebung für flachgerechnete Handschrift (#5). Dünne,
// blasse Bleistift-/Stiftstriche verblassen beim Flatten auf Weiß und beim
// Herunterskalieren zu hellem Grau und werden für die Vision-API schwer lesbar.
// Pro Pixel: nahezu weiße (Luminanz ≥ INK_WHITE_CUTOFF) auf reines Weiß ziehen
// (schwache Anti-Aliasing-Halos verschwinden); sonst die „Tintigkeit" (255−Kanal)
// per Gamma>1 verstärken, sodass blasse Striche dunkler/satter werden. Hue bleibt
// grob erhalten (Highlighter bleibt farbig, nur kräftiger). Mutiert data in place.
const INK_WHITE_CUTOFF = 246;
const INK_GAMMA = 2.2;
function enhanceInkContrast(data) {
  const inv = 1 / INK_GAMMA;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b >= INK_WHITE_CUTOFF) {
      data[i] = data[i + 1] = data[i + 2] = 255;
      continue;
    }
    data[i]     = 255 - Math.round(255 * Math.pow((255 - r) / 255, inv));
    data[i + 1] = 255 - Math.round(255 * Math.pow((255 - g) / 255, inv));
    data[i + 2] = 255 - Math.round(255 * Math.pow((255 - b) / 255, inv));
  }
}

// Gemeinsamer Vision-Zuschnitt der Handschrift (Rechnen + Lernen): den
// beschriebenen (despeckelten) Bereich auf weißen Grund flachrechnen, auf
// INK_MAX_EDGE herunterskalieren, kontrastverstärken (#5) und als PNG-Base64
// (ohne data:-Präfix) liefern. Crop-Rand ist INK_CROP_MARGIN.
const INK_CROP_MARGIN = 32;
const INK_MAX_EDGE = 1024;
function inkCropToBase64(srcCanvas, sx, sy, sw, sh) {
  const scale = Math.min(1, INK_MAX_EDGE / Math.max(sw, sh));
  const flat = document.createElement('canvas');
  flat.width  = Math.max(1, Math.round(sw * scale));
  flat.height = Math.max(1, Math.round(sh * scale));
  const fc = flat.getContext('2d');
  fc.fillStyle = '#ffffff';
  fc.fillRect(0, 0, flat.width, flat.height);
  fc.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, flat.width, flat.height);
  const img = fc.getImageData(0, 0, flat.width, flat.height);
  enhanceInkContrast(img.data);
  fc.putImageData(img, 0, 0);
  return flat.toDataURL('image/png').split(',')[1];
}

// Catmull-Rom-Glättung der Striche (#6, touch-sicher – ändert die Eingabe NICHT,
// nur das committete Rendering). iPad-/Pencil-Samples kommen pro Frame und bei
// schnellen Zügen weit auseinander → die Polyline wirkt eckig. catmullRomPts
// erzeugt aus den (phantom-gefilterten) Stützpunkten eine dichtere Folge, die
// weich UND durch ALLE Stützpunkte verläuft: lange Segmente werden in Schritte
// von höchstens SPLINE_SEG px unterteilt (gedeckelt), kurze (langsame, dichte
// Züge) bleiben praktisch unverändert. Druck p wird linear mitinterpoliert.
// Reine, testbare Funktion; <3 Punkte werden unverändert (Kopie) zurückgegeben.
const SPLINE_SEG = 8;
function catmullRomPts(pts) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : [];
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i], p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const dist  = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.min(24, Math.round(dist / SPLINE_SEG)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      if (p1.p != null) out.push({ x, y, p: p2.p != null ? p1.p + (p2.p - p1.p) * t : p1.p });
      else out.push({ x, y });
    }
  }
  return out;
}

function applyCtxStyle() {
  if (!mathCtx) return;
  mathCtx.lineCap  = 'round';
  mathCtx.lineJoin = 'round';
  if (activeTool === 'highlighter') {
    mathCtx.globalAlpha  = 0.35;
    mathCtx.strokeStyle  = '#FFD60A';
    mathCtx.lineWidth    = PEN_BASE[penSize] * 10;
  } else {
    mathCtx.globalAlpha  = 1;
    mathCtx.strokeStyle  = penColor;
    mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
  }
}

// Gepufferte Punkte einmal pro Frame zeichnen (rAF) – statt synchron pro pointermove.
// Glättung: quadratische Bézier durch die Mittelpunkte aufeinanderfolgender Punkte,
// Kontrollpunkt ist der jeweils echte Messpunkt → runde, "tintige" Linie statt Knicke.
function flushCanvasBuf() {
  canvasRaf = 0;
  if (!mathCtx || !canvasPtBuf.length) return;
  mathCtx.lineCap = 'round'; mathCtx.lineJoin = 'round';
  if (activeTool === 'eraser') {
    mathCtx.globalAlpha = 1; mathCtx.strokeStyle = '#000';
    mathCtx.lineWidth = PEN_BASE[penSize] * 12;
    mathCtx.globalCompositeOperation = 'destination-out';
  } else if (activeTool === 'highlighter') {
    mathCtx.globalCompositeOperation = 'source-over';
    mathCtx.globalAlpha = 0.35; mathCtx.strokeStyle = '#FFD60A';
    mathCtx.lineWidth = PEN_BASE[penSize] * 10;
  } else {
    mathCtx.globalCompositeOperation = 'source-over';
    mathCtx.globalAlpha = 1; mathCtx.strokeStyle = penColor;
  }
  const buf = canvasPtBuf; canvasPtBuf = [];
  for (const pt of buf) {
    // Ausreißer (Handballen-Sprung) verwerfen, ohne den Anker zu bewegen – der
    // nächste echte Stift-Sample zeichnet dann wieder sauber vom Stift aus weiter.
    const dx = pt.x - canvasLastX, dy = pt.y - canvasLastY;
    if (canvasJumpSkips < CANVAS_MAX_SKIPS && dx * dx + dy * dy > CANVAS_MAX_STEP * CANVAS_MAX_STEP) {
      canvasJumpSkips++;
      continue;
    }
    canvasJumpSkips = 0;
    if (activeTool === 'pen') mathCtx.lineWidth = Math.max(0.5, pt.p * PEN_BASE[penSize] * 1.8);
    const midX = (canvasLastX + pt.x) / 2, midY = (canvasLastY + pt.y) / 2;
    mathCtx.beginPath();
    mathCtx.moveTo(canvasLastMidX, canvasLastMidY);
    mathCtx.quadraticCurveTo(canvasLastX, canvasLastY, midX, midY);
    mathCtx.stroke();
    canvasLastMidX = midX; canvasLastMidY = midY;
    canvasLastX = pt.x; canvasLastY = pt.y;
    if (currentStroke) currentStroke.pts.push({ x: pt.x, y: pt.y, p: pt.p });
  }
  if (activeTool === 'eraser') mathCtx.globalCompositeOperation = 'source-over';
}

function setupCanvasEvents() {
  const canvas = document.getElementById('math-canvas');
  const wrap   = document.getElementById('canvas-scroll-wrap');

  // Solange gezeichnet wird (Rechnen ODER Lernen), keine Textmarkierung in der
  // Aufgabenstellung zulassen (Capture-Phase reicht).
  document.addEventListener('selectstart', e => {
    if (isDrawingCanvas || isDrawingLernen) e.preventDefault();
  }, true);

  // ── Strich-Logik, geräteunabhängig (bekommt CSS-Pixel-Koordinaten + Druck 0..1) ──
  function beginStroke(clientX, clientY, force) {
    if (currentStroke) { strokes.push(currentStroke); currentStroke = null; } // verwaisten Strich sichern
    lastInkTs = Date.now();
    isDrawingCanvas = true;
    redoStrokes = [];
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const p = force > 0 ? force : 0.5;
    canvasLastX = x; canvasLastY = y;
    canvasLastMidX = x; canvasLastMidY = y;          // Glättung: Startpunkt = erster Mittelpunkt
    canvasPtBuf = [];
    canvasJumpSkips = 0;
    if (canvasRaf) { cancelAnimationFrame(canvasRaf); canvasRaf = 0; }
    currentStroke = { tool: activeTool, color: penColor, size: penSize, pts: [{ x, y, p }] };
    if (activeTool === 'line') return; // Vorschau läuft über redrawCanvas() im move
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      applyCtxStyle();
      mathCtx.beginPath();
      const rad = Math.max(0.5, p * PEN_BASE[penSize]);
      mathCtx.arc(x, y, rad, 0, Math.PI * 2);
      mathCtx.fillStyle = activeTool === 'highlighter' ? 'rgba(255,214,10,0.35)' : penColor;
      mathCtx.fill();
    }
  }

  function moveStroke(clientX, clientY, force) {
    if (!isDrawingCanvas || !mathCtx) return;
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (activeTool === 'line') {
      redrawCanvas();
      mathCtx.globalCompositeOperation = 'source-over';
      mathCtx.globalAlpha  = 1;
      mathCtx.strokeStyle  = penColor;
      mathCtx.lineWidth    = PEN_BASE[penSize] * 2;
      mathCtx.beginPath();
      mathCtx.moveTo(canvasLastX, canvasLastY);
      mathCtx.lineTo(x, y);
      mathCtx.stroke();
      return;
    }
    canvasPtBuf.push({ x, y, p: force > 0 ? force : 0.5 });
    if (!canvasRaf) canvasRaf = requestAnimationFrame(flushCanvasBuf);
  }

  function finishStroke(clientX, clientY) {
    if (!isDrawingCanvas) return;
    lastInkTs = Date.now();
    isDrawingCanvas = false;
    if (currentStroke) {
      if (activeTool === 'line') {
        const r = canvas.getBoundingClientRect();
        currentStroke.pts = [currentStroke.pts[0], { x: clientX - r.left, y: clientY - r.top }];
      } else {
        if (canvasRaf) { cancelAnimationFrame(canvasRaf); canvasRaf = 0; }
        flushCanvasBuf();   // gepufferte Restpunkte sofort zeichnen
      }
      strokes.push(currentStroke);
      currentStroke = null;
    }
    // Committeten Strich geglättet (#6) neu rendern – ersetzt die inkrementell
    // gezeichnete, eckige Live-Vorschau durch die Catmull-Rom-Version (auch das,
    // was die Vision-Prüfung als Bitmap liest). Für 'line' ohnehin nötig.
    redrawCanvas();
    mathCtx.globalAlpha = 1;
    mathCtx.globalCompositeOperation = 'source-over';
    applyCtxStyle();
  }

  // ── Touch (iPad): NUR der Apple Pencil (touch.touchType === 'stylus') zeichnet.
  //    Finger und Handfläche ('direct') werden fürs Zeichnen komplett ignoriert →
  //    Palm-Rejection ganz ohne Heuristik. Damit umgehen wir Safaris fehlerhafte
  //    Pointer-Event-Palm-Rejection, die den Stift-Pointer mitten im Strich abbrach
  //    ("Strich wird nicht erzeugt") bzw. Phantom-Striche erzeugte. ──
  const stylusOf = list => { for (const t of list) if (t.touchType === 'stylus') return t; return null; };

  canvas.addEventListener('touchstart', e => {
    const st = stylusOf(e.touches);
    if (st) {
      e.preventDefault();                 // unterdrückt zugleich synthetische Maus-Events
      fingerScrollId = null;              // Stift gewinnt gegen laufenden Finger-Scroll
      // Nur ein NEU aufgesetzter Stift (in changedTouches) startet einen Strich – ein
      // zweiter Touch (Handfläche), während der Stift schon liegt, hat den Stift zwar in
      // e.touches, aber nicht in changedTouches und darf den laufenden Strich nicht neu
      // starten.
      const fresh = stylusOf(e.changedTouches);
      if (fresh) {
        // IMMER (neu) beginnen, nie auf einem hängenden canvasStylusId abblocken: kam ein
        // früheres touchend nicht an, blieb die Id gesetzt und JEDER Folgestrich wurde
        // verschluckt ("manchmal passiert gar nichts"). beginStroke sichert einen evtl.
        // verwaisten Strich selbst.
        canvasStylusId = fresh.identifier;
        clearTextSelection();
        beginStroke(fresh.clientX, fresh.clientY, fresh.force);
      }
      return;
    }
    // Kein Stift im Spiel → erster Finger scrollt die Fläche (JS-Scroll, da touch-action:none).
    e.preventDefault();
    endStylusStroke();                    // evtl. offenen Strich schließen (Stift-touchend verschluckt)
    const f = e.changedTouches[0];
    fingerScrollId  = f.identifier;
    fingerStartY    = f.clientY;
    wrapScrollStart = wrap.scrollTop;
  }, { passive: false });

  // Schließt einen offenen Strich, ohne auf eine bestimmte touch.identifier zu vertrauen.
  const endStylusStroke = () => {
    if (canvasStylusId === null) return;
    const r = canvas.getBoundingClientRect();
    finishStroke(canvasLastX + r.left, canvasLastY + r.top);   // Koordinaten nur fürs Linien-Werkzeug relevant
    canvasStylusId = null;
  };

  canvas.addEventListener('touchmove', e => {
    // WICHTIG: Die Stift-Position wird IMMER frisch über touchType==='stylus' aus e.touches
    // bestimmt – nie über eine gespeicherte identifier. iPadOS recycelt touch.identifier:
    // kam das touchend des Stifts nicht an, trug ein später aufgesetzter Finger/Handballen
    // dieselbe Id und wurde sonst als Stift weitergemalt → Strich quer von Stift zu Handballen.
    const st = stylusOf(e.touches);
    if (st) {
      e.preventDefault();   // während des Schreibens ALLE Touches (auch Handfläche) blocken –
                            // sonst erzeugt Safari aus dem ungebremsten Handflächen-Touch
                            // synthetische Maus-/Klick-Events (Phantom-Striche, Tab-Wechsel).
      if (canvasStylusId !== null) moveStroke(st.clientX, st.clientY, st.force);
      return;
    }
    // Kein Stift mehr auf dem Glas: ein noch offener Strich (verschlucktes touchend) wird hier
    // beendet, bevor ein Finger/Handballen ihn fortsetzen könnte.
    endStylusStroke();
    for (const t of e.changedTouches) {
      if (t.identifier === fingerScrollId) { e.preventDefault(); wrap.scrollTop = wrapScrollStart + (fingerStartY - t.clientY); break; }
    }
  }, { passive: false });

  const onTouchEnd = e => {
    // Strich beenden, sobald KEIN Stift mehr aufliegt – unabhängig davon, welche identifier
    // das end-Event trägt (schützt gegen verschlucktes / auf falscher Id geliefertes touchend).
    if (canvasStylusId !== null && !stylusOf(e.touches)) {
      const lift = stylusOf(e.changedTouches);
      if (lift) { finishStroke(lift.clientX, lift.clientY); canvasStylusId = null; }
      else endStylusStroke();
    }
    for (const t of e.changedTouches) {
      if (t.identifier === fingerScrollId) fingerScrollId = null;
    }
  };
  canvas.addEventListener('touchend',    onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  // ── Maus (Desktop): synthetische Maus-Events vom Touch sind oben per preventDefault
  //    unterdrückt. Der mouseDrawing-Flag stellt sicher, dass window-mousemove/up NUR auf
  //    einen echten, am Canvas begonnenen Maus-Zug reagieren – ein verirrtes synthetisches
  //    mousemove (z.B. aus einem Handflächen-Touch) erzeugt sonst Phantom-Striche. ──
  let mouseDrawing = false;
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0 || canvasStylusId !== null) return;
    mouseDrawing = true;
    clearTextSelection();
    beginStroke(e.clientX, e.clientY, 0.5);
  });
  window.addEventListener('mousemove', e => { if (mouseDrawing) moveStroke(e.clientX, e.clientY, 0.5); });
  window.addEventListener('mouseup',   e => { if (mouseDrawing) { mouseDrawing = false; finishStroke(e.clientX, e.clientY); } });

  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// Entfernt eine (durch gleichzeitigen Handflächen-/Finger-Kontakt) entstandene
// Textmarkierung – außer der Fokus liegt gerade in einem Eingabefeld.
function clearTextSelection() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  sel.removeAllRanges();
}

function clearCanvas() {
  if (!mathCtx) return;
  if (sessionId) localforage.removeItem(`canvas_${sessionId}`).catch(() => {});
  const r = document.getElementById('math-canvas').getBoundingClientRect();
  strokes = []; redoStrokes = []; currentStroke = null; baseImage = null;
  mathCtx.globalAlpha = 1;
  mathCtx.globalCompositeOperation = 'source-over';
  mathCtx.clearRect(0, 0, r.width, r.height);
  setActiveTool('pen');
}

function setActiveTool(tool) {
  activeTool = tool;
  isErasing  = tool === 'eraser';
  const cvs = document.getElementById('math-canvas');
  if (cvs) cvs.style.cursor = tool === 'eraser' ? 'cell' : tool === 'line' ? 'crosshair' : 'default';
  ['canvas-pen-btn','canvas-highlight-btn','canvas-line-btn','canvas-eraser-btn'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  const map = { pen: 'canvas-pen-btn', highlighter: 'canvas-highlight-btn', line: 'canvas-line-btn', eraser: 'canvas-eraser-btn' };
  document.getElementById(map[tool])?.classList.add('active');
}

function undoCanvas() {
  if (!mathCtx || !strokes.length) return;
  redoStrokes.push(strokes.pop());
  redrawCanvas();
}

function redoCanvas() {
  if (!mathCtx || !redoStrokes.length) return;
  strokes.push(redoStrokes.pop());
  redrawCanvas();
}

// ── Rechnen difficulty select ──────────────────────────────────────────────
document.getElementById('rechnen-diff-sel')?.addEventListener('change', e => {
  rechnenDiff = e.target.value;
  // Die vorgeladene Aufgabe hat noch die alte Schwierigkeit → für die neue Stufe
  // neu vorladen, damit der nächste Klick wieder sofort die passende Aufgabe hat.
  if (sessionMeta && sessionId) prefetchRechnenAufgabe();
});

// ── Rechnen generate ───────────────────────────────────────────────────────
document.getElementById('rechnen-gen-btn')?.addEventListener('click', generateMathAufgabe);
// Color picker
document.querySelectorAll('.canvas-color').forEach(btn => btn.addEventListener('click', () => {
  penColor = btn.dataset.color;
  document.querySelectorAll('.canvas-color').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  if (activeTool === 'eraser' || activeTool === 'highlighter') setActiveTool('pen');
}));

// Size picker
document.querySelectorAll('.canvas-size').forEach(btn => btn.addEventListener('click', () => {
  penSize = btn.dataset.size;
  document.querySelectorAll('.canvas-size').forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
}));

document.getElementById('canvas-pen-btn')?.addEventListener('click',       () => setActiveTool('pen'));
document.getElementById('canvas-highlight-btn')?.addEventListener('click', () => setActiveTool('highlighter'));
document.getElementById('canvas-line-btn')?.addEventListener('click',      () => setActiveTool('line'));
document.getElementById('canvas-eraser-btn')?.addEventListener('click',    () => setActiveTool(activeTool === 'eraser' ? 'pen' : 'eraser'));
document.getElementById('canvas-undo-btn')?.addEventListener('click',  undoCanvas);
document.getElementById('canvas-redo-btn')?.addEventListener('click',  redoCanvas);
document.getElementById('canvas-clear-btn')?.addEventListener('click', clearCanvas);
document.getElementById('canvas-check-btn')?.addEventListener('click', checkHandwriting);

// ── Hebel 4: faules Prefetching ────────────────────────────────────────────
// Teure Vorab-Generierung (Musterlösung / nächste Aufgabe) erst starten, wenn der
// Student wirklich anfängt zu arbeiten – nicht schon beim Laden der Aufgabe. Spart
// die Generierung für Aufgaben, die nie bearbeitet werden.
let rechnenPrefetchPending = null;   // Aufgabe, deren Prefetch noch auf Aktivität wartet
let lernenPrefetchPending  = false;
function armRechnenPrefetch(aufgabe) { rechnenPrefetchPending = aufgabe || null; }
function fireRechnenPrefetch() {
  const a = rechnenPrefetchPending;
  if (!a) return;
  rechnenPrefetchPending = null;
  prefetchRechnenLoesung(a);
  prefetchRechnenAufgabe();
}
function armLernenPrefetch()  { lernenPrefetchPending = true; }
function fireLernenPrefetch() {
  if (!lernenPrefetchPending) return;
  lernenPrefetchPending = false;
  prefetchLernenLoesung();
}
// Aktivität = erster Strich auf der Zeichenfläche ODER erste Tastatureingabe.
// Delegiert + passiv, damit die (frisch stabilisierte) Zeichenlogik unberührt bleibt.
['pointerdown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, e => {
    const id = e.target && e.target.id;
    if (id === 'math-canvas') fireRechnenPrefetch();
    else if (id === 'lernen-canvas') fireLernenPrefetch();
  }, { passive: true, capture: true })
);
document.addEventListener('input', e => {
  const id = e.target && e.target.id;
  if (id === 'rechnen-task-input') fireRechnenPrefetch();
  else if (id === 'lernen-text-answer') fireLernenPrefetch();
}, true);

// Feedback sheet buttons
document.getElementById('rechnen-sheet-close-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
});
document.getElementById('rechnen-sheet-retry-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
  clearCanvas();
});
document.getElementById('rechnen-feedback-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('rechnen-feedback-overlay').classList.add('hidden');
});

// Ask sheet buttons
document.getElementById('rechnen-ask-btn')?.addEventListener('click', openAskSheet);
document.getElementById('rechnen-ask-close-btn')?.addEventListener('click', () => {
  document.getElementById('rechnen-ask-overlay').classList.add('hidden');
});
document.getElementById('rechnen-ask-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('rechnen-ask-overlay').classList.add('hidden');
});
document.getElementById('rechnen-ask-send-btn')?.addEventListener('click', sendAskQuestion);
document.getElementById('rechnen-ask-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendAskQuestion();
});

setupCanvasEvents();

function openAskSheet() {
  document.getElementById('rechnen-ask-overlay').classList.remove('hidden');
  document.getElementById('rechnen-ask-input').focus();
}

async function sendAskQuestion() {
  const input = document.getElementById('rechnen-ask-input');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';

  const msgs = document.getElementById('rechnen-ask-msgs');
  const userBubble = document.createElement('div');
  userBubble.className = 'ask-msg-user';
  userBubble.textContent = question;
  msgs.appendChild(userBubble);

  const aiBubble = document.createElement('div');
  aiBubble.className = 'ask-msg-ai';
  aiBubble.textContent = '…';
  msgs.appendChild(aiBubble);
  msgs.scrollTop = msgs.scrollHeight;

  const taskText = document.getElementById('rechnen-task-input')?.value.trim() || '';
  const taskContext = taskText ? `\nAktuelle Aufgabe:\n${taskText}` : '';
  const docContext = activeRechnenDoc ? `\nAktives Dokument: ${activeRechnenDoc}` : '';
  const extra = `Der Student arbeitet gerade handschriftlich an einer Aufgabe und hat eine Frage.${docContext}${taskContext}

Beantworte kurz und präzise. Gib einen hilfreichen Hinweis – keine vollständige Lösung.`;

  try {
    const answer = await claudeLocalKb([{ role: 'user', content: question }], extra, 400, question);
    aiBubble.innerHTML = safeHtml(md(answer));
  } catch (e) {
    aiBubble.textContent = '⚠️ ' + e.message;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Aufgaben-Historie pro (Fach+Thema) ──────────────────────────────────────
// Verhindert, dass Generierung/Regen denselben "Kern" wiederholt: die zuletzt
// gestellten Aufgaben werden als Avoid-Liste in den Prompt gehängt. In-Memory
// für synchronen Prompt-Aufbau, gespiegelt nach localforage → überlebt Reloads.
const TASK_HIST_MAX = 8;
const taskHist = new Map();                 // scope-key → [aufgabentext, ...] (neueste zuletzt)
function taskHistKey(scope) { return `taskhist_${scope}`; }
async function hydrateTaskHist(scope) {
  const k = taskHistKey(scope);
  if (taskHist.has(k)) return taskHist.get(k);
  let arr = [];
  try { const v = await localforage.getItem(k); if (Array.isArray(v)) arr = v; } catch {}
  taskHist.set(k, arr);
  return arr;
}
function recentTasks(scope) { return taskHist.get(taskHistKey(scope)) || []; }
function rememberTask(scope, text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  const k = taskHistKey(scope);
  const next = (taskHist.get(k) || []).filter(x => x !== t);   // exakte Dubletten entfernen
  next.push(t);
  while (next.length > TASK_HIST_MAX) next.shift();
  taskHist.set(k, next);
  localforage.setItem(k, next).catch(() => {});
}
// Avoid-Block für den Prompt aus der Historie (gekürzt, damit der Kontext schlank bleibt).
function taskAvoidBlock(scope) {
  const arr = recentTasks(scope);
  if (!arr.length) return '';
  const list = arr.map(t => `- ${t.slice(0, 220)}`).join('\n');
  return `\n\nBereits gestellte Aufgaben (NICHT wiederholen – die neue Aufgabe muss sich in Szenario UND Zahlen klar davon unterscheiden):\n${list}`;
}
// Scope-Key für die Rechen-Aufgaben (Fach + aktuelles Thema bzw. Fachname).
function rechnenScope() { return `${sessionId}_${currentExplainerTopic || sessionMeta?.name || ''}`; }
// Scope-Key für die Lernen-Aufgaben – an die stabile Einheits-ID gekoppelt
// (trennt zusammengesetzte Einheiten von Einzel-Themen, überlebt Re-Scan).
function lernenScope() { return `lrn_${sessionId}_${unitId(curUnit())}`; }

// Prompt für eine einzelne Rechen-Aufgabe. Die Avoid-Liste kommt aus der
// persistenten Aufgaben-Historie (scope), damit nicht derselbe Kern wiederkehrt.
function buildRechnenAufgabePrompt(scope) {
  const avoidNote = taskAvoidBlock(scope);
  return `Erstelle EINE einzelne Aufgabe (Schwierigkeit: ${rechnenDiff}) aus dem Lernstoff von "${sessionMeta.name}".

Regeln:
- Genau eine Aufgabe, klar und präzise formuliert
- Leicht = direkte Berechnung (1–2 Schritte) | Mittel = mehrere Schritte | Schwer = komplexe Aufgabe
- Verwende LaTeX für alle Formeln und Gleichungen ($$...$$)
- Schließe mit einer klaren Handlungsaufforderung: "Berechne:", "Bestimme:", "Löse:" etc.
- Keine Lösung – NUR die Aufgabenstellung${avoidNote}

Antworte NUR mit der Aufgabenstellung, kein zusätzlicher Text.`;
}

function genRechnenAufgabe() {
  const scope = rechnenScope();
  return (async () => {
    await hydrateTaskHist(scope);   // Avoid-Liste vor dem Prompt-Aufbau laden
    return claudeLocalKb([{ role: 'user', content: 'Aufgabe erstellen.' }], buildRechnenAufgabePrompt(scope), 500, currentExplainerTopic || sessionMeta?.name || '');
  })();
}

// System-Prompt für die Standalone-Musterlösung (hängt nur an der Aufgabe, nicht
// an der Schülerlösung) – wird vom Prefetch und vom Inline-Fallback geteilt.
function rechnenLoesungSys() {
  return `Löse die folgende Aufgabe vollständig und korrekt – AUSSCHLIESSLICH auf Basis des Lernstoffs von "${sessionMeta?.name || ''}".
Gib NUR den vollständigen Lösungsweg als Markdown mit LaTeX-Notation ($$...$$) zurück – keine Einleitung, keine Anrede, keine Bewertung.`;
}

// Musterlösung der aktuellen Aufgabe schon erzeugen, während der Nutzer rechnet.
// Beim "Prüfen" steht sie dann sofort bereit (Vision-Call muss sie nicht liefern).
function prefetchRechnenLoesung(aufgabe) {
  if (!sessionMeta || !aufgabe) return;
  if (rechnenLoesung && rechnenLoesung.aufgabe === aufgabe) return; // läuft schon / fertig
  const sys = rechnenLoesungSys();
  const entry = { aufgabe, promise: null, text: '' };
  entry.promise = (async () => {
    try {
      const r = await claudeLocalKb([{ role: 'user', content: `Aufgabe: ${aufgabe}` }], sys, 1200, aufgabe);
      const txt = (r || '').trim();
      if (rechnenLoesung === entry) entry.text = txt; // nur cachen wenn noch aktuell
      return txt;
    } catch { return ''; }
  })();
  entry.promise.catch(() => {});
  rechnenLoesung = entry;
}

// Nächste Aufgabe vorab laden, während der Nutzer die aktuelle bearbeitet.
function prefetchRechnenAufgabe() {
  if (!sessionMeta || !sessionId) return;
  if (rechnenNextTask && rechnenNextTask.forSession === sessionId && rechnenNextTask.diff === rechnenDiff) return;
  const promise = genRechnenAufgabe();   // Avoid-Liste kommt aus der Aufgaben-Historie
  promise.catch(() => {});
  rechnenNextTask = { promise, diff: rechnenDiff, forSession: sessionId };
}

async function generateMathAufgabe() {
  if (!sessionMeta) { toast('Bitte zuerst ein Fach öffnen.', 'warn'); return; }
  const spinner = document.getElementById('rechnen-gen-spinner');
  const btn = document.getElementById('rechnen-gen-btn');
  spinner.classList.remove('hidden');
  btn.disabled = true;

  try {
    // Vorab geladene Aufgabe nutzen, falls sie zu Fach+Schwierigkeit passt – sonst frisch laden.
    let aufgabe;
    if (rechnenNextTask && rechnenNextTask.forSession === sessionId && rechnenNextTask.diff === rechnenDiff) {
      const p = rechnenNextTask.promise; rechnenNextTask = null;
      aufgabe = await p;
    } else {
      rechnenNextTask = null;
      aufgabe = await genRechnenAufgabe();
    }
    const taskInput = document.getElementById('rechnen-task-input');
    taskInput.value = aufgabe.trim();
    currentAufgabe  = aufgabe.trim();
    rememberTask(rechnenScope(), currentAufgabe);   // in Historie aufnehmen → nächste Aufgabe vermeidet sie
    rechnenLastFeedback = '';
    rechnenAttempts = 0;
    rechnenLastCheckSig = '';
    savedCanvasData = null;
    clearCanvas();   // setzt strokes/redoStrokes/baseImage zurück
    rechnenLoesung = null;
    // Hebel 4: erst vorladen, wenn der Student tatsächlich anfängt (erster Strich/Tippen).
    armRechnenPrefetch(currentAufgabe);   // Musterlösung + nächste Aufgabe bei Aktivität
  } catch (e) {
    toast('Fehler: ' + e.message, 'error');
  } finally {
    spinner.classList.add('hidden');
    btn.disabled = false;
  }
}

// Kompakte Signatur der aktuellen Lösung (Striche + getippter Text + Aufgabe).
// Identische Signatur bei einem erneuten "Prüfen" ⇒ es hat sich nichts geändert,
// also kann das alte Feedback ohne (teuren) API-Call wieder gezeigt werden.
function rechnenSolutionSig(writtenText, taskText) {
  let s = `${taskText}|${writtenText}|`;
  for (const st of (strokes || [])) {
    const pts = st.points || st.pts || st || [];
    s += pts.length + ':';
    const f = pts[0], l = pts[pts.length - 1];
    if (f) s += `${f.x | 0},${f.y | 0}`;
    if (l) s += `>${l.x | 0},${l.y | 0};`;
  }
  // djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

// Schlanker System-Prompt nur fürs Bewerten: OHNE den großen, gecachten
// Unterlagen-Block. Zum Prüfen einer konkreten Rechnung ist das ganze Skript
// selten nötig – das spart pro Prüfung Input-/Cache-Tokens.
function checkSysBlocks() {
  return [{
    type: 'text',
    text: `Du bist ein erfahrener, präziser Korrektor für das Fach "${sessionMeta?.name || ''}". Bewerte die Lösung eines Schülers fair und nachvollziehbar.
MATHEMATIK: Verwende für Formeln LaTeX – inline $...$, Block $$...$$.
Antworte immer auf Deutsch.${prefCalculator ? `\n\nDer Student nutzt einen ${prefCalculator}; gib bei Rechenwegen ggf. gerätespezifische Tipps.` : ''}${customPrompt ? '\n\n--- PERSÖNLICHE ANWEISUNGEN DES STUDENTEN ---\n' + customPrompt + '\n--- ENDE ---' : ''}`,
  }];
}

async function checkHandwriting() {
  if (!mathCtx) return;
  const canvas = document.getElementById('math-canvas');

  // Bitmap ist transparent (nur Tinte) – Tinte über den Alpha-Kanal erkennen und
  // dabei die despeckelte Bounding-Box bestimmen (#4: vereinzelte Phantom-Tupfer
  // blähen den Zuschnitt nicht mehr auf), damit das Bild nur auf den tatsächlich
  // beschriebenen Bereich zugeschnitten gesendet wird.
  const CW = canvas.width, CH = canvas.height;
  const bb = inkBoundingBox(mathCtx.getImageData(0, 0, CW, CH).data, CW, CH);
  const hasInk = bb.ink;
  const minX = bb.minX, minY = bb.minY, maxX = bb.maxX, maxY = bb.maxY;
  const hasTypedAnswer = (document.getElementById('rechnen-task-input')?.value.trim() || '').length > 0;
  if (!hasInk && !hasTypedAnswer) { toast('Bitte zuerst eine Lösung in den Zeichen- oder Schreibbereich eingeben.', 'warn'); return; }

  // Show feedback sheet in loading state
  const overlay = document.getElementById('rechnen-feedback-overlay');
  document.getElementById('rechnen-sheet-loading').classList.remove('hidden');
  document.getElementById('rechnen-sheet-result').classList.add('hidden');
  overlay.classList.remove('hidden');
  const checkDone = startProgress('rechnen-check-bar', 'rechnen-check-pct', 15000);

  const writtenText = document.getElementById('rechnen-task-input')?.value.trim() || '';
  const taskText    = writtenText || currentAufgabe;

  // (A) Unveränderte Lösung erneut "geprüft" → kein API-Call, altes Feedback zeigen.
  const sig = rechnenSolutionSig(writtenText, taskText);
  if (rechnenLastFeedback && sig === rechnenLastCheckSig) {
    document.getElementById('rechnen-feedback-content').innerHTML = safeHtml(md(rechnenLastFeedback));
    document.getElementById('rechnen-sheet-loading').classList.add('hidden');
    document.getElementById('rechnen-sheet-result').classList.remove('hidden');
    checkDone();
    toast('Keine Änderung – bisheriges Feedback wird angezeigt.', 'info');
    return;
  }

  // Wartezustand beleben: wechselnde Status-Zeile statt statischem "wird geprüft",
  // und die vorgeladene Musterlösung schon zum Lesen anzeigen, sobald sie fertig ist.
  const stopStatus = cycleStatus(document.getElementById('rechnen-check-status'),
    ['Lösung erfassen…', 'Rechenweg nachvollziehen…', 'Schritte nachrechnen…', 'Ergebnis bewerten…', 'Feedback formulieren…']);
  const prePreview = document.getElementById('rechnen-check-preloesung');
  if (prePreview) prePreview.innerHTML = '';
  if (prePreview && rechnenLoesung && rechnenLoesung.aufgabe === taskText) {
    rechnenLoesung.promise.then(txt => {
      txt = (txt || '').trim();
      // Nur zeigen, solange noch geprüft wird (Lade-Screen sichtbar).
      if (txt && !document.getElementById('rechnen-sheet-loading').classList.contains('hidden')) {
        prePreview.innerHTML =
          '<details class="lernen-result-details" open style="margin-top:14px;text-align:left">' +
            '<summary>📌 Musterlösung – schon mal zum Lesen</summary>' +
            `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(txt))}</div>` +
          '</details>';
      }
    }).catch(() => {});
  }

  const docNote     = activeRechnenDoc ? `\n(Aktives Dokument: ${activeRechnenDoc})` : '';
  // Eingetippter Text im Schreibbereich zählt mit zur Lösung
  const writtenNote = writtenText
    ? `\n\n**Im Schreibbereich getippter Text des Schülers (Teil der Lösung, gleichwertig zur Zeichnung berücksichtigen):**\n${writtenText}`
    : '';
  // (C) Auf den (despeckelten, #4) beschriebenen Bereich + Rand zuschneiden statt
  // den ganzen 2000px-Canvas zu senden, (B) herunterskalieren und (#5) kontrast-
  // verstärken (gemeinsamer Helper). Nur getippter Text → winziges Platzhalterbild.
  let base64;
  if (hasInk) {
    const sx = Math.max(0, minX - INK_CROP_MARGIN);
    const sy = Math.max(0, minY - INK_CROP_MARGIN);
    const sw = Math.min(CW, maxX + INK_CROP_MARGIN) - sx;
    const sh = Math.min(CH, maxY + INK_CROP_MARGIN) - sy;
    base64 = inkCropToBase64(canvas, sx, sy, sw, sh);
  }
  // Kein Zuschnitt/Platzhalterbild mehr bei reinem Text – die Modalität entscheidet
  // unten über das Routing (Tinte → Vision, reiner Text → Text-Modell), konsistent
  // zum Lernen-Tab (#7).

  // Bewertungsmaßstab an den gewählten Schwierigkeitsgrad koppeln: rechnerische
  // Fehler bleiben auf jedem Level Fehler, aber bei leichten Aufgaben wird das
  // Verständnis wohlwollend bewertet, bei Experte/Prüfungsnah streng.
  const RECHNEN_TOLERANZ = {
    leicht:       `BEWERTUNGSMASSSTAB – LEICHT (wohlwollend): Es zählt das richtige Endergebnis und der grobe Lösungsweg. Sei großzügig bei Notation, Zwischenschritten und Formulierung. Kleinere formale Ungenauigkeiten NICHT als Fehler werten. Wenn das Ergebnis stimmt, ist die Aufgabe richtig – auch wenn der Weg knapp ist.`,
    mittel:       `BEWERTUNGSMASSSTAB – MITTEL: Endergebnis und nachvollziehbarer Lösungsweg zählen. Wesentliche Rechenfehler benennen, aber kleinere Notations-Ungenauigkeiten tolerieren.`,
    schwer:       `BEWERTUNGSMASSSTAB – SCHWER: Lösungsweg und Ergebnis müssen korrekt und vollständig sein. Auch Zwischenschritte prüfen.`,
    pruefungsnah: `BEWERTUNGSMASSSTAB – PRÜFUNGSNAH (Klausurmaßstab): Bewerte wie ein strenger Korrektor. Saubere Notation, vollständige Begründung und exakte Ergebnisse erforderlich. Jeder Zwischenschritt wird geprüft.`,
    experte:      `BEWERTUNGSMASSSTAB – EXPERTE (sehr streng): Maximal anspruchsvoll. Jede Ungenauigkeit in Notation, Begründung oder Rechnung benennen. Nur eine vollständig saubere Lösung gilt als korrekt.`,
  };
  const toleranzNote = RECHNEN_TOLERANZ[rechnenDiff] || RECHNEN_TOLERANZ.mittel;

  // Re-Prüfung: vorheriges Feedback mitschicken, damit die KI konsistent bleibt
  // und nicht bei jeder Runde neue/widersprüchliche Fehler "entdeckt".
  // Eskalations-Bremse: Ab dem 2. Nachbessern (außer im strengen Prüfungs-/Experten-
  // Modus, wo Klausurschärfe gewollt ist) zählt nur noch, ob der ursprünglich
  // benannte Kernfehler behoben ist – nicht, ob alles pixelgenau perfekt ist. Das
  // verhindert den Frust-Loop "verstanden & korrigiert, aber der Bot will mehr".
  const rechnenLenient = !['pruefungsnah', 'experte'].includes(rechnenDiff);
  const coreFocusNote = (rechnenLastFeedback && rechnenLenient)
    ? `\n\nKERNFEHLER-FOKUS (das ist mindestens der 2. Versuch): Prüfe vor allem, ob der zuvor benannte Hauptfehler jetzt behoben ist. Ist der Kernfehler korrigiert und das Ergebnis stimmig, beginne dein Urteil klar mit "✅ Kernfehler behoben" und akzeptiere die Lösung – auch wenn der Weg knapp ist oder kleine formale Unschönheiten bleiben. Eröffne KEINE neuen Nebenschauplätze wegen Kleinigkeiten und verlange NICHT, dass die Musterlösung Wort für Wort reproduziert wird.`
    : '';
  const reCheckNote = rechnenLastFeedback
    ? `\n\n**WICHTIG – das ist eine erneute Prüfung derselben Aufgabe.** Du hast diese Lösung vorher schon einmal bewertet. Dein vorheriges Feedback war:\n"""\n${rechnenLastFeedback}\n"""\nBleibe konsistent: Beziehe dich auf genau diese Punkte. Was du vorher als richtig akzeptiert hast, bleibt richtig – führe KEINE neuen Kritikpunkte zu Aspekten ein, die du vorher nicht beanstandet hast, es sei denn, die Lösung wurde dort tatsächlich verändert und ist jetzt falsch. Bestätige ausdrücklich, welche der zuvor genannten Fehler nun korrigiert sind.${coreFocusNote}`
    : '';

  const checkPrompt = `Ein Schüler hat eine Aufgabe gelöst. Die Lösung kann in ZWEI Bereichen stehen:
1. handschriftlich/gezeichnet auf dem beigefügten Bild (Zeichenbereich),
2. als getippter Text im Schreibbereich (siehe unten).
Berücksichtige BEIDE Bereiche gemeinsam als die vollständige Lösung des Schülers.

${ZIFFERN_LESEHILFE}

${toleranzNote}

**Aufgabe:** ${taskText || '(keine Aufgabe angegeben – analysiere was du siehst)'}${docNote}${writtenNote}${reCheckNote}

Analysiere die gesamte Lösung (Bild + getippter Text) und antworte auf Deutsch:

## ✅ Richtig / ❌ Falsch
Ist die finale Antwort korrekt? Eindeutige Aussage zuerst.

## Lösungsweg des Schülers
Was erkennst du im Zeichenbereich und im Schreibbereich? Wie ist der Schüler vorgegangen?

## Fehleranalyse (nur wenn falsch)
Wo genau liegt der Fehler? Erkläre präzise warum er falsch ist.

Falls die Schrift schwer lesbar ist: gib trotzdem dein Bestes und erkläre was du erkennst.
(Die Musterlösung wird separat angezeigt – schreibe sie NICHT selbst.)`;

  try {
    // Bewertet nur die Schülerlösung – die Musterlösung kommt aus dem Prefetch
    // (sofort) bzw. wird, falls keiner vorliegt, jetzt einmalig nachgeladen.
    // Routing nach Modalität (konsistent zum Lernen-Tab, #7): mit Zeichnung →
    // Vision; reiner Text → KB-grounded Text-Modell (statt ein leeres Bild an die
    // Vision-KI zu schicken) – schneller, günstiger und im Fachstoff verankert.
    const kbOpts = (kbReady && taskText)
      ? { subject_id: sessionId, kb_query: `${currentAufgabe || taskText}\n${writtenText}`.slice(0, 500) }
      : {};
    const feedbackP = hasInk
      ? claudeLocalVision(base64, checkPrompt, checkSysBlocks(), 1400)
      : claudeLocal([{ role: 'user', content: checkPrompt }], checkSysBlocks(), 1400, kbOpts);
    let loesungP;
    if (rechnenLoesung && rechnenLoesung.aufgabe === taskText) {
      loesungP = rechnenLoesung.promise;
    } else {
      loesungP = claudeLocalKb([{ role: 'user', content: `Aufgabe: ${taskText}` }], rechnenLoesungSys(), 1200, taskText)
        .then(r => (r || '').trim()).catch(() => '');
    }
    const feedback = await feedbackP;
    let loesung = '';
    try { loesung = await loesungP || ''; } catch { loesung = ''; }
    const full = loesung ? `${feedback}\n\n## Musterlösung\n${loesung}` : feedback;
    checkDone(); stopStatus();
    rechnenLastFeedback = full;
    rechnenAttempts++;           // Zähler für die Eskalations-Bremse beim nächsten Re-Check
    rechnenLastCheckSig = sig;   // (A) Stand merken, damit ein unveränderter Re-Check gratis ist
    document.getElementById('rechnen-feedback-content').innerHTML = safeHtml(md(full));
    document.getElementById('rechnen-sheet-loading').classList.add('hidden');
    document.getElementById('rechnen-sheet-result').classList.remove('hidden');
  } catch (e) {
    checkDone(); stopStatus();
    overlay.classList.add('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => initCanvas()));
    toast('Fehler beim Prüfen: ' + e.message, 'error');
  }
}

// ══ DOWNLOADS ═════════════════════════════════════════════════════════════

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeName(s) {
  return (s || 'datei').replace(/[^a-z0-9äöüÄÖÜß]/gi, '_').toLowerCase().slice(0, 40);
}

document.getElementById('cheat-download-btn')?.addEventListener('click', () => {
  if (currentCheatText) downloadText(`zusammenfassung_${safeName(sessionMeta?.name)}.md`, currentCheatText);
});

document.getElementById('aufgaben-download-btn')?.addEventListener('click', () => {
  if (currentAufgabenResult) downloadText(`aufgaben_${safeName(selTopic)}.md`, currentAufgabenResult);
});

document.getElementById('exam-download-btn')?.addEventListener('click', () => {
  if (currentExamText) downloadText(`klausur_${safeName(sessionMeta?.name)}.md`, currentExamText);
});

// ══ BACKUP / RESTORE ══════════════════════════════════════════════════════
async function exportBackup() {
  const r = await fetch('/api/backup', { headers: authHeaders() }); // raw-fetch-ok: lädt JSON-Blob für Datei-Download
  const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), {
    href: url, download: `ki-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data.subjects) throw new Error('Ungültiges Backup-Format');
  await fetch('/api/restore', { // raw-fetch-ok: Bulk-Import, eigener Ablauf
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify(data),
  });
  await loadSubjects();
  toast(`${data.subjects.length} Fach/Fächer erfolgreich importiert.`, 'success');
}

document.getElementById('btn-export')?.addEventListener('click', exportBackup);
document.getElementById('btn-import')?.addEventListener('click', () => document.getElementById('import-input').click());
document.getElementById('import-input')?.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { await importBackup(f); } catch(err) { toast('Import-Fehler: ' + err.message, 'error'); }
  e.target.value = '';
});

// ══ CHEAT SHEET ═══════════════════════════════════════════════════════════
document.getElementById('cheat-gen-btn')?.addEventListener('click', generateCheatSheet);
document.getElementById('cheat-new-btn')?.addEventListener('click', () => {
  currentCheatText = '';
  api(`/api/subjects/${sessionId}/cheat`, { method: 'DELETE' }).catch(() => {});
  document.getElementById('cheat-result').classList.add('hidden');
  document.getElementById('cheat-idle').classList.remove('hidden');
});

async function generateCheatSheet() {
  document.getElementById('cheat-idle').classList.add('hidden');
  document.getElementById('cheat-loading').classList.remove('hidden');
  const cheatDone = startProgress('cheat-progress-bar', 'cheat-progress-pct', 22000);

  const prompt = `Erstelle eine präzise, kompakte Zusammenfassung für "${sessionMeta.name}" als Cheat Sheet / Spickzettel.

Struktur:
# ${sessionMeta.name} – Zusammenfassung

## Kernkonzepte
- [Konzept]: [1-Satz-Erklärung]
(alle wichtigen Konzepte)

## Wichtige Formeln
$$[Formel 1]$$
*[Was die Formel bedeutet und wann sie gilt]*

(alle relevanten Formeln mit LaTeX)

## Definitionen
**[Begriff]:** [präzise Definition]
(alle Schlüsselbegriffe)

## Merksätze & Faustregeln
- [Wichtige Regeln, Ausnahmen, Tricks]

## Typische Fehler ⚠️
- [Was Schüler häufig falsch machen]

Sei präzise und vollständig. Alle Formeln in LaTeX-Notation.`;

  try {
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-result').classList.remove('hidden');
    const body = document.getElementById('cheat-body');
    body.innerHTML = '';
    const result = await claudeLocalStream(
      [{ role: 'user', content: 'Zusammenfassung erstellen.' }],
      sysBlocks(prompt), 3000,
      (text) => { body.innerHTML = safeHtml(md(text)); },
    );
    cheatDone();
    currentCheatText = result;
    api(`/api/subjects/${sessionId}/cheat`, {
      method: 'POST',
      body: JSON.stringify({ content: result }),
    }).catch(() => {});
  } catch (e) {
    cheatDone();
    document.getElementById('cheat-result').classList.add('hidden');
    document.getElementById('cheat-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
  }
}

// ══ GLOSSAR ════════════════════════════════════════════════════════════════
let glossarTerms = [];

document.getElementById('glossar-gen-btn')?.addEventListener('click', generateGlossar);
document.getElementById('glossar-new-btn')?.addEventListener('click', () => {
  glossarTerms = [];
  document.getElementById('glossar-result').classList.add('hidden');
  document.getElementById('glossar-idle').classList.remove('hidden');
});
document.getElementById('glossar-search')?.addEventListener('input', e => {
  renderGlossarList(e.target.value.toLowerCase());
});

async function generateGlossar() {
  document.getElementById('glossar-idle').classList.add('hidden');
  document.getElementById('glossar-loading').classList.remove('hidden');
  const glossarDone = startProgress('glossar-progress-bar', 'glossar-progress-pct', 18000);

  const prompt = `Extrahiere alle wichtigen Fachbegriffe aus dem Lernstoff für "${sessionMeta.name}".
Antworte NUR als JSON-Array (maximal 40 Begriffe, alphabetisch sortiert):
[{"term":"Begriff","def":"Präzise 1-2 Satz Erklärung"},...]`;

  try {
    const raw  = await claudeLocal(
      [{ role: 'user', content: 'Alle Fachbegriffe extrahieren.' }],
      sysBlocks(prompt), 2500,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Begriffe gefunden');
    glossarTerms = parseJsonLoose(m[0]).filter(t => t.term && t.def);
    glossarTerms.sort((a, b) => a.term.localeCompare(b.term, 'de'));
    DB.setGlossar(sessionId, glossarTerms.map(t => ({ term: t.term, definition: t.def }))).catch(() => {});
    glossarDone();
    renderGlossarList('');
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-result').classList.remove('hidden');
  } catch (e) {
    glossarDone();
    document.getElementById('glossar-loading').classList.add('hidden');
    document.getElementById('glossar-idle').classList.remove('hidden');
    toast('Fehler: ' + e.message, 'error');
  }
}

function renderGlossarList(filter) {
  const list    = document.getElementById('glossar-list');
  const visible = filter ? glossarTerms.filter(t =>
    t.term.toLowerCase().includes(filter) || t.def.toLowerCase().includes(filter)
  ) : glossarTerms;
  list.innerHTML = visible.map(t => `
    <div class="glossar-item">
      <div class="glossar-term">${esc(t.term)}</div>
      <div class="glossar-def">${esc(t.def)}</div>
    </div>`).join('');
}

async function loadSavedCheat() {
  try {
    const data = await api(`/api/subjects/${sessionId}/cheat`);
    if (!data?.content) return;
    currentCheatText = data.content;
    document.getElementById('cheat-body').innerHTML = safeHtml(md(data.content));
    document.getElementById('cheat-idle').classList.add('hidden');
    document.getElementById('cheat-loading').classList.add('hidden');
    document.getElementById('cheat-result').classList.remove('hidden');
  } catch (_) {}
}

async function loadSavedGlossar() {
  if (glossarTerms.length) { renderGlossarList(''); document.getElementById('glossar-idle').classList.add('hidden'); document.getElementById('glossar-result').classList.remove('hidden'); return; }
  try {
    const terms = await api(`/api/subjects/${sessionId}/glossar`);
    if (!terms || !terms.length) return;
    glossarTerms = terms.map(t => ({ term: t.term, def: t.definition }));
    renderGlossarList('');
    document.getElementById('glossar-idle').classList.add('hidden');
    document.getElementById('glossar-result').classList.remove('hidden');
  } catch (e) {}
}

// ══ CHART.JS FORTSCHRITTSDIAGRAMM ═════════════════════════════════════════
let _progressChart = null;

function renderProgressChart() {
  const wrap = document.getElementById('chart-wrap');
  const questions = (sessionMeta?.quizStats?.questions || []);
  if (questions.length < 5) { if (wrap) wrap.classList.add('hidden'); return; }
  if (wrap) wrap.classList.remove('hidden');

  // Rolling 5-question average
  const pcts = questions.map(q => Math.round(q.score / 3 * 100));
  const rolling = pcts.map((_, i) => {
    const w = pcts.slice(Math.max(0, i - 4), i + 1);
    return Math.round(w.reduce((a, b) => a + b, 0) / w.length);
  });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)';
  const textColor = isDark ? '#ebebf5' : '#1c1c1e';

  if (_progressChart) _progressChart.destroy();
  _progressChart = new Chart(document.getElementById('progress-chart'), {
    type: 'line',
    data: {
      labels: questions.map((_, i) => i + 1),
      datasets: [
        {
          label: 'Einzelantwort',
          data: pcts,
          borderColor: 'rgba(88,86,214,0.3)',
          backgroundColor: 'transparent',
          pointRadius: 3, pointBackgroundColor: 'rgba(88,86,214,0.5)',
          tension: 0, borderWidth: 1,
        },
        {
          label: 'Ø 5-Fragen',
          data: rolling,
          borderColor: '#5856d6',
          backgroundColor: 'rgba(88,86,214,0.08)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
        y: { min: 0, max: 100, ticks: { callback: v => v + '%', color: textColor }, grid: { color: gridColor } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } },
      },
    },
  });
}

// ══ KARTEIKARTEN ══════════════════════════════════════════════════════════
let reviewQueue   = [];
let reviewAllCards = [];   // full card set; reviewQueue holds references into this
let reviewIdx     = 0;
let reviewStats   = { again: 0, hard: 0, good: 0, easy: 0 };
let reviewHardCards = [];  // in dieser Runde mit "Nochmal"/"Schwer" bewertete Karten (Referenzen)

function srsUpdate(card, grade) {
  if (grade < 2) {
    card.interval    = 1;
    card.repetitions = 0;
  } else {
    if      (card.repetitions === 0) card.interval = 1;
    else if (card.repetitions === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ef);
    card.repetitions++;
  }
  card.ef  = Math.max(1.3, card.ef + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
  card.due = Date.now() + card.interval * 86400000;
  return card;
}

function showKartenState(el) {
  document.querySelectorAll('#panel-karten .cx-state').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

async function initKarten() {
  const cards = await DB.cards(sessionId);
  const now   = Date.now();
  const due   = cards.filter(c => c.due <= now);
  const stats = document.getElementById('karten-stats');
  const revBtn = document.getElementById('karten-review-btn');

  if (!cards.length) {
    stats.innerHTML = '<p style="color:var(--text2)">Noch keine Karten. Generiere sie aus deinen Dokumenten.</p>';
    revBtn.style.display = 'none';
  } else {
    stats.innerHTML = `
      <div class="karten-stat-row">
        <span class="kstat">📦 ${cards.length} Karten gesamt</span>
        <span class="kstat kstat-due">⏰ ${due.length} heute fällig</span>
      </div>`;
    revBtn.style.display = due.length ? '' : 'none';
    if (!due.length) {
      const next = Math.min(...cards.map(c => c.due));
      const hrs  = Math.ceil((next - now) / 3600000);
      stats.innerHTML += `<p style="color:var(--text2);font-size:14px;margin-top:8px">✅ Alle Karten erledigt! Nächste Wiederholung in ${hrs < 24 ? hrs + ' Std.' : Math.ceil(hrs/24) + ' Tagen'}</p>`;
    }
  }
  showKartenState(document.getElementById('karten-idle'));
}

async function generateKarten() {
  if (!sessionTxt) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  showKartenState(document.getElementById('karten-loading'));
  const kartenDone = startProgress('karten-progress-bar', 'karten-progress-pct', 18000);

  const prompt = `Erstelle 15 hochwertige Karteikarten aus dem Lernstoff für "${sessionMeta.name}".

Regeln:
- Vorderseite: präzise Frage oder Begriff (max 2 Zeilen)
- Rückseite: vollständige Antwort/Erklärung mit dem Kerninhalt (2–4 Sätze)
- Mix aus: Begriffsdefinitionen, Konzeptfragen, Formelanwendungen, Zusammenhängen
- Keine trivialen Fragen; echtes Verständnis prüfen
- Formeln in LaTeX ($$...$$)

Antworte NUR als JSON-Array:
[{"front":"Frage oder Begriff","back":"Vollständige Antwort/Erklärung"},...]`;

  try {
    const raw  = await claudeLocal(
      [{ role: 'user', content: 'Karteikarten erstellen.' }],
      sysBlocks(prompt), 2500,
    );
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Keine Karten erkannt');
    const parsed = parseJsonLoose(m[0]).filter(c => c.front && c.back);
    const existing = await DB.cards(sessionId);
    const newCards = parsed.map(c => ({
      front: c.front, back: c.back,
      interval: 1, ef: 2.5, repetitions: 0, due: Date.now(),
    }));
    await DB.setCards(sessionId, [...existing, ...newCards]);
    kartenDone();
    await initKarten();
  } catch (e) {
    kartenDone();
    showKartenState(document.getElementById('karten-idle'));
    toast('Fehler: ' + e.message, 'error');
  }
}

async function startReview() {
  const cards = await DB.cards(sessionId);
  reviewAllCards = cards;
  reviewQueue = cards.filter(c => c.due <= Date.now());
  if (!reviewQueue.length) { await initKarten(); return; }
  reviewIdx   = 0;
  reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };
  reviewHardCards = [];
  showKartenState(document.getElementById('karten-review'));
  showCard();
}

// Fokus-Runde: nur die in der letzten Runde wackligen Karten direkt nochmal.
function startHardReview() {
  if (!reviewHardCards.length) return;
  reviewQueue = reviewHardCards;
  reviewIdx   = 0;
  reviewStats = { again: 0, hard: 0, good: 0, easy: 0 };
  reviewHardCards = [];   // diese Runde sammelt erneut die noch wackligen
  haptic(10);
  showKartenState(document.getElementById('karten-review'));
  showCard();
}

function showCard() {
  const card   = reviewQueue[reviewIdx];
  const total  = reviewQueue.length;
  const pct    = Math.round(reviewIdx / total * 100);

  document.getElementById('karten-counter').textContent = `${reviewIdx + 1} / ${total}`;
  document.getElementById('karten-progress-fill').style.width = pct + '%';
  document.getElementById('card-front-text').innerHTML = safeHtml(md(card.front));
  document.getElementById('card-back-text').innerHTML  = safeHtml(md(card.back));

  const flip = document.getElementById('card-flip');
  flip.classList.remove('flipped');
  document.getElementById('card-flip-btn').classList.remove('hidden');
  document.getElementById('card-grade-row').classList.add('hidden');
}

document.getElementById('card-flip-btn')?.addEventListener('click', () => {
  document.getElementById('card-flip').classList.add('flipped');
  document.getElementById('card-flip-btn').classList.add('hidden');
  document.getElementById('card-grade-row').classList.remove('hidden');
  haptic(10);
});

document.querySelectorAll('.grade-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const grade = parseInt(btn.dataset.grade, 10);
    haptic(grade >= 2 ? 40 : [60, 30, 60]);
    const keys = ['again','hard','good','easy'];
    reviewStats[keys[grade]]++;

    // Update the card in place. reviewQueue holds references into reviewAllCards,
    // so mutating the queued card also updates the full set we persist.
    // (We cannot re-fetch + match by id: setCards re-inserts all rows and the
    // SERIAL ids change on every save, so id matching would fail after card 1.)
    srsUpdate(reviewQueue[reviewIdx], grade);
    if (grade <= 1) reviewHardCards.push(reviewQueue[reviewIdx]); // "Nochmal"/"Schwer" → nochmal üben
    await DB.setCards(sessionId, reviewAllCards);
    touchStreak();

    reviewIdx++;
    if (reviewIdx >= reviewQueue.length) {
      endReview();
    } else {
      showCard();
    }
  });
});

function endReview() {
  const total = reviewQueue.length;
  const good  = reviewStats.good + reviewStats.easy;
  const pct   = Math.round(good / total * 100);

  const hardN = reviewHardCards.length;
  document.getElementById('karten-done-title').textContent =
    pct >= 80 ? '🌟 Ausgezeichnet!' : pct >= 60 ? '👍 Gut gemacht!' : '💪 Weiter üben!';
  document.getElementById('karten-done-stats').innerHTML = `
    <div class="done-stat-row">
      <span class="done-stat">😄 Einfach: ${reviewStats.easy}</span>
      <span class="done-stat">🙂 Gut: ${reviewStats.good}</span>
      <span class="done-stat">😕 Schwer: ${reviewStats.hard}</span>
      <span class="done-stat">😵 Nochmal: ${reviewStats.again}</span>
    </div>
    <div class="done-pct" style="color:${pct>=70?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'}">${pct}% gewusst</div>
    ${hardN ? `<button class="btn-primary btn-sm karten-hard-again" id="karten-hard-btn">💪 ${hardN} schwere Karte${hardN === 1 ? '' : 'n'} nochmal</button>` : ''}`;
  document.getElementById('karten-hard-btn')?.addEventListener('click', startHardReview);
  showKartenState(document.getElementById('karten-done'));
  sessionTick('karten');
  addXP(20, 'Karten-Session');
}

document.getElementById('karten-gen-btn')?.addEventListener('click', generateKarten);
document.getElementById('karten-review-btn')?.addEventListener('click', startReview);
document.getElementById('karten-done-btn')?.addEventListener('click', initKarten);

// ── Milestone levels (shared between calculateMilestone + renderMilestone) ──
const MILESTONE_LEVELS = [
  { min: 0,  emoji: '🌱', name: 'Einsteiger',     rec: null,          diff: null },
  { min: 20, emoji: '📖', name: 'Grundlagen',      rec: 'Leicht',      diff: 'leicht' },
  { min: 40, emoji: '🎓', name: 'Lernender',       rec: 'Mittel',      diff: 'mittel' },
  { min: 60, emoji: '💪', name: 'Fortgeschritten', rec: 'Schwer',      diff: 'schwer' },
  { min: 80, emoji: '🏆', name: 'Experte',         rec: 'Prüfungsnah', diff: 'pruefungsnah' },
];

// ══ LERNEN (Lernpfad + Meilensteine) ═════════════════════════════════════

// Normalisiert Themennamen für die Duplikat-Erkennung: Kleinschreibung, Umlaute
// und Sub-/Hochzeichen auf ASCII (CO₂ → co2), führende Artikel sowie alle Satz-
// und Sonderzeichen entfernt, Leerzeichen kollabiert. So gelten z. B.
// "Die Lichtreaktion" und "Lichtreaktion" oder "CO₂-Konzentration" und
// "CO2 Konzentration" als dasselbe Thema.
function normTopic(t) {
  return String(t)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // Diakritika/Sub-/Hochzeichen → ASCII
    .toLowerCase()
    .replace(/^(der|die|das|den|dem|des|the|ein|eine)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Entfernt Beinah-Duplikate aus einer flachen Themenliste (erster Treffer gewinnt).
function dedupeTopics(arr) {
  const seen = new Set();
  return (arr || []).reduce((out, t) => {
    if (typeof t !== 'string') return out;
    const key = normTopic(t);
    if (key && !seen.has(key)) { seen.add(key); out.push(t.trim()); }
    return out;
  }, []);
}

// Entfernt Beinah-Duplikate über ALLE Kapitel hinweg und wirft leere Kapitel raus.
function dedupeStructure(struct) {
  if (!struct?.kapitel?.length) return struct;
  const seen = new Set();
  const kapitel = struct.kapitel.map(k => ({
    ...k,
    themen: (k.themen || []).reduce((out, t) => {
      if (typeof t !== 'string') return out;
      const key = normTopic(t);
      if (key && !seen.has(key)) { seen.add(key); out.push(t.trim()); }
      return out;
    }, []),
  })).filter(k => k.themen && k.themen.length);
  return { ...struct, kapitel };
}

// Ergänzungen aus dem Scan-Abdeckungs-Check in die Struktur einfügen (pur, testbar).
// ergaenzungen: [{kapitel:"Titel", themen:["…"]}]. Bereits (normalisiert) vorhandene
// Themen werden übersprungen, unbekannte Kapitel angelegt; maxAdd deckelt die Zahl
// neuer Themen, damit der Check das Gesamt-Budget des Scans nicht sprengen kann.
function mergeCoverageAdditions(struct, ergaenzungen, maxAdd = 6) {
  if (!struct?.kapitel?.length || !Array.isArray(ergaenzungen)) return struct;
  const have = new Set(struct.kapitel.flatMap(k => k.themen || []).map(normTopic));
  const kapitel = struct.kapitel.map(k => ({ ...k, themen: [...(k.themen || [])] }));
  let added = 0;
  for (const e of ergaenzungen) {
    if (!e || !Array.isArray(e.themen)) continue;
    const titel = (typeof e.kapitel === 'string' && e.kapitel.trim()) || 'Weitere Themen';
    let kap = kapitel.find(k => normTopic(k.titel) === normTopic(titel));
    for (const t of e.themen) {
      if (added >= maxAdd) break;
      if (typeof t !== 'string') continue;
      const key = normTopic(t);
      if (!key || have.has(key)) continue;
      if (!kap) { kap = { titel, lernziel: '', themen: [] }; kapitel.push(kap); }
      kap.themen.push(t.trim());
      have.add(key);
      added++;
    }
  }
  return { ...struct, kapitel: kapitel.filter(k => k.themen && k.themen.length) };
}

// ── Stabile Themen-IDs ─────────────────────────────────────────────────────
// Fortschritt (gelernt, Wiederholung, Cache) hängt an einer einmal vergebenen ID
// statt am Themen-Namen → überlebt Umbenennen/Re-Scan. topicUids (normName → ID)
// liegt in der fach-global geteilten Struktur, sodass alle Geräte dieselben IDs
// sehen. Fehlt eine ID, degradiert alles sauber auf den normalisierten Namen (v155).
function newTopicUid() {
  // ACHTUNG: crypto.randomUUID gibt es nur in Secure Contexts – auf HTTP (kein HTTPS
  // hier) ist es undefined. Der alte Fallback Date.now().toString(16)+Math.random()
  // war ~11 Hex-Zeichen Zeitstempel; .slice(0,10) schnitt den Zufallsteil weg, sodass
  // alle in derselben Millisekunde erzeugten IDs identisch wurden (Fortschritt
  // kollabierte auf 1 Thema). getRandomValues funktioniert auch über HTTP.
  const c = self.crypto;
  let hex;
  if (c?.randomUUID) {
    hex = c.randomUUID().replace(/[^a-f0-9]/gi, '');
  } else if (c?.getRandomValues) {
    const a = new Uint8Array(8); c.getRandomValues(a);
    hex = Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Letzter Notnagel: Zufall ZUERST, damit slice() ihn nicht abschneidet.
    hex = (Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/[^a-f0-9]/gi, '');
  }
  return 't_' + hex.slice(0, 12);
}
const isTopicUid = s => /^t_[a-f0-9]+$/i.test(s);

// Selbstheilung für "kollabierte" IDs (mehrere Themen auf derselben UID, s. o.):
// jede UID darf nur EINEM normalisierten Namen gehören – Dubletten bekommen neue,
// eindeutige IDs. true, wenn etwas repariert wurde. Da Fortschritt über die NAMEN
// auflöst (resolveKey → topicId(name)), bleibt bestehender Fortschritt erhalten.
function dedupeTopicUids() {
  const owner = new Map();   // uid → erster normName, der sie behält
  let changed = false;
  for (const k of Object.keys(topicUids)) {
    const u = topicUids[k];
    if (owner.has(u)) { topicUids[k] = newTopicUid(); changed = true; }
    else owner.set(u, k);
  }
  return changed;
}

// Stabile ID eines Themas, sonst dessen normalisierter Name (v155-Fallback).
function topicId(name) {
  const k = normTopic(name);
  return topicUids[k] || k;
}

// Fortschritts-Schlüssel "<id|normName>::<niveau>".
function topicKey(name, diff) {
  return topicId(name) + '::' + diff;
}

// Löst den Kopf eines ganzen "X::Niveau"-Schlüssels auf eine ID auf – akzeptiert
// Alt-Einträge ("Name::diff") wie ID-Einträge ("t_abc::diff").
function resolveKey(key) {
  const i = String(key).lastIndexOf('::');
  const head = i < 0 ? key : key.slice(0, i);
  const diff = i < 0 ? 'einsteiger' : key.slice(i + 2);
  return (isTopicUid(head) ? head : topicId(head)) + '::' + diff;
}

function learnedKey(topic, diff) { return topicKey(topic, diff); }

// Niveau-Rangfolge (Einsteiger=0 … Prüfungsnah=4). Grundlage für "Beherrschung
// impliziert niedrigere Stufen": ein auf Stufe N gelerntes Thema gilt als auf
// allen Stufen ≤ N gelernt – so muss kein Thema 5× wiederholt werden.
const DIFF_IDX = { einsteiger: 0, leicht: 1, mittel: 2, schwer: 3, pruefungsnah: 4 };
const diffIdx  = d => DIFF_IDX[d] ?? 0;

// Höchstes je erreichtes Niveau eines Themas; -1 wenn noch nie gelernt.
function topicMaxLevel(topic) {
  const id = topicId(topic);
  let max = -1;
  for (const k of learnedTopics) {
    const r = resolveKey(k);                 // tid::diff
    const i = r.lastIndexOf('::');
    if (r.slice(0, i) === id) max = Math.max(max, diffIdx(r.slice(i + 2)));
  }
  return max;
}

// Set aller gelernten Themen als aufgelöste ID-Schlüssel.
function learnedKeySet() {
  return new Set(learnedTopics.map(resolveKey));
}

// topicMeta-Schlüssel (Wiederholungs-Termine) ebenfalls über die ID auflösen.
function normFullKey(key) { return resolveKey(key); }

// Vergibt fehlenden Pfad-Themen eine ID; true, wenn etwas neu war.
function ensureTopicUids() {
  let changed = false;
  for (const name of pathTopics()) {
    const k = normTopic(name);
    if (k && !topicUids[k]) { topicUids[k] = newTopicUid(); changed = true; }
  }
  return changed;
}

// Token-Jaccard zweier normalisierter Namen (Rename-Erkennung beim Re-Scan).
function jaccardTokens(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// Cosine-Ähnlichkeit zweier Embedding-Vektoren (∈ [-1,1], hier praktisch [0,1]).
function cosineVec(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Schwelle für semantisches (Embedding-)Matching beim Re-Scan-Fortschritt-Abgleich.
// Empirisch an realen Themen-Umbenennungen kalibriert: echte Umbenennungen liegen bei
// 0.76–0.89, Same-Domain-Rauschen/gestrichene Themen meist < 0.7 (Cosine, nomic-embed).
const EMBED_MATCH_THRESHOLD = 0.75;

// Baut eine synchrone Ähnlichkeits-Funktion sim(normA, normB)→cosine auf Embedding-Basis.
// Holt die (persistent gecachten) Vektoren der übergebenen Namen vom Server und liefert
// dann einen reinen Vergleicher. null, wenn Embeddings nicht verfügbar sind (kein Fach
// offen / Ollama down / unvollständig) → der Aufrufer nutzt dann das Token-Matching.
// Bewusst hier getrennt vom synchronen reconcile/repair, damit die (langsame) Embedding-
// Beschaffung im async Aufrufer passiert und die reinen Funktionen testbar bleiben.
async function embedSimFn(names) {
  if (typeof api !== 'function' || !sessionId) return null;
  const norm = [...new Set(names.map(normTopic).filter(Boolean))];
  if (norm.length < 2) return null;
  let vecs;
  try {
    ({ vectors: vecs } = await api(`/api/subjects/${sessionId}/embed`, {
      method: 'POST', body: JSON.stringify({ names: norm }),
    }));
  } catch { return null; }
  if (!vecs) return null;
  for (const n of norm) if (!Array.isArray(vecs[n])) return null;  // unvollständig → konsistent Token-Fallback
  return (a, b) => {
    const va = vecs[a], vb = vecs[b];
    return (va && vb) ? cosineVec(va, vb) : 0;
  };
}

// Normalisierte Namen der Themen, deren Fortschritt aktuell verwaist ist (keine Live-ID
// löst auf sie auf) – nur diese müssen vor repairOrphanedProgress (+ die aktuellen Themen)
// embedded werden. Sync & billig; hält die teure Embedding-Menge minimal.
function orphanOldNames() {
  const names = pathTopics();
  if (!names.length || !learnedTopics.length) return [];
  const liveUids = new Set(names.map(topicId));
  const uidToName = {};
  for (const [norm, uid] of Object.entries(topicUids)) if (norm && !uidToName[uid]) uidToName[uid] = norm;
  const out = new Set();
  for (const k of learnedTopics) {
    const head = resolveKey(k).split('::')[0];
    if (!liveUids.has(head) && uidToName[head]) out.add(uidToName[head]);
  }
  return [...out];
}

// Re-Scan-Abgleich: für jeden neuen Namen die ID des passenden alten Themas
// nachtragen (exakt/normalisiert → Ähnlichkeit → sonst neue ID). Alte Map-Einträge
// bleiben erhalten, damit bestehender Fortschritt referenzierbar bleibt.
// sim (optional): semantische Ähnlichkeits-Funktion (Embedding-Cosine) aus embedSimFn.
// Liegt sie vor, wird semantisch gematcht (Schwelle 0.75) – robust gegen Umformulierung;
// sonst Token-Jaccard + Containment (Schwelle 0.4) als Fallback (auch im Test-Harness).
function reconcileTopicUids(prevNames, newNames, sim) {
  const prevNorm = prevNames.map(normTopic);
  const newNorm  = newNames.map(normTopic);
  const useEmb = typeof sim === 'function';
  const threshold = useEmb ? EMBED_MATCH_THRESHOLD : 0.4;
  const used = new Set();
  newNorm.forEach(k => { if (topicUids[k]) used.add(topicUids[k]); });
  const avail = prevNorm.filter(k => topicUids[k] && !newNorm.includes(k));
  newNorm.forEach(k => {
    if (!k || topicUids[k]) return;                       // exakt/normalisiert schon zugeordnet
    let best = null, score = 0;
    for (const o of avail) {
      if (used.has(topicUids[o])) continue;
      let s;
      if (useEmb) {
        s = sim(k, o);                                    // semantische Nähe (Cosine)
      } else {
        // Token-Jaccard; Containment-Bonus: enthält ein Name den anderen als Teilstring
        // (z.B. "Lichtreaktion" ⊂ "Die Lichtreaktion der Photosynthese"), ist es fast
        // sicher dasselbe Thema → als starker Treffer werten, auch ohne Token-Overlap.
        s = jaccardTokens(k, o);
        if (k.includes(o) || o.includes(k)) s = Math.max(s, 0.75);
      }
      if (s > score) { score = s; best = o; }
    }
    // Pro alter ID kann nur ein neuer Name andocken (used-Set), der Diff-Toast macht
    // Merges sichtbar → Risiko falscher Zuordnungen ist gering.
    if (best && score >= threshold) { topicUids[k] = topicUids[best]; used.add(topicUids[best]); }
    else topicUids[k] = newTopicUid();
  });
}

// Reparatur (v214): Fortschritt, der durch einen Re-Scan auf eine inzwischen verwaiste
// ID gefallen ist, auf das passende aktuelle Thema zurück-verknüpfen. So erscheinen schon
// gelernte, aber umbenannte Themen wieder als abgehakt – ohne Neu-Lernen. Idempotent:
// nach dem Heilen referenziert kein Fortschritt mehr eine verwaiste ID, ein erneuter Lauf
// findet nichts. Mutiert learnedTopics/topicMeta und liefert { healed, removed (alte Keys
// für Server-DELETE), added (neue Keys für POST) }.
// sim (optional): semantische Ähnlichkeit (Embedding-Cosine, Schwelle 0.75); fehlt sie,
// Token-Jaccard + Containment (Schwelle 0.4) als Fallback (auch im Test-Harness).
function repairOrphanedProgress(sim) {
  const result = { healed: 0, removed: [], added: [] };
  const names = pathTopics();
  if (!names.length || !learnedTopics.length) return result;
  const useEmb = typeof sim === 'function';
  const threshold = useEmb ? EMBED_MATCH_THRESHOLD : 0.4;

  const liveUids = new Set(names.map(topicId));
  // uid → alter normalisierter Name (Reverse-Lookup; topicUids behält Alt-Einträge).
  const uidToName = {};
  for (const [norm, uid] of Object.entries(topicUids)) {
    if (norm && !uidToName[uid]) uidToName[uid] = norm;
  }
  // Verwaiste Fortschritts-IDs: kein aktuelles Thema löst auf sie auf.
  const orphans = new Set();
  for (const k of learnedTopics) {
    const head = resolveKey(k).split('::')[0];
    if (!liveUids.has(head)) orphans.add(head);
  }
  if (!orphans.size) return result;

  // Für jede verwaiste ID das ähnlichste aktuelle Thema + Score bestimmen …
  const cands = [];
  for (const ou of orphans) {
    const oldNorm = uidToName[ou];
    if (!oldNorm) continue;
    let best = null, score = 0;
    for (const nm of names) {
      const lu = topicId(nm);
      const nn = normTopic(nm);
      let s;
      if (useEmb) {
        s = sim(oldNorm, nn);
      } else {
        s = jaccardTokens(oldNorm, nn);
        if (oldNorm.includes(nn) || nn.includes(oldNorm)) s = Math.max(s, 0.75);
      }
      if (s > score) { score = s; best = lu; }
    }
    if (best && score >= threshold) cands.push({ ou, best, score });
  }
  // … dann greedy nach Score absteigend zuordnen: die sichersten Treffer beanspruchen
  // ihr Ziel zuerst, jede Ziel-ID höchstens einmal (wie reconcile's used-Set).
  cands.sort((a, b) => b.score - a.score);
  const remap = {};
  const claimed = new Set();
  for (const c of cands) {
    if (claimed.has(c.best)) continue;
    remap[c.ou] = c.best; claimed.add(c.best);
  }
  if (!Object.keys(remap).length) return result;

  // learnedTopics auf die Live-IDs umschreiben (+ dedupe); Server-Sync vormerken.
  const rewrite = key => {
    const r = resolveKey(key);
    const i = r.lastIndexOf('::');
    return (remap[r.slice(0, i)] || r.slice(0, i)) + '::' + r.slice(i + 2);
  };
  const seen = new Set();
  const next = [];
  for (const k of learnedTopics) {
    const head = resolveKey(k).split('::')[0];
    const nk = rewrite(k);
    if (remap[head]) result.removed.push(k);   // verwaister Server-Eintrag → löschen
    if (!seen.has(nk)) {
      seen.add(nk); next.push(nk);
      if (remap[head]) result.added.push(nk);   // neuer Live-Eintrag → posten
    }
  }
  learnedTopics = next;

  // topicMeta (Wiederholungs-Termine) ebenfalls umhängen.
  const newMeta = {};
  for (const [k, v] of Object.entries(topicMeta)) newMeta[rewrite(k)] = v;
  topicMeta = newMeta;

  result.healed = Object.keys(remap).length;
  return result;
}

// "Nicht so streng" beim Re-Scan (v255): Ein frischer Scan schneidet die Themen neu zu und
// lässt dabei manchmal welche GANZ fallen (echte Restrukturierung, nicht nur Umbenennung).
// Ein bereits GELERNTES Thema, das im neuen Scan keine sichere Entsprechung mehr hat
// (Ähnlichkeit < Schwelle), würde so samt Abhak-Status verschwinden – obwohl der Nutzer es
// schon abgeschlossen hat. Statt es zu verlieren, hängen wir es – mit seinem ALTEN
// Anzeigenamen – zurück in sein altes Kapitel (bzw. das best-passende neue). reconcileTopicUids
// erbt danach die alte ID (Name identisch) → der Fortschritt bleibt sichtbar. Mutiert
// moduleStructure und liefert die Zahl der zurückgeholten Themen. MUSS VOR reconcileTopicUids
// laufen (nutzt daher noch die alten IDs für topicMaxLevel). sim: Embedding-Ähnlichkeit über
// [...alteNamen, ...neueNamen]; die zurückgeholten Namen sind ⊂ alteNamen → schon eingebettet.
function retainLearnedTopics(prevStructure, sim) {
  if (!prevStructure?.kapitel?.length || !moduleStructure?.kapitel?.length) return 0;
  const useEmb = typeof sim === 'function';
  const threshold = useEmb ? EMBED_MATCH_THRESHOLD : 0.4;
  const simOf = (a, b) => {
    const na = normTopic(a), nb = normTopic(b);
    if (na === nb) return 1;
    if (useEmb) return sim(na, nb);
    let s = jaccardTokens(na, nb);
    if (na.includes(nb) || nb.includes(na)) s = Math.max(s, 0.75);
    return s;
  };
  let retained = 0;
  for (const oldK of prevStructure.kapitel) {
    for (const t of (oldK.themen || [])) {
      if (topicMaxLevel(t) < 0) continue;                                    // nie gelernt → darf wegfallen
      const cur = moduleStructure.kapitel.flatMap(k => k.themen);
      if (cur.some(nn => simOf(t, nn) >= threshold)) continue;              // (um)benannt bereits vorhanden
      // Best-passendes neues Kapitel für die Einordnung – sonst das alte Kapitel neu anlegen.
      let target = null, best = 0;
      for (const k of moduleStructure.kapitel) {
        const s = simOf(oldK.titel, k.titel);
        if (s > best) { best = s; target = k; }
      }
      if (!target || best < (useEmb ? 0.6 : 0.4)) {
        target = moduleStructure.kapitel.find(k => normTopic(k.titel) === normTopic(oldK.titel));
        if (!target) {
          target = { titel: oldK.titel, lernziel: oldK.lernziel || '', themen: [] };
          moduleStructure.kapitel.push(target);
        }
      }
      if (!target.themen.some(x => normTopic(x) === normTopic(t))) { target.themen.push(t); retained++; }
    }
  }
  return retained;
}

// Re-Scan-Diff (#7-Bonus): zählt anhand der stabilen IDs, wie viele Themen neu sind,
// verschwunden und erhalten geblieben. Ein Rename zählt als "unverändert", weil die ID
// beim Reconcile erhalten bleibt (= Fortschritt bleibt). MUSS nach reconcileTopicUids
// laufen, damit die neuen Namen ihre IDs schon tragen.
function scanDiff(prevNames, newNames) {
  const prevUids = new Set((prevNames || []).map(topicId));
  const newUids  = new Set((newNames  || []).map(topicId));
  let added = 0, unchanged = 0;
  for (const u of newUids) (prevUids.has(u) ? unchanged++ : added++);
  let removed = 0;
  for (const u of prevUids) if (!newUids.has(u)) removed++;
  return { added, removed, unchanged };
}
const formatScanDiff = d => `${d.added} neu · ${d.removed} entfernt · ${d.unchanged} unverändert`;

// IDs in die geteilte Struktur (Server + lokal) schreiben, plus lokaler Fallback.
function persistTopicUids(subjId) {
  if (!subjId) return;
  if (moduleStructure) {
    moduleStructure.ids = topicUids;
    localforage.setItem(`ms_${subjId}`, moduleStructure).catch(() => {});
    api(`/api/subjects/${subjId}/structure`, {
      method: 'POST',
      body: JSON.stringify({ structure: moduleStructure, topics: scannedTopics }),
    }).catch(() => {});
  }
  localforage.setItem(`tuid_${subjId}`, topicUids).catch(() => {});
}

// Einzige Wahrheitsquelle für die Themen des Lernpfads: exakt die Liste, die auch
// in loadLernpfad() gerendert wird. Wenn eine Kapitelstruktur existiert, zählen
// ALLE ihre Themen (ungekappt) – sonst die flache scannedTopics-Liste. So bleibt
// die Prozentzahl/„X/Y"-Anzeige immer deckungsgleich mit den sichtbaren Themen.
function pathTopics() {
  if (moduleStructure?.kapitel?.length)
    return moduleStructure.kapitel.flatMap(k => k.themen);
  return scannedTopics;
}

// Das Kapitel, zu dem ein Thema gehört (für integrierte Aufgaben auf hohem Niveau).
function chapterOf(topic) {
  return moduleStructure?.kapitel?.find(k => k.themen.includes(topic)) || null;
}

// Geschwister-Themen desselben Kapitels – auf hohem Niveau werden sie in EINE
// zusammengesetzte, klausurartige Aufgabe verwoben (statt 30 isolierter Krümel).
function chapterSiblings(topic) {
  const k = chapterOf(topic);
  return k ? k.themen.filter(t => t !== topic) : [];
}

// ── Hebel 2: Körnung pro Niveau ─────────────────────────────────────────────
// Auf hohen Stufen ist die Lerneinheit nicht mehr ein Mikro-Thema, sondern eine
// zusammengesetzte Einheit (Cluster bzw. ganzes Kapitel) → wenige, große Aufgaben
// statt 35 Krümel. Zusammen mit Hebel 1 (Beherrschung impliziert tiefer) kollabiert
// das die Stückzahl: eine Kapitel-Einheit auf Prüfungsnah erledigt alle ihre Themen.
const GRAIN_BY_DIFF = { einsteiger: 'topic', leicht: 'topic', mittel: 'topic', schwer: 'cluster', pruefungsnah: 'kapitel' };

// Liefert die Lerneinheiten für ein Niveau. 'topic' → je Thema eine Einheit;
// 'cluster' → 2–3 Themen eines Kapitels; 'kapitel' → ganzes Kapitel.
function pathUnits(diff) {
  const grain = GRAIN_BY_DIFF[diff] || 'topic';
  if (grain === 'topic' || !moduleStructure?.kapitel?.length)
    return pathTopics().map(t => ({ kind: 'topic', themen: [t], name: t }));
  const units = [];
  for (const k of moduleStructure.kapitel) {
    if (!k.themen?.length) continue;
    if (grain === 'kapitel') {
      units.push({ kind: 'kapitel', themen: k.themen, name: k.titel, lernziel: k.lernziel });
    } else { // cluster
      for (let i = 0; i < k.themen.length; i += 3) {
        const part = k.themen.slice(i, i + 3);
        units.push({ kind: 'cluster', themen: part,
          name: `${k.titel}: ${part.join(' · ')}`, lernziel: k.lernziel });
      }
    }
  }
  return units;
}

// Stabile ID einer Einheit – aus den (stabilen) Member-tids, damit Fortschritt/Cache
// einen Re-Scan überleben. Ein-Thema-Einheit = die Themen-ID selbst (kompatibel).
function unitId(unit) {
  const ts = (unit?.themen || []).filter(Boolean);
  if (ts.length <= 1) return topicId(ts[0] || unit?.name || '');
  return 'u_' + ts.map(topicId).sort().join('_');
}

// Die aktuelle Einheit robust (Fallback: Ein-Thema-Einheit aus currentExplainerTopic).
function curUnit() {
  return currentUnit || { kind: 'topic', themen: [currentExplainerTopic], name: currentExplainerTopic };
}

// Pfad-Themen, die auf diesem Niveau ODER HÖHER gelernt wurden ("Beherrschung
// impliziert niedrigere Stufen"). Wer ein Thema auf "Mittel" schafft, füllt damit
// Einsteiger+Grundlagen+Mittel in einer Aktion – kein erzwungenes 5×. Die Stufen-
// Kreise werden dadurch monoton (jeder höhere ≤ niedrigerer).
function topicsDoneAtDiff(diff) {
  const need = diffIdx(diff);
  return pathTopics().filter(t => topicMaxLevel(t) >= need).length;
}

function calculateMilestone() {
  const total = pathTopics().length;

  // Fortschritt PRO Stufe: Anteil der Themen, die auf genau diesem Niveau
  // durchgearbeitet wurden. So füllt sich jeder Stufen-Kreis nur durch Aufgaben
  // auf diesem Niveau – leichte Themen heben keine höheren Stufen.
  const fracs = MILESTONE_LEVELS.map(l => {
    const d = l.diff || 'einsteiger';
    return total > 0 ? Math.min(1, topicsDoneAtDiff(d) / total) : 0;
  });

  // Auto-Stufe = niedrigste noch nicht vollständig gelernte Stufe (= woran man
  // gerade arbeitet). Erst wenn eine Stufe ganz voll ist, rückt sie eine weiter.
  let levelIdx = 0;
  while (levelIdx < MILESTONE_LEVELS.length - 1 && fracs[levelIdx] >= 1) levelIdx++;
  // Der Lernstrahl startet bei Lernender: mit Vorwissen aus der Vorlesung steigt man
  // dort ein. Die Grundstufen (Einsteiger, Grundlagen) werden nicht mehr angezeigt –
  // ein höher gemeistertes Thema deckt sie ohnehin automatisch ab.
  if (levelIdx < MS_BASIC_COUNT) levelIdx = MS_BASIC_COUNT;
  const level = MILESTONE_LEVELS[levelIdx];

  // Anzeige-% = Fortschritt auf dem AKTIVEN Niveau (manuell gewählt oder Auto).
  const activeIdx  = selectedDiffIdx !== null ? selectedDiffIdx : levelIdx;
  const activeDiff = MILESTONE_LEVELS[activeIdx].diff || 'einsteiger';
  const diffDone   = topicsDoneAtDiff(activeDiff);
  const pct = total > 0 ? Math.round(Math.min(1, diffDone / total) * 100) : 0;

  // Gesamtfortschritt: distinkte Pfad-Themen, die auf IRGENDEINEM Niveau schon
  // gelernt wurden. Macht den Niveauwechsel sichtbar nicht-destruktiv (#5).
  const learnedIds = new Set(learnedTopics.map(t => { const r = resolveKey(t); return r.slice(0, r.lastIndexOf('::')); }));
  const overallDone = pathTopics().filter(n => learnedIds.has(topicId(n))).length;
  const overallPct  = total > 0 ? Math.round(overallDone / total * 100) : 0;

  return { ...level, pct, doneCount: diffDone, totalTopics: total, overallDone, overallPct,
           levelNum: levelIdx + 1, totalLevels: MILESTONE_LEVELS.length, fracs };
}

function renderMilestone() {
  const banner = document.getElementById('milestone-banner');
  const title  = document.getElementById('lernpfad-title');
  if (!banner) return;
  if (!scannedTopics.length) {
    banner.classList.add('hidden');
    if (title) title.style.display = 'none';
    updateExamRecBanner();
    renderKlausurBridge(null);
    return;
  }
  const m = calculateMilestone();
  banner.classList.remove('hidden');
  if (title) title.style.display = '';

  const autoIdx  = m.levelNum - 1;
  const selIdx   = selectedDiffIdx;
  const fracs    = m.fracs || [];

  // Der Lernstrahl zeigt nur die drei relevanten Stufen: Lernender, Fortgeschritten,
  // Experte. Die Grundstufen (Einsteiger, Grundlagen) gehören didaktisch in die
  // Vorlesung – hier steigt man mit Vorwissen direkt auf Lernender ein. Die Auto-
  // Stufe (calculateMilestone) ist auf min. Lernender geklemmt, sodass der aktive
  // Marker nie auf einer ausgeblendeten Grundstufe landet.
  const visibleLevels = MILESTONE_LEVELS
    .map((l, i) => ({ l, i }))
    .filter(({ i }) => i >= MS_BASIC_COUNT);

  const stepHtml = ({ l, i }, last) => {
    const frac     = fracs[i] || 0;
    const complete = frac >= 1;                 // ganze Stufe durchgelernt → Kreis voll
    const deg      = Math.round(frac * 360);    // Füllung im Uhrzeigersinn
    const isManual = selIdx !== null;
    const isActive = isManual ? i === selIdx : i === autoIdx;
    const cls = ['ms-step', isActive ? (isManual ? 'ms-manual' : 'ms-active') : '', complete ? 'ms-complete' : '']
                  .filter(Boolean).join(' ');
    // Verbindungsstrich wird dick/aktiv, sobald die Stufe LINKS davon voll ist.
    const lineClass = complete ? 'ms-line ms-line-done' : 'ms-line';
    return `<div class="${cls}" data-diffidx="${i}" style="--ms-frac:${deg}deg">
      <div class="ms-dot"><span class="ms-dot-emoji">${complete ? '✓' : l.emoji}</span></div>
      <div class="ms-label">${l.name}</div>
    </div>${last ? '' : `<div class="${lineClass}"></div>`}`;
  };

  const stepsHtml =
    visibleLevels.map((v, pos) => stepHtml(v, pos === visibleLevels.length - 1)).join('');

  const activeDiffName = selIdx !== null ? MILESTONE_LEVELS[selIdx].name : (m.diff ? m.name : 'Einsteiger');
  const infoTxt = selIdx !== null
    ? `Modus: <strong>${MILESTONE_LEVELS[selIdx].name}</strong> · ${m.doneCount}/${m.totalTopics} Themen auf diesem Level · <span class="ms-reset-btn">Zurücksetzen</span>`
    : `${m.pct}% · ${m.doneCount}/${m.totalTopics} Themen auf <strong>${activeDiffName}</strong>-Level${m.rec ? ` · Empfehlung: <strong>${m.rec}</strong>` : ''}`;

  // Gesamtfortschritt oben (alle Niveaus zusammen) – bleibt beim Stufenwechsel
  // stehen, damit die per-Niveau-% nicht wie ein Reset wirkt (#5).
  const overallHtml = `
    <div class="ms-info" style="margin:0 0 4px"><strong>🎯 Gesamt:</strong> ${m.overallDone}/${m.totalTopics} Themen gelernt · ${m.overallPct}%</div>
    <div style="height:8px;border-radius:6px;background:rgba(127,127,127,.18);overflow:hidden;margin-bottom:12px">
      <div style="height:100%;width:${m.overallPct}%;background:linear-gradient(90deg,#34d399,#10b981);border-radius:6px;transition:width .4s"></div>
    </div>`;

  banner.innerHTML = `
    ${overallHtml}
    <div class="ms-steps">${stepsHtml}</div>
    <div class="ms-bar-wrap"><div class="ms-bar-fill" style="width:${m.pct}%"></div></div>
    <div class="ms-info">${infoTxt}</div>
    <div id="ms-klausur-foot" class="ms-klausur-foot"></div>`;

  banner.querySelectorAll('.ms-step').forEach(el => {
    el.addEventListener('click', () => {
      selectedDiffIdx = +el.dataset.diffidx === selectedDiffIdx ? null : +el.dataset.diffidx;
      renderMilestone();
      loadLernpfad();
    });
  });
  banner.querySelector('.ms-reset-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    selectedDiffIdx = null;
    renderMilestone();
    loadLernpfad();
  });
  updateExamRecBanner(m);
  renderKlausurBridge(m);
}

// Probeklausur-Anschluss: dezenter Button am Ende des Lernstrahls – kein Banner,
// keine eskalierende Botschaft mehr. Erst Lernender→Experte hocharbeiten, danach
// hier die Probeklausur starten. Die Schwierigkeit folgt dem aktiven Lern-Niveau
// (manuell gewählte Stufe hat Vorrang vor der Auto-Stufe).
function renderKlausurBridge(m) {
  const el = document.getElementById('ms-klausur-foot');
  if (!el) return;
  if (!m || !scannedTopics.length) { el.innerHTML = ''; return; }
  const recDiff = (selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx].diff : m.diff) || 'mittel';
  el.innerHTML = `<button class="btn-secondary btn-sm kb-cta">📋 Probeklausur</button>`;
  el.querySelector('.kb-cta').addEventListener('click', () => startKlausurFromLernen(recDiff, false));
}

// Wechselt zum Klausur-Tab, richtet die Schwierigkeit am Lern-Niveau aus und
// startet (bei genug Fortschritt) direkt eine an den Lernpfad gekoppelte Klausur.
function startKlausurFromLernen(diff, auto) {
  switchMode('exam');
  const target = ['leicht', 'mittel', 'schwer', 'pruefungsnah', 'experte'].includes(diff) ? diff : 'mittel';
  const btn = document.querySelector(`.diff-btn[data-diff="${target}"]`);
  if (btn && !btn.disabled) {
    selDiff = target;
    document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
  }
  if (auto) generateExam();
}

function updateExamRecBanner(m) {
  const banner = document.getElementById('exam-rec-banner');
  if (!banner) return;
  if (!m) { m = scannedTopics.length ? calculateMilestone() : null; }
  if (!m || !m.rec) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  banner.innerHTML = `${m.emoji} Empfehlung für dein Level: <strong>${m.rec}</strong>`;
  document.querySelectorAll('.diff-btn').forEach(btn =>
    btn.classList.toggle('recommended', btn.dataset.diff === m.diff));
}

function initLernen() {
  // If the topic view is open from a previous visit, close it back to the list
  if (document.getElementById('lernen-topic-view').style.display !== 'none') {
    closeLernenTopic();
  }
  renderMilestone();
  loadLernpfad();
  if (sessionId) {
    api(`/api/subjects/${sessionId}/learned-topics`)
      .then(t => {
        const norm = e => e.includes('::') ? e : e + '::einsteiger';
        const server = Array.isArray(t) ? t.map(norm) : [];
        // Mit dem In-Memory-Stand VEREINEN statt überschreiben – sonst gehen in
        // dieser Session/offline gelernte Themen verloren (konsistent mit openSubject).
        learnedTopics = [...new Set([...server, ...learnedTopics.map(norm)])];
        localforage.setItem(`lt_${sessionId}`, learnedTopics).catch(() => {});
        renderMilestone(); loadLernpfad();
      })
      .catch(() => {});
    localforage.getItem(`lsession_${sessionId}`)
      .then(s => { currentSession = s || null; renderSessionBanner(); })
      .catch(() => renderSessionBanner());
  }
}

function loadLernpfad() {
  const empty = document.getElementById('lernpfad-empty');
  const list  = document.getElementById('lernpfad-list');
  if (!empty || !list) return;
  if (!scannedTopics.length) {
    empty.classList.remove('hidden');
    list.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = '';
  const activeLvl  = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  const activeDiff = activeLvl.diff || 'einsteiger';
  // "Getan" zählt auf ODER ÜBER dem aktiven Niveau: ein auf einer höheren Stufe
  // gemeistertes Thema gilt hier als fertig (Beherrschung impliziert niedrigere
  // Stufen) – nie wieder zum Wiederholen auffordern, was man schon übertroffen hat.
  // Nur niedriger Gelerntes bekommt den "⬆ Vertiefen"-Hinweis.
  const need = diffIdx(activeDiff);
  const isTopicDone  = topic => topicMaxLevel(topic) >= need;
  const wasDoneLower = topic => { const m = topicMaxLevel(topic); return m >= 0 && m < need; };
  let foundCurrent = false;
  const makeItem = topic => {
    const isDone       = isTopicDone(topic);                 // auf aktivem Niveau
    const needsUpgrade = wasDoneLower(topic);                // nur niedrigeres Niveau
    const isDue        = isDone && topicReviewDue(topic + '::' + activeDiff);
    const isCurrent    = !isDone && !needsUpgrade && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    const item = document.createElement('div');
    item.className = `lernpfad-item${isDone ? ' is-done' : ''}${needsUpgrade ? ' is-upgrade' : ''}${isDue ? ' is-due' : ''}${isCurrent ? ' is-current' : ''}`;
    const diffLvl = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : null;
    const diffTag = diffLvl && !isDone ? ` <span class="lernpfad-diff-tag">${diffLvl.emoji} ${diffLvl.name}</span>` : '';
    const dueTag  = isDue ? ' <span class="lernpfad-due-tag">🔄 Wiederholung fällig</span>' : '';
    const upgradeTag = needsUpgrade ? ` <span class="lernpfad-upgrade-tag">⬆ Jetzt auf ${activeLvl.name}</span>` : '';
    const btnLabel = isDue ? 'Auffrischen →' : isDone ? 'Wiederholen' : needsUpgrade ? 'Vertiefen →' : 'Lernen →';
    const btnClass = isDone && !isDue ? 'lernpfad-btn lernpfad-btn-repeat' : 'lernpfad-btn';
    item.innerHTML = `
      <span class="lernpfad-status">${isDue ? '🔄' : isDone ? '✅' : needsUpgrade ? '✓' : isCurrent ? '▶' : '○'}</span>
      <span class="lernpfad-name">${esc(topic)}${diffTag}${dueTag}${upgradeTag}</span>
      <button class="${btnClass}">${btnLabel}</button>`;
    item.querySelector('.lernpfad-btn').addEventListener('click', () => openTopicView(topic));
    return item;
  };

  // Hebel 2: ein Item pro zusammengesetzter Einheit (Cluster/Kapitel) statt pro Thema.
  const makeUnitItem = unit => {
    const isDone    = unit.themen.every(t => topicMaxLevel(t) >= need);
    const someLower = !isDone && unit.themen.some(t => topicMaxLevel(t) >= 0);
    const isDue     = isDone && unit.themen.some(t => topicReviewDue(t + '::' + activeDiff));
    const isCurrent = !isDone && !someLower && !foundCurrent;
    if (isCurrent) foundCurrent = true;
    const item = document.createElement('div');
    item.className = `lernpfad-item lernpfad-unit${isDone ? ' is-done' : ''}${someLower ? ' is-upgrade' : ''}${isDue ? ' is-due' : ''}${isCurrent ? ' is-current' : ''}`;
    const countTag = ` <span class="lernpfad-unit-count">${unit.themen.length} Themen</span>`;
    const dueTag   = isDue ? ' <span class="lernpfad-due-tag">🔄 Wiederholung fällig</span>' : '';
    const upTag    = someLower ? ` <span class="lernpfad-upgrade-tag">⬆ Auf ${activeLvl.name} vertiefen</span>` : '';
    const btnLabel = isDue ? 'Auffrischen →' : isDone ? 'Wiederholen' : someLower ? 'Vertiefen →' : 'Klausuraufgabe →';
    const btnClass = isDone && !isDue ? 'lernpfad-btn lernpfad-btn-repeat' : 'lernpfad-btn';
    item.innerHTML = `
      <span class="lernpfad-status">${isDue ? '🔄' : isDone ? '✅' : someLower ? '✓' : isCurrent ? '▶' : '○'}</span>
      <span class="lernpfad-name">${esc(unit.name)}${countTag}${dueTag}${upTag}</span>
      <button class="${btnClass}">${btnLabel}</button>`;
    item.querySelector('.lernpfad-btn').addEventListener('click', () => openUnit(unit));
    return item;
  };

  // Interleaving-Toggle: Themen aus verschiedenen Kapiteln abwechselnd üben
  const controlsBar = document.createElement('div');
  controlsBar.className = 'lernpfad-controls';
  const ilBtn = document.createElement('button');
  ilBtn.className = `btn-secondary btn-sm interleave-btn${interleavedMode ? ' active' : ''}`;
  ilBtn.textContent = interleavedMode ? '🔀 Gemischt (aktiv)' : '🔀 Gemischter Modus';
  ilBtn.title = 'Themen aus verschiedenen Kapiteln abwechselnd üben (Interleaving)';
  ilBtn.addEventListener('click', () => {
    interleavedMode = !interleavedMode;
    loadLernpfad();
  });
  controlsBar.appendChild(ilBtn);
  // Re-Scan: ohne diesen Button gäbe es nach dem ersten Scan keine Möglichkeit mehr,
  // die Themen neu zu erkennen (der Erst-Scan-Button lebt nur im Empty-State)
  const rescanBtn = document.createElement('button');
  rescanBtn.className = 'btn-secondary btn-sm';
  rescanBtn.textContent = '🔄 Themen neu erkennen';
  rescanBtn.title = 'Alle Dokumente neu analysieren und Hauptthemen + Lernthemen neu aufbauen';
  rescanBtn.addEventListener('click', () => scanModuleStructure(rescanBtn));
  controlsBar.appendChild(rescanBtn);
  list.appendChild(controlsBar);

  const grain = GRAIN_BY_DIFF[activeDiff] || 'topic';

  if (grain !== 'topic' && moduleStructure?.kapitel?.length) {
    // Hebel 2: wenige große Einheiten (Cluster/Kapitel) – je eine integrierte Klausuraufgabe.
    const units = pathUnits(activeDiff);
    const label = document.createElement('div');
    label.className = 'kap-restructure-hint';
    label.innerHTML = `<span>🎯 ${activeLvl.name}: zusammengesetzte Klausuraufgaben – ${units.length} Einheiten statt ${pathTopics().length} Einzelthemen. Eine erledigt alle ihre Themen.</span>`;
    list.appendChild(label);
    units.forEach(u => list.appendChild(makeUnitItem(u)));
  } else if (interleavedMode && moduleStructure?.kapitel?.length > 1) {
    // Round-robin über Kapitel: Thema 1 aus Kap1, Thema 1 aus Kap2, Thema 2 aus Kap1 …
    const maxLen = Math.max(...moduleStructure.kapitel.map(k => k.themen.length));
    const label = document.createElement('div');
    label.className = 'kap-restructure-hint';
    label.innerHTML = `<span>🔀 Gemischter Modus – Themen aus verschiedenen Kapiteln abwechselnd</span>`;
    list.appendChild(label);
    for (let i = 0; i < maxLen; i++) {
      for (const kap of moduleStructure.kapitel) {
        if (i < kap.themen.length) list.appendChild(makeItem(kap.themen[i]));
      }
    }
  } else if (moduleStructure?.kapitel?.length) {
    // Modul-Reise: chapters with Lernziel + progress
    moduleStructure.kapitel.forEach((k, ki) => {
      const doneCount = k.themen.filter(isTopicDone).length;
      const total     = k.themen.length;
      const kapDone   = total > 0 && doneCount === total;
      const head = document.createElement('div');
      head.className = `kap-head${kapDone ? ' kap-done' : ''}`;
      head.innerHTML = `
        <div class="kap-num">${kapDone ? '✓' : ki + 1}</div>
        <div class="kap-info">
          <div class="kap-title">${esc(k.titel)}</div>
          ${k.lernziel ? `<div class="kap-ziel">🎯 ${esc(k.lernziel)}</div>` : ''}
        </div>
        <span class="kap-progress${kapDone ? ' kap-progress-done' : ''}">${doneCount}/${total}</span>`;
      list.appendChild(head);
      k.themen.forEach(topic => list.appendChild(makeItem(topic)));
    });
  } else {
    // Old flat list + hint to upgrade to chapters
    const hint = document.createElement('div');
    hint.className = 'kap-restructure-hint';
    hint.innerHTML = `<span>🗺️ Neu: Strukturiere deinen Lernpfad in Kapitel mit Lernzielen.</span>
      <button class="btn-secondary btn-sm">Jetzt strukturieren</button>`;
    hint.querySelector('button').addEventListener('click', e => scanModuleStructure(e.target));
    list.appendChild(hint);
    scannedTopics.forEach(topic => list.appendChild(makeItem(topic)));
  }
}

// ══ BELOHNUNG: XP, Tagesziel, Combo, Konfetti ══════════════════════════════
const XP_DAILY_GOAL = 100;
const XP_BY_DIFF = { einsteiger: 40, leicht: 55, mittel: 70, schwer: 90, pruefungsnah: 120 };
let comboCount = 0;

function xpKey() { return `xp_${new Date().toISOString().slice(0, 10)}`; }

async function addXP(n, reason) {
  if (!n) return;
  const prev = (await localforage.getItem(xpKey()).catch(() => 0)) || 0;
  const now  = prev + n;
  localforage.setItem(xpKey(), now).catch(() => {});
  updateXpChip(now);
  if (reason) toast(`⚡ +${n} XP · ${reason}`, 'success', 2200);
  if (prev < XP_DAILY_GOAL && now >= XP_DAILY_GOAL) {
    confettiBurst();
    setTimeout(() => toast('🎯 Tagesziel erreicht! Stark.', 'success', 4000), 400);
  }
}

function updateXpChip(value) {
  const el = document.getElementById('xp-chip');
  if (!el) return;
  const render = xp => {
    const pct = Math.min(100, Math.round((xp / XP_DAILY_GOAL) * 100));
    el.classList.remove('hidden');
    el.classList.toggle('xp-goal-done', xp >= XP_DAILY_GOAL);
    el.style.setProperty('--xp-pct', pct + '%');
    el.textContent = `⚡ ${xp}`;
  };
  if (typeof value === 'number') render(value);
  else localforage.getItem(xpKey()).then(xp => render(xp || 0)).catch(() => render(0));
}

function comboUp() {
  comboCount++;
  if (comboCount >= 3) {
    const bonus = comboCount * 5;
    toast(`🔥 ${comboCount}er-Combo! +${bonus} Bonus-XP`, 'success', 2800);
    addXP(bonus);
  }
}
function comboReset() { comboCount = 0; }

function confettiBurst() {
  const colors = ['#5856d6', '#007aff', '#34c759', '#ff9500', '#ff2d55', '#ffd60a'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti-wrap';
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.5) + 's';
    p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3200);
}

// ══ LERN-SESSION (Zeitbudget-Planer) ═══════════════════════════════════════
let currentSession = null;

const SESSION_SPECS = {
  '30m':        { topics: 1, quiz: 0, pauses: 0, label: '⚡ 30-Minuten-Session' },
  '1h':         { topics: 2, quiz: 3, pauses: 0, label: '⏱️ 1-Stunden-Session' },
  'halbtag':    { topics: 4, quiz: 5, pauses: 2, label: '🌤️ Halbtags-Session' },
  'wochenende': { topics: 6, quiz: 8, pauses: 3, label: '🏕️ Wochenend-Etappe' },
};

function sessionStoreKey() { return `lsession_${sessionId}`; }

async function buildSessionPlan(budget) {
  const spec = SESSION_SPECS[budget];
  const ms         = calculateMilestone();
  const activeIdx  = selectedDiffIdx !== null ? selectedDiffIdx : (ms.levelNum - 1);
  const activeLvl  = MILESTONE_LEVELS[activeIdx];
  const activeDiff = activeLvl.diff || 'einsteiger';
  const need = diffIdx(activeDiff);
  const isDone = t => topicMaxLevel(t) >= need;   // auf/über Niveau (Beherrschung impliziert tiefer)
  const isDue  = t => isDone(t) && topicReviewDue(t + '::' + activeDiff);
  const due  = scannedTopics.filter(isDue);
  const open = scannedTopics.filter(t => !isDone(t));
  const done = scannedTopics.filter(t => isDone(t) && !isDue(t));

  const items = [];
  let pausesLeft = spec.pauses;
  let topicCount = 0;
  const pushTopic = (t, icon) => {
    items.push({ type: 'topic', label: `${icon} ${t}`, target: t, done: false });
    topicCount++;
    if (pausesLeft > 0 && topicCount % 2 === 0 && topicCount < spec.topics) {
      items.push({ type: 'pause', label: '☕ Kurze Pause (10 Min)', done: false });
      pausesLeft--;
    }
  };
  // Reihenfolge nach Lernwirkung: fällige Wiederholungen (Spacing!) → neue Themen → Rest
  due.slice(0, Math.max(1, Math.floor(spec.topics / 2))).forEach(t => pushTopic(t, '🔄'));
  open.slice(0, spec.topics - topicCount).forEach(t => pushTopic(t, '📖'));
  if (topicCount < spec.topics) {
    done.slice(0, spec.topics - topicCount).forEach(t => pushTopic(t, '🔁'));
  }

  try {
    const cards = await DB.cards(sessionId);
    const due = cards.filter(c => c.due <= Date.now()).length;
    if (due > 0) items.push({ type: 'karten', label: `🃏 ${due} Karten wiederholen`, done: false });
  } catch (_) {}

  if (spec.quiz > 0) {
    items.push({ type: 'quiz', label: `❓ ${spec.quiz} Quiz-Fragen beantworten`, need: spec.quiz, got: 0, done: false });
  }

  // Dünner Plan abfedern: Hinweis, wenn es nichts NEUES auf diesem Level mehr gibt.
  let note = '';
  if (!open.length && scannedTopics.length) {
    const hasHigher = activeIdx < MILESTONE_LEVELS.length - 1;
    note = hasHigher
      ? `🎉 Du hast alle Themen auf <strong>${esc(activeLvl.name)}</strong> gelernt! Diese Session frischt Gelerntes auf – für neue Aufgaben erhöhe die Stufe im Lernpfad.`
      : `🏆 Stark – du hast alles auf der höchsten Stufe gelernt! Diese Session hält dein Wissen frisch.`;
  } else if (items.length <= 1) {
    note = `Kurzer Plan – es gibt gerade wenig zu tun. Scanne mehr Themen oder lege Karteikarten an, um die Sessions voller zu machen.`;
  }

  return { budget, label: spec.label, startedAt: new Date().toISOString(), items, note };
}

function saveSession() {
  if (!sessionId) return;
  if (currentSession) localforage.setItem(sessionStoreKey(), currentSession).catch(() => {});
  else localforage.removeItem(sessionStoreKey()).catch(() => {});
}

function sessionTick(kind, target) {
  if (!currentSession) return;
  let item = null;
  if (kind === 'topic')  item = currentSession.items.find(i => !i.done && i.type === 'topic' && i.target === target);
  if (kind === 'karten') item = currentSession.items.find(i => !i.done && i.type === 'karten');
  if (kind === 'quiz' || kind === 'quiz-complete') {
    item = currentSession.items.find(i => !i.done && i.type === 'quiz');
    if (item && kind === 'quiz') {
      item.got = (item.got || 0) + 1;
      if (item.got < item.need) { saveSession(); renderSessionBanner(); return; }
    }
  }
  if (!item) return;
  item.done = true;
  saveSession();
  renderSessionBanner();
  const left = currentSession.items.filter(i => !i.done).length;
  if (left > 0) toast(`✓ Session: noch ${left} Schritt${left === 1 ? '' : 'e'}`, 'success', 2000);
}

function renderSessionBanner() {
  const el = document.getElementById('session-banner');
  if (!el) return;
  if (!scannedTopics.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');

  if (!currentSession) {
    el.innerHTML = `<button class="btn-primary btn-sm" id="session-start-btn">▶️ Lern-Session starten</button>
      <span class="session-hint">Sag mir wie viel Zeit du hast – ich plane den Rest.</span>`;
    el.querySelector('#session-start-btn').addEventListener('click', () =>
      document.getElementById('session-sheet').classList.remove('hidden'));
    return;
  }

  const items = currentSession.items;
  const doneN = items.filter(i => i.done).length;
  const allDone = doneN === items.length;

  if (allDone) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(currentSession.startedAt)) / 60000));
    const topics = items.filter(i => i.type === 'topic').length;
    // Ausblick: nächstes offenes Thema als Köder für morgen
    const activeLvl  = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    const activeDiff = activeLvl.diff || 'einsteiger';
    const lSet = learnedKeySet();
    const next = pathTopics().find(t => !lSet.has(learnedKey(t, activeDiff)));
    el.innerHTML = `
      <div class="session-done-card">
        <div class="session-done-title">🎉 Session geschafft!</div>
        <div class="session-done-stats">${topics} Themen · ${items.length} Schritte · ${mins} Min</div>
        ${next ? `<div class="session-next-teaser">Als Nächstes wartet: <strong>${esc(next)}</strong></div>` : ''}
        <button class="btn-primary btn-sm" id="session-finish-btn">Abschließen</button>
      </div>`;
    el.querySelector('#session-finish-btn').addEventListener('click', () => {
      currentSession = null; saveSession(); renderSessionBanner();
      confettiBurst();
      addXP(100, 'Session abgeschlossen');
    });
    return;
  }

  const pct = Math.round((doneN / items.length) * 100);
  const rows = items.map((i, idx) => {
    const sub = i.type === 'quiz' && !i.done && i.got > 0 ? ` <span class="session-item-sub">${i.got}/${i.need}</span>` : '';
    return `<div class="session-item${i.done ? ' done' : ''}" data-idx="${idx}">
      <span class="session-item-check">${i.done ? '✅' : '○'}</span>
      <span class="session-item-label">${esc(i.label)}${sub}</span>
    </div>`;
  }).join('');
  el.innerHTML = `
    <div class="session-head">
      <span class="session-title">${currentSession.label}</span>
      <span class="session-count">${doneN}/${items.length}</span>
      <button class="session-abort" title="Session beenden">✕</button>
    </div>
    <div class="session-bar"><div class="session-bar-fill" style="width:${pct}%"></div></div>
    ${currentSession.note ? `<div class="session-note">${currentSession.note}</div>` : ''}
    <div class="session-items">${rows}</div>`;
  el.querySelector('.session-abort').addEventListener('click', async () => {
    if (!await confirmDialog('Deine geplante Lern-Session wird verworfen.',
        { title: 'Session beenden', okText: 'Beenden', danger: true })) return;
    currentSession = null; saveSession(); renderSessionBanner();
  });
  el.querySelectorAll('.session-item').forEach(row => row.addEventListener('click', () => {
    const item = currentSession.items[+row.dataset.idx];
    if (!item || item.done) return;
    if (item.type === 'topic')  openTopicView(item.target);
    if (item.type === 'karten') switchMode('karten');
    if (item.type === 'quiz')   switchMode('quiz');
    if (item.type === 'pause')  { item.done = true; saveSession(); renderSessionBanner(); }
  }));
}

document.querySelectorAll('.session-budget-btn').forEach(b => b.addEventListener('click', async () => {
  document.getElementById('session-sheet').classList.add('hidden');
  try {
    currentSession = await buildSessionPlan(b.dataset.budget);
    saveSession();
    renderSessionBanner();
    toast('Session geplant – tippe den ersten Schritt an!', 'success', 3000);
  } catch (e) {
    console.error('Session build failed:', e);
    toast('Fehler beim Planen der Session: ' + e.message, 'error');
  }
}));
document.getElementById('session-sheet-close')?.addEventListener('click', () =>
  document.getElementById('session-sheet').classList.add('hidden'));
document.getElementById('session-sheet')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('session-sheet').classList.add('hidden');
});

// ── Lernen canvas state ────────────────────────────────────────────────────
let lernenCtx       = null;
let isDrawingLernen = false;
let lernenLastX     = 0, lernenLastY = 0;
let lernenLastMidX  = 0, lernenLastMidY = 0; // letzter Kurven-Mittelpunkt (Glättung)
let lernenPtBuf     = [];           // gepufferte Punkte, einmal pro Frame gezeichnet (rAF)
let lernenRaf       = 0;            // laufende requestAnimationFrame-ID (0 = keine)
let lernenJumpSkips = 0;            // aufeinanderfolgend verworfene Ausreißer-Samples (Handballen-Sprung)
let lernenStrokes   = [];           // committete Striche (für geglättetes Redraw, #6)
let lernenCurStroke = null;         // gerade in Arbeit (phantom-gefilterte Stützpunkte)
let lernenPenColor  = '#1c1c1e';
let lernenTool      = 'pen';
let lernenStylusId  = null; // touch.identifier des aktuell zeichnenden Stifts (null = keiner)
let lernenFingerId  = null;         // touch.identifier des scrollenden Fingers
let lernenFingerY0  = 0;            // Start-Y des Finger-Scrolls
let lernenScroll0   = 0;            // scrollTop bei Scroll-Beginn
const LERNEN_HEIGHT = 2400;         // langer Notizblock (scrollbar), nicht nur bildschirmhoch
let lernenTopicData = null;
let lernenQaMsgs    = [];
let lernenAnswerMode = 'canvas'; // 'canvas' | 'text' — gesteuert nur, welcher Eingabebereich sichtbar ist
let lernenHasInk    = false;     // true sobald auf die Zeichenfläche geschrieben wurde (für kombinierte Prüfung)
let selectedDiffIdx   = null; // null = auto from progress, 0-4 = manual override
// Der Lernpfad zeigt nur die oberen drei Stufen (Lernender, Fortgeschritten,
// Experte). Die zwei Grundstufen (Einsteiger, Grundlagen) sind ausgeblendet – man
// steigt mit Vorwissen aus der Vorlesung auf Lernender ein, ein höher gemeistertes
// Thema deckt die Grundstufen automatisch ab.
const MS_BASIC_COUNT = 2;
let lernenCurrentDiff = 'einsteiger'; // diff key active when topic was opened
let lernenAttempts    = 0;            // reset per task, shown in success toast
let lernenLastEval    = null;         // letzte KI-Auswertung derselben Aufgabe (konsistente Re-Prüfung)
let lernenLastCheckSig   = '';        // Signatur (Aufgabe+Text+Tinte) der zuletzt geprüften Antwort → Re-Check ohne Änderung spart den API-Call
let lernenLastResultHtml = '';        // gerendertes Ergebnis-HTML, um es bei unverändertem Re-Check ohne API-Call wieder zu zeigen
let lernenLastResultClass = '';

// Bewertungsmaßstab/Strenge an das Niveau gekoppelt (Modul-Ebene, damit sowohl die
// Prüfung als auch der Musterlösungs-Prefetch dasselbe Niveau verwenden).
const LERN_GRADE_STD = {
  einsteiger: `NIVEAU EINSTEIGER: Bewerte das konzeptuelle Verständnis. Eigene Worte und Alltagssprache sind völlig in Ordnung – Fachbegriffe sind NICHT erforderlich, solange die Kernidee inhaltlich stimmt. Die Musterlösung ("loesung") ebenfalls in einfacher, zugänglicher Sprache schreiben.`,
  leicht: `NIVEAU GRUNDLAGEN: Eigene Worte sind in Ordnung. Grobe Begriffsverwechslungen zählen als Fehler, aber exakte Fachterminologie ist nicht nötig. Musterlösung in einfacher Sprache mit den wichtigsten Grundbegriffen.`,
  mittel: `NIVEAU LERNENDER: Die zentralen Fachbegriffe des Themas sollten korrekt verwendet werden. Kleinere sprachliche Ungenauigkeiten sind ok, wenn das Verständnis klar erkennbar ist. Musterlösung mit korrekten Fachbegriffen.`,
  schwer: `NIVEAU FORTGESCHRITTEN: Präzise Fachsprache wird erwartet. Fehlende oder falsch verwendete zentrale Fachbegriffe senken die Bewertung. Musterlösung in vollständiger Fachsprache.`,
  pruefungsnah: `NIVEAU PRÜFUNGSNAH: Klausurmaßstab. Exakte Fachterminologie, vollständige Begründungen und saubere Notation wie in einer Prüfung erforderlich – bewerte wie ein strenger Korrektor. Musterlösung als vollständige Klausur-Musterlösung.`,
};
const LERN_STRICTNESS = {
  einsteiger:   `Bewerte WOHLWOLLEND und ermutigend. Es geht um das grundsätzliche Verständnis, nicht um Perfektion. Im Zweifel zugunsten des Studenten entscheiden.`,
  leicht:       `Bewerte fair und eher wohlwollend. Kleinere Ungenauigkeiten nicht überbewerten.`,
  mittel:       `Bewerte fair und ausgewogen.`,
  schwer:       `Bewerte streng. Vollständigkeit und Genauigkeit zählen.`,
  pruefungsnah: `Bewerte SEHR STRENG nach Klausurmaßstab.`,
};

// Musterlösung-Prefetch: Die Lösung einer Aufgabe hängt NICHT von der Antwort des
// Studenten ab – sie kann also schon generiert werden, während er die Aufgabe noch
// bearbeitet. Beim "Prüfen" steht sie dann sofort bereit und die Bewertung wird
// kürzer (sie muss die Lösung nicht mehr selbst ausformulieren).
let lernenLoesung = null; // { aufgabe, promise, text } – text gesetzt sobald fertig

function prefetchLernenLoesung() {
  if (!lernenTopicData || !lernenTopicData.aufgabe) return;
  const aufgabe = lernenTopicData.aufgabe;
  if (lernenLoesung && lernenLoesung.aufgabe === aufgabe) return; // läuft schon / fertig
  const gradeNote = LERN_GRADE_STD[lernenCurrentDiff] || LERN_GRADE_STD.einsteiger;
  const sys = `Löse die folgende Übungsaufgabe vollständig und korrekt – AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen.
${gradeNote}
Gib NUR die Musterlösung zurück (Markdown-Fließtext, KEIN JSON, keine Einleitung, keine Anrede). Bei Teilaufgaben (a/b/c oder 1/2/3) bekommt JEDE Teilaufgabe einen eigenen Absatz, beginnend mit der Bezeichnung fett: **a)** ...
Bei Rechenaufgaben: rechne jeden Schritt sauber und nachvollziehbar vor.`;
  const entry = { aufgabe, promise: null, text: '' };
  entry.promise = (async () => {
    try {
      const r = await claudeLocalKb([{ role: 'user', content: `Aufgabe: ${aufgabe}` }], sys, 1500, aufgabe);
      const txt = (r || '').trim();
      if (lernenLoesung === entry) entry.text = txt; // nur cachen wenn noch aktuell
      return txt;
    } catch { return ''; }
  })();
  entry.promise.catch(() => {});
  lernenLoesung = entry;
}

// ── Spaced Review: Vergessenskurve für Lernpfad-Themen ─────────────────────
// topicMeta["Thema::diff"] = { ts: <zuletzt gelernt>, attempts: <Versuche bis korrekt> }
// Sicher gekonnt (1 Versuch) → nach 7 Tagen fällig; wacklig (≥2 Versuche) → nach 3 Tagen.
let topicMeta = {};

const REVIEW_AFTER_STRONG_MS = 7 * 86400000;
const REVIEW_AFTER_WEAK_MS   = 3 * 86400000;

// ── v98: Lern-Psychologie Extras ──────────────────────────────────────────
let quizConfidence  = 0;      // 1=unsicher, 2=eher sicher, 3=sehr sicher (0=nicht gesetzt)
let lastFbTopicName = '';     // Thema der letzten Quiz-Frage (für "Vertiefen")
let nextQ = null;             // Prefetch: { promise, forDone, forSession } – nächste Quiz-Frage vorab geladen
let interleavedMode = false;  // Lernpfad-Reihenfolge über Kapitel mischen

function topicReviewDue(key) {
  const m = topicMeta[normFullKey(key)];
  if (!m || !m.ts) return false; // ohne Metadaten (Altbestand) nie als fällig markieren
  const interval = (m.attempts || 1) >= 2 ? REVIEW_AFTER_WEAK_MS : REVIEW_AFTER_STRONG_MS;
  return Date.now() - m.ts >= interval;
}

function saveTopicMeta() {
  if (sessionId) localforage.setItem(`ltmeta_${sessionId}`, topicMeta).catch(() => {});
}

function openTopicView(topic) {
  openUnit({ kind: 'topic', themen: [topic], name: topic });
}

function openUnit(unit) {
  currentUnit = unit;
  const topic = unit.name;
  currentExplainerTopic = topic;
  lernenTopicData = null;
  lernenLoesung   = null; // Musterlösung-Prefetch des vorherigen Themas verwerfen
  lernenQaMsgs    = [];
  lernenAttempts  = 0;
  lernenLastEval  = null;
  lernenLastCheckSig = '';
  lernenLastResultHtml = '';
  lernenHasInk    = false;
  lernenStrokes   = []; lernenCurStroke = null;
  lernenCtx       = null;
  lernenStylusId  = null;
  isDrawingLernen = false;
  // Switch views
  document.getElementById('lernen-pfad-view').classList.add('hidden');
  document.getElementById('lernen-topic-view').style.display = 'flex';
  document.getElementById('lernen-topic-name').textContent = topic;
  document.getElementById('lernen-qa-title').textContent = 'Fragen zu: ' + topic;
  const badge = document.getElementById('lernen-diff-badge');
  {
    const l = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    lernenCurrentDiff = l.diff || 'einsteiger';
    if (badge) {
      badge.textContent = `${l.emoji} ${l.name}`;
      badge.className = `lernen-diff-badge lernen-diff-badge--${lernenCurrentDiff}`;
    }
  }
  document.getElementById('lernen-qa-msgs').innerHTML = '';
  const valuesEl = document.getElementById('lernen-task-values');
  if (valuesEl) { valuesEl.innerHTML = ''; valuesEl.classList.add('hidden'); }
  const resultBar = document.getElementById('lernen-result-bar');
  if (resultBar) { resultBar.innerHTML = ''; resultBar.className = 'lernen-result-bar hidden'; }
  const taReset = document.getElementById('lernen-text-answer');
  if (taReset) taReset.value = '';   // Antworttext des vorherigen Themas nicht mitschleppen
  lernenAnswerMode = 'canvas';
  document.getElementById('lernen-draw-tools').style.display = 'contents';
  document.getElementById('lernen-canvas-wrap').classList.remove('hidden');
  document.getElementById('lernen-text-wrap').classList.add('hidden');
  document.getElementById('lernen-mode-canvas').classList.add('active');
  document.getElementById('lernen-mode-text').classList.remove('active');
  document.getElementById('lernen-regen-btn').classList.add('hidden');
  // Reset step 1
  document.getElementById('lernen-erkl-loading').style.display = 'none';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-tab-aufgabe').disabled = true;
  document.getElementById('lernen-done-btn').classList.add('hidden');
  // Vorwissen-Abfrage entfernt – direkt zur Erklärung, egal ob neu, fällig oder Wiederholung.
  const isDue = unit.themen.some(t => topicReviewDue(t + '::' + lernenCurrentDiff));
  // Experte-Modus: Die Theorie "sitzt" – keine Erklärung generieren, den Erklär-Tab
  // ausblenden und direkt zur Klausuraufgabe (loadTopicContent delegiert dann an
  // loadExpertTask). Auf allen niedrigeren Stufen: normale Erklärung in Schritt 1.
  const isExpert = lernenCurrentDiff === 'pruefungsnah';
  document.getElementById('lernen-tab-erkl').classList.toggle('hidden', isExpert);
  if (isExpert) {
    lernenSwitchStep(2);
  } else {
    lernenSwitchStep(1);
    document.getElementById('lernen-erkl-loading').style.display = '';
  }
  loadTopicContent(topic, isDue);
}

function closeLernenTopic() {
  document.getElementById('lernen-pfad-view').classList.remove('hidden');
  document.getElementById('lernen-topic-view').style.display = 'none';
  lernenCtx = null;
}

function lernenSwitchStep(step) {
  document.querySelectorAll('.lernen-step-tab').forEach(t =>
    t.classList.toggle('active', +t.dataset.lstep === step));
  document.getElementById('lernen-step-1').classList.toggle('lernen-step-hidden', step !== 1);
  document.getElementById('lernen-step-2').classList.toggle('lernen-step-hidden', step !== 2);
  if (step === 2) requestAnimationFrame(initLernenCanvas);
}

// ── Lernen content cache (localforage / IndexedDB) ───────────────────────
function lernenCacheKey() {
  const diff = selectedDiffIdx !== null ? (MILESTONE_LEVELS[selectedDiffIdx].diff || 'einsteiger') : 'auto';
  // An die stabile Einheits-ID gekoppelt → Cache überlebt Umbenennen/Re-Scan und
  // trennt zusammengesetzte Einheiten sauber von Einzel-Themen.
  // Prefix-Bump lc2→lc3 (v239): alte gecachte Erklärungen entstanden mit dem
  // optionalen Grafik-Prompt (oft ganz ohne SVG) bzw. vor dem JSON-Konkatenations-
  // Fix – sie enthalten keine Diagramme. Neuer Prefix verwirft sie einmalig, sodass
  // beim nächsten Öffnen frisch (mit Pflicht-SVG) generiert wird.
  return `lc3_${sessionId}_${unitId(curUnit())}_${diff}`;
}

async function loadExamDocContext(subjId) {
  const examTypes = new Set(['klausur', 'altklausur', 'uebungsblatt']);
  const docLabel = d => {
    const found = DOC_TYPES.find(t => t.value === (d.doc_type || d.docType));
    return found ? found.label : (d.doc_type || d.docType || '');
  };
  try {
    const docs = await api(`/api/subjects/${subjId}/documents/typed?types=klausur,altklausur,uebungsblatt`);
    if (docs && docs.length) {
      return docs.map(d => `[${docLabel(d)}: ${d.filename}]\n${d.content}`).join('\n\n---\n\n');
    }
  } catch {}
  // Fallback: use localforage docmeta snippets
  try {
    const meta = (await localforage.getItem(`docmeta_${subjId}`).catch(() => null)) || [];
    const examDocs = meta.filter(m => examTypes.has(m.docType));
    if (examDocs.length) {
      return examDocs.map(d => `[${docLabel(d)}: ${d.name}]\n${d.snippet || ''}`).join('\n\n---\n\n');
    }
  } catch {}
  return '';
}

// ── Kanonische Diagramm-Vorlagen (v247) ──────────────────────────────────────
// Das Modell zeichnete Koordinaten-Diagramme (IS-LM etc.) freihändig und traf
// Schnittpunkt, Achsen-Ticks und Label-Ränder nicht konsistent (Punkt neben dem
// echten Kurvenschnitt, Schrift über Linien / außerhalb der Grafik, keine
// Verschiebung erklärt). Für die klassischen Standard-Modelle geben wir daher ein
// GEPRÜFTES, exakt ausgerichtetes SVG-Gerüst vor (Schnittpunkt algebraisch
// bestimmt, gestrichelte Projektionen + Achsen-Ticks darauf gesetzt, Verschiebung
// samt neuem Gleichgewicht vordefiniert). Das Modell tauscht nur Beschriftungen,
// erfindet keine Koordinaten mehr. viewBox 0 0 320 260, Plot-Box x∈[45,305] y∈[25,215].
const _DIAG_AX = `
  <line x1='45' y1='215' x2='305' y2='215' stroke='#333' stroke-width='1.5'/>
  <line x1='45' y1='215' x2='45' y2='25' stroke='#333' stroke-width='1.5'/>`;
const DIAGRAM_SCAFFOLDS = [
  { name: 'IS-LM', keys: ['is-lm','is/lm','islm','is lm','is–lm','gütermarkt','geldmarkt'],
    hint: 'IS fällt, LM steigt; Punkt A = simultanes Gleichgewicht (Y*, i*). Die gestrichelte IS\' zeigt eine Rechtsverschiebung (z.B. expansive Fiskalpolitik, G steigt) mit neuem Gleichgewicht B.',
    svg: `<svg viewBox='0 0 320 260' xmlns='http://www.w3.org/2000/svg'>${_DIAG_AX}
  <text x='302' y='234' font-size='11' text-anchor='end' fill='#333'>Y</text>
  <text x='33' y='34' font-size='11' fill='#333'>i</text>
  <line x1='70' y1='190' x2='270' y2='60' stroke='#1f77b4' stroke-width='2.5'/>
  <text x='274' y='62' font-size='11' fill='#1f77b4' font-weight='bold'>LM</text>
  <line x1='70' y1='60' x2='270' y2='190' stroke='#d62728' stroke-width='2.5'/>
  <text x='274' y='192' font-size='11' fill='#d62728' font-weight='bold'>IS</text>
  <line x1='110' y1='60' x2='300' y2='184' stroke='#d62728' stroke-width='1.8' stroke-dasharray='5,3'/>
  <text x='302' y='176' font-size='10' fill='#d62728' text-anchor='end'>IS'</text>
  <line x1='170' y1='125' x2='170' y2='215' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <line x1='45' y1='125' x2='170' y2='125' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <circle cx='170' cy='125' r='3.5' fill='#000'/>
  <text x='157' y='120' font-size='11' font-weight='bold'>A</text>
  <circle cx='190' cy='112' r='3.5' fill='#000'/>
  <text x='196' y='109' font-size='11' font-weight='bold'>B</text>
  <line x1='174' y1='122' x2='186' y2='114' stroke='#000' stroke-width='1.2'/>
  <polygon points='187,113 181,114 184,119' fill='#000'/>
  <text x='40' y='129' font-size='10' text-anchor='end'>i*</text>
  <text x='170' y='229' font-size='10' text-anchor='middle'>Y*</text>
</svg>` },
  { name: 'Angebot/Nachfrage', keys: ['angebot','nachfrage','marktgleichgewicht','marktdiagramm','angebot und nachfrage','angebots-','preisbildung'],
    hint: 'A = Angebot (steigend), N = Nachfrage (fallend); Punkt 1 = Marktgleichgewicht (P*, Q*). Die gestrichelte N\' zeigt eine Nachfrage-Rechtsverschiebung mit neuem Gleichgewicht 2 (P und Q steigen).',
    svg: `<svg viewBox='0 0 320 260' xmlns='http://www.w3.org/2000/svg'>${_DIAG_AX}
  <text x='302' y='234' font-size='11' text-anchor='end' fill='#333'>Menge</text>
  <text x='52' y='36' font-size='11' fill='#333'>Preis</text>
  <line x1='70' y1='190' x2='270' y2='60' stroke='#1f77b4' stroke-width='2.5'/>
  <text x='274' y='62' font-size='11' fill='#1f77b4' font-weight='bold'>A</text>
  <line x1='70' y1='60' x2='270' y2='190' stroke='#d62728' stroke-width='2.5'/>
  <text x='274' y='192' font-size='11' fill='#d62728' font-weight='bold'>N</text>
  <line x1='110' y1='60' x2='300' y2='184' stroke='#d62728' stroke-width='1.8' stroke-dasharray='5,3'/>
  <text x='302' y='176' font-size='10' fill='#d62728' text-anchor='end'>N'</text>
  <line x1='170' y1='125' x2='170' y2='215' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <line x1='45' y1='125' x2='170' y2='125' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <circle cx='170' cy='125' r='3.5' fill='#000'/>
  <text x='155' y='120' font-size='11' font-weight='bold'>1</text>
  <circle cx='190' cy='112' r='3.5' fill='#000'/>
  <text x='196' y='109' font-size='11' font-weight='bold'>2</text>
  <text x='40' y='129' font-size='10' text-anchor='end'>P*</text>
  <text x='170' y='229' font-size='10' text-anchor='middle'>Q*</text>
</svg>` },
  { name: 'Phillips-Kurve', keys: ['phillips'],
    hint: 'PC = kurzfristige Phillips-Kurve (fallend, Trade-off zwischen Inflation und Arbeitslosigkeit), LPC = langfristige Phillips-Kurve (senkrecht bei der natürlichen Arbeitslosenquote u_n). Punkt A liegt auf beiden.',
    svg: `<svg viewBox='0 0 320 260' xmlns='http://www.w3.org/2000/svg'>${_DIAG_AX}
  <text x='302' y='234' font-size='11' text-anchor='end' fill='#333'>u</text>
  <text x='24' y='34' font-size='11' fill='#333'>&#960;</text>
  <line x1='170' y1='40' x2='170' y2='215' stroke='#2ca02c' stroke-width='2' stroke-dasharray='6,3'/>
  <text x='176' y='48' font-size='10' fill='#2ca02c'>LPC</text>
  <line x1='70' y1='70' x2='270' y2='195' stroke='#d62728' stroke-width='2.5'/>
  <text x='256' y='188' font-size='11' fill='#d62728' font-weight='bold'>PC</text>
  <circle cx='170' cy='132.5' r='3.5' fill='#000'/>
  <text x='178' y='128' font-size='10'>A</text>
  <text x='170' y='229' font-size='10' text-anchor='middle'>u&#8345;</text>
</svg>` },
  { name: 'Indifferenzkurve/Budgetgerade', keys: ['indifferenz','budgetgerade','haushaltsoptimum','nutzenmaximierung','haushaltstheorie','budgetrestriktion'],
    hint: 'IK = Indifferenzkurve (fallend, konvex zum Ursprung), Budget = Budgetgerade. Das Haushaltsoptimum "opt" liegt dort, wo die Budgetgerade die höchste erreichbare Indifferenzkurve TANGIERT (nicht schneidet).',
    svg: `<svg viewBox='0 0 320 260' xmlns='http://www.w3.org/2000/svg'>${_DIAG_AX}
  <text x='302' y='234' font-size='11' text-anchor='end' fill='#333'>Gut X</text>
  <text x='50' y='36' font-size='11' fill='#333'>Gut Y</text>
  <line x1='60' y1='105' x2='194' y2='205' stroke='#1f77b4' stroke-width='2.5'/>
  <text x='150' y='196' font-size='10' fill='#1f77b4' text-anchor='end'>Budget</text>
  <path d='M 70 80 Q 100 175 240 190' fill='none' stroke='#d62728' stroke-width='2.5'/>
  <text x='244' y='190' font-size='10' fill='#d62728'>IK</text>
  <line x1='119' y1='149' x2='119' y2='215' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <line x1='45' y1='149' x2='119' y2='149' stroke='#888' stroke-width='1' stroke-dasharray='4,3'/>
  <circle cx='119' cy='149' r='3.5' fill='#000'/>
  <text x='125' y='145' font-size='10' font-weight='bold'>opt</text>
  <text x='119' y='229' font-size='10' text-anchor='middle'>X*</text>
  <text x='40' y='153' font-size='10' text-anchor='end'>Y*</text>
</svg>` },
];
function pickDiagramScaffold(query) {
  const q = String(query || '').toLowerCase();
  return DIAGRAM_SCAFFOLDS.find(d => d.keys.some(k => q.includes(k))) || null;
}
// Grafik-Anweisung für den Erklärungs-Prompt: entweder ein geprüftes Vorlage-
// Gerüst (Standard-Modell erkannt) ODER strenge Koordinaten-Regeln als Fallback.
// Immer inkl. Text↔Grafik-Kopplung + Pflicht zur Verschiebungs-Erklärung.
function buildGraphikBlock(query) {
  const koppel = `\n- TEXT ↔ GRAFIK (verbindlich, wenn eine Grafik vorhanden ist): Der Begleittext MUSS das Diagramm ABLESEN und DEUTEN, nicht nur erwähnen – benenne den markierten Punkt und was er bedeutet ("Punkt A markiert das Gleichgewicht (Y*, i*)"). Bei Modellen mit Verschiebung MUSST du erklären, WAS die Kurve verschiebt UND die Bewegung zum NEUEN Gleichgewicht in Worten nachzeichnen ("steigt die Staatsnachfrage G, verschiebt sich die IS-Kurve nach rechts zu IS'; das Gleichgewicht wandert von A nach B – Einkommen Y und Zins i steigen"). Der Text trägt die Deutung/das Warum, die Grafik die räumlichen Beziehungen – nicht doppelt beschreiben.`;
  const scaf = pickDiagramScaffold(query);
  if (scaf) {
    return `\n- PFLICHT-GRAFIK (${scaf.name}): Übernimm GENAU dieses geprüfte, bereits exakt ausgerichtete SVG-Gerüst UNVERÄNDERT in den Koordinaten (Schnittpunkt, Achsen-Ticks und Verschiebung passen millimetergenau). Ändere NUR Farben/Beschriftungstexte, falls die Vorlesungsnotation abweicht – verschiebe NIEMALS Koordinaten und erfinde KEINE eigenen. Platziere das SVG FRÜH im Feld "was". ${scaf.hint}\nSVG-GERÜST:\n${scaf.svg}${koppel}`;
  }
  return `\n- GRAFIK (nur wenn das Thema ein Standard-Koordinatenmodell besitzt, z.B. Funktionsgraph, Kräfte-/Phasendiagramm): Zeichne EIN kompaktes Inline-SVG (viewBox '0 0 320 260'). REGELN für exakte Ausrichtung – strikt befolgen: (1) Zeichne Kurven als GERADE <line>, nicht als Bézier – nur so ist der Schnittpunkt berechenbar. (2) Bestimme den Schnittpunkt der beiden Geraden ALGEBRAISCH und setze den Punkt, die gestrichelten Projektionslinien UND die Achsen-Ticks (z.B. i*, Y*) auf GENAU diese Koordinaten – kein Augenmaß. (3) Achsen bei x=45 (senkrecht) und y=215 (waagerecht); ALLE Beschriftungen müssen innerhalb x∈[45,305] und y∈[25,215] bleiben; Labels nahe dem rechten Rand mit text-anchor='end'; setze KEIN Textlabel auf eine Linie. (4) Ausschließlich EINFACHE Anführungszeichen im SVG (viewBox='…'), niemals doppelte. (5) Wenn das Modell eine Verschiebung kennt: zweite, gestrichelte Kurve + kleiner Pfeil + neues Gleichgewicht.${koppel}`;
}

function getDiffInstr(effLevel, examCtx, siblings = [], lernziel = '', isSolo = false) {
  const examSnippet = examCtx && examCtx.trim()
    ? `\n\nKLAUSUR-REFERENZ: Orientiere dich an Aufgabentyp, Stil und Komplexität folgender Prüfungsunterlagen. Mimiere deren Formulierungen, Notation und Schwierigkeitsgrad:\n${examCtx.slice(0, 8000)}`
    : '';
  // Auf hohem Niveau soll die Aufgabe NICHT bloß "härter" sein, sondern größer:
  // mehrere Themen des Kapitels in EINER mehrteiligen Klausuraufgabe integrieren.
  // Das spiegelt das Probeklausur-Format und behebt das "zu kleinteilig"-Gefühl.
  const sibTxt = siblings.length
    ? ` Verknüpfe es dabei mit verwandten Themen desselben Kapitels: ${siblings.slice(0, 4).join(', ')}.`
    : '';
  const zielTxt = lernziel ? ` Messlatte ist das Kapitel-Lernziel: "${lernziel}".` : '';
  // Klarheit ≠ Leichtigkeit: Die Schwierigkeit steckt im Denken, NICHT in
  // verklausulierter Sprache. Auf hoher Stufe formulierte das Modell bisher dicht,
  // nominalisiert und mit weggelassenen Bezügen ("Wörter aneinandergereiht") – die
  // Aufgabe versteckte, was sie verlangt. Diese Regel trennt beide Achsen: der
  // Inhalt bleibt anspruchsvoll (Methode weiterhin NICHT vorgesagt), aber der
  // Aufgabentext ist nach einmaligem Lesen eindeutig verständlich.
  const klar = ` KLARE FORMULIERUNG (verbindlich, unabhängig vom Niveau): Die Herausforderung liegt im LÖSEN der Aufgabe, niemals im Entschlüsseln der Frage. Formuliere jeden (Teil-)Auftrag in klaren, vollständigen Sätzen mit einem konkreten, greifbaren Szenario und einer eindeutigen Handlungsaufforderung ("Berechne …", "Bestimme …", "Erläutere …", "Begründe …", "Vergleiche …"). Sage klar, WELCHE Form/Art von Ergebnis erwartet wird (Zahl mit Einheit, Begründung in Sätzen, Vergleich, Skizze) – das verrät NICHT die Methode. Vermeide verschachtelte Schachtelsätze, gestapelten Nominalstil und weggelassene Bezugswörter. Wenn ein Fachbegriff nötig ist, verwende ihn korrekt, aber baue die Aufgabe nicht künstlich kompliziert im Ausdruck. Prüfe vor der Ausgabe: Wüsste ein/e Studierende/r nach EINMALIGEM Lesen genau, WAS zu tun ist? Wenn nein, formuliere klarer.`;
  // Aufgabenform folgt dem Thementyp, NICHT der Stufe: Viele Fächer (z.B. Marketing)
  // sind überwiegend konzeptuell – die echten Klausuren fragen "Erläutern/Definieren/
  // Vergleichen Sie …", nicht "Berechnen Sie". Das Modell neigte aber dazu, überall
  // Rechnungen zu erzwingen (die per-Stufe-Vorgaben "Rechenbeispiel/Rechenschritt"
  // wirkten wie Pflicht). Diese Regel gated Rechnen auf tatsächlich quantitative
  // Themen und macht die Schreib-/Verständnisaufgabe zum gleichberechtigten Normalfall.
  const modus = ` AUFGABENFORM RICHTET SICH NACH DEM THEMA (nicht nach der Stufe): Prüfe anhand der Unterlagen, ob das Thema tatsächlich quantitativ ist (Formeln, Kennzahlen, Rechengrößen – z.B. Deckungsbeitrag, Preiselastizität, Break-even, Zinsen, Statistik). NUR dann ist eine Rechenaufgabe angemessen. Für konzeptuelle/theoretische Themen (Definitionen, Modelle, Strategien, Zusammenhänge, Argumentation) stelle eine SCHREIB-/VERSTÄNDNISAUFGABE im Stil der echten Klausur ("Erläutern Sie …", "Definieren und veranschaulichen Sie …", "Vergleichen Sie …", "Diskutieren Sie …", "Begründen Sie …", "Nennen und erklären Sie …"). Erzwinge NIEMALS Zahlen oder Rechnungen, wo der Stoff keine hergibt – eine erfundene Rechnung ist ein Fehler. Richte dich danach, welche Aufgabenform die Unterlagen und Prüfungsaufgaben zu genau diesem Thema nahelegen.`;
  // Geschwister-Abgrenzung (nur für Einzel-Themen, NICHT für zusammengesetzte
  // Einheiten – dort SIND die Themen ja der Gegenstand). Ohne dieses Signal holten
  // zwei inhaltlich angrenzende Nachbarthemen dieselbe KB-Sektion und erzeugten
  // identische Erklärung + Aufgabe (z.B. "Fünf-Kräfte Modell Porter" tauchte auch
  // bei "Wettbewerbsanalyse Dimensionen" auf). Greift auf ALLEN Stufen.
  const abgrenzung = (isSolo && siblings.length)
    ? ` THEMEN-ABGRENZUNG (verbindlich): Dieses Thema ist Teil eines Kapitels mit weiteren, EIGENSTÄNDIGEN Nachbarthemen: ${siblings.slice(0, 5).join(', ')}. Behandle AUSSCHLIESSLICH den eigenen Kern DIESES Themas – breite den Stoff der Nachbarthemen weder in der Erklärung noch in der Aufgabe aus. Trägt ein Konzept den Namen eines Nachbarthemas (z.B. gibt es ein eigenes Nachbarthema "Fünf-Kräfte Modell Porter"), gehört seine ausführliche Behandlung DORTHIN – hier höchstens kurz nennen und klar abgrenzen. Zwei Nachbarthemen desselben Kapitels dürfen NIEMALS dieselbe Erklärung oder dieselbe Aufgabe ergeben.`
    : '';
  const integrate = `${sibTxt}${zielTxt} Baue eine MEHRTEILIGE Aufgabe (Teil a, b, c …), deren Teile aufeinander aufbauen (z.B. a) erklären/berechnen, b) anwenden, c) bewerten/diskutieren). Der Studierende muss SELBST erkennen, welche Methode/welches Konzept je Teil greift – nenne das NICHT vorab. NUR falls die Aufgabe überhaupt einen Rechen-Teil enthält UND ein späterer Teil (Interpretation, Diskussion, Begründung, ökonomische Einordnung) inhaltlich auf dessen ZAHLENERGEBNIS aufbaut, MUSS der Aufgabentext dieses Teils den Bezug auf die selbst berechneten Werte ausdrücklich verlangen (z.B. "Interpretiere dein in Teil a) berechnetes Ergebnis …") – es darf dann nicht offen bleiben, ob eine allgemeine oder zahlengestützte Antwort erwartet wird.${klar}`;
  switch (effLevel.diff) {
    case 'leicht':
      return `Niveau: GRUNDLAGEN (Stufe 2 von 5).
ERKLÄRUNG: Erkläre das Konzept von Grund auf. Kein Fachwissen voraussetzen. Nutze alltagsnahe Analogien. "Was ist das?" = intuitive Definition mit Alltagsbeispiel. "Warum wichtig?" = praktischer Nutzen in einfachen Worten. "Beispiel" = konkretes Beispiel. Rechenbeispiel: NUR wenn das Thema quantitativ ist, dann ein einziger einfacher Schritt mit kleinen Zahlen; sonst leer lassen.
AUFGABE: Eine sehr einfache Aufgabe. Bei quantitativen Themen ein Rechenschritt mit kleinen Zahlen, sonst eine kurze Verständnis-/Definitionsfrage.${modus}${abgrenzung}`;
    case 'mittel':
      return `Niveau: LERNENDER (Stufe 3 von 5).
ERKLÄRUNG: Erkläre das Konzept klar mit korrekten Fachbegriffen. "Was ist das?" = präzise Definition + Fachbegriff erläutern. "Warum wichtig?" = Relevanz im Fachkontext, nicht nur Alltag. "Beispiel" = realistisches Szenario. Rechenbeispiel: NUR bei quantitativen Themen, dann 2-3 Rechenschritte mit Zwischenergebnissen; sonst leer lassen.
AUFGABE: Mittelschwere Aufgabe mit realistischem Szenario. Bei quantitativen Themen 2-3 Rechenschritte, bei konzeptuellen Themen eine Erläuterungs-/Anwendungsfrage.${modus}${abgrenzung}`;
    case 'schwer':
      return `Niveau: FORTGESCHRITTEN (Stufe 4 von 5).
ERKLÄRUNG: Gehe in die Tiefe. "Was ist das?" = vollständige fachliche Definition inkl. Randfälle und Einschränkungen. "Warum wichtig?" = Verbindung zu anderen Konzepten, theoretischer Hintergrund. "Beispiel" = komplexes Praxisbeispiel mit mehreren Einflussgrößen. Rechenbeispiel: NUR bei quantitativen Themen, dann mehrstufig – zeige alle Zwischenschritte und erkläre WARUM jeder Schritt nötig ist; sonst leer lassen.
AUFGABE: Eine zusammengesetzte, klausurnahe Aufgabe.${integrate}${modus}${abgrenzung}${examSnippet}`;
    case 'pruefungsnah':
      return `Niveau: EXPERTE (Stufe 5 von 5).
ERKLÄRUNG: Prüfungsqualität. "Was ist das?" = exakte wissenschaftliche Definition wie in einem Lehrbuch. "Warum wichtig?" = theoretische Fundierung, Herleitung, Abgrenzung zu ähnlichen Konzepten. "Beispiel" = Fallstudie oder Prüfungsbeispiel mit vollständigem Lösungsweg. Rechenbeispiel: NUR bei quantitativen Themen, dann vollständig ausformuliert mit Formelangaben, Einheiten und Interpretation des Ergebnisses; sonst leer lassen.
AUFGABE: Eine vollständige Klausuraufgabe im Prüfungsformat mit Punkteangabe je Teil. Präzise Fachbegriffe wie in einer Prüfung – aber klar strukturiert und unmissverständlich, NICHT künstlich verschachtelt.${integrate}${modus}${abgrenzung}${examSnippet}`;
    default:
      return `Niveau: EINSTEIGER (Stufe 1 von 5).
ERKLÄRUNG: Erkläre als ob der Student das Thema noch nie gehört hat. Kein Vorwissen annehmen. Kurz, klar, mit einfachsten Worten. Rechenbeispiel nur wenn das Thema quantitativ ist und es unbedingt nötig ist, dann maximal ein Schritt.
AUFGABE: Sehr einfache Aufgabe, intuitiv lösbar.${modus}${abgrenzung}`;
  }
}

function renderTopicContent(topic, data) {
  document.getElementById('lernen-erkl-loading').style.display = 'none';
  const fmtMd   = s => safeHtml(md(s || ''));
  const section = (icon, label, cls, inner) =>
    `<div class="explainer-section${cls ? ' ' + cls : ''}">` +
      `<div class="explainer-label"><span class="explainer-licon">${icon}</span>${label}</div>` +
      inner +
    `</div>`;
  let html = `<div class="lernen-erkl-head">` +
    `<h2 class="lernen-erkl-title">📖 ${esc(topic)}</h2>` +
    `<button class="btn-reload-erkl" onclick="reloadLernenExplanation()" title="Erklärung frisch generieren – z.B. um neue Diagramme zu erhalten">🔄 Neu laden</button>` +
    `</div>`;
  if (data.was)    html += section('💡', 'Was ist das?',       '',                    `<div class="explainer-body">${fmtMd(data.was)}</div>`);
  if (data.warum)  html += section('🎯', 'Warum wichtig?',     '',                    `<div class="explainer-body">${fmtMd(data.warum)}</div>`);
  if (data.vertiefung && data.vertiefung.trim())
                   html += section('🔍', 'Vertiefung',         'explainer-section--deep', `<div class="explainer-body">${fmtMd(data.vertiefung)}</div>`);
  if (data.beispiel) html += section('📋', 'Konkretes Beispiel', '',                  `<div class="explainer-body">${fmtMd(data.beispiel)}</div>`);
  if (data.rechnung && data.rechnung.trim())
                   html += section('📐', 'Rechenbeispiel',     '',                    `<div class="explainer-rechnung">${fmtMd(data.rechnung)}</div>`);
  const body = document.getElementById('lernen-erkl-body');
  body.innerHTML = html;
  body.classList.remove('hidden');
  // Mermaid-Blöcke (Abläufe/Strukturen) im Erklärungstext rendern – md() hat sie
  // als <div class="mermaid"> platziert, ohne run() blieben sie roher Quelltext.
  const mEls = body.querySelectorAll('.mermaid');
  if (mEls.length && window.mermaid) mermaid.run({ nodes: mEls }).catch(() => {});

  document.getElementById('lernen-step1-footer').classList.remove('hidden');

  // Die "Aufgabe"-Tab ist IMMER anwählbar: Fehlt eine Aufgabe (Modell ließ "aufgabe"
  // weg oder das Erklärungs-JSON wurde am Token-Limit abgeschnitten), wird sie beim
  // Öffnen on-demand erzeugt (openLernenTask) – statt den Tab tot/disabled zu lassen.
  document.getElementById('lernen-tab-aufgabe').disabled = false;
  if (data.aufgabe && data.aufgabe.trim()) {
    document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(data.aufgabe));
    document.getElementById('lernen-regen-btn').classList.remove('hidden');
  } else {
    // Thema ohne Übungsaufgabe: direkt abhakbar.
    document.getElementById('lernen-done-btn').classList.remove('hidden');
  }
  const valuesEl = document.getElementById('lernen-task-values');
  if (valuesEl) {
    if (Array.isArray(data.werte) && data.werte.length > 0) {
      valuesEl.innerHTML = data.werte.map(v => `<span class="task-value-chip">${esc(v)}</span>`).join('');
      valuesEl.classList.remove('hidden');
    } else {
      valuesEl.innerHTML = '';
      valuesEl.classList.add('hidden');
    }
  }
}

// Experte-Modus-Pfad: Statt der vollen Erklärung wird NUR die Klausuraufgabe
// erzeugt (bzw. aus dem Cache geholt) und direkt Schritt 2 angezeigt. Die
// Aufgaben-Generierung selbst läuft über den bestehenden On-Demand-Pfad
// (regenLernenTask via openLernenTask), der auf 'pruefungsnah' bereits das
// Klausurformat + den Altklausur-Kontext (examDocContext) nutzt.
async function loadExpertTask(topic, forceFresh = false) {
  const bar = document.getElementById('lernen-task-bar');
  document.getElementById('lernen-tab-aufgabe').disabled = false;
  lernenSwitchStep(2);
  const cached = forceFresh ? null : await localforage.getItem(lernenCacheKey()).catch(() => null);
  // Stale guard: user may have navigated to a different topic while awaiting cache/AI
  if (currentExplainerTopic !== topic) return;
  if (cached && cached.aufgabe && cached.aufgabe.trim()) {
    lernenTopicData = cached;
    if (bar) bar.innerHTML = safeHtml(md(cached.aufgabe));
    const valuesEl = document.getElementById('lernen-task-values');
    if (valuesEl) {
      if (Array.isArray(cached.werte) && cached.werte.length > 0) {
        valuesEl.innerHTML = cached.werte.map(v => `<span class="task-value-chip">${esc(v)}</span>`).join('');
        valuesEl.classList.remove('hidden');
      } else { valuesEl.innerHTML = ''; valuesEl.classList.add('hidden'); }
    }
    document.getElementById('lernen-regen-btn').classList.remove('hidden');
    armLernenPrefetch();
    return;
  }
  // Noch nichts im Cache → frisch erzeugen. openLernenTask erwartet ein truthy
  // lernenTopicData, erzeugt die Aufgabe still (initial) und blendet den
  // Regen-Button ein; regenLernenTask cached das Ergebnis unter lernenCacheKey().
  lernenTopicData = {};
  await openLernenTask();
}

async function loadTopicContent(topic, forceFresh = false) {
  // Experte-Modus: Theorie "sitzt" → keine Erklärung, nur die Klausuraufgabe.
  const _lvl = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  if (_lvl.diff === 'pruefungsnah') { await loadExpertTask(topic, forceFresh); return; }
  // Serve from cache if available (außer bei fälliger Wiederholung → frische Aufgabe)
  const cached = forceFresh ? null : await localforage.getItem(lernenCacheKey()).catch(() => null);
  // Stale guard: user may have navigated to a different topic while awaiting cache/AI
  if (currentExplainerTopic !== topic) return;
  if (cached) {
    lernenTopicData = cached;
    renderTopicContent(topic, cached);
    armLernenPrefetch(); // Hebel 4: Musterlösung erst bei Aktivität vorbereiten
    return;
  }
  const stopProg = startProgress('lernen-prog-bar', 'lernen-prog-pct', 18000);
  const effLevel = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
  const useExam = effLevel.diff === 'schwer' || effLevel.diff === 'pruefungsnah';
  // Einheit bestimmt den Behandlungsgegenstand: ein Thema ODER ein zusammengesetzter
  // Satz (Cluster/Kapitel). Composite → die Member sind der Integrations-Satz.
  const unit = curUnit();
  const isComposite = unit.kind !== 'topic';
  // Geschwister IMMER mitgeben (nicht nur im Klausur-Pfad): sonst weiß das Modell auf
  // der Lern-Stufe nicht, dass ein benachbartes Thema eigenständig ist, und zwei
  // inhaltlich angrenzende Themen (z.B. "Fünf-Kräfte Modell Porter" und
  // "Wettbewerbsanalyse Dimensionen") holen dieselbe KB-Sektion → identische
  // Erklärung + Aufgabe. Die Abgrenzungs-Klausel (getDiffInstr) zieht die Grenze.
  const sibs = isComposite ? unit.themen : chapterSiblings(topic);
  const lernziel = unit.lernziel || chapterOf(unit.themen[0])?.lernziel || chapterOf(topic)?.lernziel || '';
  const subjectClause = isComposite
    ? `die folgenden zusammengehörenden Themen GEMEINSAM als EINE Lerneinheit: ${unit.themen.join(', ')}`
    : `das Thema "${topic}"`;
  const compositeNote = isComposite
    ? `\n- Dies ist EINE zusammengesetzte Einheit: gib eine kompakte gemeinsame Einordnung (nicht jedes Thema einzeln durchdeklinieren) und in "aufgabe" GENAU EINE integrierte, mehrteilige Aufgabe, die die Themen verbindet.\n- Baut ein Schreib-/Interpretationsteil auf dem Zahlenergebnis eines früheren Rechen-Teils auf, verlange im Aufgabentext ausdrücklich den Bezug auf die selbst berechneten Werte (z.B. "Interpretiere dein Ergebnis aus Teil a) …") – nicht offen lassen, ob allgemein oder zahlengestützt geantwortet werden soll.`
    : '';
  const diffInstr = getDiffInstr(effLevel, useExam ? examDocContext : '', sibs, lernziel, !isComposite);
  const kbQ = isComposite ? unit.themen.join(', ') : topic;
  const graphik = buildGraphikBlock(kbQ);
  const scope = lernenScope();
  await hydrateTaskHist(scope);   // Avoid-Liste der zuletzt gestellten Aufgaben laden
  try {
    const raw = await claudeLocalKb(
      [{ role: 'user', content: `Behandle ${subjectClause} auf dem vorgegebenen Niveau.` }],
      `Behandle ${subjectClause} AUSSCHLIESSLICH auf Basis der bereitgestellten Unterlagen.\n\n${diffInstr}\n\nWICHTIG:${compositeNote}\n- Das Niveau beeinflusst ALLE Felder – Tiefe, Sprache, Komplexität.\n- Für konzeptuelle/theoretische Themen (ohne viel Mathematik): schreibe ausführliche, lehrreiche Texte. Kein künstliches Kürzen – so lang wie nötig für echtes Verständnis.\n- "vertiefung": Nutze dieses Feld für Hintergründe, Zusammenhänge mit anderen Konzepten, häufige Missverständnisse, historische Einordnung – alles was hilft das Thema wirklich zu durchdringen. Leer lassen wenn kein Mehrwert.\n- "rechnung": Nur befüllen wenn das Thema tatsächlich Rechenoperationen beinhaltet. Sonst leer lassen.\n- "werte": Nur bei Rechenaufgaben – Array mit den wichtigsten Zahlenwerten aus der Aufgabe (z.B. ["500 € Startkapital","8 % Zinssatz p.a."]). Bei konzeptuellen Aufgaben ohne Zahlenwerte: leeres Array [].\n- "aufgabe": Übungsaufgabe passend zum Niveau. Bei mehreren Teilfragen jede Frage auf einer neuen Zeile (trenne mit \\n\\n). NIEMALS Lösungen, Musterlösungen, Hinweise auf die Antworten oder Lösungswege im Aufgabentext!${taskAvoidBlock(scope)}\n- ANSCHAULICHKEIT: Gestalte die Erklärung lebendig und einprägsam statt trocken. Nutze – aber NUR wo es das Verständnis wirklich fördert – passendes Anschauungsmaterial direkt in den Feldern "was", "vertiefung", "beispiel" oder "rechnung". Werkzeugkasten:\\n  • Bildhafte Analogien, Vergleiche und Eselsbrücken im Text (kurz und treffend).\\n  • Markdown-Vergleichstabellen (| Spalte | Spalte |) für Gegenüberstellungen, Vor-/Nachteile, Klassifikationen, Abgrenzungen.\\n  • Mermaid-Diagramme in \`\`\`mermaid … \`\`\`-Blöcken für Abläufe, Strukturen und Zusammenhänge: flowchart TD (Prozesse/Entscheidungen), mindmap (Konzept-Übersicht), sequenceDiagram (Interaktionen). Max. 8 Knoten, Labels KURZ und OHNE doppelte Anführungszeichen.\\n  ${graphik}\n\nAntworte NUR als JSON-Objekt (kein Text davor/danach, keine Zeilenumbrüche im JSON außer \\n in Texten):\n{"was":"Vollständige Erklärung des Konzepts – so ausführlich wie nötig","warum":"Bedeutung und Relevanz – ausführlich begründet","vertiefung":"Vertiefung: Hintergründe, Zusammenhänge, Besonderheiten (leer lassen wenn nicht hilfreich)","beispiel":"Konkretes Praxisbeispiel passend zum Niveau","rechnung":"Schritt-für-Schritt Rechenbeispiel (nutze \\n zwischen Schritten). Leer lassen wenn kein Rechnen nötig.","aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile.","werte":[]}`,
      // Budget großzügig: eine ausführliche Erklärung MIT Inline-SVG (Diagramme
      // sind token-schwer) sprengte 6144/8192 → JSON-Abbruch mitten im SVG →
      // salvageTruncatedJson verwarf die Grafik. Haiku 4.5 kann bis 64k ausgeben;
      // 12000 lässt genug Luft für Erklärung + Diagramm ohne Truncation.
      12000,
      kbQ
    );
    // Stale guard: discard if user opened a different topic while AI was running
    if (currentExplainerTopic !== topic) { stopProg(); return; }
    // Robustes Parsing wie in den übrigen JSON-Pfaden: Code-Fences, literale
    // Zeilenumbrüche in Strings UND am Token-Limit abgeschnittenes JSON werden
    // gerettet (parseJsonResponse → salvageTruncatedJson). Das frühere reine
    // parseJsonLoose scheiterte hier sporadisch → "Keine Erklärung erhalten".
    const data = parseJsonResponse(raw);
    if (!data) {
      // parseJsonResponse liefert nur dann null, wenn die (200-er) Modell-Antwort
      // gar kein rettbares JSON enthielt. Zwei Fälle:
      // (a) Das Modell hat in KLARTEXT geantwortet statt JSON – meist eine
      //     hilfreiche Begründung ("die Unterlagen zu diesem Thema sind nicht
      //     lesbar, lade sie als echtes PDF hoch"). Diese Botschaft dem Nutzer
      //     ZEIGEN, statt sie hinter "Keine Erklärung erhalten" zu verstecken.
      // (b) JSON technisch zerschossen (z.B. SVG mit doppelten Anführungszeichen).
      const prose = String(raw || '').replace(/```[a-z]*|```/gi, '').trim();
      console.error('[loadTopicContent] Erklärung nicht parsebar – Rohantwort (gekürzt):',
        prose.slice(0, 2000) || '(leer)');
      if (prose.length > 40 && !/[{}]/.test(prose.slice(0, 60))) {
        // Sieht nach echtem Fließtext aus (kein abgehacktes JSON) → als Hinweis rendern.
        stopProg();
        document.getElementById('lernen-erkl-loading').style.display = 'none';
        const b = document.getElementById('lernen-erkl-body');
        b.innerHTML = `<div class="lernen-result-text" style="padding:16px">${safeHtml(md(prose))}</div>
          <div style="padding:0 16px 16px"><button class="btn-secondary" onclick="retryLernenTopic()">🔄 Erneut versuchen</button></div>`;
        b.classList.remove('hidden');
        return;
      }
      throw new Error('Keine Erklärung erhalten');
    }
    lernenTopicData = data;
    if (data.aufgabe) rememberTask(scope, data.aufgabe);   // in Historie → künftige Aufgaben vermeiden Wiederholung
    // Abgehackte Erklärung (Token-Limit) NICHT dauerhaft cachen – sonst bleibt sie
    // für immer kaputt. Beim nächsten Öffnen wird dann frisch (vollständig) geladen.
    if (!jsonWasTruncated(raw)) localforage.setItem(lernenCacheKey(), data).catch(() => {});
    stopProg();
    renderTopicContent(topic, data);
    armLernenPrefetch(); // Hebel 4: Musterlösung erst bei Aktivität vorbereiten
  } catch (e) {
    // Stale guard: don't show error for a topic the user already navigated away from
    if (currentExplainerTopic !== topic) { stopProg(); return; }
    stopProg();
    document.getElementById('lernen-erkl-loading').style.display = 'none';
    const body = document.getElementById('lernen-erkl-body');
    body.innerHTML = `<p style="color:var(--red);padding:16px;margin:0">⚠️ ${esc(e.message)}</p>
      <div style="padding:8px 16px 16px">
        <button class="btn-secondary" onclick="retryLernenTopic()">🔄 Erneut versuchen</button>
      </div>`;
    body.classList.remove('hidden');
  }
}

function retryLernenTopic() {
  const topic = currentExplainerTopic;
  if (!topic) return;
  document.getElementById('lernen-erkl-loading').style.display = '';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-done-btn').classList.add('hidden');
  loadTopicContent(topic);
}

// Erklärung bewusst frisch generieren (forceFresh → Cache umgehen). Nötig, weil
// bereits gecachte Erklärungen ohne die neueren Inline-Diagramme vorliegen können.
function reloadLernenExplanation() {
  const topic = currentExplainerTopic;
  if (!topic) return;
  document.getElementById('lernen-erkl-loading').style.display = '';
  document.getElementById('lernen-erkl-body').classList.add('hidden');
  document.getElementById('lernen-step1-footer').classList.add('hidden');
  document.getElementById('lernen-done-btn').classList.add('hidden');
  loadTopicContent(topic, true);
}

// initial=true: stille On-Demand-Erzeugung beim Öffnen der Aufgabe (kein Regen-Button,
// keine Toasts). Liefert true/false zurück, damit openLernenTask reagieren kann.
async function regenLernenTask(opts = {}) {
  const initial = opts.initial === true;
  const topic = currentExplainerTopic;
  if (!topic || !lernenTopicData) return false;
  const btn = document.getElementById('lernen-regen-btn');
  if (!initial && btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const effLevel = selectedDiffIdx !== null ? MILESTONE_LEVELS[selectedDiffIdx] : calculateMilestone();
    const useExam = effLevel.diff === 'schwer' || effLevel.diff === 'pruefungsnah';
    const unit = curUnit();
    const isComposite = unit.kind !== 'topic';
    const sibs = isComposite ? unit.themen : chapterSiblings(topic);
    const lernziel = unit.lernziel || chapterOf(unit.themen[0])?.lernziel || chapterOf(topic)?.lernziel || '';
    const gegenstand = isComposite ? `zur Einheit "${topic}" (Themen: ${unit.themen.join(', ')})` : `zum Thema "${topic}"`;
    const diffInstr = getDiffInstr(effLevel, useExam ? examDocContext : '', sibs, lernziel, !isComposite);
    const kbQ = isComposite ? unit.themen.join(', ') : topic;
    const scope = lernenScope();
    await hydrateTaskHist(scope);   // Avoid-Liste der zuletzt gestellten Aufgaben laden
    const raw = await claudeLocalKb(
      [{ role: 'user', content: `Generiere eine neue Übungsaufgabe ${gegenstand}.` }],
      `Generiere eine NEUE, andere Übungsaufgabe ${gegenstand} – ausschließlich auf Basis der bereitgestellten Unterlagen.\n${diffInstr}\n\nDie Aufgabe muss dem Niveau entsprechen (Komplexität, Sprache, Tiefe).\nBei mehreren Teilfragen jede Frage auf einer neuen Zeile (\\n\\n).\nNIEMALS Lösungen, Musterlösungen oder Hinweise auf die richtigen Antworten im Aufgabentext!${taskAvoidBlock(scope)}\n\nAntworte NUR als JSON:\n{"aufgabe":"Aufgabentext ohne Lösungen. Jede Teilfrage auf eigener Zeile."}`,
      600,
      kbQ
    );
    const m = raw.match(/\{[\s\S]*\}/);
    let newAufgabe = null;
    if (m) { try { newAufgabe = parseJsonLoose(m[0]).aufgabe; } catch {} }
    if (newAufgabe && newAufgabe.trim()) {
      rememberTask(scope, newAufgabe);   // in Historie → nächste Regen vermeidet sie
      lernenTopicData.aufgabe = newAufgabe;
      document.getElementById('lernen-task-bar').innerHTML = safeHtml(md(newAufgabe));
      localforage.setItem(lernenCacheKey(), lernenTopicData).catch(() => {});
      // Clear canvas and textarea for fresh start
      if (lernenCtx) {
        lernenCtx.globalCompositeOperation = 'source-over';
        lernenCtx.clearRect(0, 0, document.getElementById('lernen-canvas-wrap').clientWidth, LERNEN_HEIGHT);
      }
      lernenHasInk = false;
      lernenStrokes = []; lernenCurStroke = null;
      const ta = document.getElementById('lernen-text-answer');
      if (ta) ta.value = '';
      document.getElementById('lernen-done-btn').classList.add('hidden');
      const rb = document.getElementById('lernen-result-bar');
      if (rb) { rb.innerHTML = ''; rb.className = 'lernen-result-bar hidden'; }
      lernenAttempts = 0;
      lernenLastEval = null;
      lernenLastCheckSig = '';
      lernenLastResultHtml = '';
      lernenLoesung = null;        // alte Musterlösung verwerfen
      armLernenPrefetch();         // Hebel 4: erst bei Aktivität vorbereiten
      if (!initial) toast('Neue Aufgabe generiert', 'success', 2000);
      return true;
    } else {
      if (!initial) toast('Keine neue Aufgabe erhalten', 'warn');
      return false;
    }
  } catch (e) {
    if (!initial) toast('Fehler: ' + e.message, 'error');
    return false;
  } finally {
    if (!initial && btn) { btn.disabled = false; btn.innerHTML = '🔄 Neue Aufgabe'; }
  }
}

// "Aufgabe"-Tab öffnen: ist noch keine Aufgabe vorhanden, jetzt eine erzeugen, damit
// der Tab nie wirkungslos bleibt (Bugfix: "auf Aufgabe klicken passiert nichts").
async function openLernenTask() {
  if (!lernenTopicData) { lernenSwitchStep(2); return; }
  lernenSwitchStep(2);
  if (lernenTopicData.aufgabe && lernenTopicData.aufgabe.trim()) return;
  const bar = document.getElementById('lernen-task-bar');
  if (bar) bar.innerHTML = '<span class="lernen-task-generating">⏳ Aufgabe wird erstellt…</span>';
  const ok = await regenLernenTask({ initial: true });
  if (ok) {
    document.getElementById('lernen-regen-btn')?.classList.remove('hidden');
  } else if (bar) {
    bar.innerHTML = '⚠️ Aufgabe konnte nicht erstellt werden. ' +
      '<button class="btn-secondary btn-sm" onclick="openLernenTask()">🔄 Erneut versuchen</button>';
  }
}

function retryLernenSameTask() {
  if (lernenCtx) {
    const wrap = document.getElementById('lernen-canvas-wrap');
    lernenCtx.globalCompositeOperation = 'source-over';
    lernenCtx.clearRect(0, 0, wrap.clientWidth, LERNEN_HEIGHT);
  }
  const ta = document.getElementById('lernen-text-answer');
  if (ta) ta.value = '';
  lernenHasInk = false;
  lernenStrokes = []; lernenCurStroke = null;
  const rb = document.getElementById('lernen-result-bar');
  if (rb) { rb.innerHTML = ''; rb.className = 'lernen-result-bar hidden'; }
}

function initLernenCanvas() {
  const canvas = document.getElementById('lernen-canvas');
  const wrap   = document.getElementById('lernen-canvas-wrap');
  if (!canvas || !wrap || lernenCtx) return;
  const dpr = window.devicePixelRatio || 1;
  const w   = wrap.clientWidth  || 800;
  const h   = LERNEN_HEIGHT;               // fester, langer Notizblock → scrollbar
  canvas.style.height = h + 'px';
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  lernenCtx = canvas.getContext('2d');
  lernenCtx.scale(dpr, dpr);
  // Bitmap bleibt transparent (nur Tinte); Weiß + Raster kommen aus dem CSS-Hintergrund.
  lernenCtx.lineCap  = 'round';
  lernenCtx.lineJoin = 'round';
  // Touch (iPad): NUR der Stift (touchType==='stylus') zeichnet, Finger/Handfläche scrollen
  // bzw. werden ignoriert – siehe Rechnen-Canvas. Maus für Desktop. Alte Listener zuerst
  // entfernen (initLernenCanvas läuft beim Themenwechsel erneut, lernenCtx wird zurückgesetzt);
  // gleiche Fn-Referenz ⇒ keine Mehrfach-Listener.
  canvas.removeEventListener('touchstart',  onLernenTouchStart);
  canvas.removeEventListener('touchmove',   onLernenTouchMove);
  canvas.removeEventListener('touchend',    onLernenTouchEnd);
  canvas.removeEventListener('touchcancel', onLernenTouchEnd);
  canvas.removeEventListener('mousedown',   onLernenMouseDown);
  canvas.addEventListener('touchstart',  onLernenTouchStart, { passive: false });
  canvas.addEventListener('touchmove',   onLernenTouchMove,  { passive: false });
  canvas.addEventListener('touchend',    onLernenTouchEnd);
  canvas.addEventListener('touchcancel', onLernenTouchEnd);
  canvas.addEventListener('mousedown',   onLernenMouseDown);
  // Maus-Move/Up auf window (Strich soll auch außerhalb des Canvas enden). Gleiche
  // Fn-Referenz ⇒ addEventListener entdoppelt über Themenwechsel hinweg.
  window.addEventListener('mousemove', onLernenMouseMove);
  window.addEventListener('mouseup',   onLernenMouseUp);
}

// Convert a pointer event to canvas context coordinates.
// Accounts for any mismatch between the canvas buffer size and its CSS display
// size (e.g. when the task-bar is resized after the canvas was initialised).
function lernenPos(e, canvas, r) {
  const dpr = window.devicePixelRatio || 1;
  const sx = canvas.width  / (r.width  * dpr);
  const sy = canvas.height / (r.height * dpr);
  return {
    x: (e.clientX - r.left) * sx,
    y: (e.clientY - r.top)  * sy,
  };
}

// Kern-Strich-Logik (geräteunabhängig, bekommt CSS-Pixel-Koordinaten).
function lernenBegin(canvas, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const p = lernenPos({ clientX, clientY }, canvas, r);
  lernenLastX = p.x; lernenLastY = p.y;
  lernenLastMidX = p.x; lernenLastMidY = p.y;     // Glättung: Startpunkt = erster Mittelpunkt
  lernenPtBuf = [];
  lernenJumpSkips = 0;
  // Verwaisten Strich sichern (verschlucktes touchend), dann neuen Strich beginnen.
  if (lernenCurStroke && lernenCurStroke.pts.length > 1) lernenStrokes.push(lernenCurStroke);
  lernenCurStroke = { tool: lernenTool, color: lernenPenColor, pts: [{ x: p.x, y: p.y }] };
  if (lernenRaf) { cancelAnimationFrame(lernenRaf); lernenRaf = 0; }
  lastInkTs = Date.now();
  isDrawingLernen = true;
}

function lernenMove(canvas, clientX, clientY) {
  if (!isDrawingLernen || !lernenCtx) return;
  const r = canvas.getBoundingClientRect();
  const { x, y } = lernenPos({ clientX, clientY }, canvas, r);
  lernenPtBuf.push({ x, y });
  if (!lernenRaf) lernenRaf = requestAnimationFrame(flushLernenBuf);
}

function lernenFinish() {
  if (!isDrawingLernen) return;
  if (lernenRaf) { cancelAnimationFrame(lernenRaf); lernenRaf = 0; }
  flushLernenBuf();                 // gepufferte Restpunkte sofort zeichnen
  if (lernenCurStroke) {
    if (lernenCurStroke.pts.length > 1) { lernenStrokes.push(lernenCurStroke); redrawLernen(); }
    lernenCurStroke = null;         // Einzel-Tap (1 Punkt) verwerfen: nichts gezeichnet
  }
  lastInkTs = Date.now();
  isDrawingLernen = false;
}

// Gepufferte Punkte einmal pro Frame zeichnen (rAF) mit Kurven-Glättung – analog
// zum Rechnen-Canvas: quadratische Bézier durch die Mittelpunkte statt Geraden.
function flushLernenBuf() {
  lernenRaf = 0;
  if (!lernenCtx || !lernenPtBuf.length) return;
  lernenCtx.lineCap = 'round'; lernenCtx.lineJoin = 'round';
  if (lernenTool === 'eraser') {
    lernenCtx.globalCompositeOperation = 'destination-out';
    lernenCtx.lineWidth = 22;
  } else {
    lernenCtx.globalCompositeOperation = 'source-over';
    lernenCtx.strokeStyle = lernenPenColor;
    lernenCtx.lineWidth = 2.5;
    lernenHasInk = true;
  }
  const buf = lernenPtBuf; lernenPtBuf = [];
  for (const pt of buf) {
    // Handballen-Phantom-Schutz (analog zum Rechnen-Canvas, flushCanvasBuf): ein
    // Sample, das weiter als CANVAS_MAX_STEP vom Anker springt, wird verworfen,
    // ohne den Anker zu bewegen; nach CANVAS_MAX_SKIPS in Folge zwangs-resynct,
    // damit ein echter schneller Zug nicht dauerhaft abreißt.
    const dx = pt.x - lernenLastX, dy = pt.y - lernenLastY;
    if (lernenJumpSkips < CANVAS_MAX_SKIPS && dx * dx + dy * dy > CANVAS_MAX_STEP * CANVAS_MAX_STEP) {
      lernenJumpSkips++;
      continue;
    }
    lernenJumpSkips = 0;
    const midX = (lernenLastX + pt.x) / 2, midY = (lernenLastY + pt.y) / 2;
    lernenCtx.beginPath();
    lernenCtx.moveTo(lernenLastMidX, lernenLastMidY);
    lernenCtx.quadraticCurveTo(lernenLastX, lernenLastY, midX, midY);
    lernenCtx.stroke();
    lernenLastMidX = midX; lernenLastMidY = midY;
    lernenLastX = pt.x; lernenLastY = pt.y;
    if (lernenCurStroke) lernenCurStroke.pts.push({ x: pt.x, y: pt.y });
  }
}

// Lernen-Canvas komplett aus den committeten Strichen neu zeichnen – jeder Strich
// Catmull-Rom-geglättet (#6). Ersetzt die eckige inkrementelle Live-Vorschau (und
// das, was die Vision-Prüfung als Bitmap liest). Lernen hält – anders als Rechnen –
// kein Hintergrundbild, daher genügt clear + alle Striche.
function redrawLernen() {
  if (!lernenCtx) return;
  const wrap = document.getElementById('lernen-canvas-wrap');
  const w = wrap ? wrap.clientWidth : lernenCtx.canvas.width;
  lernenCtx.globalCompositeOperation = 'source-over';
  lernenCtx.clearRect(0, 0, w, LERNEN_HEIGHT);
  let inked = false;
  for (const s of lernenStrokes) { drawLernenStroke(s); if (s.tool !== 'eraser') inked = true; }
  lernenCtx.globalCompositeOperation = 'source-over';
  lernenHasInk = inked;
}

function drawLernenStroke(s) {
  const pts = catmullRomPts(s.pts);
  if (pts.length < 2) return;
  lernenCtx.lineCap = 'round'; lernenCtx.lineJoin = 'round';
  if (s.tool === 'eraser') {
    lernenCtx.globalCompositeOperation = 'destination-out';
    lernenCtx.lineWidth = 22;
  } else {
    lernenCtx.globalCompositeOperation = 'source-over';
    lernenCtx.strokeStyle = s.color;
    lernenCtx.lineWidth = 2.5;
  }
  let lx = pts[0].x, ly = pts[0].y, lmx = pts[0].x, lmy = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const mx = (lx + pts[i].x) / 2, my = (ly + pts[i].y) / 2;
    lernenCtx.beginPath();
    lernenCtx.moveTo(lmx, lmy);
    lernenCtx.quadraticCurveTo(lx, ly, mx, my);
    lernenCtx.stroke();
    lmx = mx; lmy = my; lx = pts[i].x; ly = pts[i].y;
  }
  lernenCtx.globalCompositeOperation = 'source-over';
}

// ── Touch (iPad): NUR der Apple Pencil (touchType==='stylus') zeichnet; ein Finger scrollt
//    den Notizblock; die Handfläche wird ignoriert. Spiegelbildlich zum Rechnen-Canvas. ──
function lernenStylusOf(list) { for (const t of list) if (t.touchType === 'stylus') return t; return null; }

function onLernenTouchStart(e) {
  const canvas = e.currentTarget;
  const wrap   = document.getElementById('lernen-canvas-wrap');
  const st = lernenStylusOf(e.touches);
  if (st) {
    e.preventDefault();                 // unterdrückt zugleich synthetische Maus-Events
    lernenFingerId = null;              // Stift gewinnt gegen laufenden Finger-Scroll
    // Nur ein NEU aufgesetzter Stift (in changedTouches) startet einen Strich – nie auf
    // einem hängenden lernenStylusId abblocken (sonst werden Folgestriche verschluckt).
    const fresh = lernenStylusOf(e.changedTouches);
    if (fresh) {
      lernenStylusId = fresh.identifier;
      clearTextSelection();
      lernenBegin(canvas, fresh.clientX, fresh.clientY);
    }
    return;
  }
  // Kein Stift → erster Finger scrollt den Notizblock (JS-Scroll, da touch-action:none).
  e.preventDefault();
  if (lernenStylusId !== null) { lernenFinish(); lernenStylusId = null; }  // offenen Strich schließen (Stift-touchend verschluckt)
  const f = e.changedTouches[0];
  lernenFingerId = f.identifier;
  lernenFingerY0 = f.clientY;
  lernenScroll0  = wrap.scrollTop;
}

function onLernenTouchMove(e) {
  // Stift-Position IMMER frisch über touchType==='stylus' bestimmen, nie über gespeicherte
  // identifier – iPadOS recycelt sie, sonst zeichnet ein Finger/Handballen mit der alten Id
  // weiter (Strich quer von Stift zu Handballen). Siehe Rechnen-Canvas.
  const st = lernenStylusOf(e.touches);
  if (st) {
    e.preventDefault();                 // während des Schreibens ALLE Touches (auch Handfläche) blocken
    if (lernenStylusId !== null) lernenMove(e.currentTarget, st.clientX, st.clientY);
    return;
  }
  if (lernenStylusId !== null) { lernenFinish(); lernenStylusId = null; }  // Stift abgehoben → Strich schließen
  for (const t of e.changedTouches) {
    if (t.identifier === lernenFingerId) {
      e.preventDefault();
      document.getElementById('lernen-canvas-wrap').scrollTop = lernenScroll0 + (lernenFingerY0 - t.clientY);
      break;
    }
  }
}

function onLernenTouchEnd(e) {
  // Strich beenden, sobald kein Stift mehr aufliegt – unabhängig von der end-identifier.
  if (lernenStylusId !== null && !lernenStylusOf(e.touches)) { lernenFinish(); lernenStylusId = null; }
  for (const t of e.changedTouches) {
    if (t.identifier === lernenFingerId) lernenFingerId = null;
  }
}

// Maus (Desktop): synthetische Maus-Events vom Touch sind per preventDefault unterdrückt.
// lernenMouseDrawing stellt sicher, dass window-mousemove/up nur auf einen echten,
// am Canvas begonnenen Maus-Zug reagieren (kein Phantom-Strich aus verirrtem mousemove).
let lernenMouseDrawing = false;
function onLernenMouseDown(e) {
  if (e.button !== 0 || lernenStylusId !== null) return;
  lernenMouseDrawing = true;
  clearTextSelection();
  lernenBegin(e.currentTarget, e.clientX, e.clientY);
}
function onLernenMouseMove(e) { if (lernenMouseDrawing) lernenMove(document.getElementById('lernen-canvas'), e.clientX, e.clientY); }
function onLernenMouseUp(e)   { if (lernenMouseDrawing) { lernenMouseDrawing = false; lernenFinish(); } }

// ── Sicherer Ausdrucks-Evaluator für die deterministische Rechen-Prüfung (#4) ──
// Kein eval(): Tokenizer → Shunting-Yard → RPN. Erlaubt Zahlen (auch deutsches
// Komma/Tausenderpunkt), + - * / ^ %, Klammern und Wurzel. NaN bei Unbekanntem.
function parseNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  const m = String(v).match(/-?\d[\d.\s]*(?:,\d+)?|-?\d+(?:\.\d+)?/);
  if (!m) return NaN;
  let t = m[0].replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  return parseFloat(t);
}
function evalExpr(expr) {
  if (expr == null) return NaN;
  let s = String(expr).toLowerCase()
    .replace(/wurzel|sqrt|√/g, ' sqrt ').replace(/hoch/g, '^')
    .replace(/·|×/g, '*').replace(/÷|:/g, '/');
  s = s.replace(/(\d)\.(?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/[^0-9.+\-*/^()%\sa-z]/g, ' ').replace(/(^|\()\s*-/g, '$10-');
  const tokens = s.match(/\d+(?:\.\d+)?|sqrt|[+\-*/^()%]/g);
  if (!tokens) return NaN;
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 }, isOp = t => t in prec;
  const out = [], ops = [];
  for (const t of tokens) {
    if (/^\d/.test(t)) out.push(parseFloat(t));
    else if (t === 'sqrt') ops.push(t);
    else if (isOp(t)) {
      while (ops.length) { const top = ops[ops.length - 1];
        if (top === 'sqrt' || (isOp(top) && (prec[top] > prec[t] || (prec[top] === prec[t] && t !== '^')))) out.push(ops.pop());
        else break; }
      ops.push(t);
    } else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop();
      if (ops[ops.length - 1] === 'sqrt') out.push(ops.pop()); }
  }
  while (ops.length) out.push(ops.pop());
  const st = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else if (t === 'sqrt') { const a = st.pop(); if (a === undefined) return NaN; st.push(Math.sqrt(a)); }
    else { const b = st.pop(), a = st.pop(); if (a === undefined || b === undefined) return NaN;
      st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : t === '%' ? a % b : t === '^' ? Math.pow(a, b) : NaN); }
  }
  return st.length === 1 ? st[0] : NaN;
}
// Zahlenvergleich mit relativer + absoluter Toleranz.
function numEqual(a, b, rel = 0.01) {
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(1e-9, rel * Math.abs(b), 0.005);
}

// Deterministisches Verdikt für EINE Zahl. Liefert { verdict, ref, stud } mit
// verdict ∈ 'ok' | 'abweichung' | null. null = KEIN belastbares Urteil: entweder
// fehlt eine Zahl ODER die LLM-Ground-Truth ist intern widersprüchlich – dann bleibt
// das LLM-Urteil stehen statt es auf wackeliger Basis zu überstimmen.
// In-Band-Doppelcheck (B.5): liegen sowohl ein nachgerechneter Ausdruck als auch eine
// genannte "endergebnis"-Zahl vor, MÜSSEN sie übereinstimmen – sonst ist die Referenz
// unsicher (verdict=null). Liegt nur eine der beiden vor, dient sie als Referenz.
function numericCheck(rechnung, endergebnis, schueler, tol) {
  const r1 = evalExpr(rechnung);
  const r2 = parseNum(endergebnis);
  const stud = parseNum(schueler);
  let ref;
  if (isFinite(r1) && isFinite(r2)) {
    if (!numEqual(r1, r2, tol)) return { verdict: null, ref: r1, stud };  // intern widersprüchlich
    ref = r1;
  } else {
    ref = isFinite(r1) ? r1 : r2;
  }
  if (!isFinite(ref) || !isFinite(stud)) return { verdict: null, ref, stud };
  return { verdict: numEqual(stud, ref, tol) ? 'ok' : 'abweichung', ref, stud };
}

// Deterministische Rechen-Prüfung (#4) als isolierte, unit-testbare Funktion: der CODE
// vergleicht die Zahlen, nicht das LLM. Nachweislich falsches Endergebnis ⇒ nie volle
// Punktzahl (score auf 1 gedeckelt, understood=false) – überstimmt eine LLM-Fehlein-
// schätzung und bleibt über Re-Prüfungen stabil. Bei mehreren Teilaufgaben mit je eigenem
// Zahlergebnis (ev.teilergebnisse) wird pro Teil geprüft und der Gesamt-Score aus den
// Teil-Verdikten gebildet (B.5). Mutiert `ev` (score/understood/feedback), gibt die
// angehängte Notiz zurück. Toleranz strenger auf hohen Niveaus.
function applyNumericVerdict(ev, isCalcTask, diff) {
  if (!isCalcTask) return '';
  const tol = (diff === 'pruefungsnah' || diff === 'schwer') ? 0.005 : 0.02;
  const fmt = n => (Math.round(n * 1000) / 1000).toLocaleString('de-DE');
  const parts = Array.isArray(ev.teilergebnisse) && ev.teilergebnisse.length ? ev.teilergebnisse : null;
  let note = '';
  if (parts) {
    const bad = [];
    let anyVerdict = false;
    parts.forEach((p, i) => {
      const c = numericCheck(p.endergebnis_rechnung, p.endergebnis, p.schueler_endergebnis, tol);
      if (c.verdict) anyVerdict = true;
      if (c.verdict === 'abweichung') bad.push(`${p.label || i + 1}) erwartet ${fmt(c.ref)}, deine ${fmt(c.stud)}`);
    });
    if (bad.length) {
      if (ev.score >= 2) ev.score = 1;
      ev.understood = false;
      note = `🔢 Endergebnis weicht ab bei ${bad.join('; ')}.`;
    } else if (anyVerdict) {
      note = `🔢 Alle geprüften Teilergebnisse korrekt ✓`;
    }
  } else {
    const c = numericCheck(ev.endergebnis_rechnung, ev.endergebnis, ev.schueler_endergebnis, tol);
    if (c.verdict === 'abweichung') {
      if (ev.score >= 2) ev.score = 1;
      ev.understood = false;
      note = `🔢 Endergebnis weicht ab – erwartet ${fmt(c.ref)}, deine Antwort ${fmt(c.stud)}.`;
    } else if (c.verdict === 'ok') {
      note = `🔢 Endergebnis geprüft: ${fmt(c.stud)} ✓`;
    }
  }
  if (note) ev.feedback = ev.feedback ? `${ev.feedback} — ${note}` : note;
  return note;
}

// Zerlegt eine Musterlösung an fett markierten Teilaufgaben-Köpfen (**a)**, **2)** …),
// damit korrekte Teile optisch eingeklappt und nur die falschen offen gezeigt werden.
function splitLoesungParts(text) {
  if (!text) return null;
  const re = /\*\*\s*([a-zA-Z]|\d{1,2})\s*\)\s*\*\*/g;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) heads.push({ label: m[1].toLowerCase(), idx: m.index });
  if (heads.length < 2) return null;   // keine/zu wenige Teilaufgaben → nicht eindampfen
  return heads.map((h, i) => ({
    label: h.label,
    text: text.slice(h.idx, i + 1 < heads.length ? heads[i + 1].idx : text.length).trim(),
  }));
}

// Normalisiert das "falsche_teile"-Feld (Array oder String) zu einem Set kurzer Kennungen.
function wrongPartSet(falscheTeile) {
  let arr = falscheTeile;
  if (typeof arr === 'string') arr = arr.split(/[,\s]+/);
  if (!Array.isArray(arr)) return new Set();
  return new Set(arr
    .map(s => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(s => s.length >= 1 && s.length <= 2));   // lange Strings (Anweisungs-Echo) verwerfen
}

// Liest die Lernen-Zeichenfläche EINMAL aus und liefert in einem Durchgang:
// ob Tinte vorhanden ist, deren despeckelte Bounding-Box (für den Zuschnitt, #4)
// und einen Inhalts-Hash (für "unverändert? → kein erneuter API-Call").
function lernenInkInfo() {
  const canvas = document.getElementById('lernen-canvas');
  if (!canvas || !lernenCtx) return null;
  const CW = canvas.width, CH = canvas.height;
  const bb = inkBoundingBox(lernenCtx.getImageData(0, 0, CW, CH).data, CW, CH);
  return { canvas, CW, CH, ink: bb.ink, minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY, hash: bb.hash };
}

async function checkLernenSolution() {
  if (!lernenTopicData) return;
  const checkBtn  = document.getElementById('lernen-check-btn');
  const resultBar = document.getElementById('lernen-result-bar');

  // Antwort zuerst validieren – sonst bauen wir Wartezustand/Musterlösung umsonst auf.
  const answerText = document.getElementById('lernen-text-answer')?.value.trim() || '';
  const hasInk     = lernenHasInk && !!lernenCtx;
  if (!answerText && !hasInk) {
    toast('Bitte zuerst eine Antwort zeichnen oder eingeben.', 'warn', 3000);
    return;
  }

  // Tinte einmal auslesen (Bounding-Box + Inhalts-Hash) und für den Zuschnitt merken.
  const inkInfo = hasInk ? lernenInkInfo() : null;
  const sig = `${lernenTopicData.aufgabe}|${answerText}|${inkInfo ? inkInfo.hash : 'noink'}`;

  // (A) Unveränderte Antwort erneut "geprüft" → kein API-Call, altes Ergebnis zeigen.
  if (lernenLastEval && resultBar && lernenLastResultHtml && sig === lernenLastCheckSig) {
    resultBar.className = lernenLastResultClass;
    resultBar.innerHTML = lernenLastResultHtml;
    toast('Keine Änderung – bisheriges Feedback wird angezeigt.', 'info');
    return;
  }

  checkBtn.disabled = true;
  checkBtn.innerHTML = '<span class="lernen-check-spin">⏳</span> Prüfen…';

  // Vorab generierte Musterlösung nutzen, falls schon fertig: spart der Bewertung
  // das erneute Ausformulieren (kürzere Antwort = schneller) UND wird dem Nutzer
  // direkt im Wartezustand zum Lesen angezeigt.
  let preLoesung = '';
  if (lernenLoesung && lernenLoesung.aufgabe === lernenTopicData.aufgabe) {
    try { preLoesung = await lernenLoesung.promise || ''; } catch { preLoesung = ''; }
  }

  // Wartezustand: wechselnde Status-Zeile (woran die KI gerade arbeitet) statt
  // statischem "wird geprüft" – plus die vorgeladene Musterlösung schon zum Lesen.
  let stopStatus = () => {};
  if (resultBar) {
    const isCalc = Array.isArray(lernenTopicData.werte) && lernenTopicData.werte.length > 0;
    const steps = isCalc
      ? ['Aufgabe und Werte lesen…', 'Deinen Rechenweg durchgehen…', 'Zwischenschritte nachrechnen…', 'Endergebnis vergleichen…', 'Feedback formulieren…']
      : ['Aufgabe lesen…', 'Deine Antwort durchgehen…', 'Mit der Musterlösung abgleichen…', 'Stärken und Lücken sammeln…', 'Feedback formulieren…'];
    resultBar.className = 'lernen-result-bar lernen-result-bar--loading';
    resultBar.innerHTML =
      '<span class="lernen-checking-row">' +
        '<span class="lernen-check-dots"><span></span><span></span><span></span></span>' +
        '<span id="lernen-check-status"></span>' +
      '</span>' +
      (preLoesung
        ? '<details class="lernen-result-details" open style="margin-top:12px">' +
            '<summary>📌 Musterlösung – schon mal zum Lesen</summary>' +
            `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(preLoesung))}</div>` +
          '</details>'
        : '');
    stopStatus = cycleStatus(document.getElementById('lernen-check-status'), steps);
  }

  try {
    let ev;
    // Bewertungsmaßstab/Strenge sind an das Niveau gekoppelt (Konstanten auf Modul-Ebene).
    const strictNote = LERN_STRICTNESS[lernenCurrentDiff] || LERN_STRICTNESS.einsteiger;

    // Re-Prüfung: vorherige Auswertung mitgeben, damit die KI konsistent bleibt
    // und nicht bei jeder Runde neue/widersprüchliche Fehler "entdeckt".
    // Eskalations-Bremse: Bei nicht-strengen Niveaus (einsteiger/leicht/mittel) zählt
    // ab dem 2. Versuch nur noch, ob der ursprünglich angemahnte Kernfehler behoben ist
    // – nicht Perfektion. Verhindert den Frust-Loop. Schwer/Prüfungsnah bleiben streng
    // (dort fängt der manuelle "trotzdem weiter"-Ausweg im UI den Nutzer auf).
    const lernenLenient = !['schwer', 'pruefungsnah'].includes(lernenCurrentDiff);
    const coreFocusNote = (lernenLastEval && lernenLenient)
      ? `\n\nKERNFEHLER-FOKUS (mind. 2. Versuch): Konzentriere dich darauf, ob der/die zuvor angemahnte(n) Hauptfehler jetzt behoben ist/sind. Hat der Student den Kernfehler korrigiert und sitzt die inhaltliche Kernidee, erkenne das deutlich an – eröffne KEINE neuen Nebenschauplätze wegen Kleinigkeiten und werte reine Schönheits-/Formulierungsmängel NICHT als erneutes "falsch".`
      : '';
    const reCheckNote = lernenLastEval
      ? `\n\nWICHTIG – ERNEUTE PRÜFUNG DERSELBEN AUFGABE. Deine vorherige Auswertung war:\nscore: ${lernenLastEval.score}\nfeedback: ${lernenLastEval.feedback || ''}\neinschaetzung: ${lernenLastEval.einschaetzung || ''}\nBleibe konsistent: Beziehe dich auf genau diese Punkte. Was du vorher als richtig akzeptiert hast, bleibt richtig – bringe KEINE neuen Kritikpunkte zu Aspekten ein, die du vorher nicht beanstandet hast, außer der Student hat sie verändert und sie sind jetzt falsch. Erkenne ausdrücklich an, welche zuvor genannten Fehler nun korrigiert sind. Der score darf bei einer korrigierten Antwort NICHT sinken.${coreFocusNote}`
      : '';

    // Wenn die Musterlösung bereits vorliegt: dem Modell als verbindlichen Maßstab
    // mitgeben und das loesung-Feld leer lassen – wir setzen sie unten selbst ein.
    const loesungField = preLoesung
      ? `"loesung": "" (LEER LASSEN – die Musterlösung ist bereits bekannt und wird separat angezeigt)`
      : `"loesung": "Musterlösung. Bei Teilaufgaben (a/b/c oder 1/2/3) je Absatz, getrennt durch \\n\\n, fett beginnend (**a)** ...). KORREKTE Teilaufgaben NUR kurz bestätigen (z.B. '**a)** ✓ korrekt'); die ausgearbeitete Lösung nur für die NICHT korrekten Teilaufgaben."`;
    const knownLoesungNote = preLoesung
      ? `\n\nDIE KORREKTE MUSTERLÖSUNG IST BEREITS BEKANNT (nutze sie als verbindlichen Maßstab für die Bewertung; schreibe sie NICHT erneut, lass das Feld "loesung" leer):\n"""\n${preLoesung}\n"""`
      : '';

    // Rechenaufgabe? → zusätzliche numerische Felder anfordern, die der Code danach
    // DETERMINISTISCH prüft (das LLM benotet nicht mehr seine eigene Arithmetik, #4).
    const isCalcTask = Array.isArray(lernenTopicData.werte) && lernenTopicData.werte.length > 0;
    const numFields = isCalcTask ? `,
  "endergebnis_rechnung": "reiner Rechenausdruck für DAS korrekte Endergebnis, nur Zahlen/Operatoren (z.B. \\"500*1.08\\"); leer wenn nicht sinnvoll",
  "endergebnis": <korrektes Endergebnis als reine Zahl, Punkt als Dezimaltrenner>,
  "schueler_endergebnis": <Endzahl, die der Student angibt, als reine Zahl – null wenn keine genannt>,
  "teilergebnisse": [{ "label": "a", "endergebnis_rechnung": "Ausdruck", "endergebnis": <zahl>, "schueler_endergebnis": <zahl oder null> }]` : '';
    const numInstr = isCalcTask
      ? `\nNUMERISCH: Fülle "endergebnis"/"endergebnis_rechnung" mit DEINEM korrekten Resultat und "schueler_endergebnis" mit der Endzahl des Studenten (null wenn keine). Punkt als Dezimaltrenner. WICHTIG: "endergebnis_rechnung" und "endergebnis" MÜSSEN dasselbe Resultat ergeben – rechne den Ausdruck selbst nach. Die endgültige Richtig/Falsch-Wertung der Zahl übernimmt das System.
TEILAUFGABEN MIT EIGENEM ZAHLERGEBNIS: Hat die Aufgabe mehrere Teilaufgaben (a/b/c) mit JE EIGENEM numerischen Endergebnis, fülle "teilergebnisse" mit einem Eintrag pro Teil ("label" = Kennung ohne Klammer) und lass die oberen Einzelfelder leer. Gibt es nur EIN Endergebnis, nutze die oberen Felder und lass "teilergebnisse" als leeres Array [].`
      : '';

    // LESEN VOR BEWERTEN: Bei Handschrift transkribiert die KI ZUERST exakt, was dasteht,
    // und ordnet jeden Block räumlich der richtigen Teilaufgabe zu. Das verhindert die
    // a/b-Verwechslung (Rechnung aus b landet unter a) und falsches "zu wenig", wenn die
    // KI Handschrift nicht lesen konnte. Bewertet wird nur die Transkription.
    const transkriptionField = hasInk
      ? `\n  "transkription": "Schreibe EXAKT ab, was in der Handschrift steht – nichts ergänzen, nichts raten, nichts aus einer anderen Teilaufgabe übernehmen. Bei Teilaufgaben je Absatz, beginnend mit der Bezeichnung fett (**a)** …), räumlich (Beschriftung bzw. Position von oben nach unten) der richtigen Teilaufgabe zugeordnet. Unsicher Lesbares als [unleserlich] markieren.",`
      : '';
    const transkriptionInstr = hasInk
      ? `\n${ZIFFERN_LESEHILFE}\nLESEN VOR BEWERTEN (Pflicht): Fülle ZUERST "transkription". Übernimm NIEMALS Rechnung/Notiz einer Teilaufgabe in eine andere – ordne jeden Handschrift-Block der Teilaufgabe zu, zu der er räumlich/per Beschriftung gehört. Was du nicht sicher lesen kannst, wird [unleserlich] markiert und NICHT als Fehler oder als fehlend gewertet (in der einschaetzung erwähnen, dass es unleserlich war). Bewerte ausschließlich, was in "transkription" steht.`
      : '';

    const EVAL_SYS = `Du MUSST ausschließlich ein JSON-Objekt zurückgeben – kein Text davor oder danach.
${strictNote}
{${transkriptionField}
  "score": 0,
  "understood": false,
  "feedback": "Ein-Satz-Urteil über die Antwort",
  ${loesungField},
  "falsche_teile": ["NUR die nicht korrekten Teilaufgaben als kurze Kennung ohne Klammer, z.B. \"b\"; leeres Array [] wenn es keine Teilaufgaben gibt oder alles korrekt ist"],
  "einschaetzung": "Fließtext NUR zu den NICHT korrekten Teilen: bei welcher Teilaufgabe was falsch/unvollständig ist und was konkret besser sein sollte. KORREKTE Teilaufgaben NICHT erklären oder wiederholen. Je betroffener Teilaufgabe ein eigener Absatz (z.B. **b)** …). Bei score=2 (alles korrekt) LEER LASSEN (\"\")."${numFields}
}
score: 2=vollständig korrekt (ALLE Teilergebnisse UND das Endergebnis stimmen exakt), 1=Ansatz/Teile richtig aber mindestens ein Ergebnis falsch oder unvollständig, 0=falsch oder zu wenig.
KRITISCHE REGEL: Wenn bei einer Rechenaufgabe IRGENDEIN Zwischenergebnis oder Endergebnis numerisch falsch ist → score MAXIMAL 1, NIEMALS 2. Kein Ausnahme.
understood: true NUR wenn score=2 UND alle Ergebnisse korrekt.
KEIN AUSFÜHRLICHES FEEDBACK BEI KORREKT: Ist score=2, lass "einschaetzung" leer ("") – eine korrekte Lösung braucht keine Fehleranalyse. Das spart Antwortlänge; Urteil + Musterlösung reichen.
NUR FALSCHE TEILE: Bei Teilaufgaben behandelt "einschaetzung" AUSSCHLIESSLICH die nicht korrekten Teilaufgaben. Sind z.B. a) und c) richtig und nur b) falsch, geht es allein um b) – a) und c) werden nicht weiter erklärt.
TEILAUFGABEN-MARKIERUNG: Trage in "falsche_teile" exakt die Kennungen (Buchstabe oder Zahl, ohne Klammer) der Teilaufgaben ein, die NICHT vollständig korrekt sind. Beispiel: a) und c) richtig, b) falsch → ["b"]. Keine Teilaufgaben oder alles korrekt → [].
Bei Rechenaufgaben: Berechne JEDEN Rechenschritt selbst nach und vergleiche exakt. Auch ein falscher Zwischenschritt der zufällig ein richtiges Endergebnis liefert → score=1.${numInstr}${transkriptionInstr}

${LERN_GRADE_STD[lernenCurrentDiff] || LERN_GRADE_STD.einsteiger}${reCheckNote}${knownLoesungNote}`;

    // Beide Eingabebereiche gemeinsam prüfen: Der Umschalter ✏️/⌨️ steuert nur,
    // was gerade sichtbar ist – die Antwort kann aus Zeichnung UND/ODER Text bestehen.
    // (answerText/hasInk wurden oben bereits ermittelt und validiert.)
    if (hasInk) {
      // Zeichnung vorhanden → Vision; getippten Text (falls vorhanden) zusätzlich mitschicken.
      const canvas = inkInfo.canvas;
      // (C) Auf den (despeckelten, #4) beschriebenen Bereich + Rand zuschneiden,
      // (B) herunterskalieren, (#5) kontrastverstärken – gemeinsamer Helper.
      const sx = Math.max(0, inkInfo.minX - INK_CROP_MARGIN);
      const sy = Math.max(0, inkInfo.minY - INK_CROP_MARGIN);
      const sw = Math.min(inkInfo.CW, inkInfo.maxX + INK_CROP_MARGIN) - sx;
      const sh = Math.min(inkInfo.CH, inkInfo.maxY + INK_CROP_MARGIN) - sy;
      const base64 = inkCropToBase64(canvas, sx, sy, sw, sh);
      const textPart = answerText
        ? `\n\nZusätzlich getippte Antwort des Studenten: ${answerText}\nWerte Zeichnung UND getippten Text zusammen als eine einzige Antwort.`
        : '';
      const result = await claudeLocalVision(
        base64,
        `Aufgabe: ${lernenTopicData.aufgabe}${textPart}\n\n${EVAL_SYS}`,
        checkSysBlocks()
      );
      ev = parseJsonResponse(result);
      if (!ev) throw new Error('Keine Auswertung');
    } else {
      // Nur getippter Text.
      // Bei bereiter KB den kuratierten Fach-Kontext serverseitig injizieren lassen
      // (Bewertung war bisher ungroundet); ohne KB unverändert nur EVAL_SYS.
      const kbOpts = (kbReady && lernenTopicData.aufgabe)
        ? { subject_id: sessionId, kb_query: `${lernenTopicData.aufgabe}\n${answerText}`.slice(0, 500) }
        : {};
      const raw = await claudeLocal(
        [{ role: 'user', content: `Aufgabe: ${lernenTopicData.aufgabe}\n\nAntwort des Studenten: ${answerText}` }],
        [{ type: 'text', text: EVAL_SYS }],
        2000, { json_mode: true, ...kbOpts }
      );
      ev = parseJsonResponse(raw);
      if (!ev) {
        console.error('parseJsonResponse failed, raw response:', raw?.slice(0, 300));
        throw new Error('Keine Auswertung');
      }
    }

    // Bereits vorab generierte Musterlösung einsetzen (das Modell hat das Feld leer
    // gelassen, damit die Bewertung schneller war).
    if (preLoesung) ev.loesung = preLoesung;

    // Deterministische Rechen-Prüfung (#4) – Logik isoliert in applyNumericVerdict()
    // (unit-getestet in scripts/test-pure.js). Mutiert ev: deckelt den Score und setzt
    // understood/feedback, wenn das Endergebnis nachweislich abweicht.
    applyNumericVerdict(ev, isCalcTask, lernenCurrentDiff);

    lernenAttempts++;
    lernenLastEval = { score: ev.score, feedback: ev.feedback, einschaetzung: ev.einschaetzung, transkription: ev.transkription || '' };
    const understood = ev.understood === true && ev.score >= 2;
    // Stufen-Verdikt: Beim 2.+ Versuch mit solidem Teil-Ergebnis (score 1) auf nicht-
    // strengen Niveaus gilt "Kernidee sitzt – reicht zum Weitermachen". Schaltet den
    // Abschließen-Button frei, ohne Perfektion zu verlangen.
    const coreGotIt = !understood && ev.score === 1 && lernenAttempts >= 2 && lernenLenient;
    if (ev.score >= 2) comboUp(); else comboReset();
    let scoreClass = ev.score >= 2 ? 'ok' : ev.score === 1 ? 'partial' : 'fail';
    let scoreIcon  = ev.score >= 2 ? '✅' : ev.score === 1 ? '💪' : '🔁';
    if (coreGotIt) { scoreClass = 'core'; scoreIcon = '👍'; }

    if (resultBar) {
      resultBar.className = `lernen-result-bar lernen-result-bar--${scoreClass}`;
      let html = `<div class="lernen-result-verdict lernen-result-verdict--${scoreClass}">${scoreIcon} ${esc(ev.feedback || '')}</div>`;

      // Stufen-Verdikt: "Kernidee sitzt" – ermutigen statt im Loop festhalten.
      if (coreGotIt) {
        html += `<div class="lernen-result-prose"><div class="lernen-result-text">` +
          `Du hast den Kernfehler korrigiert – die Idee sitzt. Das reicht zum Weitermachen; ` +
          `die letzten Feinheiten siehst du in der Musterlösung.</div></div>`;
      }

      // So wurde die Handschrift gelesen – einklappbar, damit der Student Lesefehler
      // (z.B. b)-Rechnung unter a) oder [unleserlich]) sofort erkennt und melden kann.
      if (ev.transkription) {
        html += `<details class="lernen-result-details">` +
          `<summary>📖 So habe ich deine Handschrift gelesen</summary>` +
          `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(ev.transkription))}</div>` +
          `</details>`;
      }

      if (ev.score < 2) {
        // Einschätzung zuerst – was konkret falsch war, kurz und direkt
        if (ev.einschaetzung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">💬 Was war leicht daneben</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.einschaetzung))}</div>` +
            `</div>`;
        }
        // Musterlösung: bei Teilaufgaben mit teils richtigen Teilen die korrekten
        // einklappen und nur die falschen offen zeigen ("nur die Lösung von b").
        if (ev.loesung) {
          const wrong = wrongPartSet(ev.falsche_teile);
          const parts = splitLoesungParts(ev.loesung);
          const mixed = parts && wrong.size &&
            parts.some(p => wrong.has(p.label)) && parts.some(p => !wrong.has(p.label));
          if (mixed) {
            let inner = '';
            for (const p of parts) {
              if (wrong.has(p.label)) {
                inner += `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(p.text))}</div>`;
              } else {
                inner += `<details class="lernen-result-details" style="margin-top:6px">` +
                  `<summary>${esc(p.label)}) ✓ richtig – Lösung trotzdem zeigen</summary>` +
                  `<div class="lernen-result-text" style="margin-top:6px">${safeHtml(md(p.text))}</div>` +
                  `</details>`;
              }
            }
            html += `<div class="lernen-result-prose">` +
              `<div class="lernen-result-label">📌 Musterlösung – Fokus auf ${[...wrong].map(w => w + ')').join(', ')}</div>` +
              inner + `</div>`;
          } else {
            html += `<details class="lernen-result-details">` +
              `<summary>📌 Musterlösung anzeigen</summary>` +
              `<div class="lernen-result-text" style="margin-top:8px">${safeHtml(md(ev.loesung))}</div>` +
              `</details>`;
          }
        }
        html += `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">` +
          (coreGotIt ? `<button class="btn-primary btn-sm" onclick="markTopicDone()">✓ Verstanden – abschließen</button>` : '') +
          `<button class="${coreGotIt ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="regenLernenTask()">→ Neue Aufgabe zum Thema</button>` +
          `<button class="btn-secondary btn-sm" onclick="retryLernenSameTask()">🔁 Gleiche Aufgabe</button>` +
          `</div>`;
        // Manueller Ausweg – IMMER verfügbar (auch bei score 0): wer den Stoff verstanden
        // hat, ist nie gefangen, bis der Bot zufrieden ist. Bewusst dezent als Link.
        if (!coreGotIt) {
          html += `<button class="lernen-skip-link" onclick="markTopicDone()">Ich hab's verstanden – trotzdem weiter →</button>`;
        }
      } else {
        if (ev.loesung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">📌 Musterlösung</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.loesung))}</div>` +
            `</div>`;
        }
        if (ev.einschaetzung) {
          html += `<div class="lernen-result-prose">` +
            `<div class="lernen-result-label">💬 Einschätzung deiner Antwort</div>` +
            `<div class="lernen-result-text">${safeHtml(md(ev.einschaetzung))}</div>` +
            `</div>`;
        }
      }
      resultBar.innerHTML = html;
      // (A) Stand + gerendertes Ergebnis merken → unveränderter Re-Check ohne API-Call.
      lernenLastCheckSig    = sig;
      lernenLastResultHtml  = html;
      lernenLastResultClass = resultBar.className;
    }
    if (understood || coreGotIt) {
      document.getElementById('lernen-done-btn').classList.remove('hidden');
    }
    if (understood && lernenAttempts > 1) toast(`🎯 Beim ${lernenAttempts}. Versuch geschafft!`, 'success', 3500);
    else if (coreGotIt) toast('Kernidee sitzt 👍 – du kannst abschließen oder weiter üben.', 'success', 3500);
  } catch (e) {
    toast('Fehler beim Prüfen: ' + e.message, 'error');
    if (resultBar) { resultBar.className = 'lernen-result-bar hidden'; resultBar.innerHTML = ''; }
  } finally {
    stopStatus();
  }
  checkBtn.disabled = false; checkBtn.innerHTML = '✅ Prüfen';
}

async function lernenQaSend() {
  const input = document.getElementById('lernen-qa-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  const msgs = document.getElementById('lernen-qa-msgs');
  const uEl = document.createElement('div');
  uEl.className = 'rechnen-ask-msg rechnen-ask-user';
  uEl.textContent = text;
  msgs.appendChild(uEl);

  lernenQaMsgs.push({ role: 'user', content: text });

  const aEl = document.createElement('div');
  aEl.className = 'rechnen-ask-msg rechnen-ask-ai';
  aEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  msgs.appendChild(aEl);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const aufgCtx = lernenTopicData?.aufgabe
      ? `\n\nAKTUELLE ÜBUNGSAUFGABE DES STUDENTEN:\n"${lernenTopicData.aufgabe}"\nDer Student arbeitet gerade an dieser Aufgabe. Beantworte Fragen dazu direkt und konkret. Korrigiere Rechenfehler präzise, erkläre den richtigen Lösungsweg Schritt für Schritt.`
      : '';
    // Chat an "Prüfen" koppeln: die offizielle Bewertung (inkl. transkribierter Handschrift)
    // ist verbindlich, damit der Chat nicht "richtig" sagt, während "Prüfen" "zu wenig" sagte.
    const evalCtx = lernenLastEval
      ? `\n\nOFFIZIELLE BEWERTUNG VON "PRÜFEN" (verbindlich – du darfst die Richtig/Falsch-Wertung NICHT umdrehen):\n${lernenLastEval.transkription ? `So wurde die Handschrift des Studenten gelesen:\n"""\n${lernenLastEval.transkription}\n"""\n` : ''}Urteil: ${lernenLastEval.feedback || ''}\nEinschätzung: ${lernenLastEval.einschaetzung || ''}\nWenn der Student fragt, ob seine Antwort richtig/ausreichend ist, stütze dich GENAU auf diese Bewertung (score ${lernenLastEval.score}/2). Erkläre, was noch fehlt – bestätige NICHT pauschal "richtig", wenn die Prüfung das nicht tat. Meint der Student, die Handschrift sei falsch gelesen worden, bitte ihn, erneut auf "Prüfen" zu tippen.`
      : '';
    const qaQuery = [...lernenQaMsgs].reverse().find(m => m.role === 'user')?.content || currentExplainerTopic || '';
    const reply = await claudeLocalKb(
      lernenQaMsgs,
      `Beantworte Fragen zum Thema "${currentExplainerTopic}" kurz und verständlich.${aufgCtx}${evalCtx}`,
      600,
      qaQuery
    );
    lernenQaMsgs.push({ role: 'assistant', content: reply });
    aEl.innerHTML = safeHtml(md(reply));
    if (window.mermaid) mermaid.run({ nodes: aEl.querySelectorAll('.mermaid') }).catch(() => {});
  } catch (e) { aEl.textContent = '⚠️ ' + e.message; }
  msgs.scrollTop = msgs.scrollHeight;
}

async function markTopicDone() {
  const unit = curUnit();
  const members = (unit.themen || []).filter(Boolean);
  if (!members.length || !sessionId) return;
  closeLernenTopic();
  // Eine zusammengesetzte Einheit erledigt ALLE ihre Member-Themen auf diesem Niveau
  // (Hebel 2). Zusammen mit Hebel 1 sind damit auch alle tieferen Stufen abgedeckt.
  const set = learnedKeySet();
  let anyFirst = false, anyReviewDue = false;
  for (const t of members) {
    const key = topicKey(t, lernenCurrentDiff);            // tid::diff
    const first = !set.has(resolveKey(key));
    if (first) {
      anyFirst = true;
      learnedTopics.push(key);
      api(`/api/subjects/${sessionId}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: key }),
      }).catch(() => {});
    } else if (topicReviewDue(key)) {
      anyReviewDue = true;
    }
    // Stärke + Zeitpunkt je Member merken (bestimmt die Wiederholungs-Fälligkeit).
    topicMeta[normFullKey(key)] = { ts: Date.now(), attempts: Math.max(1, lernenAttempts),
      score: (lernenLastEval && typeof lernenLastEval.score === 'number') ? lernenLastEval.score : null };
  }
  if (anyFirst) localforage.setItem(`lt_${sessionId}`, learnedTopics).catch(() => {});
  saveTopicMeta();
  renderMilestone();
  loadLernpfad();
  sessionTick('topic', unit.name);
  // XP nur für echten Lernfortschritt: voll beim ersten Mal, halb für fällige
  // Wiederholung (Retrieval belohnen!), nichts für wiederholtes Abhaken.
  const fullXP = XP_BY_DIFF[lernenCurrentDiff] || 40;
  if (anyFirst)            addXP(fullXP, `"${unit.name}" gelernt`);
  else if (anyReviewDue)   addXP(Math.round(fullXP / 2), `"${unit.name}" aufgefrischt`);
  // Kapitel komplett? → Konfetti (auf/über Niveau, konsistent mit dem Lernpfad)
  if (moduleStructure?.kapitel) {
    const need = diffIdx(lernenCurrentDiff);
    const tDone = t => topicMaxLevel(t) >= need;
    const kap = moduleStructure.kapitel.find(k => k.themen.includes(members[0]));
    if (kap && kap.themen.every(tDone)) {
      confettiBurst();
      setTimeout(() => toast(`📗 Kapitel "${kap.titel}" abgeschlossen!`, 'success', 4000), 300);
    }
  }
}

// Abdeckungs-Check (Phase 3 des Themen-Scans): prüft je Dokument, ob sein zentraler
// Inhalt von mindestens einem Lernthema abgedeckt ist, und liefert für echte Lücken
// wenige gezielte Ergänzungen. Braucht die Per-Dokument-Overview (buildDocOverview);
// ohne sie (offline/kein Server) wird nichts geändert. WEGLASSEN-Vorgaben des
// Studenten gelten auch hier – bewusst ausgelassene Themen sind keine Lücke.
async function ensureScanCoverage(struct, overview, directiveBlk) {
  if (!struct?.kapitel?.length || !overview) return struct;
  const topics = struct.kapitel.flatMap(k => k.themen);
  const raw = await claudeLocal(
    [{ role: 'user', content: `Kurze Auszüge aus ALLEN Dokumenten dieser Lernsammlung:\n\n${overview}\n\nBereits erkannte Lernthemen:\n${topics.map(t => '- ' + t).join('\n')}\n\nPrüfe Dokument für Dokument: Welche Dokumente behandeln einen ZENTRALEN Inhalt, der durch KEINES der Lernthemen abgedeckt ist? Ignoriere Dokumente ohne verwertbaren Auszug sowie reine Übungs-/Lösungsblätter zu bereits abgedeckten Themen.${directiveBlk || ''}` }],
    [{ type: 'text', text: 'Du prüfst eine Lernthemen-Liste auf Vollständigkeit gegen eine Dokumentsammlung. Antworte NUR als JSON:\n{"ergaenzungen":[{"kapitel":"passendes oder neues Hauptthema","themen":["Lernthema max. 4 Wörter"]}]}\nMelde NUR echte Lücken (zentraler Inhalt eines Dokuments ohne passendes Thema) – ist alles abgedeckt: {"ergaenzungen":[]}. Höchstens 6 neue Themen insgesamt.' }],
    700
  );
  const m = (raw || '').match(/\{[\s\S]*\}/);
  if (!m) return struct;
  const erg = parseJsonLoose(m[0])?.ergaenzungen;
  if (!Array.isArray(erg) || !erg.length) return struct;
  return dedupeStructure(mergeCoverageAdditions(struct, erg));
}

async function scanModuleStructure(btn) {
  if (!sessionTxt && !sessionId) { toast('Bitte zuerst Dokumente hochladen.', 'warn'); return; }
  const orig = btn.textContent;
  btn.disabled = true;
  const prevNames = pathTopics();   // für den ID-Abgleich (Rename-Erkennung) festhalten
  // Alte Struktur festhalten (tiefe Kopie): bereits gelernte Themen, die der neue Scan
  // fallen lässt, holen wir daraus mit ihrem alten Anzeigenamen + Kapitel zurück (v255).
  const prevStructure = moduleStructure ? JSON.parse(JSON.stringify(moduleStructure)) : null;
  try {
    // Vorstufe: die persönlichen Anweisungen zu verbindlichen Auswahl-Vorgaben destillieren,
    // damit "diese Themen weglassen / das ist klausurrelevant" tatsächlich in die Liste einfließt.
    btn.textContent = 'Vorgaben lesen…';
    const directives  = await distillScanDirectives();
    const directiveBlk = scanDirectiveBlock(directives);

    // Phase 1: Fetch short snippet from EVERY document → identify Hauptthemen across ALL docs
    btn.textContent = 'Überblick lädt…';
    const overview = await buildDocOverview();
    const overviewText = overview || docsForPrompt(25000);

    const p1Raw = await claudeLocal(
      [{ role: 'user', content: `Hier sind kurze Auszüge aus ALLEN Dokumenten dieser Lernsammlung:\n\n${overviewText}\n\nIdentifiziere 6–8 übergeordnete Hauptthemen, die insgesamt in diesen Dokumenten behandelt werden. Decke die GESAMTE Breite aller Dokumente ab – nicht nur die ersten.${directiveBlk}` }],
      [{ type: 'text', text: 'Du bist ein Lernstruktur-Experte. Analysiere Dokumentübersichten und erkenne übergeordnete Themengebiete.\nAntworte NUR als JSON-Array mit 6–8 Strings:\n["Hauptthema 1","Hauptthema 2",...]' + persInstrText() }],
      600
    );
    const m1 = p1Raw.match(/\[[\s\S]*?\]/);
    if (!m1) throw new Error('Hauptthemen nicht erkannt');
    const hauptthemen = parseJsonLoose(m1[0]).filter(t => typeof t === 'string' && t.trim()).slice(0, 8);
    if (!hauptthemen.length) throw new Error('Keine Hauptthemen gefunden');

    // Phase 2: For each Hauptthema generate Lernthemen using full content.
    // Budget global statt pro Kapitel: "3–5 pro Kapitel" × bis zu 8 Kapiteln ergab
    // sonst bis zu 40 Themen trotz "max 30" (widersprüchlich) → echtes Gesamt-Budget.
    btn.textContent = 'Lernthemen…';
    const p2Raw = await claudeLocal(
      [{ role: 'user', content: `Strukturiere den Lernstoff in diese Hauptthemen:\n${hauptthemen.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nErstelle pro Hauptthema ca. 3–4 konkrete Lernthemen (max. 4 Wörter), die in den Unterlagen behandelt werden – insgesamt HÖCHSTENS 28. Didaktische Reihenfolge: Grundlagen zuerst.${directiveBlk}` }],
      sysBlocks(`Antworte NUR als JSON:\n{"kapitel":[{"titel":"Hauptthema","lernziel":"Nach diesem Kapitel kannst du …(ein Satz)","themen":["Lernthema 1","Lernthema 2"]}]}\nRegeln:\n- Themennamen max. 4 Wörter.\n- Insgesamt HÖCHSTENS 28 Themen über alle Kapitel zusammen.\n- Jedes Konzept gehört in GENAU EIN Kapitel – wiederhole kein Thema sinngemäß in einem anderen Kapitel (z.B. "Bayes" oder "Mindeststichprobenumfang" nicht zweimal).\n- Erstelle KEIN separates Klausur-/Prüfungs- oder reines "Anwendungen"-Kapitel, das Konzepte aus früheren Kapiteln wiederholt – Klausur- und Praxisbezug gehört in das jeweilige Fachkapitel.`),
      1400
    );
    const m2 = p2Raw.match(/\{[\s\S]*\}/);
    if (!m2) throw new Error('Lernstruktur nicht erkannt');
    const data = parseJsonLoose(m2[0]);
    const kapitel = (data.kapitel || []).filter(k =>
      k && typeof k.titel === 'string' && Array.isArray(k.themen) && k.themen.length);
    if (!kapitel.length) throw new Error('Keine Kapitel gefunden');
    // Beinah-Duplikate über alle Kapitel hinweg entfernen (normalisierter Vergleich:
    // "Die Lichtreaktion" == "Lichtreaktion", "CO₂-Konzentration" == "CO2 Konzentration").
    moduleStructure = dedupeStructure({ kapitel });
    // Phase 3: Abdeckungs-Check. Das 6–8-Hauptthemen/28-Themen-Budget kann ganze
    // Dokumente verschlucken (real passiert: "Preisblasen auf Vermögensmärkten" mit
    // 30k Zeichen bekam kein Thema). Ein Gegen-Check pro Dokument findet solche
    // Lücken und ergänzt gezielt wenige Themen. Fail-open: ohne Overview oder bei
    // API-Fehler bleibt die Struktur aus Phase 2 unverändert.
    btn.textContent = 'Abdeckung prüfen…';
    try { moduleStructure = await ensureScanCoverage(moduleStructure, overview, directiveBlk); } catch {}
    let newNames = moduleStructure.kapitel.flatMap(k => k.themen);
    // IDs gegen die alten Themen abgleichen: Rename ⇒ ID bleibt ⇒ Fortschritt bleibt.
    // Semantischer Abgleich via Embeddings (robust gegen Umformulierung); null → Token-Fallback.
    btn.textContent = 'Fortschritt abgleichen…';
    const sim = prevNames.length ? await embedSimFn([...prevNames, ...newNames]) : null;
    // Bereits gelernte Themen, die der neue Scan fallen lässt, VOR dem Reconcile
    // zurückholen (v255) – sonst geht ihr Abhak-Status verloren. Danach newNames neu
    // aus der (jetzt ergänzten) Struktur ziehen, damit Reconcile sie mit-abgleicht.
    const retained = retainLearnedTopics(prevStructure, sim);
    if (retained) newNames = moduleStructure.kapitel.flatMap(k => k.themen);
    reconcileTopicUids(prevNames, newNames, sim);
    moduleStructure.ids = topicUids;
    // Flache Liste = ALLE Strukturthemen (kein 30er-Cut): der Lernpfad zählt sie
    // ohnehin vollständig, Session-Planer/Aufgaben sollen deckungsgleich sein (#7b).
    scannedTopics = newNames;
    localforage.setItem(`ms_${sessionId}`, moduleStructure).catch(() => {});
    localforage.setItem(`st_${sessionId}`, scannedTopics).catch(() => {});
    localforage.setItem(`tuid_${sessionId}`, topicUids).catch(() => {});
    api(`/api/subjects/${sessionId}/structure`, {
      method: 'POST',
      body: JSON.stringify({ structure: moduleStructure, topics: scannedTopics }),
    }).catch(() => {});
    // Reconcile deckt nur Renames ab, bei denen ein NEUER Name die ID des alten Themas
    // erbt. Ein Re-Scan, der Themen zusammenführt/neu zuschneidet, lässt bereits
    // gelernten Fortschritt aber auf jetzt verwaiste IDs fallen (v217). Diesen Fall
    // SOFORT heilen – nicht erst beim nächsten Fach-Öffnen (docs/app.js:1675) –, damit
    // die Abhak-Zahl direkt nach dem Re-Scan stimmt. sim deckt bereits prev+new ab
    // (⊇ Waisen + aktuelle Themen) → kein zweiter Embedding-Call nötig.
    const repair = repairOrphanedProgress(sim);
    if (repair.healed) {
      localforage.setItem(`lt_${sessionId}`, learnedTopics).catch(() => {});
      saveTopicMeta();
      repair.added.forEach(t => api(`/api/subjects/${sessionId}/learned-topics`, {
        method: 'POST', body: JSON.stringify({ topic: t }),
      }).catch(() => {}));
      repair.removed.forEach(t => api(`/api/subjects/${sessionId}/learned-topics/${encodeURIComponent(t)}`, {
        method: 'DELETE',
      }).catch(() => {}));
    }
    renderMilestone();
    loadLernpfad();
    if (repair.healed) setTimeout(() => toast(`✅ ${repair.healed} bereits gelernte${repair.healed === 1 ? 's Thema' : ' Themen'} wieder als erledigt verknüpft.`, 'success', 4500), 300);
    if (retained) setTimeout(() => toast(`📌 ${retained} bereits abgeschlossene${retained === 1 ? 's Thema' : ' Themen'} behalten (vom Re-Scan nicht fallen gelassen).`, 'info', 5000), retained && repair.healed ? 900 : 300);
    // Re-Scan: zusätzlich anzeigen, was sich gegenüber der alten Struktur geändert hat (#7).
    const diffNote = prevNames.length ? ` (${formatScanDiff(scanDiff(prevNames, newNames))})` : '';
    toast(`🗺️ ${hauptthemen.length} Hauptthemen · ${scannedTopics.length} Lernthemen erkannt!${diffNote}`, 'success');
    // Transparenz: zeigen, welche Auswahl-Vorgaben aus den Anweisungen abgeleitet und befolgt wurden.
    if (directives) setTimeout(() => toast('📌 Aus deinen Anweisungen befolgt:<br>' + esc(directives).replace(/\n/g, '<br>'), 'info', 9000), 600);
  } catch (e) {
    toast('Fehler beim Erkennen: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = orig;
}

document.getElementById('lernpfad-scan-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('lernpfad-scan-btn');
  try {
    await scanModuleStructure(btn);
  } finally {
    btn.disabled = false; btn.textContent = 'Themen erkennen';
  }
});

// Answer mode toggle (canvas ↔ text)
document.getElementById('lernen-mode-canvas')?.addEventListener('click', () => {
  lernenAnswerMode = 'canvas';
  document.getElementById('lernen-mode-canvas').classList.add('active');
  document.getElementById('lernen-mode-text').classList.remove('active');
  document.getElementById('lernen-draw-tools').style.display = 'contents';
  document.getElementById('lernen-canvas-wrap').classList.remove('hidden');
  document.getElementById('lernen-text-wrap').classList.add('hidden');
  requestAnimationFrame(initLernenCanvas);
});
document.getElementById('lernen-mode-text')?.addEventListener('click', () => {
  lernenAnswerMode = 'text';
  document.getElementById('lernen-mode-text').classList.add('active');
  document.getElementById('lernen-mode-canvas').classList.remove('active');
  document.getElementById('lernen-draw-tools').style.display = 'none';
  document.getElementById('lernen-canvas-wrap').classList.add('hidden');
  const wrap = document.getElementById('lernen-text-wrap');
  wrap.classList.remove('hidden');
  setTimeout(() => {
    adjustLernenTextHeight(); // size before keyboard to avoid layout jump
    document.getElementById('lernen-text-answer')?.focus();
  }, 80);
});

// Size the textarea to fill exactly the visible area above the iOS keyboard.
// Called once on switch-to-text and again whenever the visual viewport resizes
// (i.e. when the software keyboard appears/disappears/resizes).
function adjustLernenTextHeight() {
  const ta   = document.getElementById('lernen-text-answer');
  const wrap = document.getElementById('lernen-text-wrap');
  if (!ta || !wrap || wrap.classList.contains('hidden')) return;
  const vv = window.visualViewport;
  if (vv) {
    // vv.height is the visible height excluding the keyboard
    const wrapTop = wrap.getBoundingClientRect().top;
    const available = vv.height - wrapTop - 8; // 8 px bottom gap
    ta.style.height = Math.max(80, available) + 'px';
  } else if (!ta.style.height && wrap.clientHeight > 60) {
    // Fallback for browsers without visualViewport
    ta.style.height = (wrap.clientHeight - 28) + 'px';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustLernenTextHeight);
}

// Task area resize handle
(function () {
  const handle = document.getElementById('lernen-task-resize');
  const wrap   = document.getElementById('lernen-task-bar-wrap');
  if (!handle || !wrap) return;
  let startY = 0, startH = 0, dragging = false;
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startH = wrap.offsetHeight;
    dragging = true;
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const h = Math.max(44, Math.min(320, startH + (e.clientY - startY)));
    wrap.style.height = h + 'px';
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    localforage.setItem('lernen_taskH', wrap.offsetHeight).catch(() => {});
  };
  handle.addEventListener('pointerup',     endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // Restore last used height
  localforage.getItem('lernen_taskH').then(h => {
    if (h > 40) wrap.style.height = h + 'px';
  }).catch(() => {});
}());

// Lernen topic view controls
document.getElementById('lernen-back-btn')?.addEventListener('click', closeLernenTopic);
document.getElementById('lernen-to-task-btn')?.addEventListener('click', openLernenTask);
document.getElementById('lernen-check-btn')?.addEventListener('click', checkLernenSolution);
document.getElementById('lernen-done-btn')?.addEventListener('click', markTopicDone);
document.getElementById('lernen-regen-btn')?.addEventListener('click', regenLernenTask);
document.getElementById('lernen-clear-btn')?.addEventListener('click', () => {
  if (!lernenCtx) return;
  const wrap = document.getElementById('lernen-canvas-wrap');
  lernenCtx.globalCompositeOperation = 'source-over';
  lernenCtx.clearRect(0, 0, wrap.clientWidth, LERNEN_HEIGHT);
  lernenHasInk = false;
  lernenStrokes = []; lernenCurStroke = null;
});
document.querySelectorAll('.lernen-step-tab').forEach(t => t.addEventListener('click', () => {
  if (t.disabled) return;
  const step = +t.dataset.lstep;
  if (step === 2) openLernenTask(); else lernenSwitchStep(step);
}));
document.querySelectorAll('[data-ltool]').forEach(b => b.addEventListener('click', () => {
  lernenTool = b.dataset.ltool;
  document.querySelectorAll('[data-ltool]').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
document.querySelectorAll('[data-lcolor]').forEach(b => b.addEventListener('click', () => {
  lernenPenColor = b.dataset.lcolor;
  lernenTool = 'pen';
  document.querySelectorAll('[data-lcolor]').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('[data-ltool]').forEach(x => x.classList.toggle('active', x.dataset.ltool === 'pen'));
  b.classList.add('active');
}));
document.getElementById('lernen-qa-btn')?.addEventListener('click', () => {
  document.getElementById('lernen-qa-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('lernen-qa-input')?.focus(), 300);
});
document.getElementById('lernen-qa-close-btn')?.addEventListener('click', () =>
  document.getElementById('lernen-qa-overlay').classList.add('hidden'));
document.getElementById('lernen-qa-overlay')?.addEventListener('click', e => {
  if (!e.target.closest('.sheet')) document.getElementById('lernen-qa-overlay').classList.add('hidden');
});
document.getElementById('lernen-qa-send-btn')?.addEventListener('click', lernenQaSend);
document.getElementById('lernen-qa-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') lernenQaSend();
});

// ══ DASHBOARD ════════════════════════════════════════════════════════════

async function initDashboard() {
  const el = document.getElementById('panel-dashboard');
  if (!el) return;
  el.innerHTML = '<div class="dash-loading">Lädt…</div>';

  const stats = await DB.stats(sessionId);
  if (!stats) { el.innerHTML = '<div class="dash-loading">Keine Daten verfügbar.</div>'; return; }

  const { quizCount, avgScore, quizHistory, cardsTotal, cardsDue, docCount, messageCount } = stats;

  const scoreColor = p => p >= 70 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : 'var(--red)';

  // Chart data
  const labels = quizHistory.map((_, i) => `#${i + 1}`);
  const scores = quizHistory.map(q => q.pct);

  el.innerHTML = `
    <div class="dash-content">
      <div class="dash-kpi-row">
        <div class="dash-kpi">
          <div class="dash-kpi-val" style="color:${scoreColor(avgScore)}">${avgScore}%</div>
          <div class="dash-kpi-lbl">Ø Quiz-Score</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${quizCount}</div>
          <div class="dash-kpi-lbl">Quizfragen</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val" style="color:${cardsDue > 0 ? 'var(--red)' : 'var(--green)'}">${cardsDue}</div>
          <div class="dash-kpi-lbl">Karten fällig</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${cardsTotal}</div>
          <div class="dash-kpi-lbl">Karten gesamt</div>
        </div>
      </div>
      <div class="dash-kpi-row">
        <div class="dash-kpi">
          <div class="dash-kpi-val">${docCount}</div>
          <div class="dash-kpi-lbl">Dokumente</div>
        </div>
        <div class="dash-kpi">
          <div class="dash-kpi-val">${messageCount}</div>
          <div class="dash-kpi-lbl">Chat-Nachrichten</div>
        </div>
      </div>
      ${scores.length >= 2 ? `
      <div class="dash-chart-wrap">
        <div class="dash-chart-title">Quiz-Verlauf</div>
        <canvas id="dash-chart" height="130"></canvas>
      </div>` : '<div class="dash-empty">Noch zu wenige Quizdaten für einen Verlauf.</div>'}
    </div>`;

  if (scores.length >= 2) {
    const ctx = document.getElementById('dash-chart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Score %',
          data: scores,
          borderColor: '#5856d6',
          backgroundColor: 'rgba(88,86,214,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
        }],
      },
      options: {
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
          x: { grid: { display: false } },
        },
        plugins: { legend: { display: false } },
        animation: false,
      },
    });
  }
}

// ══ INIT ══════════════════════════════════════════════════════════════════
(async () => {
  try { await initDarkMode(); } catch (_) { applyDarkMode(false); }
  try { if (authToken) renderStreak(); } catch (_) {}
  try { prefCalculator = (await localforage.getItem('pref_calculator')) || ''; } catch (_) {}
  try {
    await checkAuth();
  } catch (_) {
    showScreen('auth-screen');
  }
})();

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  // Auto-Reload, sobald ein neuer SW die Kontrolle übernimmt (der SW ruft
  // skipWaiting + clients.claim → controllerchange). So kommen Updates an, ohne
  // dass die PWA manuell neu gestartet werden muss. Guard verhindert Reload-Schleifen.
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    // Beim Start und bei Rückkehr in den Vordergrund aktiv nach einem neuen SW
    // suchen – wichtig für iPad-PWAs, die sonst lange auf dem alten SW hängen.
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

