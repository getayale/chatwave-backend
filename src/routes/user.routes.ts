import { Router } from "express";
import {
  updateProfile,
  searchUsers,
} from "../controllers/user.controller.js";

import { authenticateToken } from "../middleware/auth.middleware.js";

const userRouter = Router();

// Search for other users
userRouter.get("/search", authenticateToken, searchUsers);

// Update authenticated user's profile
userRouter.patch("/me", authenticateToken, updateProfile);

export default userRouter;