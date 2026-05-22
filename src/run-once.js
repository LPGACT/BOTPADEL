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

const DAILY_PING_FILE = 'data/last_daily_ping.txt';

function todayStr() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD en UTC
}

function isFirstRunOfDay() {
  try {
    return fs.readFileSync(DAILY_PING_FILE, 'utf8').trim() !== todayStr();
  } catch (_) {
    return true;
  }
}

function markDailyPingSent() {
  fs.writeFileSync(DAILY_PING_FILE, todayStr());
}

async function main() {
  config.validate();

  if (new Date().getDay() === 1) {
    logger.info('Hoy es lunes — no se monitorea el día del turno.');
    process.exit(0);
  }

  logger.info('=== Chequeo único (GitHub Actions) ===');
  logger.info(`Hora: ${formatDateTime()}`);

  // Mensaje privado en el primer run del día
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
