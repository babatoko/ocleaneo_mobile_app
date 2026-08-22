import { db } from '../db/index.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function listMine(req, res) {
  const from = req.query.from || todayIso();
  const to = req.query.to || from;

  const shifts = db
    .prepare(
      `SELECT s.*, c.name AS chantier_name, c.address AS chantier_address
       FROM shifts s
       JOIN chantiers c ON c.id = s.chantier_id
       WHERE s.employee_id = ? AND s.status != 'cancelled'
         AND date(s.start_at) >= date(?) AND date(s.start_at) <= date(?)
       ORDER BY s.start_at`
    )
    .all(req.employee.id, from, to);
  res.json(shifts);
}

export function listAll(req, res) {
  const from = req.query.from || todayIso();
  const to = req.query.to || from;

  const shifts = db
    .prepare(
      `SELECT s.*, c.name AS chantier_name, e.name AS employee_name
       FROM shifts s
       JOIN chantiers c ON c.id = s.chantier_id
       JOIN employees e ON e.id = s.employee_id
       WHERE s.status != 'cancelled'
         AND date(s.start_at) >= date(?) AND date(s.start_at) <= date(?)
       ORDER BY s.start_at`
    )
    .all(from, to);
  res.json(shifts);
}

export function createShift(req, res) {
  const { employeeId, chantierId, startAt, endAt, note } = req.body;
  if (!employeeId || !chantierId || !startAt || !endAt) {
    return res.status(400).json({ error: 'employeeId, chantierId, startAt, endAt requis' });
  }
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO shifts (employee_id, chantier_id, start_at, end_at, note) VALUES (?, ?, ?, ?, ?)'
    )
    .run(employeeId, chantierId, startAt, endAt, note || null);

  res.status(201).json(
    db.prepare('SELECT * FROM shifts WHERE id = ?').get(lastInsertRowid)
  );
}

export function updateShift(req, res) {
  const existing = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Vacation introuvable' });

  const startAt = req.body.startAt ?? existing.start_at;
  const endAt = req.body.endAt ?? existing.end_at;
  const note = req.body.note ?? existing.note;
  const status =
    req.body.status ??
    (startAt !== existing.start_at || endAt !== existing.end_at ? 'modified' : existing.status);

  db.prepare(
    'UPDATE shifts SET start_at = ?, end_at = ?, note = ?, status = ? WHERE id = ?'
  ).run(startAt, endAt, note, status, req.params.id);

  res.json(db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id));
}

export function cancelShift(req, res) {
  db.prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.status(204).end();
}
