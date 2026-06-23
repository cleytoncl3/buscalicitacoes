export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '',
    uf = '',
    pagina = 1,
    modalidade = '',
    dataInicial = '',
    dataFinal = '',
    portal = ''
  } = req.query;

  const pg = parseInt(pagina) || 1;
  const TAM_PAG = 20;

  // Parse de inputs — igual SigaPregão: keywords separados por ";"
  const keywords = palavraChave
    ? palavraChave.split(';').map(k => k.trim()).filter(Boolean)
    : [''];

  const ufs      = uf       ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods     = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const portais  = portal   ? portal.split(',').map(p => p.trim()).filter(Boolean) : [];

  // --- helper ---
  const fetchJSON = async (url, tries = 3) => {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        const txt = await r.text();
        try { return JSON.parse(txt); } catch { /* non-JSON */ }
      } catch (_) { /* network error */ }
      if (i < tries - 1) await new Promise(r => setTimeout(r, 600));
    }
    return null;
  };

  // --- URL do PNCP search (igual SigaPregão usa internamente) ---
  // pesquisaAmpla = busca keywords em título E itens da licitação
  const buildSearchUrl = (kw, paginaReq, tamPag) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      status: 'recebendo_proposta',
      pagina: paginaReq,
      tam_pagina: tamPag,
    });
    if (kw) p.append('q', kw);
    // Múltiplos UFs — PNCP aceita parâmetro repetido
    ufs.forEach(u => p.append('ufs', u));
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // --- Filtros client-side (portal, modalidade, data) ---
  const aplicar = (items) => {
    // Filtro de portal: esfera_id F=Federal(Comprasnet), E=Estadual, M=Municipal
    if (portais.length > 0)
      items = items.filter(i => portais.includes(String(i.esfera_id || '')));

    // Filtro de modalidade
    if (mods.length > 0)
      items = items.filter(i => mods.includes(String(i.modalidade_licitacao_id || '')));

    // Filtro por data de abertura (igual SigaPregão tipoPeriodo:"abertura")
    if (dataInicial || dataFinal) {
      const dI = dataInicial ? new Date(dataInicial + 'T00:00:00') : null;
      const dF = dataFinal   ? new Date(dataFinal   + 'T23:59:59') : null;
      items = items.filter(i => {
        const ab = i.data_inicio_vigencia ? new Date(i.data_inicio_vigencia) : null;
        if (!ab) return !dI && !dF; // sem data → inclui só se não há filtro de data
        if (dI && ab < dI) return false;
        if (dF && ab > dF) return false;
        return true;
      });
    }
    return items;
  };

  const hasClientFilter = portais.length > 0 || mods.length > 0 || !!dataInicial || !!dataFinal;

  try {
    // ============================================================
    // BUSCA SIMPLES: 1 keyword, sem filtros client-side complexos
    // → paginação nativa do PNCP, resultado estável e consistente
    // ============================================================
    if (keywords.length === 1 && !hasClientFilter) {
      const data = await fetchJSON(buildSearchUrl(keywords[0], pg, TAM_PAG));
      const items = data?.items || [];
      const total = data?.total || 0;
      return res.status(200).json({
        data: items,
        totalRegistros: total,
        totalPaginas: Math.ceil(total / TAM_PAG) || 1,
      });
    }

    // ============================================================
    // BUSCA AVANÇADA: multi-keyword OU filtros client-side ativos
    // → busca várias páginas do PNCP, filtra, pagina client-side
    // (mesmo comportamento do SigaPregão com sua base indexada)
    // ============================================================

    // Quantas páginas do PNCP buscamos depende de quão restrito é o filtro
    // Com portais: precisamos de amostra maior (portal pode estar em qualquer página)
    const paginasPNCP = hasClientFilter ? [1, 2, 3] : [1, 2];
    const tamPagPNCP  = 20; // mantém em 20 para evitar erro do PNCP

    const queries = [];
    for (const kw of keywords.slice(0, 5)) {
      for (const pPNCP of paginasPNCP) {
        queries.push({ kw, pPNCP });
      }
    }

    const results = await Promise.all(
      queries.map(({ kw, pPNCP }) => fetchJSON(buildSearchUrl(kw, pPNCP, tamPagPNCP)))
    );

    // Mescla e deduplica — prioriza resultados das primeiras páginas
    const seen  = new Set();
    let allItems = [];
    results.forEach(data => {
      (data?.items || []).forEach(item => {
        const key = item.id || item.numero_controle_pncp;
        if (key && !seen.has(key)) { seen.add(key); allItems.push(item); }
      });
    });

    // Aplica filtros (portal, modalidade, data)
    const filtered = aplicar(allItems);

    // Paginação client-side
    const total     = filtered.length;
    const totalPags = Math.ceil(total / TAM_PAG) || 1;
    const inicio    = (pg - 1) * TAM_PAG;
    const pageItems = filtered.slice(inicio, inicio + TAM_PAG);

    return res.status(200).json({
      data: pageItems,
      totalRegistros: total,
      totalPaginas: totalPags,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
