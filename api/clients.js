const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  // Simple admin auth
  const auth = req.headers['x-admin-secret'];
  if (auth !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // GET - list all clients
  if (req.method === 'GET') {
    try {
      const ids = (await redis.get('client_index')) || [];
      const clients = [];
      for (const id of ids) {
        const client = await redis.get(`client:${id}`);
        if (client) {
          // Never expose password in listing
          const safe = { ...client, emailPassword: '••••••••' };
          clients.push(safe);
        }
      }
      return res.status(200).json(clients);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST - create new client
  if (req.method === 'POST') {
    try {
      const id = `client_${Date.now()}`;
      const client = {
        id,
        createdAt: new Date().toISOString(),
        active: true,
        ...req.body
      };
      await redis.set(`client:${id}`, client);
      const ids = (await redis.get('client_index')) || [];
      ids.unshift(id);
      await redis.set('client_index', ids);
      return res.status(200).json({ success: true, id });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH - update client
  if (req.method === 'PATCH') {
    try {
      const { id, ...updates } = req.body;
      const existing = await redis.get(`client:${id}`);
      if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });
      // Keep existing password if not provided
      if (!updates.emailPassword || updates.emailPassword === '••••••••') {
        updates.emailPassword = existing.emailPassword;
      }
      const updated = { ...existing, ...updates, id };
      await redis.set(`client:${id}`, updated);
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE - remove client
  if (req.method === 'DELETE') {
    try {
      const { id } = req.body;
      await redis.del(`client:${id}`);
      const ids = (await redis.get('client_index')) || [];
      await redis.set('client_index', ids.filter(i => i !== id));
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
