// api/negocios.js — armazenamento compartilhado via Upstash Redis (gratuito)
// Setup: Vercel Dashboard → Integrations → Upstash → Create Redis Database
// As env vars UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN são adicionadas automaticamente

const KEY = 'arantes_negocios_v1';

async function redisGet() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const { result } = await r.json();
    return result ? JSON.parse(result) : [];
  } catch { return null; }
}

async function redisSet(data) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  try {
    await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const negocios = (await redisGet()) || [];

  if (req.method === 'GET') {
    return res.status(200).json(negocios);
  }

  if (req.method === 'POST') {
    const novo = { ...req.body, id: req.body.id || Date.now().toString() };
    const idx = negocios.findIndex(n => n.numero_controle === novo.numero_controle);
    if (idx >= 0) negocios[idx] = { ...negocios[idx], ...novo };
    else negocios.unshift(novo);
    await redisSet(negocios);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PUT') {
    const { id, fase } = req.body;
    const n = negocios.find(x => x.id === id);
    if (n) { n.fase = fase; await redisSet(negocios); }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const novos = negocios.filter(n => n.id !== id);
    await redisSet(novos);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
