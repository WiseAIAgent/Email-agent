const { redis } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { page } = req.body || {};
  if (!page) return res.status(400).end();
  await redis.incr(`page_views:${page}`).catch(() => {});
  res.status(204).end();
};
