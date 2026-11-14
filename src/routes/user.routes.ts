import { Router } from "express";
import {
  updateProfile,
  searchUsers,
 
  uploadProfilePhotos,
  getProfilePhotos,
  deleteProfilePhoto,
  updateProfileVisibility,
  getProfilePhoto,
} from "../controllers/user.controller.js";

import { upload } from "../config/multer.js";

import { authenticateToken } from "../middleware/auth.middleware.js";

const userRouter = Router();

// Search for other users
userRouter.get("/search", authenticateToken, searchUsers);

// Update authenticated user's profile
userRouter.patch("/me", authenticateToken, updateProfile);

userRouter.post("/profile-photos",authenticateToken,upload.array("photos",5),uploadProfilePhotos);
// Get authenticated user's profile photos
userRouter.get("/profile-photos",authenticateToken,getProfilePhotos);
// Delete an individual profile photo
userRouter.delete("/profile-photos/:photoId",authenticateToken,deleteProfilePhoto);
// Update profile photo visibility
userRouter.patch("/profile-visibility",authenticateToken,updateProfileVisibility);

// Get an individual profile photo
userRouter.get("/profile-photos/:photoId",authenticateToken,getProfilePhoto);

export default userRouter;