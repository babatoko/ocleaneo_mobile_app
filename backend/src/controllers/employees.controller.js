import { db } from '../db/index.js';

function randomLoginCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function listEmployees(req, res) {
  const employees = db
    .prepare('SELECT id, login_code, name, is_admin, is_active FROM employees ORDER BY name')
    .all();
  res.json(employees);
}

export function createEmployee(req, res) {
  const { name, isAdmin } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });

  let loginCode = randomLoginCode();
  while (db.prepare('SELECT 1 FROM employees WHERE login_code = ?').get(loginCode)) {
    loginCode = randomLoginCode();
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO employees (login_code, name, is_admin) VALUES (?, ?, ?)')
    .run(loginCode, name, isAdmin ? 1 : 0);

  res.status(201).json(
    db
      .prepare('SELECT id, login_code, name, is_admin, is_active FROM employees WHERE id = ?')
      .get(lastInsertRowid)
  );
}

export function setAdmin(req, res) {
  const { isAdmin } = req.body;
  db.prepare('UPDATE employees SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, req.params.id);
  res.status(204).end();
}

export function deactivateEmployee(req, res) {
  db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).end();
}
