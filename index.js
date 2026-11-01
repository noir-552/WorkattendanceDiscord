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

// ---------- Bot ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await registerCommands();
});

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

      if (LOG_CHANNEL_ID && LOG_CHANNEL_ID !== i.channelId) {
        const ch = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (ch) await ch.send({ embeds: [embed] });
      }
      return i.reply({ embeds: [embed] });
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
    if (!i.replied) i.reply({ content: '💥 Error, cek log bot.', ...ephemeral }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);
