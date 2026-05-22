'use strict';
const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const config = require('../config');
const { humanDelay, sleep } = require('../utils');
const { waitForMagicLink } = require('./gmailImap');

// Opciones de contexto del browser con perfil argentino
function getBrowserContextOptions() {
  return {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    geolocation: { longitude: -60.7227, latitude: -31.6333 }, // Santa Fe
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'es-AR,es;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  };
}

/** Inyecta scripts para ocultar señales de automatización. */
async function applyStealthScripts(context) {
  await context.addInitScript(() => {
    // Remover webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Simular plugins
    Object.defineProperty(navigator, 'plugins', { get: () => Array(5).fill({}) });
    // Idiomas argentinos
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-AR', 'es', 'en-US', 'en'],
    });
    // Chrome runtime
    window.chrome = { runtime: {} };
  });
}

/** Toma screenshot para debug y lo guarda. */
async function screenshot(page, name) {
  try {
    const file = path.join(config.bot.screenshotsDir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    logger.info(`Screenshot guardado: ${file}`);
  } catch (err) {
    logger.warn(`No se pudo guardar screenshot: ${err.message}`);
  }
}

/** Escribe texto con velocidad humana. */
async function typeHuman(page, selector, text) {
  await page.click(selector);
  await humanDelay(200, 500);
  await page.fill(selector, '');
  for (const char of text) {
    await page.keyboard.type(char, { delay: 70 + Math.random() * 80 });
  }
}

/** Verifica si la sesión actual está activa navegando brevemente al inicio. */
async function isSessionValid(context) {
  const page = await context.newPage();
  try {
    await page.goto('https://atcsports.io/', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await sleep(1500);

    // Indicadores de sesión activa
    const loggedInSelectors = [
      '[data-testid="user-menu"]',
      '[class*="UserMenu"]',
      '[class*="user-menu"]',
      '[class*="Avatar"]',
      'a[href*="/cuenta"]',
      'a[href*="/perfil"]',
      'a[href*="/mis-reservas"]',
      'button[aria-label*="perfil"]',
      'button[aria-label*="usuario"]',
    ];

    for (const sel of loggedInSelectors) {
      if (await page.$(sel)) {
        logger.info('Sesión activa verificada.');
        return true;
      }
    }

    // Si hay botón de login, la sesión expiró
    const loginBtn = await page.$('a[href*="/login"], button:has-text("Iniciar sesión")');
    if (loginBtn) return false;

    // Si no fue redirigido a login, asumir válida
    return !page.url().includes('/login');
  } catch (err) {
    logger.warn(`Error verificando sesión: ${err.message}`);
    return false;
  } finally {
    await page.close();
  }
}

/** Ejecuta el flujo completo de login via magic link. */
async function performLogin(context) {
  const page = await context.newPage();
  try {
    logger.info('Iniciando login en ATC Sports (magic link)...');

    await page.goto('https://atcsports.io/login', {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    await humanDelay(1000, 2000);
    await screenshot(page, 'login-inicio');

    // --- Detectar campo de email ---
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="correo" i]',
      'input[placeholder*="Email"]',
    ];

    let emailSelector = null;
    for (const sel of emailSelectors) {
      if (await page.$(sel)) { emailSelector = sel; break; }
    }

    if (!emailSelector) {
      await screenshot(page, 'login-error-sin-input');
      throw new Error(
        'No se encontró campo de email en la página de login. ' +
          'El sitio puede haber cambiado. Revisá el screenshot en /screenshots.'
      );
    }

    // React hack: forzar onChange nativo que page.fill() no siempre dispara
    await page.click(emailSelector);
    await humanDelay(300, 500);
    await page.evaluate(
      ({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      { sel: emailSelector, val: config.atc.email }
    );
    await humanDelay(600, 1000);
    await screenshot(page, 'login-email-ingresado');

    // Intentar click en botón habilitado; si falla usar Enter directamente
    const submitSelectors = [
      'button:not([disabled]):has-text("Enviar link")',
      'button:not([disabled]):has-text("Enviar enlace")',
      'button:not([disabled]):has-text("Enviar")',
      'button:not([disabled]):has-text("Ingresar")',
      'button:not([disabled]):has-text("Continuar")',
      'button[type="submit"]:not([disabled])',
    ];

    let clicked = false;
    for (const sel of submitSelectors) {
      try {
        await page.click(sel, { timeout: 2000 });
        clicked = true;
        logger.info(`Botón de login clickeado: "${sel}"`);
        break;
      } catch (_) {}
    }

    if (!clicked) {
      logger.warn('No se pudo clickear botón habilitado. Enviando con Enter...');
      await page.press(emailSelector, 'Enter');
    }
    logger.info(`Magic link solicitado para: ${config.atc.email}`);

    // --- Esperar el magic link vía Gmail IMAP ---
    const magicLink = await waitForMagicLink();

    // --- Navegar al magic link ---
    logger.info('Activando magic link...');
    await page.goto(magicLink, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    await sleep(2500);
    await screenshot(page, 'login-post-magic-link');

    // --- Verificar login exitoso ---
    const loggedInSelectors = [
      '[data-testid="user-menu"]',
      '[class*="UserMenu"]',
      '[class*="Avatar"]',
      'a[href*="/cuenta"]',
      'a[href*="/mis-reservas"]',
    ];

    let success = false;
    for (const sel of loggedInSelectors) {
      if (await page.$(sel)) { success = true; break; }
    }

    if (!success && !page.url().includes('/login')) {
      // Si no fuimos redirigidos a login, probable éxito
      success = true;
    }

    if (!success) {
      await screenshot(page, 'login-fallo-verificacion');
      throw new Error(
        'Login falló: no se detectó sesión activa después del magic link. ' +
          'Revisá el screenshot en /screenshots.'
      );
    }

    logger.info('Login exitoso en ATC Sports.');

    // --- Guardar sesión ---
    const sessionDir = path.dirname(config.bot.sessionFile);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    await context.storageState({ path: config.bot.sessionFile });
    logger.info(`Sesión guardada en ${config.bot.sessionFile}`);
  } finally {
    await page.close();
  }
}

/**
 * Punto de entrada principal: crea y retorna un context de Playwright
 * con sesión válida. Reutiliza la sesión guardada si no expiró.
 */
async function ensureLoggedIn(browser) {
  const sessionExists = fs.existsSync(config.bot.sessionFile);

  if (sessionExists) {
    logger.info('Cargando sesión guardada...');
    let context;
    try {
      context = await browser.newContext({
        storageState: config.bot.sessionFile,
        ...getBrowserContextOptions(),
      });
    } catch (err) {
      logger.warn(`Sesión corrupta o inválida (${err.message}). Borrando y haciendo login fresco...`);
      try { fs.unlinkSync(config.bot.sessionFile); } catch (_) {}
      const freshContext = await browser.newContext(getBrowserContextOptions());
      await applyStealthScripts(freshContext);
      await performLogin(freshContext);
      return freshContext;
    }
    await applyStealthScripts(context);

    if (process.env.SKIP_SESSION_VALIDATION === 'true') {
      logger.info('Sesión cargada (validación omitida en CI).');
      return context;
    }

    if (await isSessionValid(context)) {
      return context;
    }

    logger.info('Sesión expirada. Reautenticando...');
    await context.close();
  }

  const freshContext = await browser.newContext(getBrowserContextOptions());
  await applyStealthScripts(freshContext);
  await performLogin(freshContext);
  return freshContext;
}

module.exports = { ensureLoggedIn, getBrowserContextOptions, applyStealthScripts };
