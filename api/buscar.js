export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', pagina = 1, modalidade = '', dataInicial = '', dataFinal = '' } = req.query;

  const pg = parseInt(pagina) || 1;
  const keywords = palavraChave ? palavraChave.split(';').map(k => k.trim()).filter(Boolean) : [''];
  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const modalidades = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];

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

  // Monta URL — UFs passadas como parâmetros repetidos (PNCP suporta)
  const buildUrl = (kw, paginaReq) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      status: 'recebendo_proposta',
      pagina: paginaReq,
      tam_pagina: 20,
    });
    if (kw) params.append('q', kw);
    ufs.forEach(u => params.append('ufs', u));
    return `https://pncp.gov.br/api/search/?${params}`;
  };

  try {
    let items = [], totalBase = 0, totalPaginas = 1;

    if (keywords.length === 1) {
      // BUSCA SIMPLES — uma query, paginação nativa do PNCP
      const data = await fetchJSON(buildUrl(keywords[0], pg));
      items = data?.items || [];
      totalBase = data?.total || 0;
      totalPaginas = Math.ceil(totalBase / 20) || 1;

      // Filtros client-side (só quando necessário)
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

    } else {
      // MÚLTIPLOS KEYWORDS — uma query por keyword, sem expansão adicional
      const results = await Promise.all(
        keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, 1)))
      );

      const seen = new Set();
      results.forEach(data => {
        (data?.items || []).forEach(item => {
          const key = item.id || item.numero_controle_pncp;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        });
      });

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

      // Paginação client-side para multi-keyword
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
