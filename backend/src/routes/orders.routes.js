import { Router } from 'express';
import {
  createOrder,
  getOrder,
  getOrderPdf,
  listMyOrders,
  listAllOrders,
  cancelOrder,
  consumptionByChantier,
} from '../controllers/orders.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.post('/', asyncHandler(createOrder));
router.get('/mine', asyncHandler(listMyOrders));
router.get('/all', requireAdmin, asyncHandler(listAllOrders));
router.get('/consumption/:chantierId', requireAdmin, asyncHandler(consumptionByChantier));
router.get('/:id', asyncHandler(getOrder));
router.get('/:id/pdf', asyncHandler(getOrderPdf));
router.delete('/:id', asyncHandler(cancelOrder));

export default router;
