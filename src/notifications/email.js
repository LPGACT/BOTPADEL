'use strict';
const nodemailer = require('nodemailer');
const logger = require('../logger');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

/**
 * Envía el correo de reserva exitosa.
 * @param {Object} booking - Datos de la reserva
 */
async function sendBookingEmail(booking) {
  const {
    complejo,
    fecha,
    hora,
    duracion,
    cancha,
    estado,
    ejecutadoEn,
  } = booking;

  const subject = 'Cancha reservada automáticamente';

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #2e7d32; border-bottom: 2px solid #2e7d32; padding-bottom: 12px;">
      ✅ Cancha reservada automáticamente
    </h2>
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <tr><td style="padding: 8px 0; color: #666; width: 40%;">📍 Complejo</td>
          <td style="padding: 8px 0; font-weight: bold;">${complejo}</td></tr>
      <tr style="background: #f9f9f9;">
          <td style="padding: 8px 4px; color: #666;">📅 Fecha</td>
          <td style="padding: 8px 4px; font-weight: bold;">${fecha}</td></tr>
      <tr><td style="padding: 8px 0; color: #666;">⏰ Hora</td>
          <td style="padding: 8px 0; font-weight: bold;">${hora}</td></tr>
      <tr style="background: #f9f9f9;">
          <td style="padding: 8px 4px; color: #666;">⏱ Duración</td>
          <td style="padding: 8px 4px; font-weight: bold;">${duracion}</td></tr>
      <tr><td style="padding: 8px 0; color: #666;">🏟 Cancha</td>
          <td style="padding: 8px 0; font-weight: bold;">${cancha}</td></tr>
      <tr style="background: #f9f9f9;">
          <td style="padding: 8px 4px; color: #666;">✅ Estado</td>
          <td style="padding: 8px 4px; font-weight: bold; color: #2e7d32;">${estado}</td></tr>
    </table>
    <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
    <p style="color: #999; font-size: 12px; margin: 0;">
      🤖 Bot ejecutado el ${ejecutadoEn}<br>
      Este email fue enviado automáticamente por el bot de padel.
    </p>
  </div>
</body>
</html>`;

  const text =
    `Cancha reservada automáticamente\n\n` +
    `Complejo: ${complejo}\n` +
    `Fecha: ${fecha}\n` +
    `Hora: ${hora}\n` +
    `Duración: ${duracion}\n` +
    `Cancha: ${cancha}\n` +
    `Estado: ${estado}\n\n` +
    `Bot ejecutado: ${ejecutadoEn}`;

  try {
    const info = await getTransporter().sendMail({
      from: `"Bot Padel" <${config.smtp.user}>`,
      to: config.smtp.notifyEmail,
      subject,
      html,
      text,
    });
    logger.info(`Email enviado: ${info.messageId} → ${config.smtp.notifyEmail}`);
  } catch (err) {
    logger.error(`Error enviando email: ${err.message}`);
    throw err;
  }
}

/** Envía un email genérico de alerta/error. */
async function sendAlertEmail(subject, body) {
  try {
    await getTransporter().sendMail({
      from: `"Bot Padel" <${config.smtp.user}>`,
      to: config.smtp.notifyEmail,
      subject: `[Bot Padel] ${subject}`,
      text: body,
    });
    logger.info(`Email de alerta enviado: "${subject}"`);
  } catch (err) {
    logger.error(`Error enviando email de alerta: ${err.message}`);
  }
}

module.exports = { sendBookingEmail, sendAlertEmail };
