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
    const parserPromises = []; // track async parsers so we wait for all before resolving

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
              const p = new Promise((done) => {
                simpleParser(stream, (err, parsed) => {
                  if (!err) emails.push({
                    uid: String(uid),
                    from: parsed.from?.text || '',
                    subject: parsed.subject || '(bez předmětu)',
                    text: (parsed.text || '').slice(0, 3000),
                    date: parsed.date?.toISOString() || new Date().toISOString(),
                    messageId: parsed.messageId || '',
                  });
                  done();
                });
              });
              parserPromises.push(p);
            });
          });
          fetch.once('end', () => imap.end());
          fetch.once('error', reject);
        });
      });
    });

    // Wait for all simpleParser callbacks before resolving — fixes race condition
    // where imap.end() fired before async parsers completed
    imap.once('end', () => Promise.all(parserPromises).then(() => resolve(emails)).catch(reject));
    imap.once('error', reject);
    imap.connect();
  });
}

function buildSystemPrompt(client, knowledgeUrls, urlContent) {
  const name = client.companyName || 'naše firma';
  const signature = client.signature || `Tým zákaznické podpory, ${name}`;
  const tone = client.tone || 'přátelský a profesionální';
  const salutationMap = { vykani: 'Vyká zákazníkům', tykani: 'Tyká zákazníkům' };
  const lengthMap = { kratka: 'krátká', dlouha: 'podrobná' };
  const plural = client.usePlural !== false;
  const useSignature = client.useSignature !== false;

  let prompt = `Jsi AI asistent zákaznické podpory pro firmu "${name}"${client.industry ? ` (${client.industry})` : ''}.
${client.companyDescription ? `\nO firmě: ${client.companyDescription}` : ''}
Pravidla:
- Tón: ${tone}
- Oslovení: ${salutationMap[client.salutation] || salutationMap.vykani}
- Délka odpovědi: ${lengthMap[client.replyLength] || 'střední'}
- Mluv za firmu v ${plural ? 'množném čísle (Děkujeme, Pomůžeme...)' : 'jednotném čísle (Děkuji, Pomohu...)'}
- Piš česky
${useSignature ? `- Ukončuj podpisem: "${signature}"` : '- Nepřidávej podpis'}
- Piš pouze text odpovědi bez předmětu`;

  if (client.faq?.length > 0)
    prompt += '\n\nFAQ:\n' + client.faq.map((f, i) => `Q${i+1}: ${f.q}\nA${i+1}: ${f.a}`).join('\n');
  if (client.escalationContact)
    prompt += `\n\nEskalace: Pokud ${client.escalationWhen || 'problém nelze vyřešit'}, přesměruj na: ${client.escalationContact}`;
  if (client.forbiddenTopics)
    prompt += `\n\nNIKDY nekomentuj: ${client.forbiddenTopics}`;

  if (urlContent) {
    prompt += `\n\nObsah webu klienta (přečteno automaticky):\n${urlContent}`;
    prompt += '\nPokud se zákazníkova otázka týká informací z webu, odpověz konkrétně na základě výše uvedeného obsahu.';
  } else {
    const urls = (knowledgeUrls || []).filter(Boolean);
    if (urls.length > 0) {
      prompt += `\n\nWeb klienta: ${urls.join(', ')}`;
      prompt += '\nPři relevantní příležitosti zákazníkovi doporuč navštívit tyto stránky.';
    }
  }

  return prompt;
}

function pluralNavrhu(n) {
  if (n === 1) return '1 návrh';
  if (n >= 2 && n <= 4) return `${n} návrhy`;
  return `${n} návrhů`;
}

async function sendNotification(client, processed) {
  const subjects = [
    'Máte nové návrhy odpovědí — Wise Agent',
    'Wise Agent: Zkontrolujte návrhy od vašeho AI asistenta',
    'Nové návrhy odpovědí čekají na schválení',
    'Váš AI asistent připravil návrhy odpovědí',
    'Denní přehled — návrhy odpovědí od Wise Agenta',
  ];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const greeting = client.contactName ? `Dobrý den, ${client.contactName},` : 'Dobrý den,';
  const appUrl = process.env.APP_URL || 'https://wiseagent.cz';
  const transporter = nodemailer.createTransport({
    host: client.smtpHost,
    port: parseInt(client.smtpPort || '465'),
    secure: parseInt(client.smtpPort || '465') !== 587,
    auth: { user: client.email, pass: client.emailPassword },
  });
  await transporter.sendMail({
    from: client.email,
    to: client.email,
    subject,
    text: `${greeting}\n\ndnes jsme zkontrolovali vaši emailovou schránku a připravili ${pluralNavrhu(processed)} odpovědí.\n\nPřihlaste se a schvalte je: ${appUrl}/klient`,
  });
}

