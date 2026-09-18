const { redis } = require('./_auth');

const DAILY_LIMIT = 25;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const today = new Date().toISOString().split('T')[0];
  const countKey = `demo_chat_count:${today}`;

  try {
    const count = (await redis.get(countKey)) || 0;
    if (count >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `Denní limit ${DAILY_LIMIT} vygenerování byl vyčerpán. Zkuste to zítra.`
      });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ ...req.body, stream: true })
    });

    if (!upstream.ok) {
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
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
    res.end();

  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ error: error.message });
    res.end();
  }
};
