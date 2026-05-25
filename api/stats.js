const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const clientIds = (await redis.get('client_index')) || [];
    const stats = [];

    for (const id of clientIds) {
      const client = await redis.get(`client:${id}`);
      if (!client) continue;

      const emailIds = (await redis.get(`email_index:${id}`)) || [];
      let pending = 0, sent = 0, ignored = 0;

      for (const eid of emailIds.slice(0, 200)) {
        const email = await redis.get(`email:${eid}`);
        if (!email) continue;
        if (email.status === 'pending') pending++;
        else if (email.status === 'sent') sent++;
        else if (email.status === 'ignored') ignored++;
      }

      const today = new Date().toISOString().split('T')[0];
      const dailyCount = (await redis.get(`daily_count:${id}:${today}`)) || 0;

      stats.push({
        id,
        companyName: client.companyName,
        industry: client.industry,
        active: client.active,
        email: client.email,
        total: emailIds.length,
        pending,
        sent,
        ignored,
        dailyCount,
        dailyLimit: client.dailyLimit || 25
      });
    }

    return res.status(200).json(stats);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
