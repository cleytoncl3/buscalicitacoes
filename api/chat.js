// api/chat.js — Monitoramento de chats de sessão pública (Compras.gov.br / Comprasnet)
// Código da compra = UASG(6) + Modalidade(2) + Número(9)
// Ex: UASG 986001 + Modalidade 06 + Nº 005942025 = 98600106005942025
// URL pública: https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra={codigo}

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY_CHATS   = 'arantes_chats_monitorados_v2';

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

function buildCodigo(uasg, modalidade, numCompra) {
  return uasg.padStart(6,'0') + modalidade + numCompra.padStart(9,'0');
}

// Tenta buscar mensagens via API do Comprasnet mobile
async function buscarMensagensComprasnet(codigo, uasg, numCompra) {
  const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public';
  const hdrs = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': `${base}/compras/acompanhamento-compra?compra=${codigo}`,
    'Origin': 'https://cnetmobile.estaleiro.serpro.gov.br'
  };

  // Endpoints prováveis do Comprasnet mobile API
  const endpoints = [
    `${base}/api/compras/${codigo}/mensagens`,
    `${base}/api/chat/${codigo}`,
    `${base}/compras/mensagens?compra=${codigo}`,
    `${base}/api/compras/acompanhamento-compra/mensagens?compra=${codigo}`,
    `${base}/api/chat?compra=${codigo}&uasg=${uasg}&numero=${numCompra}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: hdrs });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json')) {
          const data = await r.json();
          const msgs = Array.isArray(data) ? data : (data.mensagens||data.data||data.content||data.items||[]);
          if (msgs.length > 0) return { msgs, fonte: url, ok: true };
        }
      }
    } catch {}
  }

  return { msgs: [], fonte: null, ok: false };
}

// Busca info da compra via PNCP como fallback para enriquecer o registro
async function buscarInfoPNCP(uasg, numCompra) {
  try {
    const params = new URLSearchParams({ q: numCompra, tipos_documento: 'edital', pagina: 1, tam_pagina: 5 });
    const r = await fetch(`https://pncp.gov.br/api/search/?${params}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const data = await r.json();
    return (data.items||[])[0] || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const chats = (await redisGet(KEY_CHATS)) || [];

  // GET sem params → lista todos monitorados
  if (req.method === 'GET' && !req.query.uasg) {
    return res.status(200).json(chats);
  }

  // GET com params → busca mensagens
  if (req.method === 'GET' && req.query.uasg) {
    const { uasg, modalidade = '06', numCompra, codigo: codigoParam } = req.query;
    const codigo = codigoParam || buildCodigo(uasg, modalidade, numCompra || '');
    const { msgs, fonte, ok } = await buscarMensagensComprasnet(codigo, uasg, numCompra || '');

    // Atualiza cache do certame
    const idx = chats.findIndex(c => c.codigo === codigo || (c.uasg === uasg && c.numCompra === numCompra));
    if (idx >= 0) {
      chats[idx].ultimaVerificacao = new Date().toISOString();
      if (msgs.length > 0) chats[idx].totalMensagens = msgs.length;
      await redisSet(KEY_CHATS, chats);
    }

    return res.status(200).json({ mensagens: msgs, total: msgs.length, fonte, apiDisponivel: ok });
  }

  // POST → adicionar certame
  if (req.method === 'POST') {
    const { uasg, modalidade = '06', numCompra, codigo: codigoParam } = req.body;
    if (!uasg || !numCompra) return res.status(400).json({ erro: 'uasg e numCompra obrigatórios' });
    const codigo = codigoParam || buildCodigo(uasg, modalidade, numCompra);
    if (chats.find(c => c.codigo === codigo))
      return res.status(200).json({ ok: true, ja_existe: true });

    const info = await buscarInfoPNCP(uasg, numCompra);
    const novo = {
      id: Date.now().toString(),
      uasg, modalidade, numCompra, codigo,
      descricao: info?.title || `UASG ${uasg} — Nº ${numCompra}`,
      objeto: info?.description || null,
      orgao: info?.orgao_nome || null,
      uf: info?.uf || null,
      urlComprasnet: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${codigo}`,
      adicionado_em: new Date().toISOString(),
      ultimaVerificacao: null,
      totalMensagens: 0,
    };
    chats.unshift(novo);
    await redisSet(KEY_CHATS, chats);
    return res.status(200).json({ ok: true, certame: novo });
  }

  // DELETE → remover
  if (req.method === 'DELETE') {
    const { id } = req.query;
    await redisSet(KEY_CHATS, chats.filter(c => c.id !== id));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
