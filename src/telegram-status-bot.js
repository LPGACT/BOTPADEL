'use strict';
require('dotenv').config();
const { Telegraf } = require('telegraf');

const REPO = 'LPGACT/BOTPADEL';
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);

const ICONS = { success: '✅', failure: '❌', cancelled: '⛔', in_progress: '⏳', queued: '🕐' };

// Solo responde al dueño
bot.use((ctx, next) => {
  if (String(ctx.from?.id) !== CHAT_ID) return;
  return next();
});

bot.command('start', (ctx) => {
  ctx.reply(
    '🤖 *Bot de Padel — Status*\n\n/estado — Ver últimos runs de GitHub Actions',
    { parse_mode: 'Markdown' }
  );
});

bot.command('estado', async (ctx) => {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs?per_page=10`,
      { headers: { 'User-Agent': 'bot-padel-status' } }
    );

    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);

    const { workflow_runs: runs } = await res.json();

    if (!runs?.length) {
      ctx.reply('No hay runs registrados aún.');
      return;
    }

    const fmt = (dateStr) =>
      new Date(dateStr).toLocaleString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });

    const latest = runs[0];
    const latestIcon = ICONS[latest.conclusion] || ICONS[latest.status] || '❓';

    const lines = runs.slice(0, 8).map((r) => {
      const icon = ICONS[r.conclusion] || ICONS[r.status] || '❓';
      return `${icon} ${fmt(r.created_at)}`;
    });

    await ctx.reply(
      `📊 *Estado del Bot (GitHub Actions)*\n\n` +
      `Último run: ${latestIcon} ${fmt(latest.created_at)}\n\n` +
      `*Historial:*\n${lines.join('\n')}\n\n` +
      `🔗 [Ver logs completos](https://github.com/${REPO}/actions)`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
  } catch (err) {
    ctx.reply(`❌ Error consultando GitHub: ${err.message}`);
  }
});

bot.launch({ allowedUpdates: ['message'] });
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

console.log('Status bot iniciado. Enviá /estado en Telegram.');
