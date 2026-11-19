const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { createClerkClient, verifyToken } = require('@clerk/backend');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Valid Clerk token, but the user is not registered as a client
const FORBIDDEN = { type: 'forbidden' };
const LOCKED = { type: 'locked' };

const ADMIN_MAX_FAILS = 10;
const ADMIN_LOCK_SECONDS = 15 * 60;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function clientIp(req) {
  return req.headers['x-real-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

async function countHit(key, windowSeconds) {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, windowSeconds);
  return n;
}

// Returns false once `limit` requests from this IP were made within the window
async function rateLimit(req, name, limit, windowSeconds) {
  const n = await countHit(`rl:${name}:${clientIp(req)}`, windowSeconds);
  if (n === limit + 1) await logSecurityEvent('rate_limited', req, { limiter: name });
  return n <= limit;
}

async function logSecurityEvent(type, req, extra = {}) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    type,
    ip: clientIp(req),
    path: req.url,
    ua: String(req.headers['user-agent'] || '').slice(0, 200),
    ...extra,
  });
  console.warn('[security]', entry);
  try {
    await redis.lpush('security_log', entry);
    await redis.ltrim('security_log', 0, 999);
  } catch {}
}

async function checkAdminSecret(req, secret) {
  const failKey = `auth_fail:admin:${clientIp(req)}`;
  const fails = (await redis.get(failKey)) || 0;
  if (fails >= ADMIN_MAX_FAILS) return LOCKED;

  const expected = process.env.ADMIN_SECRET;
  if (expected && safeEqual(secret, expected)) return { type: 'admin', clientId: 'all' };

  const n = await countHit(failKey, ADMIN_LOCK_SECONDS);
  await logSecurityEvent(n >= ADMIN_MAX_FAILS ? 'admin_lockout' : 'admin_login_failed', req, { attempt: n });
  return null;
}

async function getAuthContext(req) {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret) return checkAdminSecret(req, adminSecret);

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = await verifyToken(authHeader.slice(7), { secretKey: process.env.CLERK_SECRET_KEY });
      const user = await clerkClient.users.getUser(payload.sub);
      const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress;
      if (!email) return null;
      const ids = (await redis.get('client_index')) || [];
      for (const id of ids) {
        const client = await redis.get(`client:${id}`);
        if (client?.email === email) return { type: 'client', clientId: client.id, email };
      }
      await logSecurityEvent('client_not_registered', req, { userId: payload.sub });
      return FORBIDDEN;
    } catch {
      return null;
    }
  }

  return null;
}

function sendAuthError(res, auth) {
  if (auth === LOCKED) return res.status(429).json({ error: 'Příliš mnoho neúspěšných pokusů. Zkuste to znovu za 15 minut.' });
  if (auth === FORBIDDEN) return res.status(403).json({ error: 'Forbidden' });
  return res.status(401).json({ error: 'Unauthorized' });
}

// Mailbox passwords must be readable again for IMAP/SMTP, so they are encrypted (AES-256-GCM), not hashed
const ENC_PREFIX = 'enc:v1:';

function encryptionKey() {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ENC_PREFIX + [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64')).join(':');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

// Values saved before encryption was introduced are still plaintext and are returned as-is
function decryptSecret(value) {
  if (!isEncrypted(value)) return value;
  const [iv, tag, ciphertext] = value.slice(ENC_PREFIX.length).split(':').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = {
  redis, getAuthContext, sendAuthError, FORBIDDEN, LOCKED,
  clientIp, rateLimit, logSecurityEvent,
  encryptSecret, decryptSecret, isEncrypted,
};
