const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  SCHEMA, createQueries, fmtDur, buildStatusEmbed, buildReportEmbed,
} = require('../worklog');

const TZ = 'UTC';
const T0 = Date.UTC(2026, 0, 1, 7, 0, 0);
const MIN = 60000;

test('fmtDur formats hours, minutes and seconds', () => {
  assert.equal(fmtDur(0), '0j 0m 0d');
  assert.equal(fmtDur((1 * 3600 + 2 * 60 + 3) * 1000), '1j 2m 3d');
});

test('buildStatusEmbed lists everyone working, longest first', () => {
  const rows = [
    { user_id: '2', username: 'budi', start_at: T0 + 30 * MIN },
    { user_id: '1', username: 'ani', start_at: T0 },
  ];

  const embed = buildStatusEmbed(rows, T0 + 90 * MIN, TZ);
  const lines = embed.data.description.split('\n');

  assert.equal(embed.data.title, '⏱️ Lagi kerja — 2 orang');
  assert.match(lines[0], /<@1>/);
  assert.match(lines[0], /1j 30m 0d/);
  assert.match(lines[0], /mulai 07\.00/);
  assert.match(lines[1], /<@2>/);
  assert.match(lines[1], /1j 0m 0d/);
});

test('buildStatusEmbed says when nobody is working', () => {
  const embed = buildStatusEmbed([], T0, TZ);
  assert.equal(embed.data.title, '⏱️ Lagi kerja');
  assert.equal(embed.data.description, 'Sekarang gak ada yang lagi kerja.');
});

test('buildReportEmbed summarizes each person and the team total', () => {
  const summary = [
    { user_id: '1', username: 'ani', n: 2, total: 90 * MIN },
    { user_id: '2', username: 'budi', n: 1, total: 30 * MIN },
  ];

  const embed = buildReportEmbed({ summary, days: 7, tz: TZ });

  assert.equal(embed.data.title, '📊 Report 7 hari terakhir');
  assert.match(embed.data.description, /\*\*2j 0m 0d\*\*/);
  assert.match(embed.data.description, /\*\*3 sesi\*\*/);
  assert.match(embed.data.description, /\*\*2 orang\*\*/);
  assert.equal(embed.data.fields.length, 2);
  assert.match(embed.data.fields[0].name, /ani/);
  assert.match(embed.data.fields[0].name, /1j 30m 0d/);
  assert.doesNotMatch(embed.data.fields[0].name, /<@/);
  assert.equal(embed.data.fields[0].value, '2 sesi');
});

test('buildReportEmbed shows per-session activity and link in detail mode', () => {
  const summary = [{ user_id: '1', username: 'ani', n: 1, total: 30 * MIN }];
  const detailRows = [{
    user_id: '1',
    username: 'ani',
    start_at: T0,
    end_at: T0 + 30 * MIN,
    activity: 'ngerjain inian',
    link: 'https://example.test/pr/1',
  }];

  const embed = buildReportEmbed({ summary, detailRows, days: 7, tz: TZ });
  const field = embed.data.fields.find((f) => f.name.includes('ani'));

  assert.match(field.value, /01 Jan 07\.00–07\.30/);
  assert.match(field.value, /30m 0d/);
  assert.match(field.value, /\[ngerjain inian\]\(https:\/\/example\.test\/pr\/1\)/);
});

test('buildReportEmbed caps fields at Discord limit', () => {
  const summary = Array.from({ length: 30 }, (_, i) => ({
    user_id: String(i + 1),
    username: `user${i + 1}`,
    n: 1,
    total: (30 - i) * MIN,
  }));

  const embed = buildReportEmbed({ summary, days: 7, tz: TZ });

  assert.equal(embed.data.fields.length, 25);
  assert.match(embed.data.fields[24].name, /6 orang lagi/);
});

test('createQueries groups completed sessions within the window', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const q = createQueries(db);
  const insert = db.prepare(
    'INSERT INTO sessions (user_id, username, start_at, end_at, link, activity) VALUES (?, ?, ?, ?, ?, ?)',
  );

  insert.run('1', 'ani', T0, T0 + 30 * MIN, 'https://x.test', 'a');
  insert.run('1', 'ani', T0 + 60 * MIN, null, null, null);
  insert.run('2', 'budi', T0 - 10 * 86400000, T0 - 10 * 86400000 + 60 * MIN, 'https://y.test', 'b');
  insert.run('2', 'budi', T0 + 60 * MIN, T0 + 90 * MIN, 'https://z.test', 'c');

  const since = T0 - 86400000;
  const summary = q.summary.all(since);
  const active = q.activeAll.all();
  const detail = q.detail.all(since);

  assert.deepEqual(summary.map((r) => [r.user_id, r.n, r.total]), [
    ['1', 1, 30 * MIN],
    ['2', 1, 30 * MIN],
  ]);
  assert.equal(active.length, 1);
  assert.equal(active[0].user_id, '1');
  assert.equal(detail.length, 2);
  assert.equal(detail[0].activity, 'a');
  assert.equal(detail[1].activity, 'c');
});
