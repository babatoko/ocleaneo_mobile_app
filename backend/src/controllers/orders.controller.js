import { db } from '../db/index.js';
import { renderOrderPdf } from '../services/pdf.service.js';

function loadOrderWithItems(orderId) {
  const order = db
    .prepare(
      `SELECT o.*, e.name AS employee_name, c.name AS chantier_name
       FROM orders o
       JOIN employees e ON e.id = o.employee_id
       JOIN chantiers c ON c.id = o.chantier_id
       WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) return null;

  order.items = db
    .prepare(
      `SELECT oi.*, p.name AS product_name, p.emoji AS product_emoji,
              pp.label AS packaging_label
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN product_packagings pp ON pp.id = oi.packaging_id
       WHERE oi.order_id = ?`
    )
    .all(orderId);
  return order;
}

export function createOrder(req, res) {
  const { chantierId, items } = req.body;
  if (!chantierId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'chantierId et items requis' });
  }

  const insertOrder = db.prepare(
    'INSERT INTO orders (employee_id, chantier_id) VALUES (?, ?)'
  );
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, packaging_id, quantity) VALUES (?, ?, ?, ?)'
  );
  const confirm = db.prepare(
    "UPDATE orders SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?"
  );

  const orderId = db.transaction(() => {
    const { lastInsertRowid } = insertOrder.run(req.employee.id, chantierId);
    for (const item of items) {
      insertItem.run(lastInsertRowid, item.productId, item.packagingId, item.quantity || 1);
    }
    confirm.run(lastInsertRowid);
    return lastInsertRowid;
  })();

  res.status(201).json(loadOrderWithItems(orderId));
}

export function getOrder(req, res) {
  const order = loadOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(order);
}

export function getOrderPdf(req, res) {
  const order = loadOrderWithItems(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  renderOrderPdf(order, res);
}

export function listMyOrders(req, res) {
  const limit = Number(req.query.limit) || 20;
  const orders = db
    .prepare(
      `SELECT o.*, e.name AS employee_name, c.name AS chantier_name
       FROM orders o
       JOIN employees e ON e.id = o.employee_id
       JOIN chantiers c ON c.id = o.chantier_id
       WHERE o.employee_id = ? AND o.status != 'cancelled'
       ORDER BY o.created_at DESC LIMIT ?`
    )
    .all(req.employee.id, limit);
  res.json(orders);
}

export function listAllOrders(req, res) {
  const limit = Number(req.query.limit) || 50;
  const orders = db
    .prepare(
      `SELECT o.*, e.name AS employee_name, c.name AS chantier_name
       FROM orders o
       JOIN employees e ON e.id = o.employee_id
       JOIN chantiers c ON c.id = o.chantier_id
       WHERE o.status != 'cancelled'
       ORDER BY o.created_at DESC LIMIT ?`
    )
    .all(limit);
  res.json(orders);
}

export function cancelOrder(req, res) {
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.status(204).end();
}

export function consumptionByChantier(req, res) {
  const months = Number(req.query.months) || 3;
  const rows = db
    .prepare(
      `SELECT p.name AS product_name, p.emoji, pp.label AS packaging_label,
              SUM(oi.quantity) AS total_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       JOIN product_packagings pp ON pp.id = oi.packaging_id
       WHERE o.chantier_id = ? AND o.status = 'confirmed'
         AND o.created_at >= datetime('now', ? || ' months')
       GROUP BY oi.product_id, oi.packaging_id
       ORDER BY total_qty DESC`
    )
    .all(req.params.chantierId, -months);
  res.json(rows);
}
