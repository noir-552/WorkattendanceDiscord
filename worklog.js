const { EmbedBuilder } = require('discord.js');

const TZ = process.env.TZ_DISPLAY || 'Asia/Jakarta';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT,
    start_at INTEGER NOT NULL,
    end_at INTEGER,
    link TEXT,
    activity TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_open ON sessions(user_id, end_at);
`;

function createQueries(db) {
  return {
    active: db.prepare('SELECT * FROM sessions WHERE user_id = ? AND end_at IS NULL'),
    activeAll: db.prepare('SELECT * FROM sessions WHERE end_at IS NULL ORDER BY start_at ASC'),
    start: db.prepare('INSERT INTO sessions (user_id, username, start_at) VALUES (?, ?, ?)'),
    close: db.prepare('UPDATE sessions SET end_at = ?, link = ?, activity = ? WHERE id = ?'),
    summary: db.prepare(`
      SELECT user_id, MAX(username) AS username, COUNT(*) AS n,
             COALESCE(SUM(end_at - start_at), 0) AS total
      FROM sessions
      WHERE end_at IS NOT NULL AND start_at >= ?
      GROUP BY user_id
      ORDER BY total DESC, username ASC
    `),
    detail: db.prepare(`
      SELECT user_id, username, start_at, end_at, activity, link
      FROM sessions
      WHERE end_at IS NOT NULL AND start_at >= ?
      ORDER BY start_at ASC
    `),
  };
}

const fmtDur = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}j ${m}m ${sec}d`;
};
const fmtTime = (ts, tz = TZ) =>
  new Date(ts).toLocaleString('id-ID', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
const fmtDate = (ts, tz = TZ) =>
  new Date(ts).toLocaleDateString('id-ID', { timeZone: tz, day: '2-digit', month: 'short' });
const fmtClock = (ts, tz = TZ) =>
  new Date(ts).toLocaleTimeString('id-ID', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

const clampText = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function clampLines(lines, max) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const extra = (out ? 1 : 0) + lines[i].length;
    if (out.length + extra > max - 24) {
      return `${out}\n… (+${lines.length - i} sesi lagi)`.trim();
    }
    out += (out ? '\n' : '') + lines[i];
  }
  return out;
}

function buildStatusEmbed(rows, now, tz = TZ) {
  const active = [...rows].sort((a, b) => a.start_at - b.start_at);
  const embed = new EmbedBuilder().setColor(0x57f287).setTimestamp(now);

  if (!active.length) {
    return embed.setTitle('⏱️ Lagi kerja').setDescription('Sekarang gak ada yang lagi kerja.');
  }

  const lines = active.map((r) =>
    `🟢 <@${r.user_id}> — **${fmtDur(now - r.start_at)}** (mulai ${fmtClock(r.start_at, tz)})`);
  return embed
    .setTitle(`⏱️ Lagi kerja — ${active.length} orang`)
    .setDescription(clampText(lines.join('\n'), 4000));
}

function sessionLines(rows, tz) {
  const lines = rows.map((r) => {
    const activity = (r.activity || 'tanpa activity').slice(0, 120);
    const label = r.link ? `[${activity}](${r.link})` : activity;
    const when = `${fmtDate(r.start_at, tz)} ${fmtClock(r.start_at, tz)}–${fmtClock(r.end_at, tz)}`;
    return `• ${when} · ${fmtDur(r.end_at - r.start_at)} — ${label}`;
  });
  return clampLines(lines, 1000);
}

function buildReportEmbed({ summary, detailRows = null, days, tz = TZ }) {
  const people = [...summary].sort(
    (a, b) => b.total - a.total || String(a.username).localeCompare(String(b.username)),
  );
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 Report ${days} hari terakhir`).setTimestamp();

  if (!people.length) {
    return embed.setDescription(`Belum ada sesi selesai dalam ${days} hari terakhir.`);
  }

  const totalMs = people.reduce((a, p) => a + p.total, 0);
  const totalSessions = people.reduce((a, p) => a + p.n, 0);
  embed.setDescription(
    `Total **${fmtDur(totalMs)}** dari **${totalSessions} sesi** · **${people.length} orang**`,
  );

  const detailByUser = new Map();
  if (detailRows) {
    for (const row of detailRows) {
      if (!detailByUser.has(row.user_id)) detailByUser.set(row.user_id, []);
      detailByUser.get(row.user_id).push(row);
    }
  }

  for (const [i, p] of people.slice(0, 24).entries()) {
    embed.addFields({
      name: `${i + 1}. <@${p.user_id}> — ${fmtDur(p.total)}`,
      value: detailRows ? sessionLines(detailByUser.get(p.user_id) || [], tz) : `${p.n} sesi`,
    });
  }

  const rest = people.slice(24);
  if (rest.length) {
    embed.addFields({
      name: `➕ ${rest.length} orang lagi`,
      value: `${rest.reduce((a, p) => a + p.n, 0)} sesi · ${fmtDur(rest.reduce((a, p) => a + p.total, 0))}`,
    });
  }

  return embed;
}

module.exports = {
  TZ, SCHEMA, createQueries, fmtDur, fmtTime, fmtDate, fmtClock,
  buildStatusEmbed, buildReportEmbed,
};
