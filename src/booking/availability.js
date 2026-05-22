'use strict';
const path = require('path');
const logger = require('../logger');
const config = require('../config');
const { humanDelay, sleep, formatDate } = require('../utils');

// Palabras clave que indican cancha techada/cubierta
const COVERED_KEYWORDS = ['techada', 'cubierta', 'indoor', 'techo', 'cerrada'];

/** Construye la URL del venue con el filtro de fecha. */
function buildVenueUrl(date) {
  const dateStr = formatDate(date);
  const params = new URLSearchParams({ dia: dateStr });
  // Agregar placeId solo si está configurado (algunos venues no lo necesitan)
  if (config.atc.placeId) {
    params.set('placeId', config.atc.placeId);
    params.set('placeSearched', config.atc.placeId);
  }
  if (config.atc.sportId) params.set('sportIds', config.atc.sportId);
  return `${config.atc.venueUrl}?${params.toString()}`;
}

/** Toma screenshot para debug. */
async function screenshot(page, name) {
  try {
    const file = path.join(config.bot.screenshotsDir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
  } catch (_) {}
}

/** Intenta seleccionar la duración del turno en la UI. */
async function selectDuration(page, minutes) {
  const label = String(minutes);
  const selectors = [
    `button:has-text("${label}")`,
    `[data-duration="${label}"]`,
    `[data-value="${label}"]`,
    `[value="${label}"]`,
    `option[value="${label}"]`,
    `[class*="duration" i]:has-text("${label}")`,
    `[class*="Duracion" i]:has-text("${label}")`,
    `[class*="tiempo" i]:has-text("${label}")`,
    `label:has-text("${label}")`,
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await sleep(800);
        logger.info(`Duración ${minutes} min seleccionada.`);
        return true;
      }
    } catch (_) {}
  }

  logger.warn(`No se encontró selector de duración para ${minutes} min. Continuando sin filtrar.`);
  return false;
}

/** Determina si un elemento slot está disponible (no deshabilitado). */
async function isSlotAvailable(element) {
  try {
    return await element.evaluate((el) => {
      if (el.disabled) return false;
      const cls = (el.className || '').toLowerCase();
      const blocked = ['disabled', 'blocked', 'occupied', 'reservada', 'ocupada', 'unavailable', 'no-disponible'];
      if (blocked.some((kw) => cls.includes(kw))) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
      if (el.style?.pointerEvents === 'none') return false;
      if (el.style?.opacity === '0' || parseFloat(el.style?.opacity || '1') < 0.4) return false;
      return true;
    });
  } catch (_) {
    return false;
  }
}

/** Busca el texto de la cancha asociada a un slot. */
async function getCourtText(element, page) {
  try {
    // Intentar encontrar el nombre de cancha en el elemento o sus padres
    return await element.evaluate((el) => {
      const courtKeywords = ['cancha', 'court', 'pista', 'techada', 'cubierta'];
      // Buscar en el propio elemento y en ancestros cercanos
      let node = el;
      for (let i = 0; i < 5; i++) {
        const text = (node.textContent || '').toLowerCase();
        if (courtKeywords.some((kw) => text.includes(kw))) {
          return node.textContent.trim().substring(0, 60);
        }
        if (node.parentElement) node = node.parentElement;
        else break;
      }
      // Buscar en elemento hermano
      const siblings = el.parentElement?.querySelectorAll?.('[class*="cancha"], [class*="court"]');
      if (siblings?.length) return siblings[0].textContent.trim().substring(0, 60);
      return null;
    });
  } catch (_) {
    return null;
  }
}

/** Verifica si el texto de la cancha indica que es techada/cubierta. */
function isCoveredCourt(courtText) {
  if (!courtText) return false;
  const lower = courtText.toLowerCase();
  return COVERED_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Busca todos los slots disponibles para los horarios objetivo.
 * Retorna array de { time, elementHandle, courtText, isCovered }.
 */
async function findAvailableSlots(page) {
  const available = [];

  for (const targetTime of config.atc.targetTimes) {
    // Múltiples estrategias de selector para cada horario
    const strategies = [
      `button:has-text("${targetTime}")`,
      `[data-hour="${targetTime}"]`,
      `[data-time="${targetTime}"]`,
      `[data-horario="${targetTime}"]`,
      `[class*="slot" i]:has-text("${targetTime}")`,
      `[class*="turno" i]:has-text("${targetTime}")`,
      `[class*="horario" i]:has-text("${targetTime}")`,
      `[class*="hour" i]:has-text("${targetTime}")`,
      `td:has-text("${targetTime}")`,
      `li:has-text("${targetTime}")`,
      `div[role="button"]:has-text("${targetTime}")`,
    ];

    let slotsForTime = [];

    for (const sel of strategies) {
      try {
        const elements = await page.$$(sel);
        if (elements.length > 0) {
          slotsForTime = elements;
          break;
        }
      } catch (_) {}
    }

    for (const el of slotsForTime) {
      if (await isSlotAvailable(el)) {
        const courtText = await getCourtText(el, page);
        available.push({
          time: targetTime,
          elementHandle: el,
          courtText: courtText || 'Desconocida',
          isCovered: isCoveredCourt(courtText),
        });
      }
    }
  }

  return available;
}

/**
 * Ordena los slots: techadas primero, luego por orden de horario (más temprano primero).
 * Los targetTimes ya están en orden de prioridad de horario.
 */
function sortSlots(slots) {
  return [...slots].sort((a, b) => {
    // Techadas tienen prioridad absoluta
    if (a.isCovered && !b.isCovered) return -1;
    if (!a.isCovered && b.isCovered) return 1;
    // Entre iguales, mantener orden de targetTimes (más temprano primero)
    const idxA = config.atc.targetTimes.indexOf(a.time);
    const idxB = config.atc.targetTimes.indexOf(b.time);
    return idxA - idxB;
  });
}

/**
 * Navega al venue y retorna los slots disponibles ordenados por preferencia.
 * Retorna array vacío si no hay disponibilidad.
 */
async function checkAvailability(context, targetDate) {
  const page = await context.newPage();
  try {
    const url = buildVenueUrl(targetDate);
    const dateStr = formatDate(targetDate);
    logger.info(`Verificando disponibilidad para lunes ${dateStr}...`);
    logger.info(`URL: ${url}`);

    // 'domcontentloaded' + espera fija es más robusto que 'networkidle' en SPAs
    // que tienen WebSockets o polling que nunca terminan
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(4000); // Esperar que React hidrate y cargue los slots

    // Scroll para cargar contenido lazy
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(1500);

    await screenshot(page, `check-${dateStr}`);

    // Intentar seleccionar duración
    await selectDuration(page, config.atc.durationMinutes);

    // Esperar carga dinámica post-filtro
    await sleep(1500);
    await screenshot(page, `check-${dateStr}-after-duration`);

    const slots = await findAvailableSlots(page);

    if (slots.length === 0) {
      logger.info(`Sin disponibilidad para ${dateStr} en horarios: ${config.atc.targetTimes.join(', ')}`);
      return { page, slots: [] };
    }

    const sorted = sortSlots(slots);
    const descriptions = sorted.map((s) => `${s.time} (${s.isCovered ? 'TECHADA' : 'al aire'} - ${s.courtText})`);
    logger.info(`Slots disponibles: ${descriptions.join(' | ')}`);

    // Retornar page abierta (el caller la cierra) para poder hacer la reserva en la misma página
    return { page, slots: sorted };
  } catch (err) {
    await screenshot(page, 'check-error');
    await page.close();
    throw err;
  }
}

module.exports = { checkAvailability, buildVenueUrl };
