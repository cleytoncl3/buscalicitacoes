export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', pagina = 1, modalidade = '', dataInicial = '', dataFinal = '', portal = '' } = req.query;

  const pg = parseInt(pagina) || 1;
  const keywords = palavraChave ? palavraChave.split(';').map(k => k.trim()).filter(Boolean) : [''];
  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const modalidades = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const portais = portal ? portal.split(',').map(p => p.trim()).filter(Boolean) : [];

  // Há filtros client-side? Se sim, precisamos buscar mais itens do PNCP
  const hasClientFilter = portais.length > 0 || modalidades.length > 0 || !!dataInicial || !!dataFinal;

  const fetchJSON = async (url, tentativas = 3) => {
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
        const text = await r.text();
        try { return JSON.parse(text); } catch { if (i === tentativas - 1) return null; }
      } catch (e) {
        if (i === tentativas - 1) return null;
        await new Promise(r => setTimeout(r, 700));
      }
    }
    return null;
  };

  const buildUrl = (kw, paginaReq) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      status: 'recebendo_proposta',
      pagina: paginaReq,
      // Quando há filtros client-side, busca mais itens por página para ter amostra suficiente
      tam_pagina: hasClientFilter ? 50 : 20,
    });
    if (kw) params.append('q', kw);
    ufs.forEach(u => params.append('ufs', u));
    // Tenta passar esfera para o PNCP (pode ou não ser suportado)
    portais.forEach(p => params.append('esfera', p));
    return `https://pncp.gov.br/api/search/?${params}`;
  };

  const aplicarFiltros = (items) => {
    if (portais.length > 0)
      items = items.filter(i => portais.includes(String(i.esfera_id || '')));
    if (modalidades.length > 0)
      items = items.filter(i => modalidades.includes(String(i.modalidade_licitacao_id || '')));
    if (dataInicial || dataFinal) {
      const dIni = dataInicial ? new Date(dataInicial) : null;
      const dFim = dataFinal ? new Date(dataFinal + 'T23:59:59') : null;
      items = items.filter(i => {
        const ab = i.data_inicio_vigencia ? new Date(i.data_inicio_vigencia) : null;
        if (!ab) return true;
        if (dIni && ab < dIni) return false;
        if (dFim && ab > dFim) return false;
        return true;
      });
    }
    return items;
  };

  try {
    let items = [], totalBase = 0, totalPaginas = 1;

    if (keywords.length === 1) {
      if (!hasClientFilter) {
        // BUSCA SIMPLES sem filtros: paginação nativa do PNCP — resultado estável
        const data = await fetchJSON(buildUrl(keywords[0], pg));
        items = data?.items || [];
        totalBase = data?.total || 0;
        totalPaginas = Math.ceil(totalBase / 20) || 1;
      } else {
        // COM FILTROS CLIENT-SIDE: busca múltiplas páginas para ter amostra suficiente
        // Busca páginas 1 e 2 em paralelo (até 100 itens com tam_pagina=50)
        const [p1, p2] = await Promise.all([
          fetchJSON(buildUrl(keywords[0], 1)),
          fetchJSON(buildUrl(keywords[0], 2)),
        ]);

        const seen = new Set();
        [p1, p2].forEach(data => {
          (data?.items || []).forEach(item => {
            const key = item.id || item.numero_controle_pncp;
            if (!seen.has(key)) { seen.add(key); items.push(item); }
          });
        });

        items = aplicarFiltros(items);
        totalBase = items.length;
        totalPaginas = Math.ceil(totalBase / 20) || 1;
        const ini = (pg - 1) * 20;
        items = items.slice(ini, ini + 20);
      }
    } else {
      // MÚLTIPLOS KEYWORDS
      const results = await Promise.all(keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, 1))));
      const seen = new Set();
      results.forEach(data => {
        (data?.items || []).forEach(item => {
          const key = item.id || item.numero_controle_pncp;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        });
      });
      items = aplicarFiltros(items);
      totalBase = items.length;
      totalPaginas = Math.ceil(totalBase / 20) || 1;
      const ini = (pg - 1) * 20;
      items = items.slice(ini, ini + 20);
    }

    return res.status(200).json({ data: items, totalRegistros: totalBase, totalPaginas });
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
