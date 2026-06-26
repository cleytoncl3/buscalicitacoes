export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1,
    modalidade = '', dataInicial = '', dataFinal = '',
    esfera = '',
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  const wrapFrase = (kw) => {
    kw = kw.trim();
    if (!kw) return kw;
    if (kw.startsWith('"') && kw.endsWith('"')) return kw;
    return kw;
  };

  const keywords = palavraChave
    ? palavraChave.split(';').map(k => wrapFrase(k)).filter(Boolean)
    : [''];
  const ufs     = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods    = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const esferas = esfera    ? esfera.split(',').map(e => e.trim()).filter(Boolean) : [];

  const comFiltroData = !!(dataInicial || dataFinal);

  // Limites de data para filtro client-side por data_fim_vigencia
  const dtIni = dataInicial ? new Date(dataInicial) : null;
  const dtFim = dataFinal   ? new Date(dataFinal + 'T23:59:59') : null;
  const agora = new Date();

  const fetchJSON = async (url) => {
    for (let i = 0; i < 2; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      try {
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        clearTimeout(timer);
        return JSON.parse(await r.text());
      } catch {
        clearTimeout(timer);
        if (i < 1) await new Promise(r => setTimeout(r, 300));
      }
    }
    return null;
  };

  const buildUrl = (kw, paginaReq, tamPagina = TAM, comStatus = false) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao:       '-data',
      pagina:          paginaReq,
      tam_pagina:      tamPagina,
    });
    if (kw)             p.append('q',           kw);
    if (ufs.length)     p.append('ufs',         ufs.join('|'));
    if (mods.length)    p.append('modalidades', mods.join('|'));
    if (esferas.length) p.append('esferas',     esferas.join('|'));
    // status=recebendo_proposta reduz o pool a só licitações ativas,
    // tornando o over-fetch viável dentro do timeout da Vercel.
    if (comStatus)      p.append('status',      'recebendo_proposta');
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // Filtra itens pelo prazo de recebimento de propostas (data_fim_vigencia)
  const filtrarPorData = (items) => {
    return items.filter(item => {
      const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
      if (!fim) return false;
      if (fim < agora) return false;                // proposta já encerrada
      if (dtIni && fim < dtIni) return false;
      if (dtFim && fim > dtFim) return false;
      return true;
    });
  };

  // Com filtro de datas: uma única requisição com status=recebendo_proposta,
  // filtra client-side por data_fim_vigencia para o intervalo pedido.
  const buscarComFiltroData = async (kw, paginaReq) => {
    const data = await fetchJSON(buildUrl(kw, paginaReq, TAM, true));
    if (!data) return { items: [], total: 0 };
    const filtrados = filtrarPorData(data.items || []);
    return { items: filtrados, total: data.total || 0 };
  };

  try {
    if (!comFiltroData) {
      // Sem filtro de datas: paginação normal do PNCP
      if (keywords.length === 1) {
        const data  = await fetchJSON(buildUrl(keywords[0], pg));
        const raw   = data?.items || [];
        const total = data?.total  || 0;
        return res.status(200).json({
          data:           raw,
          totalRegistros: total,
          totalPaginas:   Math.ceil(total / TAM) || 1,
        });
      }

      const results = await Promise.all(
        keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, pg)))
      );
      const seen = new Set();
      let merged = [];
      results.forEach(d =>
        (d?.items || []).forEach(i => {
          const k = i.id || i.numero_controle_pncp;
          if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
        })
      );
      const totalEst = results[0]?.total || merged.length;
      return res.status(200).json({
        data:           merged,
        totalRegistros: totalEst,
        totalPaginas:   Math.ceil(totalEst / TAM) || 1,
      });
    }

    // COM filtro de datas: status=recebendo_proposta + filtro por data_fim_vigencia
    const kwList = keywords.slice(0, 5);
    const resultados = await Promise.all(kwList.map(kw => buscarComFiltroData(kw, pg)));

    const seen = new Set();
    let merged = [];
    resultados.forEach(({ items }) =>
      items.forEach(i => {
        const k = i.id || i.numero_controle_pncp;
        if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
      })
    );

    const totalEst = resultados[0]?.total || merged.length;

    return res.status(200).json({
      data:           merged,
      totalRegistros: totalEst,
      totalPaginas:   Math.ceil(totalEst / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
