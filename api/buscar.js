export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1,
    modalidade = '', dataInicial = '', dataFinal = '',
    status = 'recebendo_proposta',
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  const keywords = palavraChave
    ? palavraChave.split(';').map(k => k.trim()).filter(Boolean)
    : [''];
  const ufs  = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];

  const statusValidos = ['recebendo_proposta', 'propostas_encerradas', 'encerradas', 'todos'];
  const statusFinal   = statusValidos.includes(status) ? status : 'recebendo_proposta';
  const hasDateFilter = !!(dataInicial || dataFinal);

  const fetchJSON = async (url) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        return JSON.parse(await r.text());
      } catch { if (i < 2) await new Promise(r => setTimeout(r, 600)); }
    }
    return null;
  };

  // Parâmetros corretos descobertos na investigação da API real do PNCP:
  // ✅ modalidades (plural, pipe)  ✅ ufs (pipe)  ✅ ordenacao=-data
  const buildUrl = (kw, paginaReq, tamPag = TAM) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao:       '-data',
      status:          statusFinal,
      pagina:          paginaReq,
      tam_pagina:      tamPag,
    });
    if (kw)          p.append('q',          kw);
    if (ufs.length)  p.append('ufs',        ufs.join('|'));
    if (mods.length) p.append('modalidades', mods.join('|'));
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  const filtrarData = (items) => {
    if (!hasDateFilter) return items;
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
    if (keywords.length === 1) {
      // ══════════════════════════════════════════════════════════
      // SEM FILTRO DE DATA → paginação nativa do PNCP (estável)
      // Sempre retorna exatamente 20 itens por página
      // ══════════════════════════════════════════════════════════
      if (!hasDateFilter) {
        const data  = await fetchJSON(buildUrl(keywords[0], pg));
        const items = data?.items || [];
        const total = data?.total || 0;
        return res.status(200).json({
          data:           items,
          totalRegistros: total,
          totalPaginas:   Math.ceil(total / TAM) || 1,
        });
      }

      // ══════════════════════════════════════════════════════════
      // COM FILTRO DE DATA → busca lote grande (PNCP suporta até
      // 1000 por página), aplica filtro, pagina client-side.
      // Garante sempre 20 itens por página mesmo após filtrar.
      // ══════════════════════════════════════════════════════════

      // Passo 1: descobre o total real com uma query rápida (tam=1)
      const probe = await fetchJSON(buildUrl(keywords[0], 1, 1));
      const totalPNCP = probe?.total || 0;

      if (totalPNCP === 0) {
        return res.status(200).json({ data: [], totalRegistros: 0, totalPaginas: 1 });
      }

      // Passo 2: busca todos os itens em uma chamada (máx 500)
      const tamLote  = Math.min(totalPNCP, 500);
      const allData  = await fetchJSON(buildUrl(keywords[0], 1, tamLote));
      const allItems = allData?.items || [];

      // Passo 3: aplica filtro de data
      const filtered = filtrarData(allItems);
      const total    = filtered.length;
      const ini      = (pg - 1) * TAM;

      return res.status(200).json({
        data:           filtered.slice(ini, ini + TAM),
        totalRegistros: total,
        totalPaginas:   Math.ceil(total / TAM) || 1,
      });
    }

    // ══════════════════════════════════════════════════════════
    // MÚLTIPLOS KEYWORDS (;) → uma query por keyword, merge
    // ══════════════════════════════════════════════════════════
    const tamMult  = hasDateFilter ? 100 : TAM;
    const results  = await Promise.all(
      keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, 1, tamMult)))
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
