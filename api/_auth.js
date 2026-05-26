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

    const email =
      clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)
        ?.emailAddress ||
      clerkUser.emailAddresses[0]?.emailAddress;

    if (!email) return null;

    const ids = (await redis.get('client_index')) || [];
    for (const id of ids) {
      const client = await redis.get(`client:${id}`);
      if (client && client.email === email) {
        return { type: 'client', clientId: client.id };
      }
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { redis, clerk, getAuthContext };
