const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, type, userEmail } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Chybí zpráva' });

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.CONTACT_EMAIL,
      pass: process.env.CONTACT_PASSWORD,
    },
  });

  try {
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
  } catch (e) {
    console.error('Feedback email error:', e);
    return res.status(500).json({ error: e.message || 'Nepodařilo se odeslat email' });
  }

  res.status(200).json({ success: true });
};
