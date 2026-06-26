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
    // Busca itens e detalhe em paralelo
    const [itensRes, detalheRes] = await Promise.all([
      fetch(`${base}/itens?pagina=1&tamanhoPagina=100`, { headers: hdrs }),
      fetch(base, { headers: hdrs }),
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

    // Processa detalhe
    let orgaoInfo = null;
    const detalheStatus = detalheRes.status;

    if (detalheRes.ok) {
      try {
        const d = await detalheRes.json();
        const codUnidade = d.unidadeOrgao?.codigoUnidade || uasgDoItem;
        const nomeUnidade = d.unidadeOrgao?.nomeUnidade || d.orgaoEntidade?.razaoSocial;
        const linkOrigem  = d.linkSistemaOrigem || null;

        // Extrai número Comprasnet da URL (formato: ?compra=UASG6+MOD2+NUM5+ANO4)
        let numeroComprasnet = null, anoComprasnet = null;
        if (linkOrigem) {
          const m = linkOrigem.match(/compra=(\d+)/);
          if (m && m[1].length >= 13) {
            numeroComprasnet = parseInt(m[1].substring(8, 13)).toString();
            anoComprasnet    = m[1].substring(13, 17) || null;
          }
        }

        orgaoInfo = {
          codigoUnidade:    codUnidade || null,
          nomeUnidade:      nomeUnidade || null,
          cnpj:             d.orgaoEntidade?.cnpj || cnpj,
          linkSistemaOrigem: linkOrigem,
          numeroCompraPNCP: d.numeroCompra || null,
          numeroCompra:     numeroComprasnet || null,
          anoCompra:        anoComprasnet || d.anoCompra || null,
          uasgLabel: codUnidade && nomeUnidade ? `${codUnidade} - ${nomeUnidade}` : nomeUnidade || null,
        };
      } catch {}
    } else {
      // Detalhe falhou — tenta endpoint alternativo (unidades)
      try {
        const altRes = await fetch(
          `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=1&tamanhoPagina=1`,
          { headers: hdrs }
        );
        if (altRes.ok) {
          const altData = await altRes.json();
          const firstItem = Array.isArray(altData) ? altData[0] : (altData.data||[])[0];
          const codAlt = firstItem?.unidadeRequisitante?.codigoUnidade
            || firstItem?.codigoUnidadeRequisitante
            || uasgDoItem;
          const nomeAlt = firstItem?.unidadeRequisitante?.nomeUnidade || null;
          if (codAlt) {
            orgaoInfo = {
              codigoUnidade: codAlt,
              nomeUnidade: nomeAlt,
              uasgLabel: nomeAlt ? `${codAlt} - ${nomeAlt}` : String(codAlt),
              linkSistemaOrigem: null,
              numeroCompra: null,
              anoCompra: null,
              _detalheStatus: detalheStatus,
            };
          }
        }
      } catch {}

      // Ainda null — retorna ao menos o status para debug
      if (!orgaoInfo) {
        orgaoInfo = { _detalheStatus: detalheStatus, _debug: `detalhe falhou: ${detalheStatus}` };
      }
    }

    return res.status(200).json({ data: itensList, total: itensList.length, orgaoInfo });

  } catch (err) {
    return res.status(500).json({ erro: err.message });
  }
}
