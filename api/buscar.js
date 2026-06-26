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
    // Passa datas para o PNCP filtrar server-side (tipoPeriodo abertura)
    if (dataInicial)    p.append('dataInicial', dataInicial);
    if (dataFinal)      p.append('dataFinal',   dataFinal);
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  try {
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

    // MÚLTIPLOS KEYWORDS (;)
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

    const totalEst = results[0]?.total || merged.length;

    return res.status(200).json({
      data:           merged,
      totalRegistros: totalEst,
      totalPaginas:   Math.ceil(totalEst / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
