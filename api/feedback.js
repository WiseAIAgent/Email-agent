const nodemailer = require('nodemailer');
const { rateLimit } = require('./_auth');

function field(value, max) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const message = String(body.message ?? '').trim().slice(0, 5000);
  const type = field(body.type, 50);
  const userEmail = field(body.userEmail, 200);
  if (!message) return res.status(400).json({ error: 'Missing message' });

  try {
    if (!(await rateLimit(req, 'feedback', 10, 60 * 60))) {
      return res.status(429).json({ error: 'Odeslali jste příliš mnoho zpráv. Zkuste to prosím později.' });
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.CONTACT_EMAIL,
        pass: process.env.CONTACT_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.CONTACT_EMAIL,
      to: 'info@wiseagent.cz',
      subject: `Feedback od klienta — ${userEmail || 'neznámý'}`,
      text: [
        `Od: ${userEmail || 'neznámý'}`,
        type ? `Typ: ${type}` : null,
        `\nZpráva:\n${message}`,
      ].filter(Boolean).join('\n'),
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Feedback email error:', e);
    return res.status(500).json({ error: 'Zprávu se nepodařilo odeslat.' });
  }
};
