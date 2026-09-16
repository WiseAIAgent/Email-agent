const { redis } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const period = req.query?.period || 'all';
    const now = new Date();
    const cutoffs = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      week:  new Date(now - 7 * 24 * 60 * 60 * 1000),
      month: new Date(now.getFullYear(), now.getMonth(), 1),
      year:  new Date(now.getFullYear(), 0, 1),
    };
    const cutoff = cutoffs[period] || null;

    const clientIds = (await redis.get('client_index')) || [];
    const stats = [];

    for (const id of clientIds) {
      const client = await redis.get(`client:${id}`);
      if (!client) continue;

      const emailIds = (await redis.get(`email_index:${id}`)) || [];
      let pending = 0, sent = 0, ignored = 0, total = 0;

      for (const eid of emailIds) {
        const email = await redis.get(`email:${eid}`);
        if (!email) continue;
        if (cutoff && new Date(email.date || email.createdAt) < cutoff) continue;
        total++;
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
        total,
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
