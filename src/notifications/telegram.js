'use strict';
const { Telegraf } = require('telegraf');
const logger = require('../logger');
const config = require('../config');

let bot = null;
let botLaunched = false;

function getBot() {
  if (!bot) {
    bot = new Telegraf(config.telegram.token);
  }
  return bot;
}

/**
 * Envía un mensaje al chat personal configurado.
 */
async function sendTelegramMessage(text) {
  try {
    await getBot().telegram.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'Markdown',
    });
    logger.info(`Telegram enviado a chat ${config.telegram.chatId}`);
  } catch (err) {
    logger.error(`Error enviando mensaje Telegram: ${err.message}`);
    throw err;
  }
}

/**
 * Envía la notificación de reserva al grupo (si está configurado) Y al chat personal.
 * El grupo recibe el mensaje de confirmación para que todos los jugadores se enteren.
 */
async function sendBookingNotification(text) {
  const tg = getBot().telegram;
  const sends = [
    tg.sendMessage(config.telegram.chatId, text, { parse_mode: 'Markdown' })
      .then(() => logger.info(`Telegram personal enviado (${config.telegram.chatId})`))
      .catch((e) => logger.error(`Error Telegram personal: ${e.message}`)),
  ];

  if (config.telegram.groupId) {
    sends.push(
      tg.sendMessage(config.telegram.groupId, text, { parse_mode: 'Markdown' })
        .then(() => logger.info(`Telegram grupo enviado (${config.telegram.groupId})`))
        .catch((e) => logger.error(`Error Telegram grupo: ${e.message}`))
    );
  }

  await Promise.all(sends);
}

/**
 * Inicia el bot de Telegram y registra los comandos.
 * Llama a los callbacks del monitor según el comando recibido.
 *
 * @param {Object} monitor - { resumeMonitor, pauseMonitor, getStatusText }
 */
function launchTelegramBot(monitor) {
  if (botLaunched) return;
  botLaunched = true;

  const tg = getBot();

  // Middleware de seguridad: solo acepta mensajes del chat configurado
  tg.use((ctx, next) => {
    const incomingId = String(ctx.from?.id || ctx.chat?.id || '');
    if (incomingId !== String(config.telegram.chatId)) {
      logger.warn(`Mensaje de Telegram ignorado de chat desconocido: ${incomingId}`);
      return;
    }
    return next();
  });

  tg.command('start', (ctx) => {
    ctx.reply(
      '🤖 *Bot de Padel - KUMAN SANTO TOME*\n\n' +
        'Comandos disponibles:\n' +
        '/estado - Ver estado actual del bot\n' +
        '/reiniciar - Reanudar monitoreo (después de una reserva)\n' +
        '/pausar - Pausar el monitoreo\n' +
        '/ayuda - Ver este mensaje',
      { parse_mode: 'Markdown' }
    );
  });

  tg.command('ayuda', (ctx) => {
    ctx.reply(
      '📋 *Comandos del Bot de Padel*\n\n' +
        '/estado — Estado actual del bot\n' +
        '/reiniciar — Reanudar monitoreo para el próximo lunes\n' +
        '/pausar — Pausar el monitoreo temporalmente\n\n' +
        'El bot busca turnos disponibles martes a domingos cada 5 min.',
      { parse_mode: 'Markdown' }
    );
  });

  tg.command('estado', (ctx) => {
    const text = monitor.getStatusText();
    ctx.reply(`📊 *Estado del Bot*\n\n${text}`, { parse_mode: 'Markdown' });
  });

  tg.command('reiniciar', (ctx) => {
    monitor.resumeMonitor();
    ctx.reply(
      '✅ *Monitoreo reanudado*\n' +
        'El bot buscará turnos para el próximo lunes.',
      { parse_mode: 'Markdown' }
    );
    logger.info('Monitor reanudado via Telegram /reiniciar');
  });

  tg.command('pausar', (ctx) => {
    monitor.pauseMonitor();
    ctx.reply(
      '⏸ *Monitoreo pausado*\n' +
        'Enviá /reiniciar para reanudar.',
      { parse_mode: 'Markdown' }
    );
    logger.info('Monitor pausado via Telegram /pausar');
  });

  // Manejo de errores del bot de Telegram
  tg.catch((err, ctx) => {
    logger.error(`Error en Telegram bot: ${err.message}`);
  });

  // Lanzar en modo polling (no requiere dominio/webhook)
  tg.launch({
    allowedUpdates: ['message'],
  }).catch((err) => {
    logger.error(`Error lanzando Telegram bot: ${err.message}`);
  });

  // Graceful shutdown
  process.once('SIGINT', () => tg.stop('SIGINT'));
  process.once('SIGTERM', () => tg.stop('SIGTERM'));

  logger.info('Bot de Telegram iniciado (modo polling).');
}

module.exports = { sendTelegramMessage, sendBookingNotification, launchTelegramBot };
