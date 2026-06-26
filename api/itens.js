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
    const numeroControle = `${cnpj}-1-${String(seq).padStart(6,'0')}/${ano}`;
    const searchUrl   = `https://pncp.gov.br/api/search/?tipos_documento=edital&q=${encodeURIComponent(numeroControle)}&tam_pagina=1`;
    // Endpoint consulta usado pela interface do PNCP
    const consultaUrl = `https://pncp.gov.br/api/pncp/v1/contratacoes/publicacao?numeroCnpj=${cnpj}&anoCompra=${ano}&sequencialCompra=${seq}`;

    const [itensRes, searchRes, consultaRes] = await Promise.all([
      fetch(`${base}/itens?pagina=1&tamanhoPagina=100`, { headers: hdrs }),
      fetch(searchUrl, { headers: hdrs }),
      fetch(consultaUrl, { headers: hdrs }),
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

          // Tenta número Comprasnet via endpoint consulta
          let numCompraSearch = null, anoCompraConsulta = null;
          try {
            if (consultaRes.ok) {
              const cd = await consultaRes.json();
              const ci = Array.isArray(cd) ? cd[0] : cd;
              numCompraSearch  = ci?.numeroCompra || ci?.numero_compra || null;
              anoCompraConsulta = ci?.anoCompra   || ci?.ano_compra   || null;
            }
          } catch {}
          // Fallback: campo direto do item da search
          if (!numCompraSearch) numCompraSearch = item.numero_compra || item.numero_sequencial_compra || null;

          orgaoInfo = {
            codigoUnidade:    codUnidade || null,
            nomeUnidade:      nomeUnidade || null,
            linkSistemaOrigem: linkOrigem,
            numeroCompra:     numeroComprasnet || numCompraSearch || null,
            anoCompra:        anoComprasnet || anoCompraConsulta || item.ano || null,
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
