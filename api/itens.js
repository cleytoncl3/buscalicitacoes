// api/itens.js — itens + UASG via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj, ano, sequencial } = req.query;
  if (!cnpj || !ano || !sequencial)
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, sequencial' });

  const seq  = parseInt(sequencial);
  const base = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}`;
  const hdrs = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

  try {
    // Busca itens e info do órgão em paralelo
    // O endpoint de detalhe retorna 301 — usamos a search API como fallback
    const numeroControle = `${cnpj}-1-${String(seq).padStart(6,'0')}/${ano}`;
    const searchUrl = `https://pncp.gov.br/api/search/?tipos_documento=edital&q=${encodeURIComponent(numeroControle)}&tam_pagina=1`;

    const [itensRes, searchRes] = await Promise.all([
      fetch(`${base}/itens?pagina=1&tamanhoPagina=100`, { headers: hdrs }),
      fetch(searchUrl, { headers: hdrs }),
    ]);

    // Processa itens
    let itensList = [];
    let uasgDoItem = null;
    try {
      const raw = await itensRes.text();
      const parsed = JSON.parse(raw);
      itensList = Array.isArray(parsed) ? parsed : (parsed.data || []);
      // Alguns itens do PNCP trazem codigoUnidadeRequisitante
      if (itensList.length > 0) {
        uasgDoItem = itensList[0].unidadeRequisitante?.codigoUnidade
          || itensList[0].codigoUnidadeRequisitante
          || null;
      }
    } catch {}

    // Extrai info do órgão via search API
    let orgaoInfo = null;
    try {
      if (searchRes.ok) {
        const sd = await searchRes.json();
        const item = sd?.items?.[0];
        if (item) {
          const codUnidade = item.unidade_codigo || item.codigo_unidade || uasgDoItem;
          const nomeUnidade = item.unidade_nome || null;
          const linkOrigem  = item.link_sistema_origem || item.linkSistemaOrigem || null;

          // Extrai número Comprasnet da URL (formato: ?compra=UASG6+MOD2+NUM5+ANO4)
          let numeroComprasnet = null, anoComprasnet = null;
          if (linkOrigem) {
            const m = linkOrigem.match(/compra=(\d+)/);
            if (m && m[1].length >= 13) {
              numeroComprasnet = parseInt(m[1].substring(8, 13)).toString();
              anoComprasnet    = m[1].substring(13, 17) || null;
            }
          }

          // Debug: retorna todos os campos do item da search para inspeção
          orgaoInfo = {
            codigoUnidade:    codUnidade || null,
            nomeUnidade:      nomeUnidade || null,
            linkSistemaOrigem: linkOrigem,
            numeroCompra:     numeroComprasnet || null,
            anoCompra:        anoComprasnet || null,
            uasgLabel: codUnidade && nomeUnidade ? `${codUnidade} - ${nomeUnidade}` : nomeUnidade || null,
            _searchFields: Object.keys(item), // debug: lista campos disponíveis
          };
        }
      }
    } catch {}

    return res.status(200).json({ data: itensList, total: itensList.length, orgaoInfo });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
