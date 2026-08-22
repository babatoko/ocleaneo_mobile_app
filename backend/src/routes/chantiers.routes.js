import { Router } from 'express';
import {
  listMyChantiers,
  listAllChantiers,
  createChantier,
  deactivateChantier,
  assignEmployee,
  unassignEmployee,
} from '../controllers/chantiers.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/mine', asyncHandler(listMyChantiers));
router.get('/', requireAdmin, asyncHandler(listAllChantiers));
router.post('/', requireAdmin, asyncHandler(createChantier));
router.delete('/:id', requireAdmin, asyncHandler(deactivateChantier));
router.post('/assign', requireAdmin, asyncHandler(assignEmployee));
router.post('/unassign', requireAdmin, asyncHandler(unassignEmployee));

export default router;
