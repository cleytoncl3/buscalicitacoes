// api/itens.js — itens + UASG + número Comprasnet via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj, ano, sequencial } = req.query;
  if (!cnpj || !ano || !sequencial)
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, sequencial' });

  const seq      = parseInt(sequencial);
  const seqOrgao = req.query.seqOrgao ? parseInt(req.query.seqOrgao) : 1;
  const base     = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  const baseAlt  = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/unidades/${seqOrgao}/compras/${ano}/${seq}`;
  const hdrs     = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

  const fetchSafe = async (url, opts = {}) => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(url, { headers: hdrs, signal: ctrl.signal, ...opts });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      return null;
    }
  };

  try {
    const numeroControle = `${cnpj}-${seqOrgao}-${String(seq).padStart(6, '0')}/${ano}`;
    const searchUrl = `https://pncp.gov.br/api/search/?tipos_documento=edital&q=${encodeURIComponent(numeroControle)}&tam_pagina=1`;

    // Testa também o endpoint principal com redirect:follow para ver para onde vai
    const [itensRes, searchRes, detalheAltRes, detalheBaseRes] = await Promise.all([
      fetchSafe(`${base}/itens?pagina=1&tamanhoPagina=100`),
      fetchSafe(searchUrl),
      fetchSafe(baseAlt),
      fetchSafe(base, { redirect: 'follow' }),
    ]);

    // Debug: captura corpo bruto de cada endpoint
    const _debug = {};

    // Endpoint base (com redirect follow)
    try {
      if (detalheBaseRes) {
        _debug.baseStatus = detalheBaseRes.status;
        _debug.baseUrl    = detalheBaseRes.url; // URL final após redirect
        const txt = await detalheBaseRes.text();
        try { _debug.baseBody = JSON.parse(txt); } catch { _debug.baseBodyRaw = txt.slice(0, 500); }
      }
    } catch(e) { _debug.baseErr = e.message; }

    // Endpoint alternativo (unidades/{seqOrgao})
    try {
      if (detalheAltRes) {
        _debug.altStatus = detalheAltRes.status;
        _debug.altUrl    = detalheAltRes.url;
        const txt = await detalheAltRes.text();
        try { _debug.altBody = JSON.parse(txt); } catch { _debug.altBodyRaw = txt.slice(0, 500); }
      }
    } catch(e) { _debug.altErr = e.message; }

    // Processa itens
    let itensList = [];
    let uasgDoItem = null;
    try {
      if (itensRes) {
        const raw    = await itensRes.text();
        const parsed = JSON.parse(raw);
        itensList = Array.isArray(parsed) ? parsed : (parsed.data || []);
        if (itensList.length > 0) {
          uasgDoItem = itensList[0].unidadeRequisitante?.codigoUnidade
            || itensList[0].codigoUnidadeRequisitante
            || null;
        }
      }
    } catch {}

    // Tenta extrair número Comprasnet do endpoint alternativo
    let numCompraDetalhe = null, anoCompraDetalhe = null;
    const altBody = _debug.altBody;
    try {
      if (altBody && _debug.altStatus === 200) {
        const di = Array.isArray(altBody) ? altBody[0] : altBody;
        numCompraDetalhe = di?.numeroCompra || di?.numero_compra || null;
        anoCompraDetalhe = di?.anoCompra    || di?.ano_compra    || null;
        _debug.numCompraDetalhe = numCompraDetalhe;
      }
    } catch {}

    // Tenta número do endpoint base após redirect
    let numCompraBase = null;
    const baseBody = _debug.baseBody;
    try {
      if (baseBody && _debug.baseStatus === 200) {
        const di = Array.isArray(baseBody) ? baseBody[0] : baseBody;
        numCompraBase = di?.numeroCompra || di?.numero_compra || null;
        _debug.numCompraBase = numCompraBase;
      }
    } catch {}

    // Extrai info do órgão via search API
    let orgaoInfo = null;
    try {
      if (searchRes && searchRes.ok) {
        const sd   = await searchRes.json();
        const item = sd?.items?.[0];
        _debug.searchItem = item ? Object.keys(item).reduce((o, k) => {
          // Inclui apenas campos potencialmente relevantes para debug
          if (['numero_compra','numero_sequencial_compra','link_sistema_origem','linkSistemaOrigem',
               'unidade_codigo','unidade_nome','ano','numeroCompra','codigoCompra','numero_edital'].includes(k))
            o[k] = item[k];
          return o;
        }, {}) : null;

        if (item) {
          const codUnidade  = item.unidade_codigo || item.codigo_unidade || uasgDoItem;
          const nomeUnidade = item.unidade_nome || null;
          const linkOrigem  = item.link_sistema_origem || item.linkSistemaOrigem || null;

          let numeroComprasnet = null, anoComprasnet = null;
          if (linkOrigem) {
            const m = linkOrigem.match(/compra=(\d+)/);
            if (m && m[1].length >= 13) {
              numeroComprasnet = parseInt(m[1].substring(8, 13)).toString();
              anoComprasnet    = m[1].substring(13, 17) || null;
            }
          }

          const numCompraSearch = item.numero_compra || item.numero_sequencial_compra || null;

          orgaoInfo = {
            codigoUnidade:     codUnidade || null,
            nomeUnidade:       nomeUnidade || null,
            linkSistemaOrigem: linkOrigem,
            numeroCompra:      numCompraDetalhe || numCompraBase || numeroComprasnet || numCompraSearch || null,
            anoCompra:         anoCompraDetalhe || anoComprasnet || item.ano || null,
            uasgLabel: codUnidade && nomeUnidade ? `${codUnidade} - ${nomeUnidade}` : nomeUnidade || null,
            _debug,
          };
        }
      }
    } catch {}

    if (!orgaoInfo) orgaoInfo = { _debug };

    return res.status(200).json({ data: itensList, total: itensList.length, orgaoInfo });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
