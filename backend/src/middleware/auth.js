import { verifyToken } from '../services/jwt.service.js';
import { db } from '../db/index.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentification requise' });

  try {
    const payload = verifyToken(token);
    const employee = db
      .prepare('SELECT * FROM employees WHERE id = ? AND is_active = 1')
      .get(payload.sub);
    if (!employee) return res.status(401).json({ error: 'Compte inactif ou introuvable' });
    req.employee = employee;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.employee?.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
}
