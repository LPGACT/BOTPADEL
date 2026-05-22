'use strict';
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const logger = require('../logger');
const config = require('../config');
const { sleep } = require('../utils');

const MAGIC_LINK_TIMEOUT_MS = 120_000; // 2 minutos para que llegue el email
const POLL_INTERVAL_MS = 8_000;        // Revisar cada 8 segundos

/** Extrae la URL del magic link del contenido del email. */
function extractMagicLink(html = '', text = '') {
  const content = (html + ' ' + text).replace(/&amp;/g, '&');

  // Prioridad 1: Firebase auth link (formato real que usa ATC Sports)
  // Ej: https://alquilatucancha-3f36d.firebaseapp.com/__/auth/action?...
  const firebaseMatch = content.match(
    /https:\/\/[a-z0-9-]+\.firebaseapp\.com\/__\/auth\/[^\s"'<>]*/gi
  );
  if (firebaseMatch?.[0]) {
    return firebaseMatch[0].replace(/&amp;/g, '&').replace(/["']/g, '').split('>')[0];
  }

  // Prioridad 2: dominios ATC con parámetros de auth
  const ATC_DOMAINS = '(?:atcsports\\.io|alquilatucancha\\.com)';
  const patterns = [
    new RegExp(`https:\\/\\/${ATC_DOMAINS}\\/[^\\s"'<>\\]]+(?:token|auth|verify|magic|login)[^\\s"'<>\\]]+`, 'gi'),
    new RegExp(`https:\\/\\/[a-z.]*(?:atcsports|alquilatucancha)[^\\s"'<>\\]]*[?&](?:token|oobCode|code)=[^\\s"'<>\\]]+`, 'gi'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[0]) {
      return match[0].replace(/&amp;/g, '&').replace(/["']/g, '').split('>')[0];
    }
  }

  return null;
}

/** Busca en Gmail el email de magic link llegado desde `sinceDate`. */
function searchMagicLinkEmail(sinceDate) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.gmail.imapUser,
      password: config.gmail.imapPassword,
      host: config.gmail.imapHost,
      port: config.gmail.imapPort,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: false,
        servername: 'imap.gmail.com',
        minVersion: 'TLSv1.2',
      },
      authTimeout: 20_000,
      connTimeout: 20_000,
    });

    const cleanup = () => { try { imap.end(); } catch (_) {} };

    imap.once('error', (err) => { cleanup(); reject(err); });

    imap.once('ready', () => {
      imap.openBox('INBOX', /* readOnly= */ false, (err) => {
        if (err) { cleanup(); return reject(err); }

        // Buscar emails recientes de atcsports.io
        const criteria = [
          ['SINCE', sinceDate],
          ['OR',
            ['FROM', 'atcsports.io'],
            ['OR',
              ['FROM', 'atcsports'],
              ['SUBJECT', 'ATC']
            ]
          ],
        ];

        imap.search(criteria, (err, uids) => {
          if (err) { cleanup(); return reject(err); }

          if (!uids || uids.length === 0) {
            cleanup();
            return resolve(null);
          }

          // Procesar el más reciente
          const uid = uids[uids.length - 1];
          const fetch = imap.fetch(uid, { bodies: '' });
          // Promise que resuelve cuando simpleParser termina (evita race condition)
          let parsePromise = Promise.resolve(null);

          fetch.on('message', (msg) => {
            parsePromise = new Promise((resolveParse) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (parseErr, parsed) => {
                  if (parseErr) { resolveParse(null); return; }
                  const from = parsed.from?.text || '';
                  const subject = parsed.subject || '';
                  logger.info(`Email ATC recibido | De: "${from}" | Asunto: "${subject}"`);
                  resolveParse(extractMagicLink(parsed.html || '', parsed.text || ''));
                });
              });
            });
          });

          fetch.once('error', (fetchErr) => { cleanup(); reject(fetchErr); });
          fetch.once('end', () => {
            cleanup();
            parsePromise.then(resolve).catch(() => resolve(null));
          });
        });
      });
    });

    imap.connect();
  });
}

/**
 * Espera hasta MAGIC_LINK_TIMEOUT_MS a que llegue el magic link de ATC Sports.
 * Hace polling cada POLL_INTERVAL_MS segundos.
 * Lanza error si no llega en tiempo.
 */
async function waitForMagicLink() {
  // Marcar el instante ANTES de que el bot haya pedido el link
  const sinceDate = new Date(Date.now() - 30_000);
  const deadline = Date.now() + MAGIC_LINK_TIMEOUT_MS;

  logger.info('Esperando magic link de ATC Sports en Gmail...');

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const link = await searchMagicLinkEmail(sinceDate);
      if (link) {
        logger.info(`Magic link encontrado: ${link.substring(0, 80)}...`);
        return link;
      }
      const remaining = Math.round((deadline - Date.now()) / 1000);
      logger.info(`Magic link no encontrado aún. Reintentando... (${remaining}s restantes)`);
    } catch (err) {
      logger.warn(`Error buscando magic link en Gmail: ${err.message}`);
    }
  }

  throw new Error(
    'Timeout: el magic link de ATC Sports no llegó en 2 minutos. ' +
      'Verificá manualmente el correo o si el email ingresado es correcto.'
  );
}

module.exports = { waitForMagicLink };
