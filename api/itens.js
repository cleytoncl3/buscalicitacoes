export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { cnpj, ano, sequencial } = req.query;
  if (!cnpj || !ano || !sequencial) {
    return res.status(400).json({ erro: 'Parâmetros obrigatórios: cnpj, ano, sequencial' });
  }

  try {
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/${cnpj}/${ano}/${sequencial}/itens/publicacao?pagina=1&tamanhoPagina=500`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ erro: text.substring(0, 200) }); }
    if (!response.ok) return res.status(response.status).json({ erro: data.message || text });
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
