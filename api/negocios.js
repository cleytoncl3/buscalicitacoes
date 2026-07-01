// api/negocios.js — banco compartilhado (todos os dispositivos e funcionários)
// COM Upstash: dados persistem permanentemente entre todos os dispositivos
// SEM Upstash: cache em memória (reseta em cold starts — NÃO use em produção sem Upstash)
// Setup Upstash: vercel.com/dashboard → Integrations → Upstash → New Redis

const KEY = 'arantes_negocios_v2';

// Cache em memória — fallback apenas, não é confiável em produção
const memoryCache = { data: null };

// Upstash cria variáveis com nomes ligeiramente diferentes dependendo da integração usada.
// Tentamos todas as variantes conhecidas.
function getUpstashCreds() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_API_URL ||
    process.env.UPSTASH_REST_URL ||
    process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_API_TOKEN ||
    process.env.UPSTASH_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN;
  return { url, token };
}

const hasUpstash = () => {
  const { url, token } = getUpstashCreds();
  return !!(url && token);
};

async function redisGet() {
  if (!hasUpstash()) return null;
  const { url, token } = getUpstashCreds();
  try {
    const r = await fetch(`${url}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) { console.error('Upstash GET error:', r.status); return null; }
    const { result } = await r.json();
    return result ? JSON.parse(result) : [];
  } catch (e) { console.error('Upstash GET exception:', e.message); return null; }
}

async function redisSet(data) {
  if (!hasUpstash()) return false;
  const { url, token } = getUpstashCreds();
  try {
    const r = await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
    if (!r.ok) { console.error('Upstash SET error:', r.status); return false; }
    return true;
  } catch (e) { console.error('Upstash SET exception:', e.message); return false; }
}

async function getNegocios() {
  const fromRedis = await redisGet();
  if (fromRedis !== null) {
    memoryCache.data = fromRedis; // atualiza cache local com dado do Redis
    return fromRedis;
  }
  return memoryCache.data || [];
}

async function setNegocios(data) {
  memoryCache.data = data;
  const saved = await redisSet(data);
  if (!saved && !hasUpstash()) {
    console.warn('Upstash não configurado — dados apenas em memória (voláteis)');
  }
  return saved;
}

export default async function handler(req, res) {
  // Impede caching pelo browser e CDN — dados de negócios devem ser sempre frescos
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const negocios = await getNegocios();

  if (req.method === 'GET') {
    const { url } = getUpstashCreds();
    console.log(`[negocios] upstash=${hasUpstash()} url_prefix=${url ? url.substring(0,30) : 'none'} count=${negocios.length}`);
    return res.status(200).json({
      negocios,
      upstash: hasUpstash(),
    });
  }

  if (req.method === 'POST') {
    const body = req.body;
    // Suporta salvar múltiplos de uma vez (array) ou um só (objeto)
    const novos = Array.isArray(body) ? body : [body];
    for (const novo of novos) {
      if (!novo || !novo.numero_controle) continue;
      novo.id = novo.id || Date.now().toString();
      const idx = negocios.findIndex(n => n.numero_controle === novo.numero_controle);
      if (idx >= 0) {
        // Preserva itensInteresse se novo não tiver (merge cuidadoso)
        const antigo = negocios[idx];
        negocios[idx] = {
          ...antigo,
          ...novo,
          itensInteresse: novo.itensInteresse?.length ? novo.itensInteresse : (antigo.itensInteresse || []),
        };
      } else {
        negocios.unshift(novo);
      }
    }
    await setNegocios(negocios);
    return res.status(200).json({ ok: true, total: negocios.length });
  }

  if (req.method === 'PUT') {
    const body = req.body;
    // Suporta: replace_all (sincronização completa) ou update de item individual
    if (body.action === 'replace_all' && Array.isArray(body.negocios)) {
      // Substitui toda a lista — propaga deleções entre dispositivos
      await setNegocios(body.negocios);
      return res.status(200).json({ ok: true, total: body.negocios.length });
    }
    const { id, fase, updates } = body;
    const n = negocios.find(x => x.id === id);
    if (n) {
      if (fase !== undefined) n.fase = fase;
      if (updates && typeof updates === 'object') Object.assign(n, updates);
      await setNegocios(negocios);
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ erro: 'ID obrigatório' });
    const novos = negocios.filter(n => n.id !== id);
    await setNegocios(novos);
    return res.status(200).json({ ok: true, total: novos.length });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
