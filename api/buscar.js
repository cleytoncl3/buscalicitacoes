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

  const buildUrl = (kw, paginaReq) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao:       '-data',
      pagina:          paginaReq,
      tam_pagina:      TAM,
    });
    if (kw)             p.append('q',           kw);
    if (ufs.length)     p.append('ufs',         ufs.join('|'));
    if (mods.length)    p.append('modalidades', mods.join('|'));
    if (esferas.length) p.append('esferas',     esferas.join('|'));
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // Filtro de data aplicado sobre itens já buscados do PNCP.
  // Filtra pela DATA DE ABERTURA DAS PROPOSTAS (data_inicio_vigencia),
  // igual ao tipoPeriodo:"abertura" do SigaPregão — campo correto.
  const filtrarData = (items) => {
    if (!comFiltroData) return items;
    const dI = dataInicial ? new Date(dataInicial + 'T00:00:00') : null;
    const dF = dataFinal   ? new Date(dataFinal   + 'T23:59:59') : null;
    return items.filter(i => {
      const abertura = i.data_inicio_vigencia ? new Date(i.data_inicio_vigencia) : null;
      if (!abertura) return false;
      if (dI && abertura < dI) return false;
      if (dF && abertura > dF) return false;
      return true;
    });
  };

  try {
    // ════════════════════════════════════════════════════════════
    // COM FILTRO DE DATA — over-fetch: busca 5 páginas em paralelo,
    // filtra por data_fim_vigencia, retorna paginação real dos filtrados.
    // Isso resolve dois bugs de uma vez:
    //   1) encerradas não aparecem (data_fim_vigencia fora do intervalo)
    //   2) paginação correta (total = itens filtrados, não total do PNCP)
    // ════════════════════════════════════════════════════════════
    if (comFiltroData && keywords.length === 1) {
      const OVERFETCH = 5; // 5 páginas × 20 = 100 itens do PNCP
      const pageNums  = Array.from({ length: OVERFETCH }, (_, i) => i + 1);
      const results   = await Promise.all(pageNums.map(n => fetchJSON(buildUrl(keywords[0], n))));

      const seen = new Set();
      const all  = [];
      for (const d of results) {
        for (const item of (d?.items || [])) {
          const k = item.id || item.numero_controle_pncp;
          if (k && !seen.has(k)) { seen.add(k); all.push(item); }
        }
      }

      const filtered   = filtrarData(all);
      const start      = (pg - 1) * TAM;
      const pageItems  = filtered.slice(start, start + TAM);

      return res.status(200).json({
        data:           pageItems,
        totalRegistros: filtered.length,
        totalPaginas:   Math.ceil(filtered.length / TAM) || 1,
      });
    }

    // ════════════════════════════════════════════════════════════
    // SEM FILTRO DE DATA, KEYWORD ÚNICO — paginação nativa do PNCP
    // ════════════════════════════════════════════════════════════
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

    // ════════════════════════════════════════════════════════════
    // MÚLTIPLOS KEYWORDS (;) — uma query por keyword, merge
    // ════════════════════════════════════════════════════════════
    const results = await Promise.all(
      keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, pg)))
    );

    const seen   = new Set();
    let   merged = [];
    results.forEach(d =>
      (d?.items || []).forEach(i => {
        const k = i.id || i.numero_controle_pncp;
        if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
      })
    );

    const filtered  = filtrarData(merged);
    const totalEst  = results[0]?.total || filtered.length;

    return res.status(200).json({
      data:           filtered,
      totalRegistros: totalEst,
      totalPaginas:   Math.ceil(totalEst / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
