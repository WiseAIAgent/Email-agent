const { Redis } = require('@upstash/redis');
const { createClerkClient, verifyToken } = require('@clerk/backend');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

// Returned when a valid Clerk token belongs to a user not registered as a client
const FORBIDDEN = { type: 'forbidden' };

async function getAuthContext(req) {
  // Admin auth via secret header
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret) {
    return adminSecret === process.env.ADMIN_SECRET
      ? { type: 'admin', clientId: 'all' }
      : null;
  }

  // Clerk Bearer token auth
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      const user = await clerkClient.users.getUser(payload.sub);
      const email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress;
      if (!email) return null;
      const ids = (await redis.get('client_index')) || [];
      for (const id of ids) {
        const client = await redis.get(`client:${id}`);
        if (client?.email === email) return { type: 'client', clientId: client.id };
      }
      // Valid Clerk user but no matching client in Redis → 403 (not 401)
      return FORBIDDEN;
    } catch {
      return null;
    }
  }

  // Legacy client password auth (kept for backward compat with admin panel)
  const clientPassword = req.headers['x-client-password'];
  const clientEmail = req.headers['x-client-email'];
  if (clientPassword && clientEmail) {
    try {
      const ids = (await redis.get('client_index')) || [];
      for (const id of ids) {
        const client = await redis.get(`client:${id}`);
        if (client && client.clientPassword === clientPassword && client.email === clientEmail) {
          return { type: 'client', clientId: client.id };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

module.exports = { redis, getAuthContext, FORBIDDEN };
