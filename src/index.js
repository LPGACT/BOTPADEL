'use strict';
const { chromium } = require('playwright');
const logger = require('./logger');
const config = require('./config');
const { ensureLoggedIn } = require('./auth/login');
const { startMonitor, pauseMonitor, resumeMonitor, getStatusText } = require('./booking/monitor');
const { launchTelegramBot } = require('./notifications/telegram');
const { sleep } = require('./utils');

async function main() {
  // 1. Validar configuración
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

  // 2. Iniciar bot de Telegram (comandos de control)
  launchTelegramBot({ resumeMonitor, pauseMonitor, getStatusText });

  // 3. Lanzar browser
  const browser = await chromium.launch({
    headless: config.bot.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
    ],
  });

  logger.info('Browser Chromium lanzado.');

  // Manejar cierre limpio
  const shutdown = async (signal) => {
    logger.info(`Señal ${signal} recibida. Cerrando bot...`);
    try { await browser.close(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 4. Login con reintentos y manejo de sesión expirada
  let context = null;
  let loginAttempts = 0;
  const MAX_LOGIN_ATTEMPTS = 3;

  while (loginAttempts < MAX_LOGIN_ATTEMPTS) {
    try {
      context = await ensureLoggedIn(browser);
      break;
    } catch (err) {
      loginAttempts++;
      logger.error(`Login fallido (intento ${loginAttempts}/${MAX_LOGIN_ATTEMPTS}): ${err.message}`);
      if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        logger.error('No se pudo hacer login después de varios intentos. Abortando.');
        await browser.close();
        process.exit(1);
      }
      await sleep(15_000);
    }
  }

  logger.info('Sesión activa. Iniciando monitor...');

  // 5. Loop principal: monitoreo con re-autenticación automática al expirar
  while (true) {
    try {
      await startMonitor(context);
    } catch (err) {
      logger.error(`Error fatal en monitor: ${err.message}`, err);

      // Intentar re-autenticar si parece un problema de sesión
      const sessionError =
        err.message?.toLowerCase().includes('login') ||
        err.message?.toLowerCase().includes('session') ||
        err.message?.toLowerCase().includes('sesión') ||
        err.message?.toLowerCase().includes('unauthorized') ||
        err.message?.toLowerCase().includes('401');

      if (sessionError) {
        logger.info('Detectado error de sesión. Reautenticando...');
        try {
          await context.close();
        } catch (_) {}
        try {
          context = await ensureLoggedIn(browser);
          logger.info('Reautenticación exitosa. Reiniciando monitor...');
          await sleep(3_000);
          continue;
        } catch (loginErr) {
          logger.error(`Reautenticación fallida: ${loginErr.message}`);
        }
      }

      // Error no recuperable: esperar 5 min antes de reintentar
      logger.warn('Esperando 5 minutos antes de reintentar...');
      await sleep(300_000);
    }
  }
}

main().catch((err) => {
  console.error('Error no manejado:', err);
  process.exit(1);
});
