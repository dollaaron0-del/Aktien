require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEFAULT_JWT_SECRET = 'nachhilfe-secret-change-in-production';
const JWT_SECRET    = process.env.JWT_SECRET    || DEFAULT_JWT_SECRET;
// Fail-fast: NIE mit dem öffentlichen Default-Secret laufen. Damit könnte jeder
// beliebige (auch Admin-)Tokens fälschen → kompletter Auth-Bypass. Lieber gar
// nicht starten, damit die Lücke nicht still durch eine fehlende .env zurückkommt.
if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.error('FATAL: JWT_SECRET ist nicht gesetzt – Fallback auf das öffentliche Default-Secret.');
  console.error('Erzeuge eines mit `openssl rand -hex 48` und trage es als JWT_SECRET in server/.env ein.');
  process.exit(1);
}
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID    = process.env.TELEGRAM_ADMIN_CHAT_ID;
const ADMIN_USER    = (process.env.ADMIN_USERNAME || '').toLowerCase();

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) {}
}

async function sendTelegramButtons(text, buttons) {
  if (!TG_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID, text, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      }),
    });
  } catch (_) {}
}

// Dynamic daily limit (stored in settings table, fallback to env var)
async function getDailyLimit() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='daily_limit_eur'");
    if (rows.length) return parseFloat(rows[0].value) || 1.0;
  } catch (_) {}
  return parseFloat(process.env.DAILY_LIMIT_EUR || '1.0');
}

// ── Telegram polling (handle bot commands & inline button presses) ─────────
let tgOffset = 0;

async function answerCallback(id, text) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: id, text }),
  }).catch(() => {});
}

async function pollTelegram() {
  if (!TG_TOKEN) return;
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getUpdates?offset=${tgOffset}&timeout=0&limit=10`
    );
    if (!r.ok) return;
    const data = await r.json();
    for (const upd of data.result || []) {
      tgOffset = upd.update_id + 1;

      // ── Inline button press ─────────────────────────────────────────────
      if (upd.callback_query) {
        const cb = upd.callback_query;
        const chatId = cb.message?.chat?.id?.toString();
        if (chatId !== TG_CHAT_ID) continue;
        const cbData = cb.data || '';

        if (cbData.startsWith('addlimit:')) {
          const add = parseFloat(cbData.split(':')[1]);
          if (!isNaN(add) && add > 0) {
            const current = await getDailyLimit();
            const newLimit = +(current + add).toFixed(2);
            await pool.query(
              "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
              [newLimit.toString()]
            );
            await answerCallback(cb.id, `✅ Limit → ${newLimit.toFixed(2)}€`);
            await sendTelegram(`✅ Tageslimit auf <b>${newLimit.toFixed(2)}€</b> erhöht (war ${current.toFixed(2)}€)`);
          }

        } else if (cbData.startsWith('approve:')) {
          const userId = parseInt(cbData.split(':')[1]);
          const { rows } = await pool.query(
            'UPDATE users SET approved=true, approval_token=NULL WHERE id=$1 AND approved=false RETURNING username',
            [userId]
          );
          if (rows.length) {
            await answerCallback(cb.id, `✅ ${rows[0].username} freigeschaltet`);
            await sendTelegram(`✅ <b>${rows[0].username}</b> wurde freigeschaltet.`);
          } else {
            await answerCallback(cb.id, 'Bereits verarbeitet');
          }

        } else if (cbData.startsWith('reject:')) {
          const userId = parseInt(cbData.split(':')[1]);
          const { rows } = await pool.query(
            'DELETE FROM users WHERE id=$1 AND approved=false RETURNING username',
            [userId]
          );
          if (rows.length) {
            await answerCallback(cb.id, `🗑 ${rows[0].username} abgelehnt`);
            await sendTelegram(`🗑 <b>${rows[0].username}</b> wurde abgelehnt und gelöscht.`);
          } else {
            await answerCallback(cb.id, 'Bereits verarbeitet');
          }
        }
        continue;
      }

      // ── Text commands ───────────────────────────────────────────────────
      const msg = upd.message;
      if (!msg || msg.chat?.id?.toString() !== TG_CHAT_ID) continue;
      const text = msg.text?.trim() || '';

      if (text.startsWith('/setlimit ')) {
        const val = parseFloat(text.split(' ')[1]);
        if (!isNaN(val) && val > 0) {
          await pool.query(
            "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
            [val.toString()]
          );
          await sendTelegram(`✅ Tageslimit auf <b>${val.toFixed(2)}€</b> gesetzt`);
        } else {
          await sendTelegram('❌ Ungültiger Betrag. Beispiel: <code>/setlimit 2.00</code>');
        }

      } else if (text === '/status') {
        const { cost, calls } = await checkDailyLimit();
        const limit = await getDailyLimit();
        const pct = limit > 0 ? Math.round(cost / limit * 100) : 0;
        await sendTelegram(
          `📊 <b>Tagesstatus</b>\n\nVerbraucht: ${cost.toFixed(3)}€\nLimit: ${limit.toFixed(2)}€\nAuslastung: ${pct}%\nAPI-Calls: ${calls}`
        );

      } else if (text === '/users') {
        const { rows } = await pool.query(
          "SELECT id, username, approved, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT 20"
        );
        if (!rows.length) {
          await sendTelegram('Keine Benutzer vorhanden.');
        } else {
          const lines = rows.map(u => {
            const status = !u.approved ? '⏳ ausstehend' : u.is_admin ? '👑 Admin' : '✅ aktiv';
            return `${status} — <b>${u.username}</b>`;
          });
          await sendTelegram(`👥 <b>Benutzer (${rows.length})</b>\n\n${lines.join('\n')}`);
        }

      } else if (text.startsWith('/approve ')) {
        const uname = text.split(' ')[1]?.toLowerCase();
        if (!uname) { await sendTelegram('Beispiel: <code>/approve benutzername</code>'); continue; }
        const { rows } = await pool.query(
          'UPDATE users SET approved=true, approval_token=NULL WHERE LOWER(username)=$1 AND approved=false RETURNING username',
          [uname]
        );
        if (rows.length) await sendTelegram(`✅ <b>${rows[0].username}</b> wurde freigeschaltet.`);
        else await sendTelegram(`❌ Kein ausstehender Benutzer mit dem Namen <b>${uname}</b> gefunden.`);

      } else if (text.startsWith('/reject ')) {
        const uname = text.split(' ')[1]?.toLowerCase();
        if (!uname) { await sendTelegram('Beispiel: <code>/reject benutzername</code>'); continue; }
        const { rows } = await pool.query(
          'DELETE FROM users WHERE LOWER(username)=$1 AND approved=false RETURNING username',
          [uname]
        );
        if (rows.length) await sendTelegram(`🗑 <b>${rows[0].username}</b> wurde abgelehnt und gelöscht.`);
        else await sendTelegram(`❌ Kein ausstehender Benutzer mit dem Namen <b>${uname}</b> gefunden.`);

      } else if (text === '/help') {
        await sendTelegram(
          `🤖 <b>Admin-Befehle</b>\n\n` +
          `👥 <b>Benutzer</b>\n` +
          `/users — alle Benutzer auflisten\n` +
          `/approve &lt;name&gt; — Benutzer freischalten\n` +
          `/reject &lt;name&gt; — Benutzer ablehnen\n\n` +
          `💰 <b>Limit</b>\n` +
          `/setlimit 2.00 — Tageslimit setzen\n` +
          `/status — API-Verbrauch heute\n\n` +
          `Registrierungsanfragen erscheinen automatisch mit ✅/❌-Buttons.`
        );
      }
    }
  } catch (_) {}
}

async function checkAndNotify90pct(today, newCost) {
  const limit = await getDailyLimit();
  if (limit <= 0 || newCost / limit < 0.9) return;
  try {
    const { rows } = await pool.query(
      'SELECT notified_90pct FROM daily_usage WHERE date=$1', [today]
    );
    if (rows[0]?.notified_90pct) return;
    await pool.query('UPDATE daily_usage SET notified_90pct=true WHERE date=$1', [today]);
    await sendTelegramButtons(
      `⚠️ <b>90% des Tageslimits erreicht!</b>\n\nVerbraucht: ${newCost.toFixed(3)}€ / ${limit.toFixed(2)}€\n\nLimit für heute erhöhen:`,
      [[
        { text: '+0,50€', callback_data: 'addlimit:0.50' },
        { text: '+1,00€', callback_data: 'addlimit:1.00' },
        { text: '+2,00€', callback_data: 'addlimit:2.00' },
        { text: '+5,00€', callback_data: 'addlimit:5.00' },
      ]]
    );
  } catch (_) {}
}

const app = express();
const PORT = process.env.PORT || 3000;

// Hinter dem nginx-Reverse-Proxy steht die echte Client-IP in X-Forwarded-For.
// Ohne 'trust proxy' würde express-rate-limit alle Nutzer unter der Proxy-IP
// zusammenfassen → 30/min würde zum gemeinsamen Limit für alle. Erster Hop wird vertraut.
app.set('trust proxy', 1);

// ── DB ─────────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Anthropic ──────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Header für die 1-Stunden-Cache-TTL (cache_control ttl:'1h'). Schadet nicht,
// falls die TTL bereits ohne Beta-Flag unterstützt wird.
const CACHE_TTL_HEADERS = { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' };
// Wird einmalig gesetzt, sobald die API die 1h-TTL ablehnt → danach senden alle
// Pfade nur noch den regulären 5-Min-Cache (kein wiederholtes Anlaufen ins 400).
let extendedTtlDisabled = false;

// Entfernt ttl:'1h' aus allen cache_control-Markierungen → Fallback auf den
// regulären 5-Min-Cache, falls die erweiterte TTL nicht verfügbar ist.
function stripCacheTtl(params) {
  const fix = b => {
    if (b && b.cache_control && b.cache_control.ttl) {
      b.cache_control = { type: b.cache_control.type || 'ephemeral' };
    }
  };
  if (Array.isArray(params.system)) params.system.forEach(fix);
  if (Array.isArray(params.messages)) {
    for (const m of params.messages) if (Array.isArray(m.content)) m.content.forEach(fix);
  }
}
const isTtlError = e => e && e.status === 400 && /ttl|cache|beta/i.test(e.message || '');
const ttlOpts = () => (extendedTtlDisabled ? {} : { headers: CACHE_TTL_HEADERS });

async function callClaude(params, maxRetries = 5, extraOpts = {}) {
  if (extendedTtlDisabled) stripCacheTtl(params);
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params, { ...ttlOpts(), ...extraOpts });
    } catch (e) {
      // 1h-Cache nicht freigeschaltet? Einmalig TTL strippen und ohne Header neu
      // versuchen, statt die ganze Anfrage scheitern zu lassen.
      if (!extendedTtlDisabled && isTtlError(e)) {
        console.warn('1h-Cache nicht verfügbar – Fallback auf 5-Min-Cache:', e.message);
        extendedTtlDisabled = true;
        stripCacheTtl(params);
        continue;
      }
      const retryable = e.status === 529 ||
        (e.message && (e.message.includes('overloaded') || e.message.includes('529')));
      if (retryable && attempt < maxRetries) {
        // backoff: 3s, 6s, 12s, 24s, 48s
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 3000));
        continue;
      }
      throw e;
    }
  }
}

// Cost per token in EUR (approximate, based on USD/EUR 0.92)
const TOKEN_COST = {
  'claude-sonnet-4-6':        { in: 0.00000276, out: 0.0000138  },
  'claude-haiku-4-5-20251001':{ in: 0.00000023, out: 0.00000115 },
};

// Anthropic rechnet gecachte Tokens SEPARAT ab und liefert sie NICHT in
// usage.input_tokens, sondern in eigenen Feldern. Wer nur input_tokens zählt,
// unterschätzt die echten Kosten massiv (der große, gecachte Unterlagen-Block
// zählt sonst als 0 €). Cache-WRITE = 1,25× Input, Cache-READ = 0,1× Input.
function usageCost(model, usage = {}) {
  const mc = TOKEN_COST[model] || TOKEN_COST['claude-sonnet-4-6'];
  const inTok   = usage.input_tokens || 0;
  const outTok  = usage.output_tokens || 0;
  const cacheR  = usage.cache_read_input_tokens || 0;
  // Cache-Writes nach TTL getrennt abrechnen: 5-Min = 1,25×, 1-Std = 2× Input.
  // Anthropic liefert die Aufschlüsselung in usage.cache_creation; fehlt sie,
  // gilt der Summenwert als 5-Min-Write (alte API ohne 1h-TTL).
  const cc = usage.cache_creation || {};
  const cacheW5  = (cc.ephemeral_5m_input_tokens != null)
    ? cc.ephemeral_5m_input_tokens
    : (usage.cache_creation_input_tokens || 0);
  const cacheW1h = cc.ephemeral_1h_input_tokens || 0;
  return inTok * mc.in + outTok * mc.out
       + cacheW5 * mc.in * 1.25 + cacheW1h * mc.in * 2 + cacheR * mc.in * 0.1;
}
async function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query('SELECT cost_eur, calls FROM daily_usage WHERE date=$1', [today]);
  return { today, cost: rows[0]?.cost_eur || 0, calls: rows[0]?.calls || 0 };
}

// Gibt eine Fehlermeldung zurück, wenn das globale ODER das persönliche
// Tagesbudget erschöpft ist – sonst null. Zentral, damit ALLE bezahlten
// Routen (auch /api/local* via Haiku) dieselbe Obergrenze durchsetzen.
const USER_DAILY_LIMIT = 1.0;
async function usageLimitError(userId) {
  const { today, cost } = await checkDailyLimit();
  const dailyLimit = await getDailyLimit();
  if (cost >= dailyLimit) {
    return `Tageslimit erreicht (${cost.toFixed(2)}€ / ${dailyLimit.toFixed(2)}€). Morgen wieder verfügbar.`;
  }
  try {
    const { rows } = await pool.query(
      'SELECT cost_eur FROM user_usage WHERE user_id=$1 AND date=$2', [userId, today]
    );
    if (parseFloat(rows[0]?.cost_eur || 0) >= USER_DAILY_LIMIT) {
      return `Dein persönliches Tageslimit (${USER_DAILY_LIMIT.toFixed(2)}€) ist aufgebraucht. Morgen wieder verfügbar.`;
    }
  } catch (_) {}
  return null;
}

async function recordUsage(today, model, usage = {}, userId = null, feature = null) {
  const cost = usageCost(model, usage);
  // tokens_in inkl. Cache-Tokens, damit die Statistik dem echten Verbrauch entspricht.
  const inputTokens = (usage.input_tokens || 0)
                    + (usage.cache_creation_input_tokens || 0)
                    + (usage.cache_read_input_tokens || 0);
  const outputTokens = usage.output_tokens || 0;
  const { rows } = await pool.query(`
    INSERT INTO daily_usage (date, cost_eur, calls, tokens_in, tokens_out)
    VALUES ($1, $2, 1, $3, $4)
    ON CONFLICT (date) DO UPDATE SET
      cost_eur   = daily_usage.cost_eur + $2,
      calls      = daily_usage.calls + 1,
      tokens_in  = daily_usage.tokens_in + $3,
      tokens_out = daily_usage.tokens_out + $4
    RETURNING cost_eur
  `, [today, cost, inputTokens, outputTokens]);
  if (userId) {
    await pool.query(`
      INSERT INTO user_usage (user_id, date, cost_eur, calls)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (user_id, date) DO UPDATE SET
        cost_eur = user_usage.cost_eur + $3,
        calls    = user_usage.calls + 1
    `, [userId, today, cost]).catch(() => {});
  }
  if (feature) {
    await pool.query(`
      INSERT INTO feature_usage (feature, date, calls)
      VALUES ($1, $2, 1)
      ON CONFLICT (feature, date) DO UPDATE SET calls = feature_usage.calls + 1
    `, [feature, today]).catch(() => {});
  }
  return rows[0]?.cost_eur || 0;
}

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // CSP handled by nginx
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Fängt fehlerhafte JSON-Bodies ab (z.B. Client sendet "subject_id":, ohne Wert),
// damit ein Parse-Fehler sauber als 400 zurückkommt statt als ungefangener Stacktrace.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Ungültiger JSON-Body' });
  }
  next(err);
});

// Rate limiting for Claude API calls
const claudeLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Zu viele Anfragen. Bitte warte eine Minute.' },
});

// ── File upload (PDFs) ─────────────────────────────────────────────────────
const upload = multer({
  dest: '/tmp/nachhilfe-uploads/',
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/')) cb(null, true);
    else cb(new Error('Nur PDF und Text-Dateien erlaubt'));
  },
});

// ── Static frontend ────────────────────────────────────────────────────────
// Assets (app.js/style.css) sind per ?v=-Query versioniert → bei jeder Version
// neue URL, daher 30 Tage cachebar (Wiederbesuche/PWA-Reloads ohne Re-Download).
// index.html & sw.js dürfen NIE lange gecacht werden, sonst sieht der Nutzer
// neue ?v=-Bumps nicht und der Service Worker aktualisiert nicht.
app.use(express.static(path.join(__dirname, '../docs'), {
  maxAge: '30d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Sitzung abgelaufen – bitte neu anmelden' }); }
}

// Verify the logged-in user owns the subject referenced by :id.
// Mounted on /api/subjects/:id so every sub-resource (messages, documents,
// cards, quiz, glossar, cheat, topics, aufgaben, klausuren, …) is isolated
// per user and one account can never read or modify another account's data.
async function assertOwnsSubject(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM subjects WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fach nicht gefunden' });
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  if (username.length < 3)  return res.status(400).json({ error: 'Benutzername mindestens 3 Zeichen' });
  if (password.length < 6)  return res.status(400).json({ error: 'Passwort mindestens 6 Zeichen' });
  const uname = username.trim().toLowerCase();
  try {
    // First user or ADMIN_USERNAME → auto-approved; everyone else needs manual approval
    const { rows: existing } = await pool.query('SELECT COUNT(*) FROM users');
    const isFirst   = parseInt(existing[0].count) === 0;
    const isAdmin   = ADMIN_USER && uname === ADMIN_USER;
    const approved  = isFirst || isAdmin;
    const approvalToken = approved ? null : require('crypto').randomBytes(24).toString('hex');

    const isAdminUser = isFirst || isAdmin;
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, approved, approval_token, is_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, approved, is_admin',
      [uname, hash, approved, approvalToken, isAdminUser]
    );

    if (!approved) {
      const userId = rows[0].id;
      await sendTelegramButtons(
        `🆕 <b>Neuer Registrierungsantrag</b>\n\n👤 Benutzername: <code>${uname}</code>\n📅 ${new Date().toLocaleString('de-DE')}`,
        [[
          { text: '✅ Freischalten', callback_data: `approve:${userId}` },
          { text: '❌ Ablehnen',    callback_data: `reject:${userId}` },
        ]]
      );
      return res.status(202).json({ pending: true, message: 'Dein Konto wartet auf Freischaltung durch den Admin.' });
    }

    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: rows[0].is_admin || false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: rows[0].is_admin || false });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/approval-status', async (req, res) => {
  const username = (req.query.username || '').toLowerCase().trim();
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const { rows } = await pool.query(
      'SELECT approved FROM users WHERE LOWER(username)=$1', [username]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ approved: rows[0].approved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/approve', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Ungültiger Link.');
  try {
    const { rows } = await pool.query(
      'UPDATE users SET approved=true, approval_token=NULL WHERE approval_token=$1 RETURNING username',
      [token]
    );
    if (!rows.length) return res.status(404).send('Link ungültig oder bereits verwendet.');
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h1>✅ Konto freigeschaltet</h1>
      <p>Der Benutzer <strong>${rows[0].username}</strong> kann sich jetzt anmelden.</p>
    </body></html>`);
  } catch (e) { res.status(500).send('Fehler: ' + e.message); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username.trim().toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash)))
      return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
    if (!rows[0].approved)
      return res.status(403).json({ error: 'Dein Konto wurde noch nicht freigeschaltet. Bitte warte auf die Bestätigung.' });
    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: rows[0].is_admin || false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: rows[0].is_admin || false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fester Demo-Account: legt bei Bedarf einen vorab freigeschalteten Demo-Benutzer
