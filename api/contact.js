const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone, note } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Chybí jméno nebo email' });

  const lines = [
    `Jméno: ${name}`,
    `Email: ${email}`,
    phone ? `Telefon: ${phone}` : null,
    note ? `\nPoznámka:\n${note}` : null,
  ].filter(Boolean).join('\n');

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
    subject: `Žádost o konzultaci — ${name}`,
    text: `Nová žádost o konzultaci přes wiseagent.cz/objednat\n\n${lines}`,
  });

  try {
    await transporter.sendMail({
      from: process.env.CONTACT_EMAIL,
      to: email,
      subject: 'Wise Agent — žádost o konzultaci přijata',
      text: `Dobrý den,\n\nobdrželi jsme vaši žádost o konzultaci. Ozveme se vám do 24 hodin.\n\nS pozdravem\nTým Wise Agent\ninfo@wiseagent.cz | wiseagent.cz`,
    });
  } catch (_) {}

  res.status(200).json({ success: true });
};
