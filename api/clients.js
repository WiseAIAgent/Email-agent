const { redis, getAuthContext, FORBIDDEN } = require('./_auth');

module.exports = async function handler(req, res) {
  // GET - admin: list all clients; client: return own data
  if (req.method === 'GET') {
    if (req.headers['x-admin-secret'] === process.env.ADMIN_SECRET) {
      try {
        const ids = (await redis.get('client_index')) || [];
        const clients = [];
        for (const id of ids) {
          const client = await redis.get(`client:${id}`);
          if (client) clients.push({ ...client, emailPassword: '••••••••' });
        }
        return res.status(200).json(clients);
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    const auth = await getAuthContext(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth === FORBIDDEN) return res.status(403).json({ error: 'Forbidden' });
    if (auth.type !== 'client') return res.status(401).json({ error: 'Unauthorized' });
    try {
      const client = await redis.get(`client:${auth.clientId}`);
      if (!client) return res.status(404).json({ error: 'Klient nenalezen' });
      const { emailPassword, ...safe } = client;
      return res.status(200).json(safe);
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
      if (auth === FORBIDDEN) return res.status(403).json({ error: 'Forbidden' });
      if (auth?.type === 'client') {
        const existing = await redis.get(`client:${auth.clientId}`);
        if (!existing) return res.status(404).json({ error: 'Klient nenalezen' });
        const {
          tone, replyLength, usePlural, useSignature, ignoreKeywords, ignoreSenders, ignoreDomains,
          companyName, industry, companyDescription, imapHost, imapPort, smtpHost, smtpPort,
          emailPassword, faq, signature, email, escalationContact, escalationWhen, forbiddenTopics, websiteUrl,
        } = req.body;
        const updated = { ...existing };
        if (tone !== undefined) updated.tone = tone;
        if (replyLength !== undefined) updated.replyLength = replyLength;
        if (usePlural !== undefined) updated.usePlural = usePlural;
        if (useSignature !== undefined) updated.useSignature = useSignature;
        if (ignoreKeywords !== undefined) updated.ignoreKeywords = ignoreKeywords;
        if (ignoreSenders !== undefined) updated.ignoreSenders = ignoreSenders;
        if (ignoreDomains !== undefined) updated.ignoreDomains = ignoreDomains;
        if (companyName !== undefined) updated.companyName = companyName;
        if (industry !== undefined) updated.industry = industry;
        if (companyDescription !== undefined) updated.companyDescription = companyDescription;
        if (imapHost !== undefined) updated.imapHost = imapHost;
        if (imapPort !== undefined) updated.imapPort = imapPort;
        if (smtpHost !== undefined) updated.smtpHost = smtpHost;
        if (smtpPort !== undefined) updated.smtpPort = smtpPort;
        if (emailPassword !== undefined && emailPassword !== '••••••••') updated.emailPassword = emailPassword;
        if (faq !== undefined) updated.faq = faq;
        if (signature !== undefined) updated.signature = signature;
        if (email !== undefined) updated.email = email;
        if (escalationContact !== undefined) updated.escalationContact = escalationContact;
        if (escalationWhen !== undefined) updated.escalationWhen = escalationWhen;
        if (forbiddenTopics !== undefined) updated.forbiddenTopics = forbiddenTopics;
        if (websiteUrl !== undefined) updated.websiteUrl = websiteUrl;
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
      // Clean up all email records for this client
      const emailIndex = (await redis.get(`email_index:${id}`)) || [];
      if (emailIndex.length > 0) {
        await Promise.all(emailIndex.map(eid => redis.del(`email:${eid}`)));
        await redis.del(`email_index:${id}`);
        // Remove client's emails from the global index too
        const globalIndex = (await redis.get('email_index')) || [];
        const clientEmailSet = new Set(emailIndex);
        await redis.set('email_index', globalIndex.filter(eid => !clientEmailSet.has(eid)));
      }
      // Delete client record and remove from index
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
