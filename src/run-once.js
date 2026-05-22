'use strict';
const fs = require('fs');
const { chromium } = require('playwright');
const logger = require('./logger');
const config = require('./config');
const { ensureLoggedIn } = require('./auth/login');
const { runCheckCycle } = require('./booking/monitor');
const { formatDateTime } = require('./utils');
const { sendTelegramMessage } = require('./notifications/telegram');

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-web-security',
];

const DAILY_PING_FILE    = 'data/last_daily_ping.txt';
const LAST_UPDATE_FILE   = 'data/last_telegram_update.txt';
const REPO               = 'LPGACT/BOTPADEL';

// ─── helpers ────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function isFirstRunOfDay() {
  try { return fs.readFileSync(DAILY_PING_FILE, 'utf8').trim() !== todayStr(); }
  catch (_) { return true; }
}

function markDailyPingSent() {
  fs.writeFileSync(DAILY_PING_FILE, todayStr());
}

function loadLastUpdateId() {
  try { return parseInt(fs.readFileSync(LAST_UPDATE_FILE, 'utf8').trim(), 10); }
  catch (_) { return 0; }
}

function saveLastUpdateId(id) {
  fs.writeFileSync(LAST_UPDATE_FILE, String(id));
}

// ─── telegram polling (sin servidor, corre en cada ciclo de GH Actions) ─────

async function tgApi(method, params = {}) {
  const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function handleTelegramCommands() {
  const offset = loadLastUpdateId();
  const { ok, result: updates } = await tgApi('getUpdates', {
    offset: offset + 1,
    limit: 20,
    timeout: 0,
  });

  if (!ok || !updates?.length) return;

  let lastId = offset;

  for (const update of updates) {
    lastId = update.update_id;
    const msg = update.message;
    if (!msg?.text) continue;

    // Solo responde al dueño
    if (String(msg.from?.id) !== String(process.env.TELEGRAM_CHAT_ID)) continue;

    const cmd = msg.text.split('@')[0].toLowerCase();

    if (cmd === '/estado') {
      await sendStatusResponse();
    }
  }

  saveLastUpdateId(lastId);
}

async function sendStatusResponse() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs?per_page=10`,
      { headers: { 'User-Agent': 'bot-padel' } }
    );
    const { workflow_runs: runs } = await res.json();

    if (!runs?.length) {
      await sendTelegramMessage('No hay runs registrados aún.');
      return;
    }

    const fmt = (d) => new Date(d).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

    const icon = (r) =>
      ({ success: '✅', failure: '❌', cancelled: '⛔' })[r.conclusion] ||
      ({ in_progress: '⏳', queued: '🕐' })[r.status] || '❓';

    const lines = runs.slice(0, 8).map((r) => `${icon(r)} ${fmt(r.created_at)}`);
    const latest = runs[0];

    await sendTelegramMessage(
      `📊 *Estado del Bot*\n\n` +
      `Último run: ${icon(latest)} ${fmt(latest.created_at)}\n\n` +
      `*Historial:*\n${lines.join('\n')}\n\n` +
      `⚠️ _Respuesta con hasta 5 min de delay_`
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error consultando GitHub: ${err.message}`);
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  config.validate();

  if (new Date().getDay() === 1) {
    logger.info('Hoy es lunes — no se monitorea el día del turno.');
    await handleTelegramCommands().catch(() => {});
    process.exit(0);
  }

  logger.info('=== Chequeo único (GitHub Actions) ===');
  logger.info(`Hora: ${formatDateTime()}`);

  // Responder comandos de Telegram pendientes
  await handleTelegramCommands().catch((e) =>
    logger.warn(`Telegram commands: ${e.message}`)
  );

  // Ping diario
  if (isFirstRunOfDay()) {
    await sendTelegramMessage(
      `🤖 *Bot de padel activo*\n` +
      `Buscando turno para el próximo lunes\n` +
      `Horarios: ${config.atc.targetTimes.join(', ')}\n` +
      `🕐 ${formatDateTime()}`
    ).catch((e) => logger.warn(`Telegram ping diario: ${e.message}`));
    markDailyPingSent();
  }

  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });

  try {
    const context = await ensureLoggedIn(browser);
    await runCheckCycle(context);
    await context.close();
  } finally {
    await browser.close();
  }

  logger.info('=== Chequeo único finalizado ===');
}

main().catch(async (err) => {
  logger.error(`Error en chequeo único: ${err.message}`);
  await sendTelegramMessage(
    `❌ *Bot detenido por error*\n\`${err.message}\`\n🕐 ${formatDateTime()}`
  ).catch(() => {});
  process.exit(1);
});
