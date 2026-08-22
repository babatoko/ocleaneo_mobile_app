import { Router } from 'express';
import {
  listEmployees,
  createEmployee,
  setAdmin,
  deactivateEmployee,
} from '../controllers/employees.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', asyncHandler(listEmployees));
router.post('/', asyncHandler(createEmployee));
router.patch('/:id/admin', asyncHandler(setAdmin));
router.delete('/:id', asyncHandler(deactivateEmployee));

export default router;
