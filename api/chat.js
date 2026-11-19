const { redis, clientIp } = require('./_auth');

const DAILY_LIMIT = 10;
const MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1000;
const MAX_SYSTEM_CHARS = 5000;
const MAX_MESSAGE_CHARS = 6000;

// The demo may only send one system prompt and one user message; model and limits are fixed here
function buildDemoRequest(body) {
  const { system, messages } = body || {};
  if (typeof system !== 'string' || system.length > MAX_SYSTEM_CHARS) return null;
  if (!Array.isArray(messages) || messages.length !== 1) return null;
  const [msg] = messages;
  if (msg?.role !== 'user' || typeof msg.content !== 'string' || !msg.content.trim() || msg.content.length > MAX_MESSAGE_CHARS) return null;
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: msg.content }],
    stream: true,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Služba není dostupná.' });

  const payload = buildDemoRequest(req.body);
  if (!payload) return res.status(400).json({ error: 'Neplatný požadavek. Zkraťte prosím text emailu.' });

  const today = new Date().toISOString().split('T')[0];
  const countKey = `demo_chat_ip:${clientIp(req)}:${today}`;

  try {
    const count = (await redis.get(countKey)) || 0;
    if (count >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Denní limit ${DAILY_LIMIT} vygenerování byl vyčerpán. Zkuste to zítra nebo si Wise Agent vyzkoušejte naplno.`
      });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('Anthropic error', upstream.status, detail.slice(0, 500));
      return res.status(502).json({ error: 'Generování se nepodařilo. Zkuste to prosím za chvíli.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Daily-Remaining', DAILY_LIMIT - count - 1);

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    await redis.set(countKey, count + 1);
    await redis.expire(countKey, 86400);
    await Promise.all([
      redis.incr('demo_requests'),
      redis.incr(`demo_requests:${today}`),
    ]);
    res.end();

  } catch (error) {
    console.error('chat error:', error);
    if (!res.headersSent) return res.status(500).json({ error: 'Generování se nepodařilo. Zkuste to prosím za chvíli.' });
    res.end();
  }
};
