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
  const hoje  = new Date();
  hoje.setHours(0, 0, 0, 0);

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

  const buildUrl = (kw, paginaReq, tamPagina = TAM) => {
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
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // Filtra itens pelo prazo de recebimento de propostas (data_fim_vigencia)
  const filtrarPorData = (items) => {
    return items.filter(item => {
      const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
      if (!fim) return false;
      if (fim < hoje) return false;                 // proposta já encerrada
      if (dtIni && fim < dtIni) return false;
      if (dtFim && fim > dtFim) return false;
      return true;
    });
  };

  // Com filtro de datas: over-fetch 10 páginas e filtra por data_fim_vigencia
  const buscarComFiltroData = async (kw) => {
    const primeiro = await fetchJSON(buildUrl(kw, 1, 50));
    if (!primeiro) return { items: [], total: 0 };

    const totalPncp = primeiro.total || 0;
    // Busca mais 2 páginas em paralelo (total 150 itens) — suficiente para
    // capturar licitações com prazo ativo publicadas nos últimos ~2 meses.
    let allItems = [...(primeiro.items || [])];

    if (totalPncp > 50) {
      const extras = await Promise.all([
        fetchJSON(buildUrl(kw, 2, 50)),
        fetchJSON(buildUrl(kw, 3, 50)),
      ]);
      extras.forEach(d => { if (d?.items) allItems = allItems.concat(d.items); });
    }

    return { items: filtrarPorData(allItems), total: totalPncp };
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

    // COM filtro de datas: over-fetch e filtra por data_fim_vigencia
    const kwList = keywords.slice(0, 5);
    const resultados = await Promise.all(kwList.map(kw => buscarComFiltroData(kw)));

    const seen = new Set();
    let merged = [];
    resultados.forEach(({ items }) =>
      items.forEach(i => {
        const k = i.id || i.numero_controle_pncp;
        if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
      })
    );

    // Ordena por data_fim_vigencia crescente (mais urgente primeiro)
    merged.sort((a, b) => {
      const fa = a.data_fim_vigencia ? new Date(a.data_fim_vigencia) : Infinity;
      const fb = b.data_fim_vigencia ? new Date(b.data_fim_vigencia) : Infinity;
      return fa - fb;
    });

    const total = merged.length;
    const inicio = (pg - 1) * TAM;
    const pagina_items = merged.slice(inicio, inicio + TAM);

    return res.status(200).json({
      data:           pagina_items,
      totalRegistros: total,
      totalPaginas:   Math.ceil(total / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
