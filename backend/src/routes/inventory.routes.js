import { Router } from 'express';
import { createInventory, getLatestInventory } from '../controllers/inventory.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.post('/', asyncHandler(createInventory));
router.get('/chantier/:chantierId/latest', asyncHandler(getLatestInventory));

export default router;
