const { getAuthContext, redis } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthContext(req);
  if (!auth || auth.type !== 'client') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await redis.get(`client:${auth.clientId}`);
    if (!client) return res.status(404).json({ error: 'Klient nenalezen' });
    return res.status(200).json({
      clientId: client.id,
      companyName: client.companyName,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
