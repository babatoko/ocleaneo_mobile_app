import { Router } from 'express';
import {
  listMine,
  listAll,
  createShift,
  updateShift,
  cancelShift,
} from '../controllers/shifts.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/mine', asyncHandler(listMine));
router.get('/', requireAdmin, asyncHandler(listAll));
router.post('/', requireAdmin, asyncHandler(createShift));
router.patch('/:id', requireAdmin, asyncHandler(updateShift));
router.delete('/:id', requireAdmin, asyncHandler(cancelShift));

export default router;
