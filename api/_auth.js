const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function getAuthContext(req) {
  // Admin auth via secret header
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret) {
    return adminSecret === process.env.ADMIN_SECRET
      ? { type: 'admin', clientId: 'all' }
      : null;
  }

  // Client auth via password header
  const clientPassword = req.headers['x-client-password'];
  if (clientPassword) {
    try {
      const ids = (await redis.get('client_index')) || [];
      for (const id of ids) {
        const client = await redis.get(`client:${id}`);
        if (client && client.clientPassword === clientPassword) {
          return { type: 'client', clientId: client.id };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

module.exports = { redis, getAuthContext };
