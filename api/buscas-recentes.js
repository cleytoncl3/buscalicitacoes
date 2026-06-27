// api/buscas-recentes.js — Buscas mais frequentes, compartilhadas entre todos os usuários
// Persiste no Upstash Redis quando configurado; senão usa memória (reseta no redeploy)
// GET  → lista ordenada por contagem (mais buscadas primeiro)
// POST → incrementa contagem de um termo

const KEY = 'arantes_buscas_recentes_v1';
const MAX = 50;

// Fallback em memória
const memStore = new Map();

async function redisGet() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/get/${KEY}`, { headers: { Authorization: `Bearer ${token}` } });
    const { result } = await r.json();
    return result ? JSON.parse(result) : {};
  } catch { return null; }
}

async function redisSet(data) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
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

function mapToObj(m) {
  const o = {};
  m.forEach((v, k) => { o[k] = v; });
  return o;
}

function objToMap(o) {
  const m = new Map();
  Object.entries(o || {}).forEach(([k, v]) => m.set(k, v));
  return m;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Carrega estado atual
  let store = memStore;
  const redisData = await redisGet();
  if (redisData !== null) {
    // Usa Redis como fonte de verdade; sincroniza memStore
    const fromRedis = objToMap(redisData);
    memStore.clear();
    fromRedis.forEach((v, k) => memStore.set(k, v));
    store = memStore;
  }

  if (req.method === 'GET') {
    const lista = [...store.values()]
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map(x => ({ kw: x.kw, count: x.count }));
    return res.status(200).json({ ok: true, buscas: lista });
  }

  if (req.method === 'POST') {
    let kw = '';
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      kw = (body?.kw || '').trim().toLowerCase().slice(0, 100);
    } catch {}
    if (!kw) return res.status(400).json({ erro: 'kw obrigatório' });

    const existing = store.get(kw);
    store.set(kw, { kw, count: (existing?.count || 0) + 1, updatedAt: Date.now() });

    // Mantém só MAX entradas
    if (store.size > MAX) {
      const sorted = [...store.entries()].sort((a, b) => a[1].count - b[1].count || a[1].updatedAt - b[1].updatedAt);
      store.delete(sorted[0][0]);
    }

    await redisSet(mapToObj(store));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
