const { createClerkClient } = require('@clerk/backend');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function getAuthContext(req) {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret) {
    return adminSecret === process.env.ADMIN_SECRET
      ? { type: 'admin', clientId: 'all' }
      : null;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.slice(7);
    const payload = await clerk.verifyToken(token);
    const clerkUser = await clerk.users.getUser(payload.sub);

    const clientId = clerkUser.publicMetadata?.clientId;
    if (!clientId) return null;

    return { type: 'client', clientId: String(clientId) };
  } catch {
    return null;
  }
}

module.exports = { redis, clerk, getAuthContext };
