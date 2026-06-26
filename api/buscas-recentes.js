// api/buscas-recentes.js — Buscas recentes compartilhadas entre todos os usuários
// Salva no servidor (memória compartilhada por instância Vercel)
// GET  → lista as mais recentes
// POST → adiciona/incrementa um termo

const MAX = 30;
// Mapa: termo → { kw, count, updatedAt }
const store = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const lista = [...store.values()]
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map(x => ({ kw: x.kw, count: x.count }));
    return res.status(200).json({ ok: true, buscas: lista });
  }

  if (req.method === 'POST') {
    let kw = '';
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      kw = (body?.kw || '').trim().toLowerCase().slice(0, 100);
    } catch { /* ignora */ }
    if (!kw) return res.status(400).json({ erro: 'kw obrigatório' });

    const existing = store.get(kw);
    store.set(kw, { kw, count: (existing?.count || 0) + 1, updatedAt: Date.now() });

    // Mantém só MAX entradas — remove as mais antigas/menos usadas
    if (store.size > MAX) {
      const sorted = [...store.entries()].sort((a, b) => a[1].count - b[1].count || a[1].updatedAt - b[1].updatedAt);
      store.delete(sorted[0][0]);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
