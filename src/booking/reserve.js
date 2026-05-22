'use strict';
const path = require('path');
const logger = require('../logger');
const config = require('../config');
const { humanDelay, sleep } = require('../utils');

/** Toma screenshot para debug. */
async function screenshot(page, name) {
  try {
    const file = path.join(config.bot.screenshotsDir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    logger.info(`Screenshot: ${file}`);
  } catch (_) {}
}

/**
 * Verifica si hay una reserva duplicada antes de intentar.
 * Chequeo simple: si el slot ya no está disponible, retorna true.
 */
async function checkDuplicateBooking(page, slot) {
  try {
    // Si el elemento ya no está clickeable o fue marcado como reservado
    const isStillAvailable = await slot.elementHandle.evaluate((el) => {
      const cls = (el.className || '').toLowerCase();
      return !cls.includes('reservada') && !cls.includes('ocupada') && !el.disabled;
    });
    return !isStillAvailable; // true = es duplicado (ya no disponible)
  } catch (_) {
    return false; // No se pudo verificar, asumir que no es duplicado
  }
}

/**
 * Espera que aparezca un modal/dialog de reserva o que la página cambie.
 */
async function waitForBookingModal(page) {
  const modalSelectors = [
    '[role="dialog"]',
    '[class*="Modal" i]',
    '[class*="modal" i]',
    '[class*="Overlay" i]',
    '[class*="overlay" i]',
    '[class*="popup" i]',
    '[class*="Popup" i]',
    '[class*="booking" i]',
    '[class*="reserva" i]',
  ];

  // Esperar hasta 8 segundos por cualquier modal
  for (let i = 0; i < 16; i++) {
    for (const sel of modalSelectors) {
      const el = await page.$(sel);
      if (el) {
        logger.info(`Modal de reserva detectado con selector: ${sel}`);
        return el;
      }
    }
    await sleep(500);
  }
  return null;
}

/**
 * Busca y hace clic en el botón de confirmación dentro del modal.
 */
async function clickConfirmButton(page) {
  const confirmSelectors = [
    'button:has-text("Confirmar reserva")',
    'button:has-text("Confirmar")',
    'button:has-text("Reservar")',
    'button:has-text("Continuar")',
    'button:has-text("Aceptar")',
    'button:has-text("OK")',
    '[data-testid="confirm-booking"]',
    '[data-testid="confirm"]',
    '[class*="confirm" i] button',
    '[role="dialog"] button[type="submit"]',
    '[role="dialog"] button:not([class*="cancel" i]):not([class*="cerrar" i]):not([class*="close" i])',
    'button[type="submit"]',
  ];

  for (const sel of confirmSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const text = await btn.textContent();
        // Filtrar botones de cancelar/cerrar
        const cancelWords = ['cancel', 'cerrar', 'close', 'volver', 'atras', 'atrás', 'no'];
        if (cancelWords.some((w) => (text || '').toLowerCase().includes(w))) continue;

        await humanDelay(300, 700);
        await btn.click();
        logger.info(`Botón de confirmación clickeado: "${(text || '').trim()}"`);
        return true;
      }
    } catch (_) {}
  }

  return false;
}

/**
 * Verifica si la reserva fue confirmada tras el click.
 */
async function verifyBookingSuccess(page) {
  await sleep(2500);

  // Indicadores de éxito en texto
  const successTexts = [
    'reserva confirmada',
    'turno confirmado',
    'reservado exitosamente',
    'tu reserva',
    '¡reservado!',
    'booking confirmed',
    'successfully booked',
    'éxito',
    'exitosa',
  ];

  try {
    const pageText = (await page.innerText('body')).toLowerCase();
    for (const txt of successTexts) {
      if (pageText.includes(txt)) {
        logger.info(`Confirmación detectada en texto: "${txt}"`);
        return true;
      }
    }
  } catch (_) {}

  // Indicadores de éxito en clases CSS
  const successSelectors = [
    '[class*="success" i]',
    '[class*="confirmed" i]',
    '[class*="confirmada" i]',
    '[class*="exitosa" i]',
    '[data-testid*="success"]',
    '[data-testid*="confirmed"]',
  ];

  for (const sel of successSelectors) {
    if (await page.$(sel)) {
      logger.info(`Confirmación detectada por selector: ${sel}`);
      return true;
    }
  }

  // Si la URL cambió a una página de confirmación
  const url = page.url();
  const successUrlParts = ['confirmacion', 'confirm', 'success', 'exitosa', 'reserva'];
  if (successUrlParts.some((part) => url.includes(part))) {
    logger.info(`Confirmación detectada por URL: ${url}`);
    return true;
  }

  // Si el modal desapareció y no hay error visible
  const errorSelectors = ['[class*="error" i]', '[role="alert"]', '[class*="alert" i]'];
  for (const sel of errorSelectors) {
    const el = await page.$(sel);
    if (el) {
      const errText = await el.textContent().catch(() => '');
      logger.warn(`Posible error detectado: "${errText.trim()}"`);
      return false;
    }
  }

  return false;
}

/**
 * Ejecuta la reserva para el slot dado (en la página ya abierta).
 * Retorna { success, error }.
 */
async function makeReservation(page, slot) {
  logger.info(`Intentando reservar: ${slot.time} | Cancha: ${slot.courtText}`);

  try {
    // Verificar que no sea duplicado
    if (await checkDuplicateBooking(page, slot)) {
      throw new Error('El slot ya no está disponible (posible reserva duplicada).');
    }

    // Scroll al elemento para asegurar visibilidad
    await slot.elementHandle.scrollIntoViewIfNeeded();
    await humanDelay(300, 700);
    await screenshot(page, 'reserve-antes-click');

    // Click en el slot disponible
    await slot.elementHandle.click();
    logger.info('Slot clickeado. Esperando modal de confirmación...');

    // Esperar modal o cambio de página
    const modal = await waitForBookingModal(page);
    await screenshot(page, 'reserve-modal');

    if (!modal) {
      logger.warn('No se detectó modal. La UI puede haber cambiado. Intentando confirmar directamente...');
    }

    // Hacer click en confirmar
    const clicked = await clickConfirmButton(page);
    if (!clicked) {
      await screenshot(page, 'reserve-error-sin-confirmar');
      throw new Error(
        'No se encontró botón de confirmación. ' +
          'La UI puede haber cambiado. Revisá el screenshot.'
      );
    }

    await screenshot(page, 'reserve-post-confirmar');

    // Verificar éxito
    const success = await verifyBookingSuccess(page);
    await screenshot(page, success ? 'reserve-exitosa' : 'reserve-posible-error');

    return { success, error: success ? null : 'No se detectó confirmación visual. Verificar manualmente.' };
  } catch (err) {
    await screenshot(page, 'reserve-excepcion');
    return { success: false, error: err.message };
  }
}

module.exports = { makeReservation };
