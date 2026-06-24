// api/orgaos.js — Busca órgãos públicos via PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q = '', uf = '', pagina = 1 } = req.query;
  try {
    const params = new URLSearchParams({
      tipos_documento: 'edital', ordenacao: '-data',
      status: 'recebendo_proposta', pagina, tam_pagina: 20,
    });
    if (q) params.append('q', q);
    if (uf) params.append('ufs', uf);
    const r = await fetch(`https://pncp.gov.br/api/search/?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await r.json();
    // Extrai órgãos únicos dos resultados
    const map = {};
    (data.items || []).forEach(i => {
      const k = i.orgao_cnpj || i.orgao_nome;
      if (!k) return;
      if (!map[k]) map[k] = { cnpj: i.orgao_cnpj, nome: i.orgao_nome, uf: i.uf, esfera: i.esfera_nome, municipio: i.municipio_nome, total: 0 };
      map[k].total++;
    });
    return res.status(200).json({ orgaos: Object.values(map), total: data.total || 0 });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
