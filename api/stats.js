const { redis } = require('./_auth');

function getDatesInRange(from, to) {
  const dates = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

async function sumDailyCounter(prefix, period, cutoffs) {
  if (period === 'all') return (await redis.get(prefix)) || 0;
  const dates = getDatesInRange(cutoffs[period], new Date());
  if (dates.length === 0) return 0;
  const keys = dates.map(d => `${prefix}:${d}`);
  const values = await redis.mget(...keys);
  return values.reduce((sum, v) => sum + (parseInt(v) || 0), 0);
}

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const { page } = req.body || {};
    if (!page) return res.status(400).end();
    const today = new Date().toISOString().split('T')[0];
    await Promise.all([
      redis.incr(`page_views:${page}`),
      redis.incr(`page_views:${page}:${today}`),
    ]).catch(() => {});
    return res.status(204).end();
  }

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

    const [demoVisits, demoRequests] = await Promise.all([
      sumDailyCounter('page_views:demo', period, cutoffs),
      sumDailyCounter('demo_requests', period, cutoffs),
    ]);

    return res.status(200).json({ clients: stats, demoVisits, demoRequests });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
