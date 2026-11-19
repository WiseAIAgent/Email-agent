const { getAuthContext, sendAuthError, redis } = require('./_auth');

// 'sent' is set only by /api/send after the email really goes out
const SETTABLE_STATUSES = new Set(['pending', 'ignored']);

module.exports = async function handler(req, res) {
  try {
    const auth = await getAuthContext(req);
    if (auth?.type !== 'admin' && auth?.type !== 'client') return sendAuthError(res, auth);

    const authId = auth.clientId;

    if (authId !== 'all') {
      const client = await redis.get(`client:${authId}`);
      if (client && client.active === false) {
        return res.status(403).json({ error: 'Váš přístup byl deaktivován. Kontaktujte info@wiseagent.cz' });
      }
    }

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
      const { emailId, status } = req.body || {};
      if (typeof emailId !== 'string' || !SETTABLE_STATUSES.has(status)) {
        return res.status(400).json({ error: 'Neplatný požadavek' });
      }
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
    console.error('emails error:', e);
    return res.status(500).json({ error: 'Chyba serveru.' });
  }
};
