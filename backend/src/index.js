import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { initDb } from './db/index.js';

import authRoutes from './routes/auth.routes.js';
import chantiersRoutes from './routes/chantiers.routes.js';
import productsRoutes from './routes/products.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import inventoryRoutes from './routes/inventory.routes.js';
import employeesRoutes from './routes/employees.routes.js';

initDb();

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/chantiers', chantiersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeesRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(config.port, () => {
  console.log(`Ocleaneo mobile API en écoute sur le port ${config.port}`);
});
