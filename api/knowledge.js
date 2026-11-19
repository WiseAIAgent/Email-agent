const { redis, getAuthContext, sendAuthError } = require('./_auth');

const MAX_URLS = 10;
const MAX_SCREENSHOTS = 10;
const MAX_IMAGE_CHARS = 1_000_000;
const JPEG_DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && value.length <= 500;
  } catch {
    return false;
  }
}

// Returns { urls?, screenshots? } with only valid values, or { error }
function validateKnowledge(body) {
  const out = {};
  if (body.urls !== undefined) {
    if (!Array.isArray(body.urls) || body.urls.length > MAX_URLS) return { error: `Můžete uložit nejvýše ${MAX_URLS} odkazů.` };
    const urls = body.urls.map(u => String(u ?? '').trim()).filter(Boolean);
    if (urls.some(u => !isHttpUrl(u))) return { error: 'Odkaz musí začínat https:// nebo http://.' };
    out.urls = urls;
  }
  if (body.screenshots !== undefined) {
    if (!Array.isArray(body.screenshots) || body.screenshots.length > MAX_SCREENSHOTS) {
      return { error: `Můžete nahrát nejvýše ${MAX_SCREENSHOTS} obrázků.` };
    }
    const shots = [];
    for (const s of body.screenshots) {
      const data = String(s?.data ?? '');
      if (data.length > MAX_IMAGE_CHARS || !JPEG_DATA_URL_RE.test(data)) return { error: 'Obrázek musí být JPEG do 750 kB.' };
      shots.push({ id: String(s?.id ?? '').slice(0, 100), name: String(s?.name ?? '').slice(0, 200), data });
    }
    out.screenshots = shots;
  }
  return out;
}

module.exports = async function handler(req, res) {
  try {
    const auth = await getAuthContext(req);
    if (auth?.type !== 'admin' && auth?.type !== 'client') return sendAuthError(res, auth);

    const clientId = auth.type === 'admin' ? (req.query?.id || req.body?.id) : auth.clientId;
    if (!clientId) return res.status(400).json({ error: 'Missing id' });

    if (req.method === 'GET') {
      const data = (await redis.get(`knowledge:${clientId}`)) || { urls: [], screenshots: [] };
      return res.status(200).json(data);
    }

    if (req.method === 'PATCH') {
      const { error, ...valid } = validateKnowledge(req.body || {});
      if (error) return res.status(400).json({ error });
      const existing = (await redis.get(`knowledge:${clientId}`)) || { urls: [], screenshots: [] };
      await redis.set(`knowledge:${clientId}`, { ...existing, ...valid });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('knowledge error:', e);
    return res.status(500).json({ error: 'Chyba serveru. Zkuste to prosím znovu.' });
  }
};
