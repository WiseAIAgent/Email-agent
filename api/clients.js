const { Redis } = require('@upstash/redis');
const { getAuthContext } = require('./_auth');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  // GET - list all clients (admin only)
  if (req.method === 'GET') {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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

  // POST - create new client (admin only)
  if (req.method === 'POST') {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
  // Admin: full update of any client
  // Client: can update only their own agent settings (tone, replyLength, usePlural, useSignature)
  if (req.method === 'PATCH') {
    try {
      // Check admin first
      if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) {
        const { id, ...updates } = req.body;
        const existing = await redis.get(`client:${id}`);
        if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });
        if (!updates.emailPassword || updates.emailPassword === '••••••••') {
          updates.emailPassword = existing.emailPassword;
        }
        const updated = { ...existing, ...updates, id };
        await redis.set(`client:${id}`, updated);
        return res.status(200).json({ success: true });
      }

      // Check client auth
      const auth = await getAuthContext(req);
      if (auth?.type === 'client') {
        const existing = await redis.get(`client:${auth.clientId}`);
        if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });
        const { tone, replyLength, usePlural, useSignature } = req.body;
        const updated = { ...existing };
        if (tone !== undefined) updated.tone = tone;
        if (replyLength !== undefined) updated.replyLength = replyLength;
        if (usePlural !== undefined) updated.usePlural = usePlural;
        if (useSignature !== undefined) updated.useSignature = useSignature;
        await redis.set(`client:${auth.clientId}`, updated);
        return res.status(200).json({ success: true });
      }

      return res.status(401).json({ error: 'Unauthorized' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE - remove client (admin only)
  if (req.method === 'DELETE') {
    if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
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
};
