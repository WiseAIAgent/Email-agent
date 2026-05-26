const { getAuthContext, redis } = require('./_auth');

module.exports = async function handler(req, res) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const authId = auth.clientId;

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
      if (authId !== 'all' && record.clientId !== authId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      record.status = status;
      await redis.set(`email:${emailId}`, record);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
