export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1,
    modalidade = '', dataInicial = '', dataFinal = '',
    status = 'recebendo_proposta', esfera = '',
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  // Cada keyword separada por ";" vira uma busca de frase exata automaticamente:
  // "bobina papel kraft" ou bobina papel kraft → enviado como "bobina papel kraft" pro PNCP
  // Palavra única → sem aspas (não precisa)
  // Já entre aspas → mantém como está
  const wrapFrase = (kw) => {
    kw = kw.trim();
    if (!kw) return kw;
    if (kw.startsWith('"') && kw.endsWith('"')) return kw; // já tem aspas
    if (kw.includes(' ')) return `"${kw}"`; // multi-palavra → adiciona aspas
    return kw; // palavra única → sem aspas
  };

  const keywords = palavraChave
    ? palavraChave.split(';').map(k => wrapFrase(k)).filter(Boolean)
    : [''];
  const ufs     = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods    = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const esferas = esfera    ? esfera.split(',').map(e => e.trim()).filter(Boolean) : [];

  const statusValidos = ['recebendo_proposta','propostas_encerradas','encerradas','todos'];
  const statusFinal   = statusValidos.includes(status) ? status : 'recebendo_proposta';

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

  // Parâmetros corretos do PNCP:
  // ✅ modalidades (plural) com pipe  ✅ ufs com pipe  ✅ ordenacao=-data
  const buildUrl = (kw, paginaReq) => {
    const p = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao:       '-data',
      status:          statusFinal,
      pagina:          paginaReq,
      tam_pagina:      TAM,
    });
    if (kw)             p.append('q',           kw);
    if (ufs.length)     p.append('ufs',         ufs.join('|'));
    if (mods.length)    p.append('modalidades', mods.join('|'));
    if (esferas.length) p.append('esferas',     esferas.join('|'));
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // Filtro de data client-side (PNCP não suporta este filtro na /api/search/)
  // Lógica: inclui licitação se ela for RELEVANTE no período selecionado
  // Filtra pela DATA DE ENCERRAMENTO DE PROPOSTAS (data_fim_vigencia)
  // Lógica: o usuário quer ver licitações cujo prazo de proposta cai dentro do período
  // Ex: "Próximos 30 dias" = propostas que encerram nos próximos 30 dias (urgência)
  // Isso é estável porque licitações abertas têm data_fim_vigencia no futuro próximo
  const filtrarData = (items) => {
    if (!dataInicial && !dataFinal) return items;
    const dI = dataInicial ? new Date(dataInicial + 'T00:00:00') : null;
    const dF = dataFinal   ? new Date(dataFinal   + 'T23:59:59') : null;
    return items.filter(i => {
      const fim = i.data_fim_vigencia ? new Date(i.data_fim_vigencia) : null;
      if (!fim) return true;                  // sem data de encerramento: inclui
      if (dI && fim < dI) return false;       // encerra antes do período: fora
      if (dF && fim > dF) return false;       // encerra depois do período: fora
      return true;
    });
  };

  try {
    // ════════════════════════════════════════════════════════════
    // KEYWORD ÚNICO — paginação nativa do PNCP sempre
    // Simples, estável e nunca quebra
    // ════════════════════════════════════════════════════════════
    if (keywords.length === 1) {
      const data  = await fetchJSON(buildUrl(keywords[0], pg));
      const raw   = data?.items || [];
      const total = data?.total  || 0;

      return res.status(200).json({
        data:           filtrarData(raw),   // filtro de data na página atual
        totalRegistros: total,              // total real do PNCP
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
