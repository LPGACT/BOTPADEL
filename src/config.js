'use strict';
require('dotenv').config();

const REQUIRED_VARS = [
  'ATC_EMAIL',
  'GMAIL_APP_PASSWORD',
  'SMTP_USER',
  'SMTP_PASS',
  'NOTIFY_EMAIL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

function validate() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Variables de entorno faltantes en .env: ${missing.join(', ')}\n` +
        'Copiá .env.example como .env y completá los valores.'
    );
  }
}

const config = {
  atc: {
    email: process.env.ATC_EMAIL,
    venueUrl:
      process.env.VENUE_URL || 'https://atcsports.io/venues/kuman-caba',
    venueSlug: process.env.VENUE_SLUG || 'kuman-caba',
    placeId: process.env.VENUE_PLACE_ID || '',
    sportId: process.env.SPORT_ID || '17',
    targetDay: 1, // 1 = lunes (getDay())
    durationMinutes: parseInt(process.env.DURATION_MINUTES || '90', 10),
    targetTimes: (process.env.TARGET_TIMES || '18:00,18:30,19:00,19:30')
      .split(',')
      .map((t) => t.trim()),
  },

  gmail: {
    imapUser: process.env.ATC_EMAIL,
    imapPassword: process.env.GMAIL_APP_PASSWORD,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
  },

  smtp: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    notifyEmail: process.env.NOTIFY_EMAIL,
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    groupId: process.env.TELEGRAM_GROUP_ID || '',
  },

  bot: {
    checkIntervalMs: parseInt(
      process.env.CHECK_INTERVAL_MS || '300000',
      10
    ),
    stopAfterBooking: process.env.STOP_AFTER_BOOKING !== 'false',
    headless: process.env.HEADLESS !== 'false',
    sessionFile: 'data/session.json',
    screenshotsDir: 'screenshots',
  },

  validate,
};

module.exports = config;
