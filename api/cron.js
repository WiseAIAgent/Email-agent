const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function fetchEmailsForClient(client) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: client.email,
      password: client.emailPassword,
      host: client.imapHost,
      port: parseInt(client.imapPort || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
    });

    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);
        imap.search(['UNSEEN'], (err, results) => {
          if (err) return reject(err);
          if (!results || results.length === 0) { imap.end(); return resolve([]); }

          const toFetch = results.slice(0, 10);
          const fetch = imap.fetch(toFetch, { bodies: '', markSeen: true });

          fetch.on('message', (msg) => {
            let uid;
            msg.on('attributes', (attrs) => { uid = attrs.uid; });
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (!err) emails.push({
                  uid: String(uid),
                  from: parsed.from?.text || '',
                  subject: parsed.subject || '(bez předmětu)',
                  text: (parsed.text || '').slice(0, 3000),
                  date: parsed.date?.toISOString() || new Date().toISOString()
                });
              });
            });
          });
          fetch.once('end', () => imap.end());
          fetch.once('error', reject);
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.once('error', reject);
    imap.connect();
  });
}

function buildSystemPrompt(client) {
  const name = client.companyName || 'naše firma';
  const signature = client.signature || `Tým zákaznické podpory, ${name}`;
  const tone = client.tone || 'přátelský a profesionální';
  const salutationMap = { vykani: 'Vyká zákazníkům', tykani: 'Tyká zákazníkům' };
  const lengthMap = { kratka: 'krátká', dlouha: 'podrobná' };
  const plural = client.usePlural !== false;
  const useSignature = client.useSignature !== false;

  let prompt = `Jsi AI asistent zákaznické podpory pro firmu "${name}"${client.industry ? ` (${client.industry})` : ''}.
${client.companyDesc ? `\nO firmě: ${client.companyDesc}` : ''}
Pravidla:
- Tón: ${tone}
- Oslovení: ${salutationMap[client.salutation] || salutationMap.vykani}
- Délka odpovědi: ${lengthMap[client.replyLength] || 'střední'}
- Mluv za firmu v ${plural ? 'množném čísle (Děkujeme, Pomůžeme...)' : 'jednotném čísle (Děkuji, Pomohu...)'}
- Piš česky
${useSignature ? `- Ukončuj podpisem: "${signature}"` : '- Nepřidávej podpis'}
- Piš pouze text odpovědi bez předmětu`;

  if (client.faqs?.length > 0)
    prompt += '\n\nFAQ:\n' + client.faqs.map((f, i) => `Q${i+1}: ${f.q}\nA${i+1}: ${f.a}`).join('\n');
  if (client.escalationContact)
    prompt += `\n\nEskalace: Pokud ${client.escalationWhen || 'problém nelze vyřešit'}, přesměruj na: ${client.escalationContact}`;
  if (client.forbiddenTopics)
    prompt += `\n\nNIKDY nekomentuj: ${client.forbiddenTopics}`;

  return prompt;
}

async function sendNotification(client, processed) {
  const transporter = nodemailer.createTransport({
    host: client.smtpHost,
    port: parseInt(client.smtpPort || '465'),
    secure: parseInt(client.smtpPort) !== 587,
    auth: { user: client.email, pass: client.emailPassword },
  });

  await transporter.sendMail({
    from: client.email,
    to: client.email,
    subject: `Email Agent — ${processed} nových návrhů odpovědí čeká na schválení`,
    text: `Dobrý den,\n\ndnes jsme zkontrolovali vaši emailovou schránku a připravili ${processed} návrhů odpovědí.\n\nPřihlaste se a schvalte je: https://email-agent-indol-seven.vercel.app/klient`,
  });
}

async function generateReply(email, client) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: buildSystemPrompt(client),
      messages: [{ role: 'user', content: `Od: ${email.from}\nPředmět: ${email.subject}\n\n${email.text}\n\nNapiš odpověď.` }]
    })
  });
  const data = await response.json();
  return data.content?.map(b => b.text || '').join('') || '';
}

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const clientIds = (await redis.get('client_index')) || [];
    if (clientIds.length === 0) return res.status(200).json({ message: 'Žádní klienti' });

    const today = new Date().toISOString().split('T')[0];
    const results = [];

    for (const clientId of clientIds) {
      const client = await redis.get(`client:${clientId}`);
      if (!client || !client.active) continue;

      const countKey = `daily_count:${clientId}:${today}`;
      const count = (await redis.get(countKey)) || 0;
      const limit = client.dailyLimit || 25;

      if (count >= limit) {
        results.push({ clientId, message: 'Denní limit vyčerpán' });
        continue;
      }

      let processed = 0;
      try {
        const emails = await fetchEmailsForClient(client);

        for (const email of emails) {
          const currentCount = (await redis.get(countKey)) || 0;
          if (currentCount >= limit) break;

          const reply = await generateReply(email, client);
          const id = `email_${clientId}_${email.uid}_${Date.now()}`;
          const record = {
            id, clientId,
            uid: email.uid,
            from: email.from,
            subject: email.subject,
            body: email.text,
            date: email.date,
            reply,
            status: 'pending',
            createdAt: new Date().toISOString()
          };

          await redis.set(`email:${id}`, record);

          const globalIndex = (await redis.get('email_index')) || [];
          globalIndex.unshift(id);
          if (globalIndex.length > 1000) globalIndex.pop();
          await redis.set('email_index', globalIndex);

          const clientIndex = (await redis.get(`email_index:${clientId}`)) || [];
          clientIndex.unshift(id);
          if (clientIndex.length > 200) clientIndex.pop();
          await redis.set(`email_index:${clientId}`, clientIndex);

          await redis.set(countKey, currentCount + 1);
          await redis.expire(countKey, 86400);
          processed++;
        }

        if (processed > 0) {
          try {
            await sendNotification(client, processed);
          } catch (notifErr) {
            console.error(`Notification failed for client ${clientId}:`, notifErr.message);
          }
        }

        results.push({ clientId, name: client.companyName, processed });
      } catch (err) {
        console.error(`Error for client ${clientId}:`, err.message);
        results.push({ clientId, name: client.companyName, error: err.message });
      }
    }

    return res.status(200).json({ results });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
}
