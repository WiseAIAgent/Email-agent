const { redis } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const clientPassword = req.headers['x-client-password'];
  const clientEmail = req.headers['x-client-email'];
  if (!clientPassword || !clientEmail) {
    return res.status(401).json({ error: 'Nesprávný email nebo heslo' });
  }

  try {
    const ids = (await redis.get('client_index')) || [];
    let client = null;
    for (const id of ids) {
      const c = await redis.get(`client:${id}`);
      if (c && c.clientPassword === clientPassword && c.email === clientEmail) {
        client = c;
        break;
      }
    }
    if (!client) {
      return res.status(401).json({ error: 'Nesprávný email nebo heslo' });
    }
    return res.status(200).json({
      clientId: client.id,
      companyName: client.companyName,
      tone: client.tone || 'přátelský a profesionální',
      replyLength: client.replyLength || 'stredni',
      usePlural: client.usePlural !== false,
      useSignature: client.useSignature !== false,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
