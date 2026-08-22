import { Router } from 'express';
import { login, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.get('/me', requireAuth, asyncHandler(me));

export default router;
