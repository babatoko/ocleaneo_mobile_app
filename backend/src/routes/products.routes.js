import { Router } from 'express';
import {
  listProducts,
  listCategories,
  createProduct,
  deactivateProduct,
} from '../controllers/products.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(listProducts));
router.get('/categories', asyncHandler(listCategories));
router.post('/', requireAdmin, asyncHandler(createProduct));
router.delete('/:id', requireAdmin, asyncHandler(deactivateProduct));

export default router;