function isIgnored(email, client) {
  const subject = (email.subject || '').toLowerCase();
  const from = (email.from || '').toLowerCase();

  if (client.ignoreKeywords) {
    const keywords = client.ignoreKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.some(k => k && subject.includes(k))) return true;
  }

  if (client.ignoreSenders) {
    const senders = client.ignoreSenders.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (senders.some(s => from.includes(s))) return true;
  }

  if (client.ignoreDomains) {
    const domains = client.ignoreDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    const domainMatch = from.match(/@([\w.-]+)/);
    const emailDomain = domainMatch ? domainMatch[1] : '';
    if (emailDomain && domains.some(d => emailDomain === d || emailDomain.endsWith('.' + d))) return true;
  }

  return false;
}

async function fetchUrlContent(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WiseAgent/1.0; +https://wiseagent.cz)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return '';
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

async function getKnowledgeUrlContent(clientId, urls) {
  const validUrls = (urls || []).filter(Boolean).slice(0, 3);
  if (validUrls.length === 0) return '';

  const cacheKey = `url_cache:${clientId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const parts = [];
  for (const url of validUrls) {
    try {
      const text = await fetchUrlContent(url);
      if (text) parts.push(`--- ${url} ---\n${text}`);
    } catch {}
  }

  const combined = parts.join('\n\n');
  if (combined) {
    await redis.set(cacheKey, combined);
    await redis.expire(cacheKey, 86400);
  }
  return combined;
}

async function generateReply(email, client, knowledge, urlContent) {
  const kb = knowledge || { urls: [], screenshots: [] };
  const emailText = `Od: ${email.from}\nPředmět: ${email.subject}\n\n${email.text}\n\nNapiš odpověď.`;

  // Build user content — include screenshots as vision images (max 5 to control token cost)
  let userContent;
  const shots = (kb.screenshots || []).slice(0, 5);
  if (shots.length > 0) {
    userContent = [
      { type: 'text', text: `Kontext — screenshoty webu a materiálů klienta (${shots.length}):` },
      ...shots.map(s => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: s.data.replace(/^data:image\/\w+;base64,/, ''),
        },
      })),
      { type: 'text', text: emailText },
    ];
  } else {
    userContent = emailText;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: buildSystemPrompt(client, kb.urls, urlContent),
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API ${response.status}: ${err.error?.message || 'unknown error'}`);
  }
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
        const knowledge = (await redis.get(`knowledge:${clientId}`)) || { urls: [], screenshots: [] };
        const urlContent = await getKnowledgeUrlContent(clientId, knowledge.urls).catch(() => '');

        for (const email of emails) {
          const currentCount = (await redis.get(countKey)) || 0;
          if (currentCount >= limit) break;

          const id = `email_${clientId}_${email.uid}_${Date.now()}`;

          // Check ignore rules — save as ignored without generating reply
          if (isIgnored(email, client)) {
            const record = {
              id, clientId,
              uid: email.uid,
              from: email.from,
              subject: email.subject,
              body: email.text,
              date: email.date,
              messageId: email.messageId || '',
              reply: '',
              status: 'ignored',
              createdAt: new Date().toISOString()
            };
            await redis.set(`email:${id}`, record);
            const gi = (await redis.get('email_index')) || [];
            gi.unshift(id); if (gi.length > 1000) gi.pop();
            await redis.set('email_index', gi);
            const ci = (await redis.get(`email_index:${clientId}`)) || [];
            ci.unshift(id); if (ci.length > 200) ci.pop();
            await redis.set(`email_index:${clientId}`, ci);
            continue; // skip reply generation, don't count toward daily limit
          }

          const reply = await generateReply(email, client, knowledge, urlContent);
          const record = {
            id, clientId,
            uid: email.uid,
            from: email.from,
            subject: email.subject,
            body: email.text,
            date: email.date,
            messageId: email.messageId || '',
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
