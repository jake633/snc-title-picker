export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-notion-key, x-notion-path, x-notion-method');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const notionKey = req.headers['x-notion-key'];
  const notionPath = req.headers['x-notion-path'];
  const notionMethod = (req.headers['x-notion-method'] || 'GET').toUpperCase();
  if (!notionKey || !notionPath) return res.status(400).json({ error: 'Missing headers' });

  const isReadMethod = notionMethod === 'GET' || notionMethod === 'HEAD';

  try {
    const response = await fetch(`https://api.notion.com/v1${notionPath}`, {
      method: notionMethod,
      headers: {
        'Authorization': `Bearer ${notionKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      ...(isReadMethod ? {} : { body: JSON.stringify(req.body || {}) })
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
