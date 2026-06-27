// api/itens.js — itens + UASG + número Comprasnet via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj, ano, sequencial } = req.query;
  if (!cnpj || !ano || !sequencial)
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, sequencial' });

  const seq      = parseInt(sequencial);
  const seqOrgao = req.query.seqOrgao ? parseInt(req.query.seqOrgao) : 1;
  // Endpoint correto: /api/consulta/v1/ (o antigo /api/pncp/v1/ retorna 301)
  const baseConsulta = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  const baseItens    = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  const hdrs         = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

  const fetchSafe = async (url) => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(url, { headers: hdrs, signal: ctrl.signal });
      clearTimeout(timer);
      return r;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  try {
    const numeroControle = `${cnpj}-${seqOrgao}-${String(seq).padStart(6, '0')}/${ano}`;
    const searchUrl = `https://pncp.gov.br/api/search/?tipos_documento=edital&q=${encodeURIComponent(numeroControle)}&tam_pagina=1`;

    const [itensRes, searchRes, consultaRes] = await Promise.all([
      fetchSafe(`${baseItens}/itens?pagina=1&tamanhoPagina=100`),
      fetchSafe(searchUrl),
      fetchSafe(baseConsulta),
    ]);

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

    // Extrai número Comprasnet do endpoint correto (/api/consulta/v1/)
    let numCompraDetalhe = null, anoCompraDetalhe = null;
    try {
      if (consultaRes && consultaRes.ok) {
        const cd = await consultaRes.json();
        const ci = Array.isArray(cd) ? cd[0] : cd;
        numCompraDetalhe = ci?.numeroCompra  || ci?.numero_compra  || null;
        anoCompraDetalhe = ci?.anoCompra     || ci?.ano_compra     || null;
      }
    } catch {}

    // Extrai info do órgão via search API
    let orgaoInfo = null;
    try {
      if (searchRes && searchRes.ok) {
        const sd   = await searchRes.json();
        const item = sd?.items?.[0];
        if (item) {
          const codUnidade  = item.unidade_codigo || item.codigo_unidade || uasgDoItem;
          const nomeUnidade = item.unidade_nome || null;
          const linkOrigem  = item.link_sistema_origem || item.linkSistemaOrigem || null;

          // Tenta número Comprasnet via URL (formato: ?compra=UASG6+MOD2+NUM5+ANO4)
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
            numeroCompra:      numCompraDetalhe || numeroComprasnet || numCompraSearch || null,
            anoCompra:         anoCompraDetalhe || anoComprasnet || item.ano || null,
            uasgLabel: codUnidade && nomeUnidade ? `${codUnidade} - ${nomeUnidade}` : nomeUnidade || null,
          };
        }
      }
    } catch {}

    return res.status(200).json({ data: itensList, total: itensList.length, orgaoInfo });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
