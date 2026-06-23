export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1, modalidade = '',
    status = 'recebendo_proposta', dataInicial = '', dataFinal = ''
  } = req.query;

  const keywords = palavraChave ? palavraChave.split(';').map(k => k.trim()).filter(Boolean) : [''];
  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];

  const buildUrl = (kw, ufItem) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      pagina: keywords.length > 1 || ufs.length > 1 ? 1 : pagina,
      tam_pagina: keywords.length > 1 || ufs.length > 1 ? 50 : 20,
      status: status || 'recebendo_proposta',
    });
    if (kw) params.append('q', kw);
    if (ufItem) params.append('ufs', ufItem);
    if (modalidade) params.append('modalidade', modalidade);
    // Tenta passar datas para o PNCP (podem ou não ser suportadas)
    if (dataInicial) params.append('dataInicial', dataInicial.replace(/-/g, ''));
    if (dataFinal) params.append('dataFinal', dataFinal.replace(/-/g, ''));
    return `https://pncp.gov.br/api/search/?${params}`;
  };

  const fetchComRetry = async (url, tentativas = 3) => {
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
        const text = await r.text();
        try { return JSON.parse(text); } catch { if (i === tentativas - 1) return null; }
      } catch (e) {
        if (i === tentativas - 1) return null;
        await new Promise(r => setTimeout(r, 800));
      }
    }
    return null;
  };

  try {
    const ufList = ufs.length > 0 ? ufs : [''];
    const combinations = [];
    for (const kw of keywords) {
      for (const ufItem of ufList) {
        combinations.push({ kw, uf: ufItem });
      }
    }

    const results = await Promise.all(combinations.map(({ kw, uf: ufItem }) => fetchComRetry(buildUrl(kw, ufItem))));

    const seen = new Set();
    let items = [];
    let totalBase = 0;

    results.forEach((data, i) => {
      if (!data) return;
      if (i === 0) totalBase = data.total || 0;
      (data.items || []).forEach(item => {
        const key = item.id || item.numero_controle_pncp;
        if (!seen.has(key)) { seen.add(key); items.push(item); }
      });
    });

    // Filtro de data client-side (fallback caso PNCP não filtre pelo servidor)
    if (dataInicial || dataFinal) {
      const dIni = dataInicial ? new Date(dataInicial) : null;
      const dFim = dataFinal ? new Date(dataFinal + 'T23:59:59') : null;
      items = items.filter(item => {
        const abertura = item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null;
        if (!abertura) return true;
        if (dIni && abertura < dIni) return false;
        if (dFim && abertura > dFim) return false;
        return true;
      });
    }

    const isMulti = keywords.length > 1 || ufs.length > 1 || dataInicial || dataFinal;
    return res.status(200).json({
      data: items,
      totalRegistros: isMulti ? items.length : totalBase,
      totalPaginas: isMulti ? Math.ceil(items.length / 20) : Math.ceil(totalBase / 20)
    });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
