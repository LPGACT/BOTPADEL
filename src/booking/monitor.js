'use strict';
const logger = require('../logger');
const config = require('../config');
const { sleep, getNextMonday, formatDate, formatDateTime, retry } = require('../utils');
const { ensureLoggedIn } = require('../auth/login');
const { checkAvailability } = require('./availability');
const { makeReservation } = require('./reserve');
const { sendBookingEmail } = require('../notifications/email');
const { sendTelegramMessage, sendBookingNotification } = require('../notifications/telegram');

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-web-security',
];

let currentBrowser = null;
function getCurrentBrowser() { return currentBrowser; }

// Estado compartido del bot (modificado por el módulo de Telegram también)
const botState = {
  running: false,
  paused: false,          // true = esperando /reiniciar de Telegram
  checkCount: 0,
  lastCheck: null,
  lastBooking: null,
  consecutiveErrors: 0,
};

/** Retorna el estado actual como texto legible. */
function getStatusText() {
  const estado = botState.paused
    ? 'PAUSADO (esperando /reiniciar)'
    : botState.running
    ? 'ACTIVO'
    : 'DETENIDO';

  return (
    `Estado: ${estado}\n` +
    `Verificaciones: ${botState.checkCount}\n` +
    `Última verificación: ${botState.lastCheck || 'nunca'}\n` +
    `Última reserva: ${botState.lastBooking || 'ninguna'}\n` +
    `Errores consecutivos: ${botState.consecutiveErrors}`
  );
}

/**
 * Determina si el bot debe correr hoy (martes a domingos = todo excepto lunes).
 */
function shouldRunToday() {
  const day = new Date().getDay(); // 0=Dom, 1=Lun, 2=Mar, ...
  return day !== 1; // Excluir lunes
}

/**
 * Lógica principal de una iteración: verifica disponibilidad y reserva si hay.
 * Retorna true si reservó exitosamente.
 */
async function runCheckCycle(context) {
  const targetDate = getNextMonday();
  const dateStr = formatDate(targetDate);

  botState.lastCheck = formatDateTime();
  botState.checkCount++;

  logger.info(`--- Ciclo #${botState.checkCount} | Buscando para lunes ${dateStr} ---`);

  // checkAvailability devuelve { page, slots } - la página queda abierta
  const { page, slots } = await checkAvailability(context, targetDate);

  if (slots.length === 0) {
    await page.close();
    botState.consecutiveErrors = 0;
    return false;
  }

  // Hay disponibilidad: intentar reservar el slot de mayor prioridad
  const targetSlot = slots[0];
  logger.info(
    `DISPONIBILIDAD ENCONTRADA: ${targetSlot.time} | ` +
      `${targetSlot.isCovered ? 'TECHADA' : 'Al aire libre'} | ${targetSlot.courtText}`
  );

  // Notificar que se encontró disponibilidad (antes de intentar reservar)
  await sendTelegramMessage(
    `🎾 *Disponibilidad encontrada!*\n` +
      `Horario: ${targetSlot.time}\n` +
      `Cancha: ${targetSlot.courtText}\n` +
      `Intentando reservar...`
  ).catch((e) => logger.warn(`Telegram pre-reserva: ${e.message}`));

  const { success, error } = await makeReservation(page, targetSlot);
  await page.close();

  const now = formatDateTime();

  if (success) {
    botState.lastBooking = now;
    botState.consecutiveErrors = 0;

    const msg =
      `✅ *Reserva confirmada!*\n\n` +
      `📍 Complejo: KUMAN SANTO TOME PADEL\n` +
      `📅 Fecha: lunes ${dateStr}\n` +
      `⏰ Hora: ${targetSlot.time}\n` +
      `⏱ Duración: ${config.atc.durationMinutes} minutos\n` +
      `🏟 Cancha: ${targetSlot.courtText}\n` +
      `✅ Estado: RESERVADA\n` +
      `🤖 Ejecutado: ${now}`;

    logger.info('=== RESERVA EXITOSA ===');
    logger.info(`Complejo: KUMAN SANTO TOME PADEL | Fecha: lunes ${dateStr} | Hora: ${targetSlot.time}`);

    // Enviar notificaciones en paralelo
    await Promise.allSettled([
      sendBookingEmail({
        complejo: 'KUMAN SANTO TOME PADEL',
        fecha: `lunes ${dateStr}`,
        hora: targetSlot.time,
        duracion: `${config.atc.durationMinutes} minutos`,
        cancha: targetSlot.courtText,
        estado: 'CONFIRMADA',
        ejecutadoEn: now,
      }),
      sendBookingNotification(msg),
    ]);

    return true;
  } else {
    logger.error(`Reserva fallida: ${error}`);
    botState.consecutiveErrors++;

    await sendTelegramMessage(
      `❌ *Reserva fallida*\n` +
        `Horario: ${targetSlot.time}\n` +
        `Error: ${error}\n` +
        `El bot continuará monitoreando...`
    ).catch((e) => logger.warn(`Telegram error-reserva: ${e.message}`));

    return false;
  }
}

