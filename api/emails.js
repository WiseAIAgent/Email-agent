const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function getClientIdFromAuth(req) {
  const adminSecret = req.headers['x-admin-secret'];
  const clientPassword = req.headers['x-client-password'];

  if (adminSecret) {
    if (adminSecret !== process.env.ADMIN_SECRET) return null;
    return req.query.clientId || 'all';
  }

  if (clientPassword) {
    const ids = (await redis.get('client_index')) || [];
    for (const id of ids) {
      const client = await redis.get(`client:${id}`);
      if (client && client.clientPassword === clientPassword) return client.id;
    }
    return null;
  }

  return null;
}

module.exports = async function handler(req, res) {
  try {
    const authId = await getClientIdFromAuth(req);
    if (!authId) return res.status(401).json({ error: 'Unauthorized' });

    if (req.method === 'GET') {
      let ids;
      if (authId === 'all') {
        ids = (await redis.get('email_index')) || [];
      } else {
        ids = (await redis.get(`email_index:${authId}`)) || [];
      }

      const emails = [];
      for (const id of ids.slice(0, 100)) {
        const raw = await redis.get(`email:${id}`);
        if (raw) emails.push(raw);
      }
      return res.status(200).json(emails);
    }

    if (req.method === 'PATCH') {
      const { emailId, status } = req.body;
      const record = await redis.get(`email:${emailId}`);
      if (!record) return res.status(404).json({ error: 'Nenalezeno' });
      if (authId !== 'all' && record.clientId !== authId) return res.status(403).json({ error: 'Forbidden' });
      record.status = status;
      await redis.set(`email:${emailId}`, record);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
