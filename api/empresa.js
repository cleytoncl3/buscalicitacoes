// api/empresa.js — Consulta CNPJ (BrasilAPI) + licitações no PNCP
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cnpj = '' } = req.query;
  if (!cnpj) return res.status(400).json({ erro: 'CNPJ obrigatório' });
  const num = cnpj.replace(/\D/g, '');
  try {
    const [rfRes, pncpRes] = await Promise.all([
      fetch(`https://brasilapi.com.br/api/cnpj/v1/${num}`),
      fetch(`https://pncp.gov.br/api/search/?q=${num}&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=20`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      })
    ]);
    const empresa = await rfRes.json();
    const licitacoes = await pncpRes.json();
    return res.status(200).json({ empresa, licitacoes: licitacoes.items || [], totalLicitacoes: licitacoes.total || 0 });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
