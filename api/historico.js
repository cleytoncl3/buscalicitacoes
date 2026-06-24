// api/historico.js — Histórico de preços via atas do PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { descricao = '', uf = '', pagina = 1 } = req.query;
  try {
    const params = new URLSearchParams({
      tipos_documento: 'ata', ordenacao: '-data', pagina, tam_pagina: 20,
    });
    if (descricao) params.append('q', descricao.includes(' ') ? `"${descricao}"` : descricao);
    if (uf) params.append('ufs', uf);
    const r = await fetch(`https://pncp.gov.br/api/search/?${params}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await r.json();
    return res.status(200).json({ data: data.items || [], total: data.total || 0, totalPaginas: Math.ceil((data.total || 0) / 20) });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
