const { redis, getAuthContext, FORBIDDEN } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) {
      const clientId = req.query && req.query.id;
      if (!clientId) return res.status(400).json({ error: 'Missing id' });
      const data = (await redis.get(`knowledge:${clientId}`)) || { urls: [], screenshots: [] };
      return res.status(200).json(data);
    }
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth === FORBIDDEN) return res.status(403).json({ error: 'Forbidden' });
    if (auth.type !== 'client') return res.status(401).json({ error: 'Unauthorized' });
    const data = (await redis.get(`knowledge:${auth.clientId}`)) || { urls: [], screenshots: [] };
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) {
      const { id, urls, screenshots } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const existing = (await redis.get(`knowledge:${id}`)) || { urls: [], screenshots: [] };
      if (urls !== undefined) existing.urls = urls;
      if (screenshots !== undefined) existing.screenshots = screenshots;
      await redis.set(`knowledge:${id}`, existing);
      return res.status(200).json({ success: true });
    }
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth === FORBIDDEN) return res.status(403).json({ error: 'Forbidden' });
    if (auth.type !== 'client') return res.status(401).json({ error: 'Unauthorized' });
    const { urls, screenshots } = req.body || {};
    const existing = (await redis.get(`knowledge:${auth.clientId}`)) || { urls: [], screenshots: [] };
    if (urls !== undefined) existing.urls = urls;
    if (screenshots !== undefined) existing.screenshots = screenshots;
    await redis.set(`knowledge:${auth.clientId}`, existing);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
