import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rate-limit.js';
import { getUser, searchUsers, updateUser } from '../services/user.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/errors.js';
import { updateProfileSchema } from '../validators/auth.js';

export const userRouter = Router();
userRouter.use(requireAuth);

userRouter.get(
  '/search',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (query.length > 80) throw new AppError(400, 'INVALID_QUERY', 'Search query is too long');
    res.json({ users: await searchUsers(req.user!.id, query) });
  }),
);

userRouter.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const input = updateProfileSchema.parse(req.body);
    res.json({ user: await updateUser(req.user!.id, input) });
  }),
);

userRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ user: await getUser(req.params.id!) });
  }),
);
