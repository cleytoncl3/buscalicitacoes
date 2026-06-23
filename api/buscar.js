export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1, modalidade = '',
    status = '', dataInicial = '', dataFinal = ''
  } = req.query;

  const pg = parseInt(pagina) || 1;

  // Parse: keywords exatos (sem expansão automática para evitar inconsistência)
  const keywords = palavraChave
    ? palavraChave.split(';').map(k => k.trim()).filter(Boolean)
    : [''];

  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const modalidades = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];

  // Se busca simples (1 keyword, 1 UF, sem filtros client-side complexos) → usa paginação do PNCP
  const isSimple = keywords.length === 1 && ufs.length <= 1 && modalidades.length === 0 &&
                   !dataInicial && !dataFinal &&
                   (status === 'recebendo_proposta' || status === '');

  const buildUrl = (kw, ufItem, paginaReq) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      pagina: paginaReq,
      tam_pagina: isSimple ? 20 : 50,
    });
    if (status === 'recebendo_proposta') params.append('status', 'recebendo_proposta');
    if (kw) params.append('q', kw);
    if (ufItem) params.append('ufs', ufItem);
    return `https://pncp.gov.br/api/search/?${params}`;
  };

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

  try {
    let items = [];
    let totalBase = 0;
    let totalPaginas = 1;

    if (isSimple) {
      // BUSCA SIMPLES: paginação nativa do PNCP — resultado consistente
      const data = await fetchJSON(buildUrl(keywords[0], ufs[0] || '', pg));
      if (data) {
        items = data.items || [];
        totalBase = data.total || 0;
        totalPaginas = Math.ceil(totalBase / 20);
      }
    } else {
      // BUSCA COMBINADA: múltiplos keywords/UFs/filtros
      const ufList = ufs.length > 0 ? ufs : [''];
      const combinations = [];
      for (const kw of keywords) {
        for (const ufItem of ufList) {
          combinations.push({ kw, uf: ufItem });
        }
      }
      // Limita combinações para performance
      const limited = combinations.slice(0, 10);

      const results = await Promise.all(
        limited.map(({ kw, uf: ufItem }) => fetchJSON(buildUrl(kw, ufItem, 1)))
      );

      const seen = new Set();
      results.forEach(data => {
        if (!data) return;
        (data.items || []).forEach(item => {
          const key = item.id || item.numero_controle_pncp;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        });
      });

      // Aplica filtros client-side
      const agora = new Date();

      // Filtro modalidade
      if (modalidades.length > 0) {
        items = items.filter(item => modalidades.includes(String(item.modalidade_licitacao_id || '')));
      }

      // Filtro status
      if (status === 'encerrada') {
        items = items.filter(item => {
          const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
          return fim && agora > fim;
        });
      } else if (status === 'em_julgamento') {
        items = items.filter(item => {
          const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
          return fim && agora > fim;
        });
      } else if (status === 'recebendo_proposta') {
        items = items.filter(item => {
          const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
          return !fim || agora <= fim;
        });
      }

      // Filtro data
      if (dataInicial || dataFinal) {
        const dIni = dataInicial ? new Date(dataInicial) : null;
        const dFim = dataFinal ? new Date(dataFinal + 'T23:59:59') : null;
        items = items.filter(item => {
          const ab = item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null;
          if (!ab) return true;
          if (dIni && ab < dIni) return false;
          if (dFim && ab > dFim) return false;
          return true;
        });
      }

      // Paginação client-side para busca combinada
      const tamPag = 20;
      totalBase = items.length;
      totalPaginas = Math.ceil(totalBase / tamPag) || 1;
      const inicio = (pg - 1) * tamPag;
      items = items.slice(inicio, inicio + tamPag);
    }

    return res.status(200).json({
      data: items,
      totalRegistros: totalBase,
      totalPaginas: totalPaginas,
    });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
