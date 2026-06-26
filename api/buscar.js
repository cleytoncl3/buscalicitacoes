export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    palavraChave = '', uf = '', pagina = 1,
    modalidade = '', dataInicial = '', dataFinal = '',
    esfera = '',
  } = req.query;

  const pg  = parseInt(pagina) || 1;
  const TAM = 20;

  // Busca com aspas só quando o usuário colocou aspas explicitamente.
  // Palavra única ou frase SEM aspas → enviada sem aspas para o PNCP
  // fazer uma busca de proximidade ampla (inclui variações morfológicas).
  // Frase JÁ entre aspas → mantém aspas (busca exata pelo usuário).
  const wrapFrase = (kw) => {
    kw = kw.trim();
    if (!kw) return kw;
    if (kw.startsWith('"') && kw.endsWith('"')) return kw; // usuário pediu exata
    return kw; // sem aspas → PNCP faz busca ampla (encontra mais resultados)
  };

  const keywords = palavraChave
    ? palavraChave.split(';').map(k => wrapFrase(k)).filter(Boolean)
    : [''];
  const ufs     = uf        ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const mods    = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];
  const esferas = esfera    ? esfera.split(',').map(e => e.trim()).filter(Boolean) : [];

  // Status: sem filtro de status por padrão → retorna todas (abertas + encerradas).
  // Equivalente ao SigaPregão que exibe todas as licitações do período.
  // O filtro de datas client-side já reduz ao período desejado.

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

  const comFiltroData = !!(dataInicial || dataFinal);

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
    // Quando o usuário filtra por período, limita ao PNCP só licitações abertas.
    // Isso resolve dois problemas ao mesmo tempo:
    // 1) Elimina encerradas que não deveriam aparecer no período selecionado
    // 2) Reduz o total de ~943 para ~40, corrigindo a paginação quebrada
    //    (paginação server-side + filtro client-side eram incompatíveis)
    if (comFiltroData) p.append('status', 'recebendo_proposta');
    return `https://pncp.gov.br/api/search/?${p}`;
  };

  // Filtro de data client-side (segunda passagem, sobre itens já abertos do PNCP)
  // Filtra pela DATA DE ENCERRAMENTO DE PROPOSTAS (data_fim_vigencia)
  // Ex: "Próximos 30 dias" = propostas que encerram nos próximos 30 dias
  const filtrarData = (items) => {
    if (!comFiltroData) return items;
    const dI = dataInicial ? new Date(dataInicial + 'T00:00:00') : null;
    const dF = dataFinal   ? new Date(dataFinal   + 'T23:59:59') : null;
    return items.filter(i => {
      const fim = i.data_fim_vigencia ? new Date(i.data_fim_vigencia) : null;
      if (!fim) return false;                 // sem data de encerramento: exclui
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
