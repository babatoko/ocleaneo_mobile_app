import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signEmployeeToken(employee) {
  return jwt.sign(
    { sub: employee.id, name: employee.name, isAdmin: !!employee.is_admin },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
