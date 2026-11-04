require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, MessageFlags,
} = require('discord.js');
const Database = require('better-sqlite3');
const {
  TZ, SCHEMA, createQueries, fmtDur, fmtTime, buildStatusEmbed, buildReportEmbed,
} = require('./worklog');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, LOG_CHANNEL_ID } = process.env;
const DB_PATH = process.env.DB_PATH || './data/worklog.db';

// ---------- Database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
// WAL + synchronous=NORMAL: write lebih cepat & gak nge-block read, tetap aman dari korupsi.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.exec(SCHEMA);
const q = createQueries(db);

// ---------- Helpers ----------
const isValidUrl = (str) => {
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
};

// ---------- Slash commands ----------
const commands = [
  new SlashCommandBuilder().setName('check-in').setDescription('Mulai stopwatch jam kerja'),
  new SlashCommandBuilder()
    .setName('check-out')
    .setDescription('Stop stopwatch (wajib isi link & activity)')
    .addStringOption((o) => o.setName('link').setDescription('Link hasil kerja (PR, doc, Figma, dll)').setRequired(true))
    .addStringOption((o) => o.setName('activity').setDescription('Apa yang dikerjain').setRequired(true).setMinLength(5)),
  new SlashCommandBuilder().setName('status').setDescription('Cek siapa yang lagi kerja dan berapa lama'),
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Rekap jam kerja semua orang')
    .addIntegerOption((o) => o.setName('hari').setDescription('Berapa hari ke belakang (default 7)').setMinValue(1).setMaxValue(90))
    .addBooleanOption((o) => o.setName('detail').setDescription('Tampilkan rincian tiap sesi (activity & link)')),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log('✅ Slash commands registered');
}

// Kirim embed ke channel log tanpa nge-block reply ke user.
// Pakai cache dulu (0 request), baru fetch kalau belum ada.
async function relayToLogChannel(payload) {
  try {
    const ch = client.channels.cache.get(LOG_CHANNEL_ID)
      ?? await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch?.isTextBased()) await ch.send(payload);
  } catch (err) {
    console.error('⚠️ Gagal kirim ke log channel:', err.message);
  }
}

// ---------- Bot ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('❌ Gagal register slash commands:', err);
  }
  // Warm-up cache channel log supaya check-out pertama gak kena delay fetch.
  if (LOG_CHANNEL_ID) client.channels.fetch(LOG_CHANNEL_ID).catch(() => {});
});

client.on('error', (err) => console.error('Discord client error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  const uid = i.user.id;
  const now = Date.now();
  const ephemeral = { flags: MessageFlags.Ephemeral };

  try {
    if (i.commandName === 'check-in') {
      const act = q.active.get(uid);
      if (act) return i.reply({ content: `⚠️ Lo masih check-in dari **${fmtTime(act.start_at)}**. Check-out dulu.`, ...ephemeral });
      q.start.run(uid, i.user.username, now);
      return i.reply(`🟢 **${i.user.displayName}** check-in jam **${fmtTime(now)}**. Semangat!`);
    }

    if (i.commandName === 'check-out') {
      const act = q.active.get(uid);
      if (!act) return i.reply({ content: '⚠️ Lo belum check-in.', ...ephemeral });

      const link = i.options.getString('link').trim();
      const activity = i.options.getString('activity').trim();
      if (!isValidUrl(link)) return i.reply({ content: '❌ Link gak valid. Harus diawali http:// atau https://', ...ephemeral });

      q.close.run(now, link, activity, act.id);
      const dur = now - act.start_at;

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setAuthor({ name: i.user.displayName, iconURL: i.user.displayAvatarURL() })
        .setTitle('🔴 Check-out')
        .addFields(
          { name: 'Mulai', value: fmtTime(act.start_at), inline: true },
          { name: 'Selesai', value: fmtTime(now), inline: true },
          { name: 'Durasi', value: `**${fmtDur(dur)}**`, inline: true },
          { name: 'Activity', value: activity.slice(0, 1024) },
          { name: 'Link', value: link.slice(0, 1024) },
        )
        .setTimestamp();

      // Reply dulu (batas ack Discord 3 detik), relay ke log channel jalan di background.
      await i.reply({ embeds: [embed] });
      if (LOG_CHANNEL_ID && LOG_CHANNEL_ID !== i.channelId) relayToLogChannel({ embeds: [embed] });
      return;
    }

    if (i.commandName === 'status') {
      return i.reply({ embeds: [buildStatusEmbed(q.activeAll.all(), now, TZ)] });
    }

    if (i.commandName === 'report') {
      const days = i.options.getInteger('hari') ?? 7;
      const since = now - days * 86400000;
      const detailRows = i.options.getBoolean('detail') ? q.detail.all(since) : null;
      return i.reply({
        embeds: [buildReportEmbed({ summary: q.summary.all(since), detailRows, days, tz: TZ })],
      });
    }
  } catch (err) {
    console.error(err);
    const msg = { content: '💥 Error, cek log bot.', ...ephemeral };
    const send = i.replied || i.deferred ? i.followUp(msg) : i.reply(msg);
    send.catch(() => {});
  }
});

// Graceful shutdown (docker stop kirim SIGTERM) supaya WAL ke-checkpoint & DB ketutup rapi.
function shutdown(signal) {
  console.log(`👋 ${signal} diterima, shutdown...`);
  client.destroy().catch(() => {}).finally(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(DISCORD_TOKEN);
