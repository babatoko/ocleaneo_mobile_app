import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  const schema = fs.readFileSync(
    new URL('./schema.sql', import.meta.url),
    'utf-8'
  );
  db.exec(schema);
  seedProducts();
  seedDefaultAdmin();
}

function seedProducts() {
  if (!fs.existsSync(config.productsSeedPath)) return;
  const products = JSON.parse(fs.readFileSync(config.productsSeedPath, 'utf-8'));

  const findProduct = db.prepare('SELECT id FROM products WHERE name = ?');
  const insertProduct = db.prepare(
    'INSERT INTO products (name, emoji, image_path, category) VALUES (?, ?, ?, ?)'
  );
  const insertPackaging = db.prepare(
    'INSERT INTO product_packagings (product_id, label, is_default) VALUES (?, ?, ?)'
  );

  const seedAll = db.transaction((items) => {
    for (const p of items) {
      if (findProduct.get(p.name)) continue;
      const { lastInsertRowid: productId } = insertProduct.run(
        p.name,
        p.emoji || '',
        p.image || '',
        p.category || ''
      );
      (p.packagings || []).forEach((label, i) => {
        insertPackaging.run(productId, label, i === 0 ? 1 : 0);
      });
    }
  });
  seedAll(products);
}

function seedDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
  if (count > 0) return;
  db.prepare(
    'INSERT INTO employees (login_code, name, is_admin) VALUES (?, ?, 1)'
  ).run('ADMIN', 'Administrateur');
}
