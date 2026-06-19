export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { palavraChave = '', uf = '', pagina = 1, modalidade = '', status = 'recebendo_proposta' } = req.query;

  const params = new URLSearchParams({
    tipos_documento: 'edital',
    ordenacao: '-data',
    pagina: pagina,
    tam_pagina: 20,
    status: status,
  });

  if (palavraChave) params.append('q', palavraChave);
  if (uf) params.append('ufs', uf);
  if (modalidade) params.append('modalidade', modalidade);

  try {
    const url = `https://pncp.gov.br/api/search/?${params}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });

    const text = await response.text();

    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ erro: `PNCP retornou: ${text.substring(0, 300)}` }); }

    if (!response.ok) {
      return res.status(response.status).json({ erro: data.detail || data.message || text });
    }

    return res.status(200).json({
      data: data.items || data.results || data,
      totalRegistros: data.total || data.count || 0,
      totalPaginas: Math.ceil((data.total || data.count || 0) / 20)
    });

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
