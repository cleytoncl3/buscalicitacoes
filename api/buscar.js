export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const {
    palavraChave = '',
    uf = '',
    dataInicial = '',
    dataFinal = '',
    pagina = 1,
    modalidade = ''
  } = req.query;

  const hoje = new Date().toISOString().split('T')[0];
  const trintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const params = new URLSearchParams({
    dataInicial: dataInicial || trintaDias,
    dataFinal: dataFinal || hoje,
    pagina: pagina,
    tamanhoPagina: 20,
  });

  if (palavraChave) params.append('palavraChave', palavraChave);
  if (uf) params.append('uf', uf);
  if (modalidade) params.append('codigoModalidadeContratacao', modalidade);

  try {
    const url = `https://pncp.gov.br/api/pncp/v1/oportunidades/compras?${params}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ erro: text });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
