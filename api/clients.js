const { redis, getAuthContext, sendAuthError, encryptSecret } = require('./_auth');

const MASK = '••••••••';

const TEXT_LIMITS = {
  tone: 100, replyLength: 20, salutation: 20,
  companyName: 200, industry: 100, companyDescription: 3000,
  signature: 1000, escalationContact: 300, escalationWhen: 1000, forbiddenTopics: 2000,
  ignoreKeywords: 2000, ignoreSenders: 2000, ignoreDomains: 2000,
};
const BOOL_FIELDS = ['usePlural', 'useSignature'];
const PROCESS_MODES = new Set(['unread', 'all']);
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const PRIVATE_HOST_RE = /^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && value.length <= 500;
  } catch {
    return false;
  }
}

function withoutSecrets(client) {
  const { emailPassword, clientPassword, ...safe } = client;
  return safe;
}

// Validates the fields a client may change in their own settings; returns { updates } or { error }
function pickClientUpdates(body) {
  const updates = {};

  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (body[key] == null) continue;
    const value = String(body[key]).trim();
    if (value.length > max) return { error: `Pole ${key} je příliš dlouhé (max. ${max} znaků).` };
    updates[key] = value;
  }

  for (const key of BOOL_FIELDS) {
    if (typeof body[key] === 'boolean') updates[key] = body[key];
  }

  for (const key of ['imapHost', 'smtpHost']) {
    if (body[key] == null || body[key] === '') continue;
    const host = String(body[key]).trim().toLowerCase();
    if (!HOST_RE.test(host) || PRIVATE_HOST_RE.test(host)) return { error: `Neplatná adresa serveru v poli ${key}.` };
    updates[key] = host;
  }

  for (const key of ['imapPort', 'smtpPort']) {
    if (body[key] == null || body[key] === '') continue;
    const port = Number(body[key]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: `Neplatný port v poli ${key}.` };
    updates[key] = String(port);
  }

  if (body.websiteUrl != null) {
    const url = String(body.websiteUrl).trim();
    if (url && !isHttpUrl(url)) return { error: 'Adresa webu musí začínat https:// nebo http://.' };
    updates.websiteUrl = url;
  }

  if (body.processMode != null) {
    if (!PROCESS_MODES.has(body.processMode)) return { error: 'Neplatná volba zpracování emailů.' };
    updates.processMode = body.processMode;
  }

  if (body.faq != null) {
    if (!Array.isArray(body.faq) || body.faq.length > 50) return { error: 'FAQ může mít nejvýše 50 položek.' };
    const faq = body.faq.map(f => ({ q: String(f?.q ?? '').trim(), a: String(f?.a ?? '').trim() }));
    if (faq.some(f => f.q.length > 2000 || f.a.length > 2000)) return { error: 'Položka FAQ je příliš dlouhá (max. 2000 znaků).' };
    updates.faq = faq;
  }

  if (body.emailPassword != null && body.emailPassword !== MASK && body.emailPassword !== '') {
    const pass = String(body.emailPassword);
    if (pass.length > 500) return { error: 'Heslo je příliš dlouhé.' };
    updates.emailPassword = encryptSecret(pass);
  }

  return { updates };
}

async function handleGet(req, res, auth) {
  if (auth.type === 'admin') {
    const ids = (await redis.get('client_index')) || [];
    const clients = [];
    for (const id of ids) {
      const client = await redis.get(`client:${id}`);
      if (client) clients.push({ ...withoutSecrets(client), emailPassword: MASK });
    }
    return res.status(200).json(clients);
  }
  const client = await redis.get(`client:${auth.clientId}`);
  if (!client) return res.status(404).json({ error: 'Klient nenalezen' });
  return res.status(200).json(withoutSecrets(client));
}

async function handleAdminCreate(req, res) {
  const id = `client_${Date.now()}`;
  const { id: _ignored, clientPassword, emailPassword, ...data } = req.body || {};
  const client = { ...data, id, createdAt: new Date().toISOString(), active: data.active !== false };
  if (emailPassword && emailPassword !== MASK) client.emailPassword = encryptSecret(emailPassword);
  await redis.set(`client:${id}`, client);
  const ids = (await redis.get('client_index')) || [];
  ids.unshift(id);
  await redis.set('client_index', ids);
  return res.status(200).json({ success: true, id });
}

async function handleAdminUpdate(req, res) {
  const { id, clientPassword, emailPassword, ...updates } = req.body || {};
  const existing = await redis.get(`client:${id}`);
  if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });
  const updated = { ...existing, ...updates, id };
  delete updated.clientPassword;
  if (emailPassword && emailPassword !== MASK) updated.emailPassword = encryptSecret(emailPassword);
  await redis.set(`client:${id}`, updated);
  return res.status(200).json({ success: true });
}

async function handleClientUpdate(req, res, auth) {
  const body = req.body || {};
  const existing = await redis.get(`client:${auth.clientId}`);
  if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });

  const { updates, error } = pickClientUpdates(body);
  if (error) return res.status(400).json({ error });

  if (body.email != null) {
    const email = String(body.email).trim();
    if (email.toLowerCase() !== auth.email.toLowerCase()) {
      return res.status(400).json({ error: 'Emailová schránka musí být stejná jako email, kterým se přihlašujete.' });
    }
    updates.email = auth.email;
  }

  const updated = { ...existing, ...updates };
  delete updated.clientPassword;
  await redis.set(`client:${auth.clientId}`, updated);
  return res.status(200).json({ success: true });
}

// Delete every key matching a glob pattern, one SCAN batch at a time
async function scanDel(match) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match, count: 1000 });
    if (keys.length > 0) await redis.del(...keys);
    cursor = String(next);
  } while (cursor !== '0');
}

async function handleAdminDelete(req, res) {
  const { id } = req.body || {};
  // id goes into SCAN patterns below, so it must not contain glob characters
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
    return res.status(400).json({ error: 'Neplatné id' });
  }
  // Remove from client index first so the cron stops picking the client up
  const ids = (await redis.get('client_index')) || [];
  await redis.set('client_index', ids.filter(i => i !== id));
  await redis.del(`client:${id}`, `email_index:${id}`, `knowledge:${id}`, `url_cache:${id}`, `imap_state:${id}`);
  // Email IDs are email_<clientId>_<uid>_<ts>, so this also finds records
  // that already fell off the capped indexes
  await scanDel(`email:email_${id}_*`);
  await scanDel(`daily_count:${id}:*`);
  const globalIndex = (await redis.get('email_index')) || [];
  await redis.set('email_index', globalIndex.filter(eid => !eid.startsWith(`email_${id}_`)));
  return res.status(200).json({ success: true });
}

module.exports = async function handler(req, res) {
  try {
    const auth = await getAuthContext(req);
    const isAdmin = auth?.type === 'admin';
    const isClient = auth?.type === 'client';
    if (!isAdmin && !isClient) return sendAuthError(res, auth);

    if (req.method === 'GET') return handleGet(req, res, auth);
    if (req.method === 'PATCH') return isAdmin ? handleAdminUpdate(req, res) : handleClientUpdate(req, res, auth);
    if (req.method === 'POST' || req.method === 'DELETE') {
      if (!isAdmin) return res.status(403).json({ error: 'Forbidden' });
      return req.method === 'POST' ? handleAdminCreate(req, res) : handleAdminDelete(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('clients error:', e);
    return res.status(500).json({ error: 'Chyba serveru. Zkuste to prosím znovu.' });
  }
};
