import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { createUser, loginUser, getCurrentUser } from '../controllers/userController';
import { protect } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/express';

const router = Router();

// Public routes
router.post('/register', createUser as RequestHandler);
router.post('/login', loginUser as RequestHandler);

// Protected routes
router.get('/me', protect, getCurrentUser as unknown as RequestHandler);

export default router;
