// ═══════════════════════════════════════════════════════════════════
// buscar.js — API de busca do PNCP replicada com parâmetros corretos
//
// Descobertas da investigação da API real do PNCP:
//  ✅ ufs=PR|SP           → pipe em UM parâmetro (não repetido, não vírgula)
//  ✅ modalidades=6|8     → plural com S, pipe separado (era "modalidade" — ignorado!)
//  ✅ status=recebendo_proposta | propostas_encerradas | encerradas | todos
//  ✅ ordenacao=-data     → mais recente primeiro (| data | relevancia | valor)
//  ✅ tam_pagina=20       → pode ir até 1000
//  ❌ Filtro de data NÃO existe na /api/search/ — feito client-side
//  ❌ modalidade (sem S)  → ignorado silenciosamente pela API!
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '',
    uf = '',
    pagina = 1,
    modalidade = '',   // recebemos do front, mas enviamos como "modalidades" para o PNCP
    dataInicial = '',
    dataFinal = '',
    status = 'recebendo_proposta',
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  // Múltiplos keywords separados por ";"
  const keywords = palavraChave
    ? palavraChave.split(';').map(k => k.trim()).filter(Boolean)
    : [''];

  // UFs e modalidades em formato pipe (|) — formato correto do PNCP
  const ufs  = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];

  // ── Status válidos no PNCP ────────────────────────────────────────
  const statusValidos = ['recebendo_proposta', 'propostas_encerradas', 'encerradas', 'todos'];
  const statusFinal   = statusValidos.includes(status) ? status : 'recebendo_proposta';

  // ── Fetch com retry ───────────────────────────────────────────────
  const fetchJSON = async (url) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        const txt = await r.text();
        return JSON.parse(txt);
      } catch {
        if (i < 2) await new Promise(r => setTimeout(r, 600));
      }
    }
    return null;
  };

  // ── Monta URL com parâmetros CORRETOS do PNCP ────────────────────
  const buildUrl = (kw, paginaReq) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',          // obrigatório — sem ele retorna 400
      ordenacao:       '-data',           // mais recentes primeiro
      status:          statusFinal,
      pagina:          paginaReq,
      tam_pagina:      TAM,
    });

    if (kw) p.append('q', kw);

    // UFs: UM parâmetro, valores separados por pipe
    // ✅ ufs=PR|SP   ❌ ufs=PR&ufs=SP   ❌ ufs=PR,SP
    if (ufs.length) p.append('ufs', ufs.join('|'));

    // Modalidades: parâmetro "modalidades" (plural!), pipe separado
    // ✅ modalidades=6|8   ❌ modalidade=6|8 (ignorado pela API!)
    if (mods.length) p.append('modalidades', mods.join('|'));

    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // ── Filtro de data (client-side — PNCP não suporta na /api/search/) ─
  const filtrarData = (items) => {
    if (!dataInicial && !dataFinal) return items;
    const dI = dataInicial ? new Date(dataInicial + 'T00:00:00') : null;
    const dF = dataFinal   ? new Date(dataFinal   + 'T23:59:59') : null;
    return items.filter(i => {
      const ab = i.data_inicio_vigencia ? new Date(i.data_inicio_vigencia) : null;
      if (!ab) return true;
      if (dI && ab < dI) return false;
      if (dF && ab > dF) return false;
      return true;
    });
  };

  try {
    // ══════════════════════════════════════════════════════════════
    // KEYWORD ÚNICO → UMA query, paginação nativa do PNCP
    // Com modalidades e ufs filtrados SERVER-SIDE → resultado estável
    // ══════════════════════════════════════════════════════════════
    if (keywords.length === 1) {
      const data  = await fetchJSON(buildUrl(keywords[0], pg));
      const raw   = data?.items || [];
      const total = data?.total  || 0;

      // Data é o único filtro client-side (PNCP não suporta)
      const items = filtrarData(raw);

      return res.status(200).json({
        data:             items,
        totalRegistros:   total,   // total já filtrado pelo PNCP (ufs + modalidades + status)
        totalPaginas:     Math.ceil(total / TAM) || 1,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // MÚLTIPLOS KEYWORDS (separados por ;) → uma query por keyword
    // Merge + dedup client-side, paginação client-side
    // ══════════════════════════════════════════════════════════════
    const results = await Promise.all(
      keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, 1)))
    );

    const seen   = new Set();
    let   merged = [];
    results.forEach(d =>
      (d?.items || []).forEach(i => {
        const k = i.id || i.numero_controle_pncp;
        if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
      })
    );

    const filtered = filtrarData(merged);
    const total    = filtered.length;
    const ini      = (pg - 1) * TAM;

    return res.status(200).json({
      data:           filtered.slice(ini, ini + TAM),
      totalRegistros: total,
      totalPaginas:   Math.ceil(total / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
