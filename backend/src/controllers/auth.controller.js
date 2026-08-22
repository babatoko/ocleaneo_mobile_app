import { db } from '../db/index.js';
import { signEmployeeToken } from '../services/jwt.service.js';

export function login(req, res) {
  const { loginCode } = req.body;
  if (!loginCode) return res.status(400).json({ error: 'loginCode requis' });

  const employee = db
    .prepare('SELECT * FROM employees WHERE login_code = ? AND is_active = 1')
    .get(loginCode.trim().toUpperCase());

  if (!employee) return res.status(401).json({ error: 'Code inconnu ou compte inactif' });

  const token = signEmployeeToken(employee);
  res.json({
    token,
    employee: {
      id: employee.id,
      name: employee.name,
      isAdmin: !!employee.is_admin,
    },
  });
}

export function me(req, res) {
  const { id, name, is_admin } = req.employee;
  res.json({ id, name, isAdmin: !!is_admin });
}
