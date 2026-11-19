const nodemailer = require('nodemailer');
const { rateLimit } = require('./_auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function field(value, max) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const name = field(body.name, 100);
  const email = field(body.email, 200);
  const phone = field(body.phone, 40);
  const tarif = field(body.tarif, 50);
  const note = String(body.note ?? '').trim().slice(0, 2000);
  if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Vyplňte prosím jméno a platný email.' });

  try {
    if (!(await rateLimit(req, 'contact', 5, 60 * 60))) {
      return res.status(429).json({ error: 'Odeslali jste příliš mnoho žádostí. Zkuste to prosím později.' });
    }

    const lines = [
      `Jméno: ${name}`,
      `Email: ${email}`,
      phone ? `Telefon: ${phone}` : null,
      tarif ? `Zvolený tarif: ${tarif}` : null,
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

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('contact error:', e);
    return res.status(500).json({ error: 'Žádost se nepodařilo odeslat.' });
  }
};
