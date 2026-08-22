import { db } from '../db/index.js';

export function listMyChantiers(req, res) {
  const chantiers = db
    .prepare(
      `SELECT c.* FROM chantiers c
       JOIN employee_chantiers ec ON ec.chantier_id = c.id
       WHERE ec.employee_id = ? AND c.is_active = 1
       ORDER BY c.name`
    )
    .all(req.employee.id);
  res.json(chantiers);
}

export function listAllChantiers(req, res) {
  const chantiers = db
    .prepare('SELECT * FROM chantiers WHERE is_active = 1 ORDER BY name')
    .all();
  res.json(chantiers);
}

export function createChantier(req, res) {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO chantiers (name, address) VALUES (?, ?)')
    .run(name, address || null);
  res.status(201).json(db.prepare('SELECT * FROM chantiers WHERE id = ?').get(lastInsertRowid));
}

export function deactivateChantier(req, res) {
  db.prepare('UPDATE chantiers SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).end();
}

export function assignEmployee(req, res) {
  const { employeeId, chantierId } = req.body;
  db.prepare(
    'INSERT OR IGNORE INTO employee_chantiers (employee_id, chantier_id) VALUES (?, ?)'
  ).run(employeeId, chantierId);
  res.status(204).end();
}

export function unassignEmployee(req, res) {
  const { employeeId, chantierId } = req.body;
  db.prepare(
    'DELETE FROM employee_chantiers WHERE employee_id = ? AND chantier_id = ?'
  ).run(employeeId, chantierId);
  res.status(204).end();
}
