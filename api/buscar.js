export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', pagina = 1, modalidade = '', status = '', dataInicial = '', dataFinal = '' } = req.query;

  // Parse inputs
  const baseKeywords = palavraChave ? palavraChave.split(';').map(k => k.trim()).filter(Boolean) : [''];
  const ufs = uf ? uf.split(',').map(u => u.trim()).filter(Boolean) : [];
  const modalidades = modalidade ? modalidade.split(',').map(m => m.trim()).filter(Boolean) : [];

  // Expansão de palavras-chave: "papel kraft" → busca "papel kraft" (prioridade 1) + "kraft" (prioridade 2)
  const keywords = [];
  const seenKw = new Set();
  for (const kw of baseKeywords) {
    if (kw && !seenKw.has(kw.toLowerCase())) {
      keywords.push({ q: kw, priority: 1 });
      seenKw.add(kw.toLowerCase());
    }
    // Palavras individuais de keyword multi-palavra como busca secundária
    const words = kw.trim().split(/\s+/).filter(w => w.length > 3);
    if (words.length > 1) {
      for (const word of words) {
        if (!seenKw.has(word.toLowerCase())) {
          keywords.push({ q: word, priority: 2 });
          seenKw.add(word.toLowerCase());
        }
      }
    }
  }

  const buildUrl = (kw, ufItem) => {
    const params = new URLSearchParams({
      tipos_documento: 'edital',
      ordenacao: '-data',
      pagina: 1,
      tam_pagina: 20,
    });
    // Só passa status para o PNCP quando é recebendo_proposta (único reconhecido)
    if (status === 'recebendo_proposta') params.append('status', 'recebendo_proposta');
    if (kw) params.append('q', kw);
    if (ufItem) params.append('ufs', ufItem);
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
        combinations.push({ q: kw.q, priority: kw.priority, uf: ufItem });
      }
    }
    // Limita a 15 combinações para não sobrecarregar
    const limited = combinations.slice(0, 15);

    const results = await Promise.all(
      limited.map(c => fetchComRetry(buildUrl(c.q, c.uf)).then(data => ({ data, priority: c.priority })).catch(() => ({ data: null, priority: c.priority })))
    );

    // Merge com prioridade: frases completas primeiro, palavras individuais depois
    const seen = new Set();
    let items = [];
    for (const priority of [1, 2]) {
      results.filter(r => r.priority === priority).forEach(r => {
        if (!r.data) return;
        (r.data.items || []).forEach(item => {
          const key = item.id || item.numero_controle_pncp;
          if (!seen.has(key)) { seen.add(key); items.push(item); }
        });
      });
    }

    const totalBase = results.find(r => r.priority === 1)?.data?.total || 0;

    // Filtro por MODALIDADE (client-side)
    if (modalidades.length > 0) {
      items = items.filter(item => {
        const mid = String(item.modalidade_licitacao_id || '');
        return modalidades.includes(mid);
      });
    }

    // Filtro por STATUS (client-side garantido)
    const agora = new Date();
    if (status === 'encerrada') {
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        return fim && agora > fim;
      });
    } else if (status === 'em_julgamento') {
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        const ini = item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null;
        return fim && ini && agora > fim;
      });
    } else if (status === 'recebendo_proposta') {
      items = items.filter(item => {
        const fim = item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null;
        return !fim || agora <= fim;
      });
    }
    // status vazio = todos

    // Filtro por DATA de abertura
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

    const hasClientFilter = modalidades.length > 0 || (status && status !== 'recebendo_proposta') || dataInicial || dataFinal || keywords.some(k => k.priority === 2) || ufs.length > 1;

    return res.status(200).json({
      data: items,
      totalRegistros: hasClientFilter ? items.length : totalBase,
      totalPaginas: hasClientFilter ? Math.ceil(items.length / 20) : Math.ceil(totalBase / 20)
    });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
