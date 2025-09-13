import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { protect } from '../middleware/auth';
import { validateRequest } from '../middleware/validateRequest';
import * as pollController from '../controllers/pollController';
import { createPollSchema, updatePollSchema, voteSchema } from '../zod/zod';
import { AuthenticatedRequest } from '../types/express';

const router = Router();

// Type-safe request handler with authenticated request
type AuthenticatedRequestHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

// Helper function to wrap authenticated request handlers
const handleAuthRequest = (handler: AuthenticatedRequestHandler): RequestHandler => 
  (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as unknown as AuthenticatedRequest;
    return handler(authReq, res, next);
  };

// Public routes
router.get('/', pollController.listPolls as RequestHandler);
router.get('/:id', pollController.getPoll as RequestHandler);

// Protected routes (require authentication)
router.use(protect);

// Create a new poll
router.post(
  '/',
  validateRequest({
    body: createPollSchema
  }),
  pollController.createPoll as RequestHandler
);

// Update a poll
router.patch(
  '/:id',
  validateRequest({
    params: z.object({ id: z.string() }),
    body: updatePollSchema
  }),
  pollController.updatePoll as unknown as RequestHandler
);

// Delete a poll
router.delete(
  '/:id',
  validateRequest({
    params: z.object({ id: z.string() })
  }),
  pollController.deletePoll as unknown as RequestHandler
);

// Vote on a poll
router.post(
  '/:id/vote',
  // First handle authentication
  protect,
  // Then validate the request
  validateRequest({
    body: voteSchema,
    params: z.object({
      id: z.string().min(1, 'Poll ID is required')
    })
  }),
  // Finally, handle the request
  (req: Request, res: Response, next: NextFunction) => {
    // Cast the request to AuthenticatedRequest
    pollController.voteOnPoll(req as AuthenticatedRequest, res, next);
  }
);

export default router;
