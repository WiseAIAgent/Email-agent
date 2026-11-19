const nodemailer = require('nodemailer');
const { getAuthContext, sendAuthError, redis, decryptSecret } = require('./_auth');

const MAX_REPLY_CHARS = 20000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await getAuthContext(req);
    if (auth?.type !== 'admin' && auth?.type !== 'client') return sendAuthError(res, auth);

    const authId = auth.clientId;
    const { emailId, replyText } = req.body || {};
    if (typeof emailId !== 'string' || typeof replyText !== 'string' || !replyText.trim()) {
      return res.status(400).json({ error: 'Chybí emailId nebo replyText' });
    }
    if (replyText.length > MAX_REPLY_CHARS) return res.status(400).json({ error: 'Odpověď je příliš dlouhá.' });

    const record = await redis.get(`email:${emailId}`);
    if (!record) return res.status(404).json({ error: 'E-mail nenalezen' });
    if (record.status === 'sent') return res.status(400).json({ error: 'Už odesláno' });
    if (authId !== 'all' && record.clientId !== authId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const client = await redis.get(`client:${record.clientId}`);
    if (!client) return res.status(404).json({ error: 'Klient nenalezen' });

    const transporter = nodemailer.createTransport({
      host: client.smtpHost,
      port: parseInt(client.smtpPort || '465'),
      secure: parseInt(client.smtpPort) !== 587,
      auth: { user: client.email, pass: decryptSecret(client.emailPassword) },
    });

    await transporter.sendMail({
      from: client.email,
      to: record.from,
      subject: record.subject.startsWith('Re:') ? record.subject : `Re: ${record.subject}`,
      text: replyText,
      ...(record.messageId && {
        inReplyTo: record.messageId,
        references: record.messageId,
      }),
    });

    record.status = 'sent';
    record.sentAt = new Date().toISOString();
    record.reply = replyText;
    await redis.set(`email:${emailId}`, record);

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Send error:', e);
    return res.status(500).json({ error: 'Email se nepodařilo odeslat. Zkontrolujte nastavení schránky nebo to zkuste znovu.' });
  }
};
