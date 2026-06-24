// api/negocios.js — banco de dados compartilhado de Negócios
// Usa armazenamento em memória com persistência via arquivo JSON no /tmp
// Para produção real, substituir por Vercel KV ou Supabase

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DB_PATH = '/tmp/arantes_negocios.json';

function lerDB() {
  try {
    if (existsSync(DB_PATH)) return JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch {}
  return [];
}

function salvarDB(dados) {
  writeFileSync(DB_PATH, JSON.stringify(dados), 'utf8');
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const negocios = lerDB();

  if (req.method === 'GET') {
    return res.status(200).json(negocios);
  }

  if (req.method === 'POST') {
    // Adicionar novo negócio
    const novo = { ...req.body, id: req.body.id || Date.now().toString() };
    const idx = negocios.findIndex(n => n.numero_controle === novo.numero_controle);
    if (idx >= 0) negocios[idx] = { ...negocios[idx], ...novo };
    else negocios.unshift(novo);
    salvarDB(negocios);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PUT') {
    // Atualizar fase
    const { id, fase } = req.body;
    const n = negocios.find(x => x.id === id);
    if (n) { n.fase = fase; salvarDB(negocios); }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    const novos = negocios.filter(n => n.id !== id);
    salvarDB(novos);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