/**
 * Bucle principal del monitor.
 * Recibe el objeto `chromium` y lanza/cierra el browser en cada ciclo
 * para minimizar el uso de RAM en Railway (~$1.20/mes vs ~$5.30 con browser permanente).
 */
async function startMonitor(chromium) {
  botState.running = true;
  botState.paused = false;

  logger.info('=== Monitor iniciado ===');
  logger.info(`Intervalo: ${config.bot.checkIntervalMs / 1000}s | Días: martes a domingos`);
  logger.info(`Horarios objetivo: ${config.atc.targetTimes.join(', ')} | Duración: ${config.atc.durationMinutes}min`);

  await sendTelegramMessage(
    `🤖 *Bot de padel iniciado*\n` +
      `Monitoreando KUMAN SANTO TOME los lunes\n` +
      `Horarios: ${config.atc.targetTimes.join(', ')}\n` +
      `Intervalo: ${config.bot.checkIntervalMs / 60000} min\n` +
      `Enviá /estado para ver el estado actual.`
  ).catch((e) => logger.warn(`Telegram inicio: ${e.message}`));

  while (botState.running) {
    if (botState.paused) {
      logger.info('Bot pausado. Esperando /reiniciar desde Telegram...');
      await sleep(30_000);
      continue;
    }

    if (!shouldRunToday()) {
      logger.info('Hoy es lunes — el bot no monitorea los días del turno. Próximo ciclo en 1h.');
      await sleep(3_600_000);
      continue;
    }

    if (botState.consecutiveErrors >= 10) {
      logger.warn('10 errores consecutivos detectados. Esperando 15 minutos (posible rate limit)...');
      await sendTelegramMessage(
        '⚠️ *Muchos errores consecutivos*\nEl bot esperará 15 minutos antes de continuar.'
      ).catch(() => {});
      await sleep(900_000);
      botState.consecutiveErrors = 0;
      continue;
    }

    let browser = null;
    let context = null;

    try {
      browser = await chromium.launch({ headless: config.bot.headless, args: BROWSER_ARGS });
      currentBrowser = browser;
      context = await ensureLoggedIn(browser);

      const booked = await retry(
        () => runCheckCycle(context),
        { maxAttempts: 2, baseDelayMs: 5000, label: 'ciclo de verificación' }
      );

      botState.consecutiveErrors = 0;

      if (booked && config.bot.stopAfterBooking) {
        logger.info('Reserva exitosa. Bot pausado. Enviá /reiniciar cuando quieras buscar para la semana siguiente.');
        botState.paused = true;
        continue;
      }
    } catch (err) {
      botState.consecutiveErrors++;
      logger.error(`Error en ciclo de monitoreo: ${err.message}`, err);

      if (botState.consecutiveErrors === 3) {
        await sendTelegramMessage(
          `⚠️ *Error repetido en el bot*\n${err.message}\nSe intentará recuperar automáticamente.`
        ).catch(() => {});
      }
    } finally {
      try { if (context) await context.close(); } catch (_) {}
      try { if (browser) await browser.close(); } catch (_) {}
      currentBrowser = null;
    }

    logger.info(`Próxima verificación en ${config.bot.checkIntervalMs / 1000}s...`);
    await sleep(config.bot.checkIntervalMs);
  }

  logger.info('=== Monitor detenido ===');
}

/** Pausa el monitor (llamado por el módulo Telegram cuando se recibe /pausar). */
function pauseMonitor() {
  botState.paused = true;
  logger.info('Monitor pausado manualmente.');
}

/** Reanuda el monitor (llamado por el módulo Telegram cuando se recibe /reiniciar). */
function resumeMonitor() {
  botState.paused = false;
  logger.info('Monitor reanudado por Telegram.');
}

/** Detiene el monitor completamente. */
function stopMonitor() {
  botState.running = false;
  logger.info('Monitor detenido.');
}

module.exports = {
  startMonitor,
  runCheckCycle,
  pauseMonitor,
  resumeMonitor,
  stopMonitor,
  getStatusText,
  getCurrentBrowser,
  botState,
};
