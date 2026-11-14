import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import { unlink } from "node:fs/promises";
import path from "node:path";



export const updateProfile = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = updateProfileSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Get authenticated user ID
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 3. Update profile in PostgreSQL
    const user = await prisma.user.update({
      where: { id: userId },
      data: result.data,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        updatedAt: true,
      },
    });

    // 4. Return updated profile
    return res.status(200).json({
      message: "Profile updated successfully",
      user,
    });
  } catch (error) {
    console.error("Profile update error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const searchUsers = async (req: Request, res: Response) => {
  try {
    // 1. Get the search query
    const query =
      typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.status(400).json({
        message: "Search query is required",
      });
    }

    // 2. Get authenticated user ID
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 3. Search for other users
    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        OR: [
          {
            username: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            displayName: {
              contains: query,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      take: 10,
    });

    // 4. Return search results
    return res.status(200).json({
      message: "Users retrieved successfully",
      users,
    });
  } catch (error) {
    console.error("User search error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const uploadProfilePhotos = async (
  req: Request,
  res: Response,
) => {
  let files: Express.Multer.File[] = [];

  try {
    // 1. Get authenticated user ID
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Get uploaded files
    files = (req.files as Express.Multer.File[] | undefined) ?? [];

    if (files.length === 0) {
      return res.status(400).json({
        message: "Please upload at least one photo",
      });
    }

    // 3. Save and retrieve photos in one transaction
    const uploadedPhotos = await prisma.$transaction(async (tx) => {
      await tx.profilePhoto.createMany({
        data: files.map((file) => ({
          imageUrl: `/api/users/profile-photos/${file.filename}`,
          storageKey: file.filename,
          userId,
        })),
      });

      return tx.profilePhoto.findMany({
        where: {
          userId,
          storageKey: {
            in: files.map((file) => file.filename),
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    });

    // 4. Return uploaded photos
    return res.status(201).json({
      message: "Profile photos uploaded successfully",
      photos: uploadedPhotos,
    });
  } catch (error) {
    // 5. Remove uploaded files if database operations fail
    await Promise.allSettled(
      files.map((file) => unlink(file.path)),
    );

    console.error("Profile photo upload error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getProfilePhotos = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // Get the requested user's ID.
    // If no userId is provided, retrieve the current user's photos.
    const targetUserId =
      typeof req.query.userId === "string"
        ? req.query.userId
        : currentUserId;

    // Find the target user and check profile visibility.
    const targetUser = await prisma.user.findUnique({
      where: {
        id: targetUserId,
      },
      select: {
        id: true,
        profileVisibility: true,
      },
    });

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Prevent viewing private profiles belonging to other users.
    if (
      targetUser.profileVisibility === "PRIVATE" &&
      targetUser.id !== currentUserId
    ) {
      return res.status(403).json({
        message: "This user's profile is private",
      });
    }

    // Retrieve the permitted user's photos.
    const photos = await prisma.profilePhoto.findMany({
      where: {
        userId: targetUserId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      message: "Profile photos retrieved successfully",
      photos,
    });
  } catch (error) {
    console.error("Get Profile photos error:", error);

    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


export const deleteProfilePhoto = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Get photo ID
    const photoId = req.params.photoId;

    if (typeof photoId !== "string") {
      return res.status(400).json({
        message: "Invalid photo ID",
      });
    }

    // 2. Get authenticated user ID
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 3. Find photo
    const photo = await prisma.profilePhoto.findUnique({
      where: {
        id: photoId,
      },
    });

    if (!photo) {
      return res.status(404).json({
        message: "Profile photo not found",
      });
    }

    // 4. Verify ownership
    if (photo.userId !== userId) {
      return res.status(403).json({
        message: "You are not allowed to delete this photo",
      });
    }

    // 5. Delete physical image
    const filePath = path.join(
      process.cwd(),
      "uploads",
      "profile-photos",
      photo.storageKey,
    );

    await unlink(filePath);

    // 6. Delete database record
    await prisma.profilePhoto.delete({
      where: {
        id: photoId,
      },
    });

    // 7. Return success
    return res.status(200).json({
      message: "Profile photo deleted successfully",
    });

  } catch (error) {
    console.error("Delete profile photo error:", error);

    return res.status(500).json({
      message: "Internal Server error",
    });
  }
};


export const updateProfileVisibility = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Get requested visibility
    const { profileVisibility } = req.body;

    // 2. Validate visibility
    if (
      profileVisibility !== "PUBLIC" &&
      profileVisibility !== "PRIVATE"
    ) {
      return res.status(400).json({
        message: "Profile visibility must be PUBLIC or PRIVATE",
      });
    }

    // 3. Get authenticated user ID
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 4. Update profile visibility
    const user = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        profileVisibility,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        profileVisibility: true,
      },
    });

    // 5. Return updated profile
    return res.status(200).json({
      message: "Profile visibility updated successfully",
      user,
    });
  } catch (error) {
    console.error("Update profile visibility error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const getProfilePhoto = async (req: Request, res: Response) => {
  try {
    const photoId = req.params.photoId;

    if (typeof photoId !== "string") {
      return res.status(400).json({
        message: "Invalid photo ID",
      });
    }

    const photo = await prisma.profilePhoto.findFirst({
      where: {
        storageKey: photoId,
      },
      include: {
        user: {
          select: {
            id: true,
            profileVisibility: true,
          },
        },
      },
    });

    if (!photo) {
      return res.status(404).json({
        message: "Profile photo not found",
      });
    }

    const userId = req.user?.userId;

    if (
      photo.user.profileVisibility === "PRIVATE" &&
      photo.userId !== userId
    ) {
      return res.status(403).json({
        message: "You are not allowed to view this photo",
      });
    }

    const filePath = path.join(
      process.cwd(),
      "uploads",
      "profile-photos",
      photo.storageKey,
    );

    return res.sendFile(filePath);
  } catch (error) {
    console.error("Get profile photo error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

