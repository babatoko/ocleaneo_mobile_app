import { Router } from 'express';
import { today, clock } from '../controllers/timeEntries.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/today', asyncHandler(today));
router.post('/', asyncHandler(clock));

export default router;
