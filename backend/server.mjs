import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, createWriteStream, createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import Busboy from 'busboy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv'
]);

// Minimal .env loader (no extra dependency at runtime beyond pg)
try {
  const envPath = path.join(__dirname, '.env');
  const raw = readFileSync(envPath, 'utf8');
  raw.split('\n').forEach(line => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = (m[2] || '').trim();
  });
} catch (e) { /* .env is optional */ }

const GADGET_ID = 'gadget_talknest_kato';
const PORT = Number(process.env.PORT || process.env.TALKNEST_BACKEND_PORT || 8791);
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();
const STAMPS = ['👍','🎉','😂','❤️','🙏','👀','💡','✅','🔥','😢','😮','🚀'];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Refusing to start without a configured PostgreSQL connection.');
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
});
if (process.env.PGSCHEMA) {
  pool.on('connect', (client) => {
    client.query(`SET search_path TO ${process.env.PGSCHEMA}, public`).catch(() => {});
  });
}

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
function extractMentionUsernames(text) {
  const matches = String(text || '').match(/@([a-zA-Z0-9_]+)/g) || [];
  return [...new Set(matches.map(m => m.slice(1)))];
}
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  const [salt] = String(stored || '').split(':');
  if (!salt) return false;
  return crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored));
};
const rowToUser = (r) => r && ({
  id: r.id, username: r.username, displayName: r.display_name, email: r.email,
  department: r.department, role: r.role, avatarColor: r.avatar_color, avatarUrl: r.avatar_url,
  createdAt: r.created_at, updatedAt: r.updated_at
});
const rowToChannel = (r) => r && ({
  id: r.id, name: r.name, type: r.type, members: r.members,
  createdAt: r.created_at, updatedAt: r.updated_at
});
const rowToDm = (r) => r && ({ id: r.id, members: r.members, createdAt: r.created_at, updatedAt: r.updated_at });
const rowToMessage = (r) => r && ({
  id: r.id, channelId: r.channel_id, dmId: r.dm_id, userId: r.user_id, text: r.text,
  attachments: r.attachments, reactions: r.reactions, revoked: r.revoked,
  createdAt: r.created_at, updatedAt: r.updated_at
});
const rowToReply = (r) => r && ({
  id: r.id, messageId: r.message_id, userId: r.user_id, text: r.text,
  reactions: r.reactions, createdAt: r.created_at, updatedAt: r.updated_at
});

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM users');
  if (rows[0].c > 0) return;
  const t = now();
  const seedUsers = [
    { id: 'usr_takasu', username: 'takasu', displayName: '加藤良会', email: 'takasu@talknest.example', department: '営業企画部', role: '管理者', avatarColor: '#4f7cff' },
    { id: 'usr_minagawa', username: 'minagawa', displayName: '皆川 蓮', email: 'minagawa@talknest.example', department: '制作部', role: 'メンバー', avatarColor: '#ff9f43' },
    { id: 'usr_shinonome', username: 'shinonome', displayName: '東雲 彩', email: 'shinonome@talknest.example', department: 'カスタマーサクセス部', role: 'メンバー', avatarColor: '#2ed573' },
    { id: 'usr_fujimura', username: 'fujimura', displayName: '藤村 悠', email: 'fujimura@talknest.example', department: 'エンジニアリング部', role: 'メンバー', avatarColor: '#a55eea' },
    { id: 'usr_kurosaki', username: 'kurosaki', displayName: '黒崎 遥', email: 'kurosaki@talknest.example', department: '人事部', role: 'メンバー', avatarColor: '#ff4f81' }
  ];
  for (const u of seedUsers) {
    await pool.query(
      `INSERT INTO users (id, username, display_name, email, password_hash, department, role, avatar_color, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [u.id, u.username, u.displayName, u.email, hashPassword('password'), u.department, u.role, u.avatarColor, t]
    );
  }
  const memberIds = seedUsers.map(u => u.id);
  await pool.query(
    `INSERT INTO channels (id, name, type, members, created_at, updated_at) VALUES
     ('ch_general','雑談','public',$1,$2,$2),
     ('ch_project','新規プロジェクト','public',$1,$2,$2),
     ('ch_ops','運営チーム','private',$3,$2,$2)`,
    [memberIds, t, ['usr_takasu','usr_minagawa']]
  );
  await pool.query(
    `INSERT INTO dms (id, members, created_at, updated_at) VALUES ('dm_1',$1,$2,$2)`,
    [['usr_takasu','usr_minagawa'], t]
  );
  await pool.query(
    `INSERT INTO messages (id, channel_id, dm_id, user_id, text, attachments, reactions, revoked, created_at, updated_at)
     VALUES ($1,'ch_general',NULL,'usr_minagawa','おはようございます、本日の進行表を共有します。',$2,'{}',false,$3,$3)`,
    [id('msg'), JSON.stringify([{ type: 'file', name: '進行表_v2.xlsx' }]), t]
  );
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { const err = new Error('Invalid JSON'); err.status = 400; throw err; }
}
function requireGadget(req) {
  const incoming = req.headers['x-gadget-id'];
  if (incoming && incoming !== GADGET_ID) {
    const err = new Error('gadget_id is not allowed for this backend'); err.status = 403; throw err;
  }
}
function requireAuth(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = sessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    const err = new Error('Authentication required'); err.status = 401; throw err;
  }
  s.expiresAt = Date.now() + TOKEN_TTL_MS;
  return s;
}
const json = (res, status, b) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-gadget-id'
  });
  res.end(JSON.stringify(b));
};
function dmKey(members) { return [...members].sort().join('__'); }

// --- SSE (Server-Sent Events) for near-realtime delivery ---
const sseClients = new Map(); // roomKey -> Set of http.ServerResponse
function roomKeyFor(channelId, dmId) { return channelId ? `channel:${channelId}` : `dm:${dmId}`; }
function sseSubscribe(roomKey, res) {
  if (!sseClients.has(roomKey)) sseClients.set(roomKey, new Set());
  sseClients.get(roomKey).add(res);
}
function sseUnsubscribe(roomKey, res) {
  const set = sseClients.get(roomKey);
  if (set) { set.delete(res); if (!set.size) sseClients.delete(roomKey); }
}
function sseBroadcast(roomKey, eventName, payload) {
  const set = sseClients.get(roomKey);
  if (!set || !set.size) return;
  const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) { try { res.write(chunk); if (res.flush) res.flush(); } catch (e) { /* ignore broken pipe */ } }
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>TalkNest Backend</title>
<style>body{font-family:sans-serif;background:#0f1115;color:#e6e8ee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.card{background:#161922;border:1px solid #2a2f3a;border-radius:14px;padding:32px 40px;text-align:center;}
h1{font-size:18px;margin:0 0 8px;} p{font-size:13px;color:#8b93a3;margin:4px 0;}
.ok{color:#2ed573;font-weight:700;}</style></head>
<body><div class="card"><h1>TalkNest Backend API</h1>
<p class="ok">● 稼働中 (gadget_id: ${GADGET_ID})</p>
<p>これはAPIサーバーです。画面を見る場合はフロントエンドのURLを開いてください。</p>
<p>ヘルスチェック: <a href="/health" style="color:#5b7cfa;">/health</a></p>
</div></body></html>`);
  }

  requireGadget(req);

  if (url.pathname === '/health') {
    await pool.query('SELECT 1');
    return json(res, 200, { ok: true, service: 'talknest-backend', storage: 'postgresql', gadget_id: GADGET_ID, time: now() });
  }
  if (url.pathname === '/api/meta') return json(res, 200, { gadget_id: GADGET_ID, app: 'TalkNest', storage: 'postgresql', stamps: STAMPS, endpoints: ['/api/register','/api/login','/api/logout','/api/me','/api/users','/api/users/:id','/api/channels','/api/dms','/api/messages','/api/messages/:id/threads','/api/messages/:id/reactions','/api/uploads','/api/messages/:id/read','/api/messages/read-bulk','/api/search','/api/stream'] });

  const uploadGetMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (uploadGetMatch && req.method === 'GET') {
    const row = (await pool.query('SELECT * FROM uploads WHERE id=$1', [uploadGetMatch[1]])).rows[0];
    if (!row) return json(res, 404, { error: 'file not found' });
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    if (!existsSync(filePath)) return json(res, 404, { error: 'file missing on disk' });
    const stat = statSync(filePath);
    res.writeHead(200, {
      'content-type': row.mime_type,
      'content-length': stat.size,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      'access-control-allow-origin': '*'
    });
    return createReadStream(filePath).pipe(res);
  }

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    // EventSource cannot set custom headers, so auth token comes via query param here.
    const token = url.searchParams.get('token') || '';
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) return json(res, 401, { error: 'Authentication required' });
    session.expiresAt = Date.now() + TOKEN_TTL_MS;
    const channelId = url.searchParams.get('channelId');
    const dmId = url.searchParams.get('dmId');
    if (!channelId && !dmId) return json(res, 400, { error: 'channelId or dmId is required' });

    // Membership check
    if (channelId) {
      const ch = (await pool.query('SELECT * FROM channels WHERE id=$1', [channelId])).rows[0];
      if (!ch || !(ch.type === 'public' || (ch.members || []).includes(session.userId))) {
        return json(res, 403, { error: 'このチャンネルにアクセスできません' });
      }
    } else {
      const dm = (await pool.query('SELECT * FROM dms WHERE id=$1', [dmId])).rows[0];
      if (!dm || !(dm.members || []).includes(session.userId)) {
        return json(res, 403, { error: 'このDMにアクセスできません' });
      }
    }

    const roomKey = roomKeyFor(channelId, dmId);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*'
    });
    // Send padding to force intermediate proxies (e.g. Cloudflare) to flush the stream immediately.
    res.write(':' + ' '.repeat(2048) + '\n\n');
    res.write('event: connected\ndata: {"ok":true}\n\n');
    if (res.flush) res.flush();
    sseSubscribe(roomKey, res);
    const keepAlive = setInterval(() => { try { res.write(':ping\n\n'); if (res.flush) res.flush(); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(keepAlive); sseUnsubscribe(roomKey, res); });
    return; // keep connection open
  }

  if (url.pathname === '/api/register' && req.method === 'POST') {
    const b = await body(req);
    for (const k of ['username','password']) if (!b[k]) return json(res, 400, { error: `${k} is required` });
    const exists = await pool.query('SELECT 1 FROM users WHERE username=$1', [b.username]);
    if (exists.rowCount) return json(res, 409, { error: 'username already exists' });
    const u = { id: id('usr'), username: b.username, displayName: b.displayName || b.username, email: b.email || '', department: b.department || '', role: b.role || 'メンバー', avatarColor: b.avatarColor || '#747d8c' };
    const t = now();
    await pool.query(
      `INSERT INTO users (id, username, display_name, email, password_hash, department, role, avatar_color, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [u.id, u.username, u.displayName, u.email, hashPassword(b.password), u.department, u.role, u.avatarColor, t]
    );
    await pool.query(`UPDATE channels SET members = array_append(members, $1), updated_at=$2 WHERE type='public' AND NOT ($1 = ANY(members))`, [u.id, t]);
    return json(res, 201, { user: u });
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const b = await body(req);
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [b.username]);
    const row = rows[0];
    if (!row || !verifyPassword(b.password || '', row.password_hash)) return json(res, 401, { error: 'invalid username or password' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { userId: row.id, username: row.username, expiresAt: Date.now() + TOKEN_TTL_MS });
    return json(res, 200, { token, user: rowToUser(row) });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    sessions.delete(token); return json(res, 200, { ok: true });
  }

  const session = requireAuth(req);
  const meRow = (await pool.query('SELECT * FROM users WHERE id=$1', [session.userId])).rows[0];
  if (!meRow) return json(res, 401, { error: 'session user not found' });
  const me = rowToUser(meRow);

  if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user: me });
  if (url.pathname === '/api/me' && req.method === 'PATCH') {
    const b = await body(req);
    const allowed = ['displayName', 'department', 'email', 'avatarUrl'];
    const fields = [];
    const values = [];
    let i = 1;
    const colMap = { displayName: 'display_name', department: 'department', email: 'email', avatarUrl: 'avatar_url' };
    for (const key of allowed) {
      if (key in b) { fields.push(`${colMap[key]}=$${i}`); values.push(b[key]); i++; }
    }
    if (!fields.length) return json(res, 400, { error: '更新する項目がありません' });
    fields.push(`updated_at=$${i}`); values.push(now()); i++;
    values.push(me.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id=$${i}`, values);
    const updated = (await pool.query('SELECT * FROM users WHERE id=$1', [me.id])).rows[0];
    return json(res, 200, { user: rowToUser(updated) });
  }

  if (url.pathname === '/api/uploads' && req.method === 'POST') {
    return new Promise((resolve) => {
      let fileHandled = false;
      let responded = false;
      const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      const respondOnce = (status, body) => {
        if (responded) return;
        responded = true;
        json(res, status, body);
        resolve();
      };
      bb.on('file', (name, fileStream, info) => {
        fileHandled = true;
        const { filename, mimeType } = info;
        if (!ALLOWED_MIME.has(mimeType)) {
          fileStream.resume();
          return respondOnce(415, { error: `許可されていないファイル形式です: ${mimeType}` });
        }
        const storedName = `${id('up')}_${filename}`.replace(/[^\w.\-]/g, '_');
        const destPath = path.join(UPLOAD_DIR, storedName);
        const writeStream = createWriteStream(destPath);
        let sizeBytes = 0;
        let tooLarge = false;
        fileStream.on('data', (chunk) => { sizeBytes += chunk.length; });
        fileStream.on('limit', () => { tooLarge = true; });
        fileStream.pipe(writeStream);
        writeStream.on('finish', async () => {
          if (tooLarge) {
            return respondOnce(413, { error: 'ファイルサイズが10MBを超えています' });
          }
          const uploadId = id('file');
          const t = now();
          await pool.query(
            `INSERT INTO uploads (id, original_name, stored_name, mime_type, size_bytes, uploaded_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [uploadId, filename, storedName, mimeType, sizeBytes, me.id, t]
          );
          respondOnce(201, { attachment: { id: uploadId, type: 'file', name: filename, mimeType, sizeBytes, url: `/api/uploads/${uploadId}` } });
        });
        writeStream.on('error', () => respondOnce(500, { error: 'ファイルの保存に失敗しました' }));
      });
      bb.on('finish', () => { if (!fileHandled) respondOnce(400, { error: 'ファイルが見つかりません' }); });
      bb.on('error', () => respondOnce(400, { error: 'アップロードに失敗しました' }));
      req.pipe(bb);
    });
  }
  if (url.pathname === '/api/users' && req.method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at');
    return json(res, 200, { users: rows.map(rowToUser) });
  }
  const userDetailMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userDetailMatch && req.method === 'GET') {
    const row = (await pool.query('SELECT * FROM users WHERE id=$1', [userDetailMatch[1]])).rows[0];
    if (!row) return json(res, 404, { error: 'user not found' });
    return json(res, 200, { user: rowToUser(row) });
  }
  if (userDetailMatch && req.method === 'PATCH') {
    if (me.role !== '管理者') return json(res, 403, { error: '役割の変更は管理者のみ行えます' });
    const b = await body(req);
    if (!b.role || !['管理者', 'メンバー'].includes(b.role)) return json(res, 400, { error: 'roleは管理者またはメンバーを指定してください' });
    await pool.query('UPDATE users SET role=$1, updated_at=$2 WHERE id=$3', [b.role, now(), userDetailMatch[1]]);
    const updated = (await pool.query('SELECT * FROM users WHERE id=$1', [userDetailMatch[1]])).rows[0];
    if (!updated) return json(res, 404, { error: 'user not found' });
    return json(res, 200, { user: rowToUser(updated) });
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return json(res, 200, { channels: [], dms: [], messages: [] });
    const likeQ = `%${q}%`;

    const channelsRes = await pool.query(
      `SELECT * FROM channels WHERE (type='public' OR $1 = ANY(members)) AND name ILIKE $2 ORDER BY created_at`,
      [me.id, likeQ]
    );

    const dmsRes = await pool.query(`SELECT * FROM dms WHERE $1 = ANY(members)`, [me.id]);
    const otherIds = [...new Set(dmsRes.rows.map(d => d.members.find(m => m !== me.id)).filter(Boolean))];
    const otherUsersRes = otherIds.length ? await pool.query('SELECT * FROM users WHERE id = ANY($1)', [otherIds]) : { rows: [] };
    const otherUsersById = Object.fromEntries(otherUsersRes.rows.map(u => [u.id, rowToUser(u)]));
    const matchingDms = dmsRes.rows
      .map(d => ({ ...rowToDm(d), otherUser: otherUsersById[d.members.find(m => m !== me.id)] || null }))
      .filter(d => d.otherUser && d.otherUser.displayName.toLowerCase().includes(q.toLowerCase()));

    const myChannelIds = (await pool.query(`SELECT id FROM channels WHERE type='public' OR $1 = ANY(members)`, [me.id])).rows.map(r => r.id);
    const myDmIds = dmsRes.rows.map(d => d.id);
    const msgRows = (myChannelIds.length || myDmIds.length)
      ? (await pool.query(
          `SELECT * FROM messages
           WHERE revoked = false AND text ILIKE $1
           AND (channel_id = ANY($2) OR dm_id = ANY($3))
           ORDER BY created_at DESC LIMIT 50`,
          [likeQ, myChannelIds, myDmIds]
        )).rows
      : [];
    const msgUserIds = [...new Set(msgRows.map(r => r.user_id))];
    const msgUsersRes = msgUserIds.length ? await pool.query('SELECT * FROM users WHERE id = ANY($1)', [msgUserIds]) : { rows: [] };
    const msgUsersById = Object.fromEntries(msgUsersRes.rows.map(u => [u.id, rowToUser(u)]));
    const channelsById = Object.fromEntries(channelsRes.rows.map(c => [c.id, c.name]));
    const allMyChannelsRes = await pool.query(`SELECT id, name FROM channels WHERE type='public' OR $1 = ANY(members)`, [me.id]);
    const allChannelNameById = Object.fromEntries(allMyChannelsRes.rows.map(c => [c.id, c.name]));
    const messages = msgRows.map(r => ({
      ...rowToMessage(r),
      user: msgUsersById[r.user_id] || null,
      channelName: r.channel_id ? (allChannelNameById[r.channel_id] || null) : null,
      dmOtherUser: r.dm_id ? (otherUsersById[(dmsRes.rows.find(d => d.id === r.dm_id) || {}).members?.find(m => m !== me.id)] || null) : null
    }));

    return json(res, 200, {
      channels: channelsRes.rows.map(rowToChannel),
      dms: matchingDms,
      messages
    });
  }

  if (url.pathname === '/api/channels' && req.method === 'GET') {
    const { rows } = await pool.query(`SELECT * FROM channels WHERE type='public' OR $1 = ANY(members) ORDER BY created_at`, [me.id]);
    return json(res, 200, { channels: rows.map(rowToChannel) });
  }
  if (url.pathname === '/api/channels' && req.method === 'POST') {
    const b = await body(req);
    if (!b.name) return json(res, 400, { error: 'name is required' });
    const type = b.type === 'private' ? 'private' : 'public';
    const members = [...new Set([me.id, ...(b.members || [])])];
    const ch = { id: id('ch'), name: b.name, type, members };
    const t = now();
    await pool.query(
      `INSERT INTO channels (id, name, type, members, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)`,
      [ch.id, ch.name, ch.type, ch.members, t]
    );
    return json(res, 201, { channel: { ...ch, createdAt: t, updatedAt: t } });
  }
  const channelMemberMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
  if (channelMemberMatch && req.method === 'PATCH') {
    const chRow = (await pool.query('SELECT * FROM channels WHERE id=$1', [channelMemberMatch[1]])).rows[0];
    if (!chRow) return json(res, 404, { error: 'channel not found' });
    if (!(chRow.type === 'public' || (chRow.members || []).includes(me.id))) {
      return json(res, 403, { error: 'このチャンネルのメンバーのみ編集できます' });
    }
    const b = await body(req);
    let members = [...new Set([...(chRow.members || []), ...(b.add || [])])].filter(m => !(b.remove || []).includes(m));
    if (!members.length) return json(res, 400, { error: 'チャンネルには最低1名のメンバーが必要です' });
    const t = now();
    await pool.query('UPDATE channels SET members=$1, updated_at=$2 WHERE id=$3', [members, t, chRow.id]);
    return json(res, 200, { channel: rowToChannel({ ...chRow, members, updated_at: t }) });
  }

  if (url.pathname === '/api/dms' && req.method === 'GET') {
    const { rows } = await pool.query(`SELECT * FROM dms WHERE $1 = ANY(members) ORDER BY created_at`, [me.id]);
    return json(res, 200, { dms: rows.map(rowToDm) });
  }
  if (url.pathname === '/api/dms' && req.method === 'POST') {
    const b = await body(req);
    const members = [...new Set([me.id, b.userId])];
    const { rows } = await pool.query('SELECT * FROM dms');
    let found = rows.find(d => dmKey(d.members) === dmKey(members));
    if (!found) {
      const t = now();
      const newDm = { id: id('dm'), members };
      await pool.query('INSERT INTO dms (id, members, created_at, updated_at) VALUES ($1,$2,$3,$3)', [newDm.id, newDm.members, t]);
      found = { id: newDm.id, members: newDm.members, created_at: t, updated_at: t };
    }
    return json(res, 200, { dm: rowToDm(found) });
  }

  if (url.pathname === '/api/messages' && req.method === 'GET') {
    const channelId = url.searchParams.get('channelId');
    const dmId = url.searchParams.get('dmId');
    if (!channelId && !dmId) return json(res, 400, { error: 'channelId or dmId is required' });
    const { rows } = channelId
      ? await pool.query('SELECT * FROM messages WHERE channel_id=$1 ORDER BY created_at', [channelId])
      : await pool.query('SELECT * FROM messages WHERE dm_id=$1 ORDER BY created_at', [dmId]);
    const userIds = [...new Set(rows.map(r => r.user_id))];
    const usersRes = userIds.length ? await pool.query('SELECT * FROM users WHERE id = ANY($1)', [userIds]) : { rows: [] };
    const usersById = Object.fromEntries(usersRes.rows.map(u => [u.id, rowToUser(u)]));
    const allUsersRes = await pool.query('SELECT id, username FROM users');
    const userIdByUsername = Object.fromEntries(allUsersRes.rows.map(u => [u.username, u.id]));
    const msgIds = rows.map(r => r.id);
    const threadCounts = msgIds.length ? await pool.query('SELECT message_id, count(*)::int AS c FROM thread_replies WHERE message_id = ANY($1) GROUP BY message_id', [msgIds]) : { rows: [] };
    const countsById = Object.fromEntries(threadCounts.rows.map(r => [r.message_id, r.c]));
    const readRes = msgIds.length ? await pool.query('SELECT message_id, user_id, read_at FROM read_receipts WHERE message_id = ANY($1)', [msgIds]) : { rows: [] };
    const readByMsgId = {};
    readRes.rows.forEach(r => {
      (readByMsgId[r.message_id] = readByMsgId[r.message_id] || []).push({ userId: r.user_id, user: usersById[r.user_id] || null, readAt: r.read_at });
    });
    const messages = rows.map(r => {
      const mentionUsernames = extractMentionUsernames(r.text);
      const mentionedUserIds = mentionUsernames.map(u => userIdByUsername[u]).filter(Boolean);
      return { ...rowToMessage(r), user: usersById[r.user_id], threadCount: countsById[r.id] || 0, readBy: readByMsgId[r.id] || [], mentionedUserIds };
    });
    return json(res, 200, { messages });
  }
  if (url.pathname === '/api/messages' && req.method === 'POST') {
    const b = await body(req);
    const msg = { id: id('msg'), channelId: b.channelId || null, dmId: b.dmId || null, userId: me.id, text: b.text || '', attachments: b.attachments || [] };
    const t = now();
    await pool.query(
      `INSERT INTO messages (id, channel_id, dm_id, user_id, text, attachments, reactions, revoked, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'{}',false,$7,$7)`,
      [msg.id, msg.channelId, msg.dmId, msg.userId, msg.text, JSON.stringify(msg.attachments), t]
    );
    const mentionUsernames = extractMentionUsernames(msg.text);
    let mentionedUserIds = [];
    if (mentionUsernames.length) {
      const mentionRes = await pool.query('SELECT id, username FROM users WHERE username = ANY($1)', [mentionUsernames]);
      mentionedUserIds = mentionRes.rows.map(r => r.id);
    }
    const fullMessage = { ...msg, reactions: {}, revoked: false, createdAt: t, updatedAt: t, user: me, mentionedUserIds, threadCount: 0, readBy: [] };
    sseBroadcast(roomKeyFor(msg.channelId, msg.dmId), 'message:new', fullMessage);
    return json(res, 201, { message: fullMessage });
  }
  const msgMatch = url.pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (msgMatch && req.method === 'DELETE') {
    const row = (await pool.query('SELECT * FROM messages WHERE id=$1', [msgMatch[1]])).rows[0];
    if (!row) return json(res, 404, { error: 'message not found' });
    if (row.user_id !== me.id) return json(res, 403, { error: 'only sender can revoke' });
    const t = now();
    await pool.query(`UPDATE messages SET revoked=true, text='このメッセージは削除されました', updated_at=$1 WHERE id=$2`, [t, row.id]);
    const updated = rowToMessage({ ...row, revoked: true, text: 'このメッセージは削除されました', updated_at: t });
    sseBroadcast(roomKeyFor(row.channel_id, row.dm_id), 'message:deleted', { id: row.id });
    return json(res, 200, { message: updated });
  }

  const reactMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);
  if (reactMatch && req.method === 'POST') {
    const b = await body(req);
    const emoji = b.emoji;
    if (!STAMPS.includes(emoji)) return json(res, 400, { error: 'unsupported stamp' });
    let table = 'messages';
    let row = (await pool.query('SELECT * FROM messages WHERE id=$1', [reactMatch[1]])).rows[0];
    if (!row) { table = 'thread_replies'; row = (await pool.query('SELECT * FROM thread_replies WHERE id=$1', [reactMatch[1]])).rows[0]; }
    if (!row) return json(res, 404, { error: 'message not found' });
    const reactions = row.reactions || {};
    const list = reactions[emoji] || [];
    reactions[emoji] = list.includes(me.id) ? list.filter(u => u !== me.id) : [...list, me.id];
    if (!reactions[emoji].length) delete reactions[emoji];
    await pool.query(`UPDATE ${table} SET reactions=$1, updated_at=$2 WHERE id=$3`, [JSON.stringify(reactions), now(), row.id]);
    let roomKey = null;
    if (table === 'messages') {
      roomKey = roomKeyFor(row.channel_id, row.dm_id);
    } else {
      const parent = (await pool.query('SELECT channel_id, dm_id FROM messages WHERE id=$1', [row.message_id])).rows[0];
      if (parent) roomKey = roomKeyFor(parent.channel_id, parent.dm_id);
    }
    if (roomKey) sseBroadcast(roomKey, 'reaction:updated', { id: row.id, table, reactions });
    return json(res, 200, { reactions });
  }

  const threadMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/threads$/);
  if (threadMatch && req.method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM thread_replies WHERE message_id=$1 ORDER BY created_at', [threadMatch[1]]);
    const userIds = [...new Set(rows.map(r => r.user_id))];
    const usersRes = userIds.length ? await pool.query('SELECT * FROM users WHERE id = ANY($1)', [userIds]) : { rows: [] };
    const usersById = Object.fromEntries(usersRes.rows.map(u => [u.id, rowToUser(u)]));
    return json(res, 200, { replies: rows.map(r => ({ ...rowToReply(r), user: usersById[r.user_id] })) });
  }
  if (threadMatch && req.method === 'POST') {
    const b = await body(req);
    const reply = { id: id('thr'), messageId: threadMatch[1], userId: me.id, text: b.text || '' };
    const t = now();
    await pool.query(
      `INSERT INTO thread_replies (id, message_id, user_id, text, reactions, created_at, updated_at) VALUES ($1,$2,$3,$4,'{}',$5,$5)`,
      [reply.id, reply.messageId, reply.userId, reply.text, t]
    );
    const fullReply = { ...reply, reactions: {}, createdAt: t, updatedAt: t, user: me };
    const parent = (await pool.query('SELECT channel_id, dm_id FROM messages WHERE id=$1', [reply.messageId])).rows[0];
    if (parent) sseBroadcast(roomKeyFor(parent.channel_id, parent.dm_id), 'thread:new', fullReply);
    return json(res, 201, { reply: fullReply });
  }

  const readMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/read$/);
  if (readMatch && req.method === 'POST') {
    const msgRow = (await pool.query('SELECT id FROM messages WHERE id=$1', [readMatch[1]])).rows[0];
    if (!msgRow) return json(res, 404, { error: 'message not found' });
    await pool.query(
      `INSERT INTO read_receipts (message_id, user_id, read_at) VALUES ($1,$2,$3)
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [readMatch[1], me.id, now()]
    );
    const { rows } = await pool.query('SELECT user_id, read_at FROM read_receipts WHERE message_id=$1', [readMatch[1]]);
    return json(res, 200, { readBy: rows.map(r => ({ userId: r.user_id, readAt: r.read_at })) });
  }
  // Bulk mark-as-read for all messages currently loaded in a channel/DM (used on room open)
  if (url.pathname === '/api/messages/read-bulk' && req.method === 'POST') {
    const b = await body(req);
    const ids = Array.isArray(b.messageIds) ? b.messageIds.slice(0, 500) : [];
    if (!ids.length) return json(res, 200, { ok: true, marked: 0 });
    const t = now();
    for (const mid of ids) {
      await pool.query(
        `INSERT INTO read_receipts (message_id, user_id, read_at) VALUES ($1,$2,$3)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [mid, me.id, t]
      );
    }
    return json(res, 200, { ok: true, marked: ids.length });
  }

  return json(res, 404, { error: 'not found' });
}

await seedIfEmpty();
const server = http.createServer((req, res) => route(req, res).catch(err => json(res, err.status || 500, { error: err.message || 'server error' })));
const HOST = process.env.PORT ? '0.0.0.0' : '127.0.0.1'; // Render requires binding to 0.0.0.0
server.listen(PORT, HOST, () => console.log(`TalkNest backend listening on http://${HOST}:${PORT} gadget_id=${GADGET_ID} storage=postgresql`));
