// api/chat.js — Monitoramento de sessões públicas Compras.gov.br
// Código = UASG(6) + Modalidade(2) + Número(9) → ex: 98600106005942025

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'arantes_chats_v3';

async function redisGet() {
  if (!REDIS_URL) return [];
  try {
    const r = await fetch(`${REDIS_URL}/get/${KEY}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const { result } = await r.json();
    return result ? JSON.parse(result) : [];
  } catch { return []; }
}

async function redisSet(data) {
  if (!REDIS_URL) return;
  try {
    await fetch(`${REDIS_URL}/set/${KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
  } catch {}
}

function buildCodigo(uasg, modalidade, num, ano) {
  return String(uasg).padStart(6,'0') + String(modalidade) + String(num).padStart(5,'0') + String(ano||new Date().getFullYear());
}

async function fetchMensagens(codigo, pagina=1, tam=20) {
  const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public';
  const hdrs = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Referer': `${base}/compras/acompanhamento-compra?compra=${codigo}`
  };
  const urls = [
    `${base}/compras/${codigo}/mensagens?pagina=${pagina}&tamanhoPagina=${tam}`,
    `${base}/compra/${codigo}/mensagens?pagina=${pagina}&tamanhoPagina=${tam}`,
    `${base}/api/compras/${codigo}/mensagens?pagina=${pagina}&tamanhoPagina=${tam}`,
    `${base}/compras/mensagens?compra=${codigo}&pagina=${pagina}&tamanhoPagina=${tam}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(5000) });
      if (r.ok && (r.headers.get('content-type')||'').includes('json')) {
        const d = await r.json();
        const msgs = Array.isArray(d) ? d : (d.content||d.mensagens||d.data||d.items||d.result||[]);
        const total = d.totalElements||d.total||d.totalRegistros||msgs.length;
        return { msgs, total, fonte: url };
      }
    } catch {}
  }
  return { msgs: [], total: 0, fonte: null };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── LIST ──────────────────────────────────────────────
  if (req.method === 'GET' && !req.query.codigo && !req.query.uasg) {
    return res.status(200).json(await redisGet());
  }

  // ── BUSCAR MENSAGENS ──────────────────────────────────
  if (req.method === 'GET' && (req.query.codigo || req.query.uasg)) {
    const { uasg='', modalidade='06', numCompra='', ano='', codigo: cp, pagina='1', tam='20' } = req.query;
    const codigo = cp || buildCodigo(uasg, modalidade, numCompra, ano);
    const { msgs, total, fonte } = await fetchMensagens(codigo, Number(pagina)||1, Number(tam)||20);
    // Atualiza totalMensagens no Redis sem bloquear a resposta
    if (msgs.length > 0) {
      redisGet().then(chats => {
        const idx = chats.findIndex(c => c.codigo === codigo);
        if (idx >= 0) {
          chats[idx].totalMensagens = total;
          chats[idx].ultimaVerificacao = new Date().toISOString();
          redisSet(chats);
        }
      });
    }
    return res.status(200).json({ mensagens: msgs, total, fonte });
  }

  // ── ADICIONAR ─────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const uasg       = String(body.uasg || '').trim();
    const modalidade  = String(body.modalidade || '06').trim();
    const numCompra   = String(body.numCompra || '').trim();
    const ano        = String(body.ano || new Date().getFullYear()).trim();
    const descricao   = body.descricao || null;

    if (!uasg || !numCompra)
      return res.status(400).json({ erro: 'uasg e numCompra são obrigatórios' });

    // Prefer the pre-built codigo from frontend (already includes year); fallback to buildCodigo
    const codigo = body.codigo || buildCodigo(uasg, modalidade, numCompra, ano);
    const chats  = await redisGet();

    if (chats.find(c => c.codigo === codigo))
      return res.status(200).json({ ok: true, ja_existe: true });

    // Salva IMEDIATAMENTE — sem esperar PNCP
    const novo = {
      id: Date.now().toString(),
      uasg, modalidade, numCompra, ano, codigo,
      descricao: descricao || `UASG ${uasg} — Nº ${numCompra}`,
      objeto: null, orgao: null, uf: null,
      urlComprasnet: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=${codigo}`,
      adicionado_em: new Date().toISOString(),
      ultimaVerificacao: null,
      totalMensagens: 0,
    };
    chats.unshift(novo);
    await redisSet(chats);  // Salva antes de qualquer chamada externa

    // Tenta enriquecer com PNCP em background (sem bloquear a resposta)
    // Nota: em serverless, isso pode não completar — dados básicos já estão salvos
    try {
      const pParams = new URLSearchParams({ q: numCompra, tipos_documento: 'edital', pagina: 1, tam_pagina: 5 });
      const pRes = await fetch(`https://pncp.gov.br/api/search/?${pParams}`,
        { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000) });
      if (pRes.ok) {
        const pData = await pRes.json();
        const info = (pData.items||[])[0];
        if (info) {
          const idx = chats.findIndex(c => c.codigo === codigo);
          if (idx >= 0) {
            chats[idx].descricao = info.title || novo.descricao;
            chats[idx].objeto    = info.description || null;
            chats[idx].orgao     = info.orgao_nome || null;
            chats[idx].uf        = info.uf || null;
            await redisSet(chats);
          }
        }
      }
    } catch {}

    return res.status(200).json({ ok: true, certame: novo });
  }

  // ── REMOVER ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const chats = await redisGet();
    await redisSet(chats.filter(c => c.id !== id));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
