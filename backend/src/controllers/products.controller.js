import { db } from '../db/index.js';

function withPackagings(product) {
  product.packagings = db
    .prepare(
      'SELECT * FROM product_packagings WHERE product_id = ? AND is_active = 1'
    )
    .all(product.id);
  return product;
}

export function listProducts(req, res) {
  const { category } = req.query;
  const products = category
    ? db
        .prepare(
          'SELECT * FROM products WHERE category = ? AND is_active = 1 ORDER BY name'
        )
        .all(category)
    : db
        .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY category, name')
        .all();
  res.json(products.map(withPackagings));
}

export function listCategories(req, res) {
  const rows = db
    .prepare(
      "SELECT DISTINCT category FROM products WHERE is_active = 1 AND category != '' ORDER BY category"
    )
    .all();
  res.json(rows.map((r) => r.category));
}

export function createProduct(req, res) {
  const { name, emoji, category, imagePath, packagings } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });

  const insertProduct = db.prepare(
    'INSERT INTO products (name, emoji, category, image_path) VALUES (?, ?, ?, ?)'
  );
  const insertPackaging = db.prepare(
    'INSERT INTO product_packagings (product_id, label, is_default) VALUES (?, ?, ?)'
  );

  const productId = db.transaction(() => {
    const { lastInsertRowid } = insertProduct.run(
      name,
      emoji || '',
      category || '',
      imagePath || null
    );
    (packagings || []).forEach((label, i) => {
      insertPackaging.run(lastInsertRowid, label, i === 0 ? 1 : 0);
    });
    return lastInsertRowid;
  })();

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.status(201).json(withPackagings(product));
}

export function deactivateProduct(req, res) {
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.status(204).end();
}
