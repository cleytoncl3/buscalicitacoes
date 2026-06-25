// api/portal.js — busca portal de origem de uma licitação via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj, ano, seq } = req.query;
  if (!cnpj || !ano || !seq) return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, seq' });
  try {
    const r = await fetch(
      `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${parseInt(seq)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!r.ok) return res.status(404).json({ erro: 'Não encontrado' });
    const d = await r.json();
    return res.status(200).json({
      linkSistemaOrigem: d.linkSistemaOrigem || null,
      nomePortal: detectarPortal(d.linkSistemaOrigem),
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

function detectarPortal(link) {
  if (!link) return null;
  const l = link.toLowerCase();
  if (l.includes('comprasnet') || l.includes('compras.gov') || l.includes('comprasgovernamentais')) return 'Compras.gov.br';
  if (l.includes('bll.org') || l.includes('bllcompras')) return 'BLL Compras';
  if (l.includes('portaldecompraspublicas') || l.includes('pcp.')) return 'Portal de Compras Públicas';
  if (l.includes('licitacoes-e') || l.includes('licitacoese')) return 'Licitações-e (BB)';
  if (l.includes('banrisul')) return 'Banrisul';
  if (l.includes('licitanet')) return 'Licitanet';
  if (l.includes('bnc.org') || l.includes('bncompras')) return 'BNC';
  if (l.includes('compras.rs') || l.includes('comprasrs')) return 'Compras RS';
  if (l.includes('compras.mg') || l.includes('comprasmg')) return 'Compras MG';
  if (l.includes('compras.ba') || l.includes('comprasba')) return 'Compras BA';
  if (l.includes('e-lic') || l.includes('elic')) return 'e-Lic SC';
  if (l.includes('pe-integrado')) return 'PE Integrado';
  if (l.includes('banpara')) return 'Banpará';
  if (l.includes('procergs')) return 'PROCERGS';
  return 'Portal PNCP';
}
