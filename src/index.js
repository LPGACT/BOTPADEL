'use strict';
const { chromium } = require('playwright');
const logger = require('./logger');
const config = require('./config');
const { startMonitor, pauseMonitor, resumeMonitor, getStatusText, getCurrentBrowser } = require('./booking/monitor');
const { launchTelegramBot } = require('./notifications/telegram');

async function main() {
  try {
    config.validate();
  } catch (err) {
    logger.error(`Configuración inválida: ${err.message}`);
    process.exit(1);
  }

  logger.info('==============================================');
  logger.info('  BOT PADEL - KUMAN SANTO TOME - ATC SPORTS  ');
  logger.info('==============================================');
  logger.info(`Email ATC: ${config.atc.email}`);
  logger.info(`Venue URL: ${config.atc.venueUrl}`);
  logger.info(`Horarios: ${config.atc.targetTimes.join(', ')} | ${config.atc.durationMinutes} min`);
  logger.info(`Headless: ${config.bot.headless} | Intervalo: ${config.bot.checkIntervalMs / 1000}s`);

  launchTelegramBot({ resumeMonitor, pauseMonitor, getStatusText });

  const shutdown = async (signal) => {
    logger.info(`Señal ${signal} recibida. Cerrando bot...`);
    const browser = getCurrentBrowser();
    try { if (browser) await browser.close(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await startMonitor(chromium);
}

main().catch((err) => {
  console.error('Error no manejado:', err);
  process.exit(1);
});
