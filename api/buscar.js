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

  function formatarData(data) {
    if (!data) return null;
    return data.replace(/-/g, '');
  }

  const hoje = new Date();
  const trintaDias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dataIni = formatarData(dataInicial) || trintaDias.toISOString().split('T')[0].replace(/-/g, '');
  const dataFim = formatarData(dataFinal) || hoje.toISOString().split('T')[0].replace(/-/g, '');

  const params = new URLSearchParams({
    dataInicial: dataIni,
    dataFinal: dataFim,
    tamanhoPagina: 50,
    pagina: pagina,
  });

  if (uf) params.append('uf', uf);
  if (modalidade) params.append('codigoModalidadeContratacao', modalidade);

  try {
    const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?${params}`;

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

    // Filtro por palavra-chave no servidor
    if (palavraChave && data.data) {
      const termo = palavraChave.toLowerCase();
      data.data = data.data.filter(item => {
        const obj = (item.objetoCompra || '').toLowerCase();
        const info = (item.informacaoComplementar || '').toLowerCase();
        return obj.includes(termo) || info.includes(termo);
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ erro: error.message });
  }
}
