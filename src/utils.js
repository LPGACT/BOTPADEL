'use strict';

/** Pausa aleatoria con distribución humana. */
async function humanDelay(minMs = 400, maxMs = 1200) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  await new Promise((r) => setTimeout(r, ms));
}

/** Pausa fija. */
async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Retorna el próximo lunes a partir de `from`.
 * Si `from` ya es lunes, retorna el lunes siguiente (7 días después).
 */
function getNextMonday(from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Dom, 1=Lun, ...
  const daysUntil = day === 1 ? 7 : (8 - day) % 7;
  d.setDate(d.getDate() + daysUntil);
  return d;
}

/** Formatea una fecha como YYYY-MM-DD. */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Formatea fecha y hora legible en Argentina. */
function formatDateTime(date = new Date()) {
  return date.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Ejecuta `fn` hasta `maxAttempts` veces con backoff exponencial.
 * Lanza el último error si todos los intentos fallan.
 */
async function retry(fn, { maxAttempts = 3, baseDelayMs = 2000, label = 'operación' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const wait = baseDelayMs * Math.pow(2, attempt - 1);
        const logger = require('./logger');
        logger.warn(
          `[retry] ${label} - intento ${attempt}/${maxAttempts} falló: ${err.message}. Reintentando en ${wait}ms...`
        );
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

module.exports = { humanDelay, sleep, getNextMonday, formatDate, formatDateTime, retry };
