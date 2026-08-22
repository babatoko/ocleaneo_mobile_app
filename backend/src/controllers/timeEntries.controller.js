import { db } from '../db/index.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function today(req, res) {
  const entries = db
    .prepare(
      `SELECT te.*, c.name AS chantier_name
       FROM time_entries te
       JOIN chantiers c ON c.id = te.chantier_id
       WHERE te.employee_id = ? AND date(te.recorded_at) = date(?)
       ORDER BY te.recorded_at`
    )
    .all(req.employee.id, todayIso());

  const last = entries[entries.length - 1];
  const status = last?.type === 'in' ? 'in' : 'out';
  res.json({ entries, status });
}

export function clock(req, res) {
  const { chantierId, shiftId, type, latitude, longitude } = req.body;
  if (!chantierId || !['in', 'out'].includes(type)) {
    return res.status(400).json({ error: "chantierId et type ('in' ou 'out') requis" });
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO time_entries (employee_id, chantier_id, shift_id, type, latitude, longitude)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.employee.id, chantierId, shiftId || null, type, latitude ?? null, longitude ?? null);

  const entry = db
    .prepare(
      `SELECT te.*, c.name AS chantier_name
       FROM time_entries te
       JOIN chantiers c ON c.id = te.chantier_id
       WHERE te.id = ?`
    )
    .get(lastInsertRowid);

  res.status(201).json(entry);
}
