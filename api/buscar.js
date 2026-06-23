export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1, modalidade = '',
    status = '', dataInicial = '', dataFinal = ''
  } = req.query;

  const keywords = palavraChave ? palavraChave.split(';').map(k => k.trim()).filter(Boolean) : [''];
  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const isMulti = keywords.length > 1 || ufs.length > 1;

  const buildUrl = (kw, ufItem) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      pagina: isMulti ? 1 : pagina,
      tam_pagina: isMulti ? 50 : 20,
    });

    // Só passa status=recebendo_proposta para o PNCP (único que funciona na API deles)
    // Para encerrada/em_julgamento/todos, buscamos sem filtro e filtramos client-side
    if (status === 'recebendo_proposta') {
      params.append('status', 'recebendo_proposta');
    }
    // Se vazio (todos) ou outros status — não passa status para o PNCP
    // pois o PNCP ignora valores desconhecidos e retorna recebendo_proposta por padrão

    if (kw) params.append('q', kw);
    if (ufItem) params.append('ufs', ufItem);
    if (modalidade) params.append('modalidade', modalidade);
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

    const results = await Promise.all(combinations.map(({ kw, uf: ufItem }) =>
      fetchComRetry(buildUrl(kw, ufItem))
    ));

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

    const agora = new Date();

    // Filtro de STATUS — feito no servidor para garantir
    if (status === 'encerrada') {
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        return fim && agora > fim;
      });
    } else if (status === 'em_julgamento') {
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        const ini = item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null;
        // Proposta encerrada mas resultado ainda não divulgado
        return fim && agora > fim && ini;
      });
    } else if (status === 'recebendo_proposta') {
      // Já filtrado pelo PNCP, mas garantimos client-side também
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        const ini = item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null;
        if (fim && agora > fim) return false;
        return true;
      });
    }
    // status vazio = todos, sem filtro adicional

    // Filtro de DATA por abertura
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

    const hasExtraFilter = isMulti || dataInicial || dataFinal || (status && status !== 'recebendo_proposta');
    return res.status(200).json({
      data: items,
      totalRegistros: hasExtraFilter ? items.length : totalBase,
      totalPaginas: hasExtraFilter ? Math.ceil(items.length / 20) : Math.ceil(totalBase / 20)
    });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