// an (ohne Telegram-Freischaltung) und gibt ein Token zurück. Alle Demo-Besucher
// teilen sich dasselbe Konto und damit dasselbe Demo-Fach. ON CONFLICT macht den
// Aufruf race-sicher, falls mehrere Besucher gleichzeitig zum ersten Mal klicken.
const DEMO_USERNAME = 'demo';
app.post('/api/auth/demo', async (req, res) => {
  try {
    const hash = await bcrypt.hash(require('crypto').randomBytes(18).toString('hex'), 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, approved, is_admin)
       VALUES ($1,$2,true,false) ON CONFLICT (username) DO NOTHING`,
      [DEMO_USERNAME, hash]
    );
    const { rows } = await pool.query('SELECT id, username FROM users WHERE username=$1', [DEMO_USERNAME]);
    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, is_admin: false }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: rows[0].username, is_admin: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
    res.json({ username: req.user.username, is_admin: rows[0]?.is_admin || false });
  } catch { res.json({ username: req.user.username, is_admin: req.user.is_admin || false }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUBJECTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.emoji, s.color, s.custom_prompt, s.created_at,
        COUNT(DISTINCT d.id)::int        AS doc_count,
        COUNT(DISTINCT qr.id)::int       AS quiz_count,
        ROUND(AVG(qr.score::float / NULLIF(qr.total,0) * 100))::int AS avg_score
      FROM subjects s
      LEFT JOIN documents   d  ON d.subject_id  = s.id
      LEFT JOIN quiz_results qr ON qr.subject_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects', authMiddleware, async (req, res) => {
  const { id, name, emoji, color } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id und name erforderlich' });
  try {
    // Scope the upsert to the owner: ON CONFLICT only updates a row that already
    // belongs to this user. A subject id that exists for *another* user must not
    // be silently overwritten (cross-user data integrity).
    const { rows } = await pool.query(
      `INSERT INTO subjects (id,name,emoji,color,user_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3,color=$4
       WHERE subjects.user_id=$5 RETURNING *`,
      [id, name, emoji || '📚', color || '#5856d6', req.user.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Fach-ID bereits vergeben' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// All /api/subjects/:id/* routes below require ownership of the subject.
app.use('/api/subjects/:id', authMiddleware, assertOwnsSubject);

app.patch('/api/subjects/:id', async (req, res) => {
  const { custom_prompt } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE subjects SET custom_prompt=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [custom_prompt || '', req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    await Promise.all([
      pool.query('DELETE FROM cheat_sheets     WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM scanned_topics   WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM saved_aufgaben   WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM saved_klausuren  WHERE subject_id=$1', [req.params.id]),
      pool.query('DELETE FROM learned_topics   WHERE subject_id=$1', [req.params.id]),
    ]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGES (chat history)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT role,content,created_at FROM messages WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/messages', async (req, res) => {
  const { role, content } = req.body;
  if (!role || !content) return res.status(400).json({ error: 'role und content erforderlich' });
  try {
    await pool.query(
      'INSERT INTO messages (subject_id,role,content) VALUES ($1,$2,$3)',
      [req.params.id, role, content]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/messages', async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════
// ── Wissensbasis (Phase 1) ──────────────────────────────────────────────────
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

// Lokales Embedding via Ollama (nomic, CPU-schnell). null bei Fehler.
// keep_alive: -1 hält das Modell dauerhaft im RAM – warm ~0,1s, sonst Cold-Start
// ~21s beim Nachladen (CPU-VM ohne GPU). Timeout deckt den einmaligen Cold-Load
// nach Server-Neustart ab; danach bleibt das Modell resident.
async function embedText(text) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);   // hängendes Ollama nicht ewig abwarten (deckt 1x Cold-Load ab)
  try {
    const r = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: (text || '').slice(0, 8000), keep_alive: -1 }),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.embedding) && d.embedding.length ? d.embedding : null;
  } catch { return null; }
  finally { clearTimeout(to); }
}

// Toleranter JSON-Extraktor (erstes '{' bis letztes '}').
function safeJsonExtract(text) {
  if (!text) return null;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

// Bergung aus abgeschnittenem JSON: extrahiert die vollständigen Objekte aus dem
// "chunks"-Array einzeln, selbst wenn die Ausgabe mitten im Array abgeschnitten
// wurde (stop_reason=max_tokens). Ein unvollständiges letztes Objekt wird nie
// geschlossen → fällt automatisch weg, der Rest bleibt erhalten. String-/Escape-
// bewusst, damit '{' oder '}' innerhalb von Werten nicht die Klammerzählung stört.
function salvageChunks(text) {
  if (!text) return [];
  const key = text.indexOf('"chunks"');
  if (key < 0) return [];   // ohne "chunks"-Key kein verlässlicher Array-Anker → nichts bergen
  const start = text.indexOf('[', key);
  if (start < 0) return [];
  const out = [];
  let depth = 0, objStart = -1, inStr = false, esc = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      if (--depth === 0 && objStart >= 0) {
        try { out.push(JSON.parse(text.slice(objStart, i + 1))); } catch { /* unbergbar */ }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;   // Array regulär beendet
  }
  return out;
}

const KB_EXTRACT_SYS = `Du strukturierst die Lernunterlagen eines Studenten in eine kompakte, durchsuchbare Wissensbasis.
Gib AUSSCHLIESSLICH ein JSON-Objekt zurück – kein Text davor oder danach:
{
  "topics": ["die Oberthemen, die in diesem Auszug vorkommen"],
  "chunks": [
    {
      "kind": "definition | formel | konzept | beispiel | pruefungsfrage",
      "topic": "Oberthema, zu dem dieser Häppchen gehört",
      "heading": "kurzer Titel (3–8 Wörter)",
      "content": "eigenständig verständliche, kompakte Erklärung/Formel/Beispiel – ausschließlich aus dem Auszug, nichts erfinden",
      "source_ref": "Fundstelle falls erkennbar (z.B. Kapitel/Seite), sonst weglassen"
    }
  ]
}
REGELN: Nur Inhalte aus dem Auszug, KEIN Allgemeinwissen, nichts hinzudichten. Formeln in LaTeX.
Zerlege nach inhaltlichen Einheiten (nicht nach Seiten). Jeder chunk muss FÜR SICH verständlich sein (max ~250 Wörter). Antworte auf Deutsch.`;

// Ein Dokument per Sonnet in chunks zerlegen (große Dokumente in Fenstern).
// Rückgabe: { chunks, truncated, budgetHit } – truncated = Anzahl geborgener
// (abgeschnittener) Fenster, budgetHit = Abbruch wegen Tagesbudget.
async function structureDocument(content, filename) {
  const WINDOW = 24000, MAX_WINDOWS = 8;   // Kostendeckel für sehr große Dokumente
  const windows = [];
  for (let i = 0; i < content.length && windows.length < MAX_WINDOWS; i += WINDOW) {
    windows.push(content.slice(i, i + WINDOW));
  }
  const chunks = [];
  let truncated = 0, budgetHit = false;
  for (let wi = 0; wi < windows.length; wi++) {
    // Budget ZWISCHEN den Fenstern prüfen, damit ein einzelnes Riesen-Dokument
    // das Tagesbudget nicht in einem Rutsch (bis zu 8 Sonnet-Calls) überschreitet.
    if (wi > 0) {
      const { cost } = await checkDailyLimit();
      if (cost >= await getDailyLimit()) { budgetHit = true; break; }
    }
    const r = await callClaude({
      // max_tokens großzügig: ein 24k-Fenster erzeugt oft > 4096 Tokens JSON →
      // sonst mittendrin abgeschnitten → 0 Chunks trotz voller Sonnet-Kosten.
      model: 'claude-sonnet-4-6', max_tokens: 8192,
      system: KB_EXTRACT_SYS,
      messages: [{ role: 'user', content: `Dateiname: ${filename}\n\nAUSZUG:\n${windows[wi]}` }],
    }, 2, { timeout: 120000 });   // harter Timeout: hängt ein Doku, wird es übersprungen statt alles zu blockieren
    // Kosten global + unter Feature 'kb_index' erfassen (userId=null → zählt nicht
    // gegen das interaktive 1€-Tageslimit des Nutzers, ist aber im Gesamtbudget sichtbar).
    // await, damit die Kosten dieses Fensters im Budget-Check des nächsten Fensters (oben) sichtbar sind.
    await recordUsage(new Date().toISOString().slice(0, 10), 'claude-sonnet-4-6', r.usage || {}, null, 'kb_index').catch(() => {});
    const text = r.content?.[0]?.text || '';
    let parsed = safeJsonExtract(text)?.chunks;
    // Abgeschnitten (max_tokens) oder unparsebar → vollständige Objekte einzeln bergen.
    if (!Array.isArray(parsed) || r.stop_reason === 'max_tokens') {
      const salvaged = salvageChunks(text);
      if (salvaged.length > (Array.isArray(parsed) ? parsed.length : 0)) {
        parsed = salvaged;
        if (r.stop_reason === 'max_tokens') truncated++;
      }
    }
    if (Array.isArray(parsed)) chunks.push(...parsed);
  }
  if (truncated) console.warn(`structureDocument: ${filename} – ${truncated} Fenster abgeschnitten, per Salvage geborgen`);
  return { chunks, truncated, budgetHit };
}

async function setKbStatus(subjectId, status) {
  await pool.query(
    `INSERT INTO subject_kb (subject_id, status) VALUES ($1,$2)
     ON CONFLICT (subject_id) DO UPDATE SET status=$2, updated_at=now()`,
    [subjectId, status]
  ).catch(() => {});
}

// Themen-Landkarte je Fach aus den chunks neu aufbauen.
// forceStatus: überschreibt das aus der Chunk-Zahl abgeleitete Ergebnis (z.B.
// 'pending' bei Budget-Abbruch) – so wird der Status atomar im selben Write gesetzt
// und es entsteht kein kurzes 'ready'-Sichtbarkeitsfenster vor einer Korrektur.
async function rebuildSubjectKb(subjectId, forceStatus) {
  const { rows } = await pool.query(
    'SELECT topic, heading FROM doc_chunks WHERE subject_id=$1 ORDER BY topic, id', [subjectId]
  );
  const byTopic = {};
  for (const r of rows) (byTopic[r.topic || 'Sonstiges'] ||= []).push(r.heading);
  const overview = Object.entries(byTopic)
    .map(([t, hs]) => `• ${t}: ${[...new Set(hs.filter(Boolean))].slice(0, 8).join('; ')}`)
    .join('\n');
  // 0 chunks (z.B. wegen Budget-Stopp) NICHT als 'ready' ausweisen → 'pending'.
  const status = forceStatus || (rows.length ? 'ready' : 'pending');
  await pool.query(
    `INSERT INTO subject_kb (subject_id, overview, status, updated_at)
     VALUES ($1,$2,$3,now())
     ON CONFLICT (subject_id) DO UPDATE SET overview=$2, status=$3,
       kb_version=subject_kb.kb_version+1, updated_at=now()`,
    [subjectId, overview, status]
  );
}

// Ein Dokument indexieren: strukturieren → embedden → speichern. Re-Index-sicher.
// opts.skipFinalize: im Batch (Reindex ganzer Fächer) den Status NICHT pro Doku auf
// 'ready' setzen – das macht der Aufrufer einmal am Ende.
// Rückgabe: 'ok' | 'budget' | 'error' – der Batch-Reindex bricht bei 'budget'
// ab und markiert die KB als unvollständig statt fälschlich 'ready'.
async function indexDocument(subjectId, documentId, opts = {}) {
  try {
    // Budget-Schutz: bei erschöpftem Tagesbudget nicht teuer indexieren – später per Reindex.
    const { cost } = await checkDailyLimit();
    if (cost >= await getDailyLimit()) { if (!opts.skipFinalize) await setKbStatus(subjectId, 'pending'); return 'budget'; }

    if (!opts.skipFinalize) await setKbStatus(subjectId, 'indexing');
    const { rows } = await pool.query(
      'SELECT filename, content FROM documents WHERE id=$1 AND subject_id=$2', [documentId, subjectId]
    );
    if (!rows.length || !rows[0].content || rows[0].content.length < 20) {
      if (!opts.skipFinalize) await rebuildSubjectKb(subjectId);
      return 'ok';
    }

    const { chunks, budgetHit } = await structureDocument(rows[0].content, rows[0].filename);
    await pool.query('DELETE FROM doc_chunks WHERE document_id=$1', [documentId]);  // alte Version weg
    for (const c of chunks) {
      const emb = await embedText(`${c.topic || ''} ${c.heading || ''} ${c.content || ''}`);
      await pool.query(
        `INSERT INTO doc_chunks (subject_id, document_id, kind, topic, heading, content, source_ref, tokens, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [subjectId, documentId, c.kind || null, c.topic || null, c.heading || null,
         c.content || '', c.source_ref || rows[0].filename,
         Math.round((c.content || '').length / 4), emb ? JSON.stringify(emb) : null]
      );
    }
    // budgetHit → 'pending' atomar im rebuild setzen (Doku nur teil-indexiert).
    if (!opts.skipFinalize) await rebuildSubjectKb(subjectId, budgetHit ? 'pending' : undefined);
    return budgetHit ? 'budget' : 'ok';
  } catch (e) {
    console.error('indexDocument failed:', e.message);
    if (!opts.skipFinalize) await setKbStatus(subjectId, 'error');
    return 'error';
  }
}

// ── Retrieval (Phase 2): semantische Suche über die Wissensbasis ─────────────
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
const KB_KIND_LABEL = { definition: 'Definition', formel: 'Formel', konzept: 'Konzept', beispiel: 'Beispiel', pruefungsfrage: 'Prüfungsfrage' };

// Top-k chunks eines Fachs zu einer Anfrage. null = KB nicht bereit / kein
// Embedding / keine chunks → der Aufrufer nutzt dann den bisherigen Keyword-RAG.
async function rankChunks(subjectId, query, k = 6) {
  const kb = (await pool.query('SELECT status FROM subject_kb WHERE subject_id=$1', [subjectId])).rows[0];
  if (!kb || kb.status !== 'ready') return null;
  // Query-Embedding (Ollama) und Chunk-Fetch (DB) hängen nicht voneinander ab →
  // parallel statt sequenziell, spart die ~100ms Embedding-Zeit vor jeder Antwort.
  const [qvec, chunkRes] = await Promise.all([
    embedText(query),
    pool.query(
      'SELECT kind, topic, heading, content, source_ref, embedding FROM doc_chunks WHERE subject_id=$1 AND embedding IS NOT NULL', [subjectId]
    ),
  ]);
  if (!qvec) return null;
  const { rows } = chunkRes;
  if (!rows.length) return null;
  return rows
    .map(r => ({ ...r, score: cosineSim(qvec, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Fertiger Kontext-String (Themen-Überblick + Top-k chunks). null → Keyword-Fallback.
async function retrieveContext(subjectId, query, k = 6) {
  // Ranking (Embedding + Cosine) und Overview-Query sind unabhängig → parallel.
  const [ranked, overviewRes] = await Promise.all([
    rankChunks(subjectId, query, k),
    pool.query('SELECT overview FROM subject_kb WHERE subject_id=$1', [subjectId]),
  ]);
  if (!ranked || !ranked.length) return null;
  const overview = overviewRes.rows[0]?.overview;
  const body = ranked.map(r =>
    `[${KB_KIND_LABEL[r.kind] || 'Info'}${r.topic ? ' · ' + r.topic : ''}] ${r.heading || ''}\n${r.content}`
  ).join('\n\n---\n\n');
  return `${overview ? `Themen-Überblick des Fachs:\n${overview}\n\n` : ''}Relevante Auszüge aus den Unterlagen:\n${body}`;
}

// Head/Mid/Tail-Stichprobe der vollen Unterlagen (spiegelt docsForPrompt() im Client).
// Fallback für Generierungs-Pfade, wenn die Wissensbasis (noch) nicht bereit ist.
function sampleDocs(txt, limit = 40000) {
  if (!txt) return '';
  if (txt.length <= limit) return txt;
  const headLen = Math.floor(limit * 0.45);
  const midLen  = Math.floor(limit * 0.30);
  const tailLen = limit - headLen - midLen;
  const midStart = Math.floor(txt.length / 2 - midLen / 2);
  return `${txt.slice(0, headLen)}\n\n[…Auszug aus der Mitte der Unterlagen…]\n\n` +
         `${txt.slice(midStart, midStart + midLen)}\n\n[…Auszug vom Ende der Unterlagen…]\n\n` +
         `${txt.slice(txt.length - tailLen)}`;
}

// Kontext für Generierungs-Pfade (/api/local): semantischer KB-Treffer → kuratierter
// Block; sonst die vollen Fach-Unterlagen aus der DB (Generierung braucht Breite, der
// Client schickt den 40k-Dump dann nicht mehr selbst mit). '' wenn gar nichts da ist.
async function generationDocContext(subjectId, query, k = 6) {
  let ctx = '';
  if (query) {
    try { ctx = (await retrieveContext(subjectId, query, k)) || ''; }
    catch (e) { console.error('KB retrieve (local) skipped:', e.message); }
  }
  if (ctx) return ctx;
  try {
    const { rows } = await pool.query(
      'SELECT content FROM documents WHERE subject_id=$1 AND length(content) > 0 ORDER BY uploaded_at', [subjectId]
    );
    return sampleDocs(rows.map(r => r.content).filter(Boolean).join('\n\n'), 40000);
  } catch (e) { console.error('full-docs fallback skipped:', e.message); return ''; }
}

app.get('/api/subjects/:id/documents', async (req, res) => {
  try {
    // usable_chars spiegelt usableDocChars() in SQL: "=== Datei ==="-Header-Zeilen
    // und Whitespace raus. So sieht das UI, welche Uploads nur leere Hüllen sind
    // (fehlgeschlagene OCR vor v253) und als "nicht lesbar" markiert werden können.
    const USABLE = `length(regexp_replace(regexp_replace(content, '^===.*===$', '', 'ng'), '\\s', '', 'g'))`;
    let rows;
    try {
      ({ rows } = await pool.query(
        `SELECT id,filename,doc_type,uploaded_at,${USABLE} AS usable_chars FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC`,
        [req.params.id]
      ));
    } catch (e) {
      // Schema drift on an old prod DB (doc_type column missing): degrade
      // gracefully to the list without the tag instead of 500-ing.
      console.error('documents list without doc_type:', e.message);
      ({ rows } = await pool.query(
        `SELECT id,filename,NULL AS doc_type,uploaded_at,${USABLE} AS usable_chars FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC`,
        [req.params.id]
      ));
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/subjects/:id/documents/:docId', async (req, res) => {
  const { doc_type } = req.body;
  try {
    await pool.query(
      'UPDATE documents SET doc_type=$1 WHERE id=$2 AND subject_id=$3',
      [doc_type || null, req.params.docId, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return short snippets of ALL documents for breadth-first topic scanning
app.get('/api/subjects/:id/documents/snippets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT filename, LEFT(content, 600) AS snippet FROM documents WHERE subject_id=$1 ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return content of documents filtered by doc_type (for exam-style context)
app.get('/api/subjects/:id/documents/typed', async (req, res) => {
  const types = (req.query.types || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!types.length) return res.json([]);
  try {
    const placeholders = types.map((_, i) => `$${i + 2}`).join(',');
    const { rows } = await pool.query(
      `SELECT filename, doc_type, LEFT(content, 8000) AS content FROM documents WHERE subject_id=$1 AND doc_type IN (${placeholders}) ORDER BY uploaded_at DESC`,
      [req.params.id, ...types]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Return the full text of ALL documents. Server-side fallback to rebuild the
// local prompt context (sessionTxt) on a fresh browser/device — or the shared
// demo account — where localforage is empty even though the server has docs.
app.get('/api/subjects/:id/documents/content', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT filename, content FROM documents WHERE subject_id=$1 ORDER BY uploaded_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Nutzbare Zeichen eines extrahierten Dokuments: ohne die vom Client eingefügten
// "=== Dateiname ==="-Header und ohne Whitespace. Darunter liegende Uploads sind
// leere Hüllen (nur Header), wie sie fehlgeschlagene OCR bisher hinterließ.
const MIN_DOC_CHARS = 40;
function usableDocChars(content) {
  return String(content).replace(/^===.*===$/gm, '').replace(/\s/g, '').length;
}

// Accept pre-extracted text (from client-side PDF.js)
app.post('/api/subjects/:id/documents/text', async (req, res) => {
  const { filename, content, skipCards } = req.body;
  if (!filename || !content) return res.status(400).json({ error: 'filename und content erforderlich' });
  // Faktisch leere Extraktionen (Bild-/Scan-PDFs, deren OCR nichts lieferte) nicht
  // speichern: solche Docs liegen sonst unsichtbar tot in der Sammlung – kein
  // RAG-Kontext, keine Themen, aber "erfolgreich hochgeladen" für den Nutzer.
  if (usableDocChars(content) < MIN_DOC_CHARS) {
    return res.status(422).json({ error: 'Kein lesbarer Text im Dokument (Scan-/Bild-PDF?). Bitte erneut hochladen – Bildseiten werden dann per Texterkennung gelesen.' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO documents (subject_id,filename,content) VALUES ($1,$2,$3) RETURNING id,filename,uploaded_at',
      [req.params.id, filename, content]
    );
    // Auto-generate cards in background (skipCards: z. B. beim vorab geseedeten
    // Demo-Fach, das bereits fertige Karten mitbringt).
    if (!skipCards) {
      autoGenerateCards(req.params.id, filename, content).catch(e => console.error('Auto-cards:', e.message));
    }
    // Wissensbasis (Phase 1) im Hintergrund aufbauen – blockiert den Upload nicht.
    indexDocument(req.params.id, rows[0].id).catch(e => console.error('KB index error:', e.message));
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    let content = '';
    if (req.file.mimetype === 'application/pdf') {
      // pdftotext asynchron (blockiert den Event-Loop nicht) und ohne Shell
      // (execFile mit Argument-Array → keine Shell-Injection über den Pfad).
      try {
        const { execFile } = require('child_process');
        const { promisify } = require('util');
        const { stdout } = await promisify(execFile)('pdftotext', [req.file.path, '-'],
          { maxBuffer: 25 * 1024 * 1024, timeout: 30000 });
        content = stdout;
      } catch (err) {
        // pdftotext fehlt/scheitert → KEINE Base64-Rohdaten speichern; die würden
        // RAG-Kontext und Auto-Karten vergiften. Stattdessen ehrlich fehlschlagen.
        console.error('pdftotext failed:', err.message);
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(422).json({
          error: 'PDF konnte serverseitig nicht gelesen werden. Bitte lade die Datei erneut hoch – der Text wird dann direkt im Browser extrahiert.',
        });
      }
    } else {
      content = fs.readFileSync(req.file.path, 'utf8');
    }
    fs.unlinkSync(req.file.path);

    // Gleiche Leer-Prüfung wie beim Text-Upload: pdftotext liefert bei reinen
    // Bild-PDFs "erfolgreich" einen leeren String – das ist kein lesbares Dokument.
    if (usableDocChars(content) < MIN_DOC_CHARS) {
      return res.status(422).json({
        error: 'Kein lesbarer Text im Dokument (Scan-/Bild-PDF?). Bitte über die App hochladen – Bildseiten werden dort per Texterkennung gelesen.',
      });
    }

    const { rows } = await pool.query(
      'INSERT INTO documents (subject_id,filename,content) VALUES ($1,$2,$3) RETURNING id,filename,uploaded_at',
      [req.params.id, req.file.originalname, content]
    );
    // Wissensbasis (Phase 1) im Hintergrund aufbauen – blockiert den Upload nicht.
    indexDocument(req.params.id, rows[0].id).catch(e => console.error('KB index error:', e.message));
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/subjects/:id/documents/:docId', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id=$1 AND subject_id=$2', [req.params.docId, req.params.id]);
    // Wissensbasis konsistent halten: chunks des Dokuments entfernen, Landkarte neu bauen.
    await pool.query('DELETE FROM doc_chunks WHERE document_id=$1', [req.params.docId]).catch(() => {});
    rebuildSubjectKb(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Status der Wissensbasis + Stichprobe der chunks (zum Prüfen der Qualität).
app.get('/api/subjects/:id/kb', async (req, res) => {
  try {
    const sid = req.params.id;
    const kb = (await pool.query(
      'SELECT status, overview, kb_version, updated_at FROM subject_kb WHERE subject_id=$1', [sid]
    )).rows[0] || { status: 'none' };
    const c = (await pool.query(
      'SELECT count(*)::int AS n, count(embedding)::int AS e FROM doc_chunks WHERE subject_id=$1', [sid]
    )).rows[0];
    const sample = (await pool.query(
      'SELECT kind, topic, heading, LEFT(content,240) AS content FROM doc_chunks WHERE subject_id=$1 ORDER BY id LIMIT 25', [sid]
    )).rows;
    res.json({ ...kb, chunks: c.n, embedded: c.e, sample });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Wissensbasis für ein Fach (neu) aufbauen – auch für vor dem Feature hochgeladene Dokumente.
app.post('/api/subjects/:id/kb/reindex', async (req, res) => {
  try {
    const sid = req.params.id;
    // Budget vorab prüfen → klares Feedback statt stiller, leerer Indexierung.
    const { cost } = await checkDailyLimit();
    if (cost >= await getDailyLimit()) {
      return res.status(429).json({ error: 'Tagesbudget erreicht – Indexierung morgen erneut oder Limit erhöhen.' });
    }
    const docs = (await pool.query('SELECT id FROM documents WHERE subject_id=$1', [sid])).rows;
    res.json({ started: true, documents: docs.length });   // sofort antworten
    (async () => {
      try {
        await pool.query('DELETE FROM doc_chunks WHERE subject_id=$1', [sid]).catch(() => {});
        await setKbStatus(sid, 'indexing');
        let budgetHit = false;
        for (const d of docs) {
          const st = await indexDocument(sid, d.id, { skipFinalize: true });
          if (st === 'budget') { budgetHit = true; break; }   // Rest bliebe un-indexiert → abbrechen
        }
        // Overview bauen + Status. Budget-Abbruch mitten im Batch → KB ist
        // unvollständig, NICHT als 'ready' ausweisen (der Client nutzt bei
        // 'pending' den vollständigen Inline-Pfad) – atomar im rebuild gesetzt.
        await rebuildSubjectKb(sid, budgetHit ? 'pending' : undefined);
      } catch (e) { console.error('KB reindex failed:', e.message); await setKbStatus(sid, 'error'); }
    })();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Retrieval-Test: zeigt, welche chunks die semantische Suche zu einer Anfrage liefert.
app.get('/api/subjects/:id/kb/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().slice(0, 300);
    if (!q) return res.status(400).json({ error: 'q (Suchbegriff) erforderlich' });
    const ranked = await rankChunks(req.params.id, q, 8);
    if (!ranked) return res.json({ query: q, ready: false, results: [] });
    res.json({
      query: q, ready: true,
      results: ranked.map(r => ({
        score: Math.round(r.score * 1000) / 1000,
        kind: r.kind, topic: r.topic, heading: r.heading,
        preview: (r.content || '').slice(0, 160),
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE PROXY (hides API key)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/claude', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, system, max_tokens, model } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  try {
    // Build system blocks array (preserves cache_control for prompt caching)
    let systemBlocks = Array.isArray(system)
      ? system
      : system ? [{ type: 'text', text: system }] : [];

    // RAG: inject relevant document context if subject_id provided.
    // Only for subjects the requesting user actually owns — otherwise the RAG
    // path could leak another user's documents into the response.
    let ownsSubject = false;
    let kbHit = false;   // true, wenn die Wissensbasis (semantisch) sauberen Kontext lieferte
    if (req.body.subject_id) {
      const { rows } = await pool.query(
        'SELECT 1 FROM subjects WHERE id=$1 AND user_id=$2',
        [req.body.subject_id, req.user.id]
      );
      ownsSubject = rows.length > 0;
    }
    if (req.body.subject_id && ownsSubject) {
      const lastMsg = messages[messages.length - 1];
      const query = typeof lastMsg?.content === 'string' ? lastMsg.content.slice(0, 300) : '';
      let docContext = '';

      // Phase 2: zuerst semantische Suche über die Wissensbasis (sauber + kompakt).
      // Findet sie nichts (KB noch nicht bereit), greift unten der bisherige Keyword-RAG.
      if (query) {
        try { docContext = (await retrieveContext(req.body.subject_id, query, 6)) || ''; }
        catch (e) { console.error('KB retrieve skipped:', e.message); }
      }
      kbHit = !!docContext;   // KB lieferte sauberen Kontext → Chat darf auf Haiku

      const docLabel = r => {
        const types = { skript:'Vorlesungsskript', formelsammlung:'Formelsammlung', klausur:'Klausur', altklausur:'Altklausur', uebungsblatt:'Übungsblatt', zusammenfassung:'Zusammenfassung', lehrbuch:'Lehrbuch' };
        return r.doc_type && types[r.doc_type] ? `[${types[r.doc_type]}: ${r.filename}]` : `[${r.filename}]`;
      };

      if (!docContext && query) {
        try {
          const { rows } = await pool.query(`
            SELECT filename, doc_type,
                   ts_headline('german', content, plainto_tsquery('german', $1),
                     'MaxWords=80, MinWords=30, StartSel=, StopSel=') AS snippet
            FROM documents
            WHERE subject_id=$2 AND length(content) > 10
              AND to_tsvector('german', content) @@ plainto_tsquery('german', $1)
            ORDER BY ts_rank(to_tsvector('german', content), plainto_tsquery('german', $1)) DESC
            LIMIT 4
          `, [query, req.body.subject_id]);
          if (rows.length) docContext = rows.map(r => `${docLabel(r)}\n${r.snippet}`).join('\n\n---\n\n');
        } catch {}
      }

      if (!docContext) {
        // Bounded fallback when full-text search finds nothing: cap at the 4 most
        // recent documents so subjects with many uploads can't blow up token cost.
        // Wrapped in try/catch so a DB without the doc_type column (schema drift on
        // an old prod DB) degrades to "no context" instead of 500-ing the chat.
        try {
          const { rows } = await pool.query(
            'SELECT filename, doc_type, content FROM documents WHERE subject_id=$1 ORDER BY uploaded_at DESC LIMIT 4', [req.body.subject_id]
          );
          if (rows.length) docContext = rows.map(r => `${docLabel(r)}\n${r.content.slice(0, 4000)}`).join('\n\n---\n\n');
        } catch (e) { console.error('RAG fallback skipped:', e.message); }
      }

      if (docContext) {
        systemBlocks = [...systemBlocks, { type: 'text', text: `Dokumenten-Kontext:\n${docContext}` }];
      }
    }

    // Limit messages to last 12 to control costs
    const trimmedMessages = messages.slice(-12);

    // Hebel 1: Sobald die Wissensbasis sauberen Kontext geliefert hat (kbHit), reicht
    // das schnelle, günstige Haiku (≈3x schneller bei TTFB + Durchsatz) – der saubere
    // Kontext trägt die Antwort, nicht das Modellwissen. Früher zusätzlich hinter dem
    // Admin-Toggle (kb_chat) versteckt; jetzt automatisch bei JEDEM KB-Treffer. Ohne
    // KB-Kontext (Vision, KB nicht bereit, Allgemeinfrage) bleibt es bei Sonnet bzw.
    // einem explizit angefragten Modell, wo Modellwissen die Qualität bestimmt.
    // Haiku rechnet auf sauberen Aufgaben fehlerfrei (Eval scripts/eval-rechnen.js:
    // 42/42), daher kein Rechen-Sonderweg mehr – die Widerspruchsfreiheit sichert
    // stattdessen v231 client-seitig (frisch lösen ohne kontaminierte Historie).
    const chatModel = kbHit ? 'claude-haiku-4-5-20251001' : (model || 'claude-sonnet-4-6');
    const params = {
      model: chatModel,
      max_tokens: Math.min(max_tokens || 2000, 4096),
      messages: trimmedMessages,
    };
    if (systemBlocks.length) params.system = systemBlocks;

    // Daily + per-user limit check (shared helper)
    const limitMsg = await usageLimitError(req.user.id);
    if (limitMsg) return res.status(429).json({ error: limitMsg });
    const today = new Date().toISOString().slice(0, 10);

    const response = await callClaude(params);
    const feature = req.body.feature || null;

    // Record usage then check 90% threshold (non-blocking)
    recordUsage(today, params.model, response.usage || {}, req.user.id, feature)
     .then(newCost => checkAndNotify90pct(today, newCost))
     .catch(e => console.error('Usage tracking error:', e.message));

    res.json(response);
  } catch (e) {
    console.error('Claude error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA PROXY (local model — free, for batch tasks)
// ═══════════════════════════════════════════════════════════════════════════
const OLLAMA_MODEL        = process.env.OLLAMA_MODEL        || 'phi4:14b';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:7b';
const OLLAMA_URL          = 'http://localhost:11434/v1/chat/completions';

// Local-model toggle. Default OFF: the local model (phi4:14b) exceeded its 60s
// budget on CPU hardware and only wasted time before falling back to Haiku, so
// /api/local + /api/local/stream go straight to Claude Haiku — fast & reliable
// for live use. Set USE_OLLAMA=true to re-enable the free local model (e.g. on
// GPU hardware).
const USE_OLLAMA = process.env.USE_OLLAMA === 'true';
// Vision toggle, same story: llava:7b on a CPU-only VM made the "Aufgabe prüfen"
// check take minutes (1400 Token Bildanalyse @ CPU) and read handwriting/math
// unreliably. Default OFF → /api/local/vision goes to Claude Haiku (vision-fähig,
// Sekunden statt Minuten, Cent-Bruchteile pro Bild, läuft ins Tagesbudget).
// Set USE_OLLAMA_VISION=true to re-enable local llava (e.g. on GPU hardware).
const USE_OLLAMA_VISION = process.env.USE_OLLAMA_VISION === 'true';

function ollamaMsgs(system, messages) {
  const sysText = Array.isArray(system)
    ? system.map(b => b.text || '').join('\n')
    : (system || '');
  return sysText ? [{ role: 'system', content: sysText }, ...messages] : messages;
}

async function callOllama(messages, maxTokens = 2000, jsonMode = false) {
  const body = {
    model: OLLAMA_MODEL, messages, max_tokens: maxTokens,
    stream: false, options: { num_ctx: 16384 },
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`Ollama error ${r.status}`);
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Ollama returned unexpected response shape');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Routes a batch completion to the local model or straight to Claude Haiku,
// honoring USE_OLLAMA. Use this for background/server-side tasks (not the
// request handlers, which record per-user usage themselves).
async function localComplete(messages, maxTokens = 2000, jsonMode = false) {
  if (USE_OLLAMA) return callOllama(messages, maxTokens, jsonMode);
  const r = await callClaude({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages });
  const text = r.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Haiku returned unexpected response shape');
  return text;
}

app.post('/api/local', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, max_tokens, json_mode, feature } = req.body;
  let system = req.body.system;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  // KB-Kontext für Generierungs-Pfade: der Client schickt subject_id + kb_query und
  // lässt den vollen Doku-Block weg (omitDocs). Wir injizieren hier den kuratierten
  // KB-Kontext (bzw. die vollen Unterlagen, falls die KB noch nicht bereit ist).
  if (req.body.subject_id && req.body.kb_query) {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM subjects WHERE id=$1 AND user_id=$2', [req.body.subject_id, req.user.id]
      );
      if (rows.length) {
        const k = Math.min(Math.max(parseInt(req.body.kb_k, 10) || 6, 1), 12);
        const ctx = await generationDocContext(req.body.subject_id, String(req.body.kb_query).slice(0, 500), k);
        if (ctx) {
          const sysArr = Array.isArray(system) ? system : (system ? [{ type: 'text', text: system }] : []);
          system = [...sysArr, { type: 'text', text: `Dokumenten-Kontext:\n${ctx}` }];
        }
      }
    } catch (e) { console.error('local KB inject skipped:', e.message); }
  }
  const callHaiku = async () => {
    const params = { model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 2000, messages };
    if (system) params.system = system;
    const r = await callClaude(params);
    const haikuText = r.content?.[0]?.text;
    if (typeof haikuText !== 'string') throw new Error('Haiku returned unexpected response shape');
    return { text: haikuText, usage: r.usage || {} };
  };
  try {
    // Local model disabled → answer directly with Haiku (fast, reliable).
    if (!USE_OLLAMA) {
      // Haiku ist kostenpflichtig → gleiche Budget-Obergrenze wie /api/claude.
      const limitMsg = await usageLimitError(req.user.id);
      if (limitMsg) return res.status(429).json({ error: limitMsg });
      const { text: haikuText, usage } = await callHaiku();
      const todayH = new Date().toISOString().slice(0, 10);
      recordUsage(todayH, 'claude-haiku-4-5-20251001', usage, req.user.id, feature).catch(() => {});
      return res.json({ content: [{ text: haikuText }] });
    }
    const text = await callOllama(ollamaMsgs(system, messages), max_tokens || 2000, !!json_mode);
    // When json_mode was requested, verify Ollama returned *valid* parseable JSON.
    // Regex alone is not enough — models often produce { } with literal newlines
    // inside strings that break JSON.parse.  Fall back to Haiku for any failure.
    if (json_mode) {
      const repair = s => {
        let inStr = false, esc = false, out = '';
        for (const c of s) {
          if (esc)        { out += c; esc = false; continue; }
          if (c === '\\') { out += c; esc = true;  continue; }
          if (c === '"')  { out += c; inStr = !inStr; continue; }
          if (inStr && c === '\n') { out += '\\n'; continue; }
          if (inStr && c === '\r') { out += '\\r'; continue; }
          out += c;
        }
        return out;
      };
      const m = text.match(/\{[\s\S]*\}/);
      let jsonOk = false;
      if (m) { try { JSON.parse(m[0]); jsonOk = true; } catch { try { JSON.parse(repair(m[0])); jsonOk = true; } catch {} } }
      if (!jsonOk) {
        console.warn('Ollama returned invalid/no JSON in json_mode – falling back to Haiku');
        const { text: haikuText, usage } = await callHaiku();
        const today2 = new Date().toISOString().slice(0, 10);
        recordUsage(today2, 'claude-haiku-4-5-20251001', usage, req.user.id, feature).catch(() => {});
        return res.json({ content: [{ text: haikuText }] });
      }
    }
    res.json({ content: [{ text }] });
  } catch (e) {
    console.error('Ollama error:', e.message);
    try {
      const { text: haikuText, usage } = await callHaiku();
      const today3 = new Date().toISOString().slice(0, 10);
      recordUsage(today3, 'claude-haiku-4-5-20251001', usage, req.user.id, feature).catch(() => {});
      res.json({ content: [{ text: haikuText }] });
    } catch (e2) {
      console.error('Haiku fallback also failed:', e2.message);
      res.status(500).json({ error: `Ollama: ${e.message} | Haiku: ${e2.message}` });
    }
  }
});

app.post('/api/local/stream', claudeLimit, authMiddleware, async (req, res) => {
  const { messages, system, max_tokens } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array erforderlich' });
  }
  // Budget-Check VOR den SSE-Headern, damit ein 429 als normaler JSON-Fehler ankommt.
  if (!USE_OLLAMA) {
    const limitMsg = await usageLimitError(req.user.id);
    if (limitMsg) return res.status(429).json({ error: limitMsg });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    // Local model disabled → stream tokens directly from Claude Haiku.
    if (!USE_OLLAMA) {
      const params = { model: 'claude-haiku-4-5-20251001', max_tokens: max_tokens || 3000, messages };
      if (system) params.system = system;
      if (extendedTtlDisabled) stripCacheTtl(params);
      // Ein 1h-TTL-400 tritt vor dem ersten Token auf → solange noch nichts
      // geschrieben wurde, TTL strippen und den Stream einmal neu aufsetzen.
      let wroteAny = false;
      const streamOnce = async () => {
        const stream = anthropic.messages.stream(params, ttlOpts());
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            wroteAny = true;
            res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
          }
        }
        return stream.finalMessage();
      };
      let finalMsg;
      try {
        finalMsg = await streamOnce();
      } catch (e) {
        if (!extendedTtlDisabled && isTtlError(e) && !wroteAny) {
          console.warn('1h-Cache nicht verfügbar (stream) – Fallback auf 5-Min-Cache:', e.message);
          extendedTtlDisabled = true; stripCacheTtl(params);
          finalMsg = await streamOnce();
        } else throw e;
      }
      const u = finalMsg.usage || {};
      recordUsage(new Date().toISOString().slice(0, 10), 'claude-haiku-4-5-20251001', u, req.user.id, null).catch(() => {});
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    const r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL, messages: ollamaMsgs(system, messages),
        max_tokens: max_tokens || 3000, stream: true, options: { num_ctx: 16384 },
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Keep the trailing (possibly incomplete) line in the buffer for the next chunk.
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const token = JSON.parse(d).choices?.[0]?.delta?.content || '';
          if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
        } catch {}
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

app.post('/api/local/vision', authMiddleware, async (req, res) => {
  const { base64, text, system, max_tokens = 1500, media_type = 'image/png', feature } = req.body;
  if (!base64 || !text) return res.status(400).json({ error: 'base64 und text erforderlich' });
  const sysText = Array.isArray(system) ? system.map(b => b.text || '').join('\n') : (system || '');

  // Default: Claude-Haiku-Vision (schnell + zuverlässig). llava nur, wenn explizit
  // per USE_OLLAMA_VISION reaktiviert (z.B. auf GPU-Hardware).
  if (!USE_OLLAMA_VISION) {
    // Kostenpflichtig → gleiche Budget-Obergrenze wie die übrigen Cloud-Routen.
    const limitMsg = await usageLimitError(req.user.id);
    if (limitMsg) return res.status(429).json({ error: limitMsg });
    try {
      const params = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: base64 } },
            { type: 'text', text },
          ],
        }],
      };
      if (sysText) params.system = sysText;
      const r = await callClaude(params);
      const out = r.content?.[0]?.text;
      if (typeof out !== 'string') throw new Error('Haiku vision returned unexpected response shape');
      recordUsage(new Date().toISOString().slice(0, 10), 'claude-haiku-4-5-20251001', r.usage || {}, req.user.id, feature || 'vision').catch(() => {});
      return res.json({ content: [{ text: out }] });
    } catch (e) {
      console.error('Haiku vision error:', e.message);
      return res.status(503).json({ error: e.message });
    }
  }

  // Use Ollama native /api/chat format — more reliable for vision models than /v1/
  const messages = [
    ...(sysText ? [{ role: 'system', content: sysText }] : []),
    { role: 'user', content: text, images: [base64] },
  ];
  try {
    const r = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // num_ctx hochgesetzt: der 4096-Default reicht für Bild-Tokens + Prompt nicht
      // (führte zu "exceeds available context size 4096"-400ern). 16384 wie bei /api/local.
      body: JSON.stringify({ model: OLLAMA_VISION_MODEL, messages, stream: false, keep_alive: -1, options: { num_ctx: 16384 } }),
    });
    if (!r.ok) throw new Error(`Ollama vision ${r.status}: ${await r.text()}`);
    const data = await r.json();
    res.json({ content: [{ text: data.message.content }] });
  } catch (e) {
    console.error('Ollama vision error:', e.message);
    res.status(503).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLASHCARDS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/cards', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM flashcards WHERE subject_id=$1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/cards', async (req, res) => {
  const { cards } = req.body; // array of {front,back,ef,interval,repetitions,due}
  if (!Array.isArray(cards)) return res.status(400).json({ error: 'cards array erforderlich' });
  try {
    await pool.query('DELETE FROM flashcards WHERE subject_id=$1', [req.params.id]);
    for (const c of cards) {
      await pool.query(
        'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.params.id, c.front, c.back, c.ef||2.5, c.interval||1, c.repetitions||0, c.due||0]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUIZ RESULTS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/quiz', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT score,total,taken_at FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/quiz', async (req, res) => {
  const { score, total } = req.body;
  if (score == null || total == null) return res.status(400).json({ error: 'score und total erforderlich' });
  try {
    await pool.query(
      'INSERT INTO quiz_results (subject_id,score,total) VALUES ($1,$2,$3)',
      [req.params.id, score, total]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAK
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/streak', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT count,last_date FROM user_streaks WHERE user_id=$1', [req.user.id]);
    res.json(rows[0] || { count: 0, last_date: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/streak', authMiddleware, async (req, res) => {
  const { count, last_date } = req.body;
  try {
    await pool.query(
      `INSERT INTO user_streaks (user_id, count, last_date) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET count=$2, last_date=$3`,
      [req.user.id, count, last_date]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOSSAR
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/glossar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,term,definition FROM glossar WHERE subject_id=$1 ORDER BY term ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/glossar', async (req, res) => {
  const { terms } = req.body; // array of {term, definition}
  if (!Array.isArray(terms)) return res.status(400).json({ error: 'terms array erforderlich' });
  try {
    await pool.query('DELETE FROM glossar WHERE subject_id=$1', [req.params.id]);
    for (const t of terms) {
      await pool.query(
        'INSERT INTO glossar (subject_id,term,definition) VALUES ($1,$2,$3)',
        [req.params.id, t.term, t.definition]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/backup', authMiddleware, async (req, res) => {
  try {
    const subjects = (await pool.query('SELECT * FROM subjects WHERE user_id=$1 ORDER BY created_at', [req.user.id])).rows;
    const backup = { version: 2, exportedAt: new Date().toISOString(), subjects: [] };

    for (const s of subjects) {
      const messages  = (await pool.query('SELECT role,content FROM messages WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      const cards     = (await pool.query('SELECT front,back,ef,interval,repetitions,due FROM flashcards WHERE subject_id=$1', [s.id])).rows;
      const quiz      = (await pool.query('SELECT score,total FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at', [s.id])).rows;
      const glossar   = (await pool.query('SELECT term,definition FROM glossar WHERE subject_id=$1', [s.id])).rows;
      const cheat     = (await pool.query('SELECT content FROM cheat_sheets WHERE subject_id=$1', [s.id])).rows[0]?.content || null;
      const topics    = (await pool.query('SELECT topics FROM scanned_topics WHERE subject_id=$1', [s.id])).rows[0]?.topics || [];
      const aufgaben  = (await pool.query('SELECT id,topic,type,tasks_part,full_result,created_at FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      const klausuren = (await pool.query('SELECT id,diff,content,created_at FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at', [s.id])).rows;
      backup.subjects.push({ ...s, messages, cards, quiz, glossar, cheat, topics, aufgaben, klausuren });
    }

    res.setHeader('Content-Disposition', `attachment; filename="nachhilfe-backup-${Date.now()}.json"`);
    res.json(backup);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/restore', authMiddleware, async (req, res) => {
  const { subjects } = req.body;
  if (!Array.isArray(subjects)) return res.status(400).json({ error: 'Ungültiges Backup-Format' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of subjects) {
      // Only insert a new subject or update one already owned by this user.
      // Never seize a subject id that belongs to another account (the old
      // ON CONFLICT … SET user_id=$4 let a crafted backup steal ownership).
      const { rows: own } = await client.query(
        `INSERT INTO subjects (id,name,emoji,user_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=$2,emoji=$3
         WHERE subjects.user_id=$4 RETURNING id`,
        [s.id, s.name, s.emoji || '📚', req.user.id]
      );
      if (!own.length) continue;  // id belongs to someone else → skip its data
      if (s.messages?.length) {
        await client.query('DELETE FROM messages WHERE subject_id=$1', [s.id]);
        for (const m of s.messages) {
          await client.query('INSERT INTO messages (subject_id,role,content) VALUES ($1,$2,$3)', [s.id, m.role, m.content]);
        }
      }
      if (s.cards?.length) {
        await client.query('DELETE FROM flashcards WHERE subject_id=$1', [s.id]);
        for (const c of s.cards) {
          await client.query(
            'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [s.id, c.front, c.back, c.ef||2.5, c.interval||1, c.repetitions||0, c.due||0]
          );
        }
      }
      if (s.glossar?.length) {
        await client.query('DELETE FROM glossar WHERE subject_id=$1', [s.id]);
        for (const g of s.glossar) {
          await client.query('INSERT INTO glossar (subject_id,term,definition) VALUES ($1,$2,$3)', [s.id, g.term, g.definition]);
        }
      }
      if (s.cheat) {
        await client.query(
          `INSERT INTO cheat_sheets (subject_id, content, updated_at) VALUES ($1,$2,now())
           ON CONFLICT (subject_id) DO UPDATE SET content=$2, updated_at=now()`,
          [s.id, s.cheat]
        );
      }
      if (s.topics?.length) {
        await client.query(
          `INSERT INTO scanned_topics (subject_id, topics, updated_at) VALUES ($1,$2,now())
           ON CONFLICT (subject_id) DO UPDATE SET topics=$2, updated_at=now()`,
          [s.id, JSON.stringify(s.topics)]
        );
      }
      if (s.aufgaben?.length) {
        await client.query('DELETE FROM saved_aufgaben WHERE subject_id=$1', [s.id]);
        for (const a of s.aufgaben) {
          await client.query(
            'INSERT INTO saved_aufgaben (id,subject_id,topic,type,tasks_part,full_result,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [a.id, s.id, a.topic||'', a.type||'uebung', a.tasks_part||'', a.full_result||'', a.created_at||new Date()]
          );
        }
      }
      if (s.klausuren?.length) {
        await client.query('DELETE FROM saved_klausuren WHERE subject_id=$1', [s.id]);
        for (const k of s.klausuren) {
          await client.query(
            'INSERT INTO saved_klausuren (id,subject_id,diff,content,created_at) VALUES ($1,$2,$3,$4,$5)',
            [k.id, s.id, k.diff||'mittel', k.content||'', k.created_at||new Date()]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── Auto-card generation (local model or Haiku, per USE_OLLAMA) ───────────
async function autoGenerateCards(subjectId, filename, content) {
  const truncated = content.slice(0, 8000);
  const text = await localComplete([{
    role: 'user',
    content: `Erstelle 12 Lernkarten (Frage/Antwort) aus diesem Text. Antworte NUR als JSON-Array ohne Erklärung:\n[{"front":"Frage?","back":"Antwort."},...]\n\nText:\n${truncated}`,
  }], 2000);
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return;
  const cards = JSON.parse(m[0]).filter(c => c.front && c.back);
  for (const c of cards) {
    await pool.query(
      'INSERT INTO flashcards (subject_id,front,back,ef,interval,repetitions,due) VALUES ($1,$2,$3,2.5,1,0,0)',
      [subjectId, c.front, c.back]
    );
  }
  console.log(`Auto-generated ${cards.length} cards from "${filename}" using ${USE_OLLAMA ? 'Ollama' : 'Haiku'}`);
}

// ── Stats endpoint ─────────────────────────────────────────────────────────
app.get('/api/subjects/:id/stats', async (req, res) => {
  const id = req.params.id;
  try {
    const [quizRes, cardsRes, docsRes, msgsRes] = await Promise.all([
      pool.query('SELECT score, total, taken_at FROM quiz_results WHERE subject_id=$1 ORDER BY taken_at ASC', [id]),
      pool.query('SELECT COUNT(*) AS total, COUNT(CASE WHEN due < $2 THEN 1 END) AS due FROM flashcards WHERE subject_id=$1', [id, Date.now()]),
      pool.query('SELECT COUNT(*) AS count FROM documents WHERE subject_id=$1', [id]),
      pool.query('SELECT COUNT(*) AS count FROM messages WHERE subject_id=$1', [id]),
    ]);
    const questions = quizRes.rows;
    const avgScore = questions.length > 0
      ? Math.round(questions.reduce((a, q) => a + q.score / q.total, 0) / questions.length * 100)
      : 0;
    res.json({
      quizCount: questions.length,
      avgScore,
      quizHistory: questions.slice(-20).map(q => ({
        pct: Math.round(q.score / q.total * 100),
        date: q.taken_at,
      })),
      cardsTotal: parseInt(cardsRes.rows[0].total),
      cardsDue: parseInt(cardsRes.rows[0].due),
      docCount: parseInt(docsRes.rows[0].count),
      messageCount: parseInt(msgsRes.rows[0].count),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── User: own daily usage ──────────────────────────────────────────────────
app.get('/api/my-usage', authMiddleware, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      'SELECT cost_eur, calls FROM user_usage WHERE user_id=$1 AND date=$2',
      [req.user.id, today]
    );
    res.json({ cost_eur: parseFloat(rows[0]?.cost_eur || 0), calls: rows[0]?.calls || 0, limit: USER_DAILY_LIMIT });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: pending user count ──────────────────────────────────────────────
app.get('/api/admin/pending-count', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE approved=false');
    res.json({ count: rows[0].count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected', uptime: process.uptime() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/usage', authMiddleware, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      // Re-check from DB in case token is old
      const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
      if (!rows[0]?.is_admin) return res.json({ is_admin: false });
    }
    const limit = await getDailyLimit();
    const { cost, calls } = await checkDailyLimit();
    const last7 = (await pool.query(
      'SELECT date, cost_eur, calls FROM daily_usage ORDER BY date DESC LIMIT 7'
    )).rows;
    res.json({ today: { cost_eur: cost, calls }, limit_eur: limit, last7, is_admin: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: user management ─────────────────────────────────────────────────
async function requireAdmin(req, res) {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.is_admin) { res.status(403).json({ error: 'Nur für Admins' }); return false; }
  return true;
}

app.get('/api/admin/users', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      'SELECT id, username, approved, is_admin, approval_token IS NOT NULL AS pending, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/approve', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET approved=true, approval_token=NULL WHERE id=$1 RETURNING username',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true, username: rows[0].username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:id/admin', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Eigenen Admin-Status nicht änderbar' });
  try {
    const { rows } = await pool.query(
      'UPDATE users SET is_admin=$1 WHERE id=$2 RETURNING username, is_admin',
      [req.body.is_admin, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true, username: rows[0].username, is_admin: rows[0].is_admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
  try {
    const { rows } = await pool.query('DELETE FROM users WHERE id=$1 RETURNING username', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/set-limit', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Nur für Admins' });
  const val = parseFloat(req.body.limit);
  if (isNaN(val) || val <= 0) return res.status(400).json({ error: 'Ungültiger Wert' });
  try {
    await pool.query(
      "INSERT INTO settings (key,value) VALUES ('daily_limit_eur',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [val.toString()]
    );
    res.json({ ok: true, limit_eur: val });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHEAT SHEETS (Zusammenfassungen)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/cheat', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT content FROM cheat_sheets WHERE subject_id=$1', [req.params.id]);
    res.json({ content: rows[0]?.content || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/cheat', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content erforderlich' });
  try {
    await pool.query(
      `INSERT INTO cheat_sheets (subject_id, content, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (subject_id) DO UPDATE SET content=$2, updated_at=now()`,
      [req.params.id, content]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/cheat', async (req, res) => {
  try {
    await pool.query('DELETE FROM cheat_sheets WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SCANNED TOPICS
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/topics', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT topics FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json(rows[0]?.topics || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/topics', async (req, res) => {
  const { topics } = req.body;
  if (!Array.isArray(topics)) return res.status(400).json({ error: 'topics array erforderlich' });
  try {
    await pool.query(
      `INSERT INTO scanned_topics (subject_id, topics, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (subject_id) DO UPDATE SET topics=$2, updated_at=now()`,
      [req.params.id, JSON.stringify(topics)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/topics', async (req, res) => {
  try {
    await pool.query('DELETE FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Module structure (Kapitel + Lernziele), stored alongside flat topics
app.get('/api/subjects/:id/structure', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT structure FROM scanned_topics WHERE subject_id=$1', [req.params.id]);
    res.json(rows[0]?.structure || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/structure', async (req, res) => {
  const { structure, topics } = req.body;
  if (!structure || !Array.isArray(topics)) return res.status(400).json({ error: 'structure und topics erforderlich' });
  try {
    await pool.query(
      `INSERT INTO scanned_topics (subject_id, topics, structure, updated_at) VALUES ($1,$2,$3,now())
       ON CONFLICT (subject_id) DO UPDATE SET topics=$2, structure=$3, updated_at=now()`,
      [req.params.id, JSON.stringify(topics), JSON.stringify(structure)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Themen-Namen-Embeddings (für das semantische Re-Scan-Matching im Client). Liefert
// pro angefragtem (normalisiertem) Namen einen Vektor. Persistenter Cache in
// topic_vectors → nur fehlende Namen werden tatsächlich (teuer) embedded. Fehlt ein
// Embedding (Ollama down), bleibt der Name im Ergebnis weg → Client fällt auf
// Token-Matching zurück.
app.post('/api/subjects/:id/embed', authMiddleware, async (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names) || !names.length) return res.status(400).json({ error: 'names array erforderlich' });
  if (names.length > 200) return res.status(400).json({ error: 'höchstens 200 Namen pro Anfrage' });
  const sid = req.params.id;
  try {
    const uniq = [...new Set(names.map(n => String(n || '').trim()).filter(Boolean))];
    const { rows } = await pool.query(
      'SELECT norm_name, embedding FROM topic_vectors WHERE subject_id=$1 AND norm_name = ANY($2)',
      [sid, uniq]
    );
    const out = {};
    rows.forEach(r => { if (Array.isArray(r.embedding)) out[r.norm_name] = r.embedding; });
    const miss = uniq.filter(n => !out[n]);
    for (const n of miss) {                         // sequenziell: Ollama serialisiert ohnehin auf der CPU
      const v = await embedText(n);
      if (!v) continue;
      out[n] = v;
      await pool.query(
        `INSERT INTO topic_vectors (subject_id, norm_name, embedding, updated_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (subject_id, norm_name) DO UPDATE SET embedding=$3, updated_at=now()`,
        [sid, n, JSON.stringify(v)]
      );
    }
    res.json({ vectors: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVED AUFGABEN
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/aufgaben', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, topic, type, tasks_part, full_result, created_at FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.params.id]
    );
    res.json(rows.map(r => ({
      id: r.id, topic: r.topic, type: r.type,
      tasksPart: r.tasks_part, fullResult: r.full_result, createdAt: r.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/aufgaben', async (req, res) => {
  const { id, topic, type, tasksPart, fullResult, createdAt } = req.body;
  if (!id || !fullResult) return res.status(400).json({ error: 'id und fullResult erforderlich' });
  try {
    await pool.query(
      `INSERT INTO saved_aufgaben (id, subject_id, topic, type, tasks_part, full_result, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id.toString(), req.params.id, topic || '', type || 'uebung', tasksPart || '', fullResult, createdAt || new Date().toISOString()]
    );
    await pool.query(
      `DELETE FROM saved_aufgaben WHERE subject_id=$1 AND id NOT IN (
        SELECT id FROM saved_aufgaben WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 20
      )`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/aufgaben/:aufgId', async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_aufgaben WHERE id=$1 AND subject_id=$2', [req.params.aufgId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVED KLAUSUREN (Probeklausuren aus dem Klausur-Tab)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/klausuren', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, diff, content, created_at FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 10',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/klausuren', async (req, res) => {
  const { id, diff, content } = req.body;
  if (!id || !content) return res.status(400).json({ error: 'id und content erforderlich' });
  try {
    await pool.query(
      `INSERT INTO saved_klausuren (id, subject_id, diff, content) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [id.toString(), req.params.id, diff || 'mittel', content]
    );
    await pool.query(
      `DELETE FROM saved_klausuren WHERE subject_id=$1 AND id NOT IN (
        SELECT id FROM saved_klausuren WHERE subject_id=$1 ORDER BY created_at DESC LIMIT 10
      )`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/klausuren/:klId', async (req, res) => {
  try {
    await pool.query('DELETE FROM saved_klausuren WHERE id=$1 AND subject_id=$2', [req.params.klId, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// LEARNED TOPICS (Lernpfad progress per user)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/subjects/:id/learned-topics', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT topic FROM learned_topics WHERE subject_id=$1 AND user_id=$2 ORDER BY learned_at ASC',
      [req.params.id, req.user.id]
    );
    res.json(rows.map(r => r.topic));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subjects/:id/learned-topics', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic erforderlich' });
  try {
    await pool.query(
      'INSERT INTO learned_topics(subject_id,user_id,topic) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, req.user.id, topic]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/subjects/:id/learned-topics/:topic', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM learned_topics WHERE subject_id=$1 AND user_id=$2 AND topic=$3',
      [req.params.id, req.user.id, decodeURIComponent(req.params.topic)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: per-user stats ──────────────────────────────────────────────────
app.get('/api/admin/user-stats', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.approved,
        COALESCE(ud.cost_eur, 0)::float   AS today_cost,
        COALESCE(ud.calls, 0)::int         AS today_calls,
        COALESCE(ut.total_cost, 0)::float  AS total_cost,
        COALESCE(ut.total_calls, 0)::int   AS total_calls
      FROM users u
      LEFT JOIN user_usage ud ON ud.user_id = u.id AND ud.date = $1
      LEFT JOIN (
        SELECT user_id, SUM(cost_eur)::float AS total_cost, SUM(calls)::int AS total_calls
        FROM user_usage GROUP BY user_id
      ) ut ON ut.user_id = u.id
      ORDER BY today_cost DESC, u.username ASC
    `, [today]);
    res.json({ users: rows, limit: USER_DAILY_LIMIT });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: anonymous analytics ─────────────────────────────────────────────
app.get('/api/admin/analytics', authMiddleware, async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const { rows: features } = await pool.query(`
      SELECT feature,
        SUM(calls)::int AS total,
        SUM(CASE WHEN date = CURRENT_DATE THEN calls ELSE 0 END)::int AS today,
        SUM(CASE WHEN date >= CURRENT_DATE - 6 THEN calls ELSE 0 END)::int AS week
      FROM feature_usage
      GROUP BY feature ORDER BY total DESC
    `);
    const { rows: dau } = await pool.query(`
      SELECT date::text, COUNT(DISTINCT user_id)::int AS users
      FROM user_usage WHERE calls > 0
      GROUP BY date ORDER BY date DESC LIMIT 14
    `);
    const { rows: costs } = await pool.query(`
      SELECT date::text, cost_eur::float, calls::int
      FROM daily_usage ORDER BY date DESC LIMIT 14
    `);
    res.json({ features, dau, costs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SPA fallback (must stay AFTER all /api routes) ──────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../docs/index.html'));
});

// ── DB Table Init ──────────────────────────────────────────────────────────
async function initTables() {
  // Self-healing column migrations for tables created before these columns
  // existed (CREATE TABLE IF NOT EXISTS never adds columns to an existing table).
  // Each runs in its own statement + try/catch so a missing-ownership error
  // (app user is not the table owner) only logs and never aborts the inits below.
  const columnMigrations = [
    'ALTER TABLE documents ADD COLUMN IF NOT EXISTS doc_type TEXT;',
    'ALTER TABLE scanned_topics ADD COLUMN IF NOT EXISTS structure JSONB;',
  ];
  for (const sql of columnMigrations) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('Column migration skipped:', sql, '-', e.message);
    }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cheat_sheets (
      subject_id TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS scanned_topics (
      subject_id TEXT PRIMARY KEY,
      topics     JSONB NOT NULL,
      structure  JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS saved_aufgaben (
      id          TEXT PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      topic       TEXT,
      type        TEXT,
      tasks_part  TEXT,
      full_result TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_saved_aufgaben_subject ON saved_aufgaben(subject_id);
    CREATE TABLE IF NOT EXISTS saved_klausuren (
      id          TEXT PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      diff        TEXT,
      content     TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_saved_klausuren_subject ON saved_klausuren(subject_id);
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id   INTEGER PRIMARY KEY,
      count     INTEGER DEFAULT 0,
      last_date TEXT
    );
    CREATE TABLE IF NOT EXISTS learned_topics (
      subject_id TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      topic      TEXT NOT NULL,
      learned_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (subject_id, user_id, topic)
    );
    CREATE TABLE IF NOT EXISTS user_usage (
      user_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date     DATE NOT NULL,
      cost_eur DECIMAL(10,6) DEFAULT 0,
      calls    INTEGER DEFAULT 0,
      PRIMARY KEY(user_id, date)
    );
    CREATE TABLE IF NOT EXISTS feature_usage (
      feature  VARCHAR(50) NOT NULL,
      date     DATE NOT NULL,
      calls    INTEGER DEFAULT 0,
      PRIMARY KEY(feature, date)
    );
    -- Wissensbasis (Phase 1): strukturierte, durchsuchbare Häppchen je Dokument
    -- + eine kompakte Themen-Landkarte je Fach. subject_id ist TEXT (wie überall).
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id          SERIAL PRIMARY KEY,
      subject_id  TEXT NOT NULL,
      document_id INTEGER NOT NULL,
      kind        TEXT,
      topic       TEXT,
      heading     TEXT,
      content     TEXT,
      source_ref  TEXT,
      tokens      INTEGER,
      embedding   JSONB,
      kb_version  INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_subject  ON doc_chunks(subject_id);
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON doc_chunks(document_id);
    CREATE TABLE IF NOT EXISTS subject_kb (
      subject_id  TEXT PRIMARY KEY,
      overview    TEXT,
      status      TEXT DEFAULT 'pending',
      kb_version  INTEGER DEFAULT 1,
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
    -- Persistenter Cache für Themen-Namen-Embeddings (semantisches Re-Scan-Matching).
    -- Embedding ist auf der CPU-VM teuer (~3s/Name) → einmal berechnen, wiederverwenden.
    -- Überlebt Re-Scans (Alt-Namen bleiben für den Fortschritt-Abgleich nutzbar).
    CREATE TABLE IF NOT EXISTS topic_vectors (
      subject_id TEXT NOT NULL,
      norm_name  TEXT NOT NULL,
      embedding  JSONB,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (subject_id, norm_name)
    );
  `);
}
initTables().catch(e => console.error('Table init error:', e.message));

// Prevent unhandled promise rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ── Start ──────────────────────────────────────────────────────────────────
// Nur auf Loopback lauschen: nginx proxied ohnehin an 127.0.0.1:3000. So ist das
// Backend nicht direkt aus dem Netz erreichbar (kein Vorbeischleichen an nginx,
// Rate-Limit & Security-Headern).
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Nachhilfe-Server läuft auf Port ${PORT}`);
  console.log(`Datenbank: ${process.env.DATABASE_URL ? 'konfiguriert' : 'FEHLT'}`);
  console.log(`API-Key: ${process.env.ANTHROPIC_API_KEY ? 'gesetzt' : 'FEHLT'}`);
  console.log(`Telegram: ${TG_TOKEN ? 'aktiv' : 'nicht konfiguriert'}`);

  // Start Telegram polling
  if (TG_TOKEN) {
    setTimeout(() => pollTelegram().catch(() => {}), 3000);
    setInterval(() => pollTelegram().catch(() => {}), 30000);
  }
});
