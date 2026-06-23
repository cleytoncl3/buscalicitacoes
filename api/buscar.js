export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1,
    modalidade = '', dataInicial = '', dataFinal = '', portal = ''
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  const keywords = palavraChave
    ? palavraChave.split(';').map(k => k.trim()).filter(Boolean)
    : [''];
  const ufs     = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean)        : [];
  const mods    = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const portais = portal    ? portal.split(',').map(p => p.trim()).filter(Boolean)     : [];

  // ── fetch com retry simples ──────────────────────────────────────
  const fetchJSON = async (url) => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
        });
        return JSON.parse(await r.text());
      } catch {
        if (i < 2) await new Promise(r => setTimeout(r, 600));
      }
    }
    return null;
  };

  // ── monta URL do PNCP ───────────────────────────────────────────
  // Todos os filtros possíveis são passados pro PNCP.
  // O que ele aceitar → filtrado server-side (consistente).
  // O que ignorar     → filtrado client-side na mesma página.
  const buildUrl = (kw, paginaReq) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',          // mais recentes primeiro
      status: 'recebendo_proposta',
      pagina: paginaReq,
      tam_pagina: TAM,
    });
    if (kw) p.append('q', kw);
    ufs.forEach(u   => p.append('ufs',      u));   // PNCP aceita múltiplos
    mods.forEach(m  => p.append('modalidade', m));  // tenta server-side
    portais.forEach(pt => p.append('esfera', pt));  // tenta server-side (F/E/M)
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // ── filtros client-side (garante mesmo que PNCP ignore) ─────────
  const filtrarData = (items) => {
    if (!dataInicial && !dataFinal) return items;
    const dI = dataInicial ? new Date(dataInicial)               : null;
    const dF = dataFinal   ? new Date(dataFinal + 'T23:59:59')   : null;
    return items.filter(i => {
      const ab = i.data_inicio_vigencia ? new Date(i.data_inicio_vigencia) : null;
      if (!ab) return true;
      if (dI && ab < dI) return false;
      if (dF && ab > dF) return false;
      return true;
    });
  };

  const filtrarPortal = (items) =>
    portais.length ? items.filter(i => portais.includes(String(i.esfera_id || ''))) : items;

  const filtrarMod = (items) =>
    mods.length ? items.filter(i => mods.includes(String(i.modalidade_licitacao_id || ''))) : items;

  // ── aplica todos os filtros client-side ──────────────────────────
  const aplicar = (items) => filtrarData(filtrarPortal(filtrarMod(items)));

  try {
    // ══════════════════════════════════════════════════════════════
    // KEYWORD ÚNICO → UMA query PNCP, paginação nativa
    // Igual ao SigaPregão: mesma query = mesmo resultado estável
    // ══════════════════════════════════════════════════════════════
    if (keywords.length === 1) {
      const data  = await fetchJSON(buildUrl(keywords[0], pg));
      const raw   = data?.items || [];
      const total = data?.total  || 0;
      const items = aplicar(raw);   // filtra a página atual

      return res.status(200).json({
        data: items,
        totalRegistros: total,        // total do PNCP (estável, sem filtragem dupla)
        totalPaginas: Math.ceil(total / TAM) || 1,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // MÚLTIPLOS KEYWORDS → uma query por keyword, merge, paginação
    // client-side (único caso onde multi-query é necessário)
    // ══════════════════════════════════════════════════════════════
    const results = await Promise.all(
      keywords.slice(0, 5).map(kw => fetchJSON(buildUrl(kw, 1)))
    );

    const seen = new Set();
    let merged = [];
    results.forEach(d =>
      (d?.items || []).forEach(i => {
        const k = i.id || i.numero_controle_pncp;
        if (k && !seen.has(k)) { seen.add(k); merged.push(i); }
      })
    );

    const filtered = aplicar(merged);
    const total    = filtered.length;
    const ini      = (pg - 1) * TAM;

    return res.status(200).json({
      data: filtered.slice(ini, ini + TAM),
      totalRegistros: total,
      totalPaginas: Math.ceil(total / TAM) || 1,
    });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
