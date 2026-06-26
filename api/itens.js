// api/itens.js — itens + UASG (codigoUnidade) via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj, ano, sequencial } = req.query;
  if (!cnpj || !ano || !sequencial)
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, sequencial' });

  const base = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${parseInt(sequencial)}`;
  const hdrs = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };

  try {
    // Busca itens e detalhe (UASG) em paralelo
    const [itensRes, detalheRes] = await Promise.all([
      fetch(`${base}/itens?pagina=1&tamanhoPagina=100`, { headers: hdrs }),
      fetch(base, { headers: hdrs })
    ]);

    // Processa itens
    let itensList = [];
    try {
      const raw = await itensRes.text();
      const parsed = JSON.parse(raw);
      itensList = Array.isArray(parsed) ? parsed : (parsed.data || []);
    } catch {}

    // Processa detalhe para extrair UASG / codigoUnidade
    let orgaoInfo = null;
    if (detalheRes.ok) {
      try {
        const d = await detalheRes.json();
        const codUnidade = d.unidadeOrgao?.codigoUnidade;
        const nomeUnidade = d.unidadeOrgao?.nomeUnidade || d.orgaoEntidade?.razaoSocial;
        const linkOrigem = d.linkSistemaOrigem || null;
        // Extrai número real do Comprasnet da URL do sistema de origem
        // Formato: ...?compra=UASG(6)+MOD(2)+NUM(5)+ANO(4) = 17 dígitos
        let numeroComprasnet = null, anoComprasnet = null;
        if (linkOrigem) {
          const m = linkOrigem.match(/compra=(\d{17})/);
          if (m) {
            numeroComprasnet = parseInt(m[1].substring(8, 13)).toString();
            anoComprasnet    = m[1].substring(13);
          }
        }

        orgaoInfo = {
          codigoUnidade:     codUnidade || null,
          nomeUnidade:       nomeUnidade || null,
          cnpj:              d.orgaoEntidade?.cnpj || cnpj,
          linkSistemaOrigem: linkOrigem,
          numeroCompra:      numeroComprasnet || d.numeroCompra || null,
          anoCompra:         anoComprasnet || d.anoCompra || null,
          uasgLabel: codUnidade && nomeUnidade ? `${codUnidade} - ${nomeUnidade}` : nomeUnidade || null,
        };
      } catch {}
    }

    return res.status(200).json({ data: itensList, total: itensList.length, orgaoInfo });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
