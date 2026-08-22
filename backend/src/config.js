import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'change_me_in_production',
  dbPath: process.env.DB_PATH
    ? path.resolve(rootDir, process.env.DB_PATH)
    : path.resolve(rootDir, 'data/ocleaneo.db'),
  productsSeedPath: path.resolve(rootDir, 'data/products.json'),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
