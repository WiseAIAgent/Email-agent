const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Chybí heslo' });

  try {
    const ids = (await redis.get('client_index')) || [];
    for (const id of ids) {
      const client = await redis.get(`client:${id}`);
      if (client && client.clientPassword === password) {
        return res.status(200).json({
          clientId: client.id,
          companyName: client.companyName,
          industry: client.industry || ''
        });
      }
    }
    return res.status(401).json({ error: 'Nesprávné heslo' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
