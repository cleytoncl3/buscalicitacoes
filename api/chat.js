// api/chat.js — Monitoramento de chats de sessão pública (Compras.gov.br)
// Armazena certames monitorados no Upstash e busca mensagens do Comprasnet

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY_CHATS   = 'arantes_chats_monitorados_v1';

async function redisGet(key) {
  if (!REDIS_URL) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${key}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const { result } = await r.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

async function redisSet(key, data) {
  if (!REDIS_URL) return;
  try {
    await fetch(`${REDIS_URL}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
  } catch {}
}

// Busca mensagens do chat da sessão pública no Comprasnet
async function buscarMensagensComprasnet(uasg, numCompra) {
  const hdrs = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.comprasnet.gov.br/' };
  const endpoints = [
    `https://www.comprasnet.gov.br/api/chat/${uasg}/${numCompra}/mensagens`,
    `https://www.comprasnet.gov.br/api/v1/pregao/${uasg}/${numCompra}/chat`,
    `https://www.comprasnet.gov.br/ConsultaLicitacoes/api/chat?uasg=${uasg}&numCompra=${numCompra}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: hdrs });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const data = await r.json();
          const msgs = Array.isArray(data) ? data : (data.mensagens || data.data || data.content || []);
          if (msgs.length > 0) return { msgs, fonte: url };
        }
      }
    } catch {}
  }
  return { msgs: [], fonte: null };
}

// Busca info da compra via PNCP (para validar UASG + número)
async function buscarInfoCompra(uasg, numCompra) {
  try {
    // Busca pelo número no PNCP search
    const params = new URLSearchParams({ q: numCompra, tipos_documento: 'edital', pagina: 1, tam_pagina: 5 });
    const r = await fetch(`https://pncp.gov.br/api/search/?${params}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const data = await r.json();
    // Filtra por UASG no título ou órgão
    const match = (data.items || []).find(i =>
      i.title?.includes(numCompra) || i.orgao_nome?.includes(uasg) || i.numero_controle_pncp?.includes(uasg)
    );
    return match || (data.items || [])[0] || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const chats = (await redisGet(KEY_CHATS)) || [];

  // GET /api/chat — lista certames monitorados
  if (req.method === 'GET' && !req.query.uasg) {
    return res.status(200).json(chats);
  }

  // GET /api/chat?uasg=X&numCompra=Y — busca mensagens de um certame
  if (req.method === 'GET' && req.query.uasg) {
    const { uasg, numCompra } = req.query;
    const { msgs, fonte } = await buscarMensagensComprasnet(uasg, numCompra);
    // Cache das últimas mensagens no certame
    const idx = chats.findIndex(c => c.uasg === uasg && c.numCompra === numCompra);
    if (idx >= 0) {
      chats[idx].ultimaVerificacao = new Date().toISOString();
      if (msgs.length > 0) chats[idx].totalMensagens = msgs.length;
      await redisSet(KEY_CHATS, chats);
    }
    return res.status(200).json({ mensagens: msgs, total: msgs.length, fonte });
  }

  // POST /api/chat — adicionar certame para monitorar
  if (req.method === 'POST') {
    const { uasg, numCompra, descricao } = req.body;
    if (!uasg || !numCompra) return res.status(400).json({ erro: 'uasg e numCompra obrigatórios' });
    if (chats.find(c => c.uasg === uasg && c.numCompra === numCompra))
      return res.status(200).json({ ok: true, ja_existe: true });
    // Busca info da compra para enriquecer o registro
    const info = await buscarInfoCompra(uasg, numCompra);
    const novo = {
      id: Date.now().toString(),
      uasg, numCompra,
      descricao: descricao || info?.title || `UASG ${uasg} — Nº ${numCompra}`,
      objeto: info?.description || null,
      orgao: info?.orgao_nome || null,
      uf: info?.uf || null,
      adicionado_em: new Date().toISOString(),
      ultimaVerificacao: null,
      totalMensagens: 0,
    };
    chats.unshift(novo);
    await redisSet(KEY_CHATS, chats);
    return res.status(200).json({ ok: true, certame: novo });
  }

  // DELETE /api/chat?id=X — remover certame
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const novos = chats.filter(c => c.id !== id);
    await redisSet(KEY_CHATS, novos);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
