// api/jornais.js — jornais compartilhados entre todos os dispositivos (mesmo padrão de negocios.js)

const KEY = 'arantes_jornais_v1';
const memoryCache = { data: null };

function getUpstashCreds() {
  const url =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_KV_URL ||
    process.env.UPSTASH_REDIS_REST_REDIS_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REST_TOKEN;
  return { url, token };
}

const hasUpstash = () => { const {url,token}=getUpstashCreds(); return !!(url&&token); };

async function redisGet() {
  if (!hasUpstash()) return null;
  const { url, token } = getUpstashCreds();
  try {
    const r = await fetch(`${url}/get/${KEY}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { console.error('Upstash GET error:', r.status); return null; }
    const { result } = await r.json();
    if (!result) return [];
    let parsed = JSON.parse(result);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { console.error('Upstash GET exception:', e.message); return null; }
}

async function redisSet(data) {
  if (!hasUpstash()) return false;
  const { url, token } = getUpstashCreds();
  try {
    const r = await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) { console.error('Upstash SET error:', r.status); return false; }
    return true;
  } catch (e) { console.error('Upstash SET exception:', e.message); return false; }
}

async function getJornaisData() {
  const fromRedis = await redisGet();
  if (fromRedis !== null) { memoryCache.data = fromRedis; return fromRedis; }
  return memoryCache.data || [];
}

async function setJornaisData(data) {
  memoryCache.data = data;
  return await redisSet(data);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const jornais = await getJornaisData();

  if (req.method === 'GET') {
    return res.status(200).json({ jornais, upstash: hasUpstash() });
  }

  if (req.method === 'PUT') {
    const body = req.body;
    if (body.action === 'replace_all' && Array.isArray(body.jornais)) {
      await setJornaisData(body.jornais);
      return res.status(200).json({ ok: true, total: body.jornais.length });
    }
    return res.status(400).json({ erro: 'Ação inválida' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
