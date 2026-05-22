'use strict';
const { chromium } = require('playwright');
const logger = require('./logger');
const config = require('./config');
const { ensureLoggedIn } = require('./auth/login');
const { runCheckCycle } = require('./booking/monitor');
const { formatDateTime } = require('./utils');

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-web-security',
];

async function main() {
  config.validate();

  // No monitorear los lunes (ese es el día del turno que buscamos)
  if (new Date().getDay() === 1) {
    logger.info('Hoy es lunes — no se monitorea el día del turno.');
    process.exit(0);
  }

  logger.info('=== Chequeo único (GitHub Actions) ===');
  logger.info(`Hora: ${formatDateTime()}`);
  logger.info(`Horarios: ${config.atc.targetTimes.join(', ')} | ${config.atc.durationMinutes} min`);

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

main().catch((err) => {
  logger.error(`Error en chequeo único: ${err.message}`);
  process.exit(1);
});
