import { db } from '../db/index.js';

function loadInventoryWithItems(inventoryId) {
  const inventory = db
    .prepare(
      `SELECT inv.*, e.name AS employee_name, c.name AS chantier_name
       FROM inventories inv
       JOIN employees e ON e.id = inv.employee_id
       JOIN chantiers c ON c.id = inv.chantier_id
       WHERE inv.id = ?`
    )
    .get(inventoryId);
  if (!inventory) return null;

  inventory.items = db
    .prepare(
      `SELECT ii.*, p.name AS product_name, p.emoji AS product_emoji,
              pp.label AS packaging_label
       FROM inventory_items ii
       JOIN products p ON p.id = ii.product_id
       JOIN product_packagings pp ON pp.id = ii.packaging_id
       WHERE ii.inventory_id = ?`
    )
    .all(inventoryId);
  return inventory;
}

export function createInventory(req, res) {
  const { chantierId, items } = req.body;
  if (!chantierId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'chantierId et items requis' });
  }

  const insertInventory = db.prepare(
    'INSERT INTO inventories (employee_id, chantier_id) VALUES (?, ?)'
  );
  const insertItem = db.prepare(
    `INSERT INTO inventory_items (inventory_id, product_id, packaging_id, quantity_remaining)
     VALUES (?, ?, ?, ?)`
  );

  const inventoryId = db.transaction(() => {
    const { lastInsertRowid } = insertInventory.run(req.employee.id, chantierId);
    for (const item of items) {
      insertItem.run(lastInsertRowid, item.productId, item.packagingId, item.quantityRemaining);
    }
    return lastInsertRowid;
  })();

  res.status(201).json(loadInventoryWithItems(inventoryId));
}

export function getLatestInventory(req, res) {
  const { chantierId } = req.params;
  const row = db
    .prepare(
      `SELECT id FROM inventories
       WHERE employee_id = ? AND chantier_id = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(req.employee.id, chantierId);
  if (!row) return res.status(404).json({ error: 'Aucun inventaire trouvé' });
  res.json(loadInventoryWithItems(row.id));
}
