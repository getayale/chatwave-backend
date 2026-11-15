import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "../generated/prisma/client.js";
import { getCache, setCache } from "../config/cache.js";

export const updateProfile = async (req: Request, res: Response) => {
  try {
    // 1. Validate authenticated user
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Validate incoming data
    const result = updateProfileSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 3. Update profile and retrieve selected fields
    const user = await prisma.user.update({
      where: {
        id: userId,
      },
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

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};



export const getProfilePhotos = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Validate authenticated user
    const currentUserId = req.user?.userId;

    if (!currentUserId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Determine whose photos to retrieve
    const targetUserId =
      typeof req.query.userId === "string"
        ? req.query.userId
        : currentUserId;

    // 3. Check current profile visibility
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

    // 4. Enforce profile privacy before accessing cache
    if (
      targetUser.profileVisibility === "PRIVATE" &&
      targetUser.id !== currentUserId
    ) {
      return res.status(403).json({
        message: "This user's profile is private",
      });
    }

    // 5. Create a unique cache key for this user's photos
    const cacheKey = `user:profile-photos:${targetUserId}`;

    // 6. Try retrieving photos from Redis
    try {
      const cachedPhotos = await getCache<unknown[]>(cacheKey);

      if (cachedPhotos !== null) {
        return res.status(200).json({
          message: "Profile photos retrieved successfully",
          photos: cachedPhotos,
        });
      }
    } catch (cacheError) {
      console.error("Redis cache retrieval error:", cacheError);
    }

    // 7. If cache misses, retrieve photos from PostgreSQL
    const photos = await prisma.profilePhoto.findMany({
      where: {
        userId: targetUserId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        imageUrl: true,
        storageKey: true,
        userId: true,
        createdAt: true,
      },
    });

    // 8. Store photos in Redis for 60 seconds
    try {
      await setCache(cacheKey, photos, 60);
    } catch (cacheError) {
      console.error("Redis cache storage error:", cacheError);
    }

    // 9. Return photos
    return res.status(200).json({
      message: "Profile photos retrieved successfully",
      photos,
    });
  } catch (error) {
    console.error("Get profile photos error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};



export const searchUsers = async (req: Request, res: Response) => {
  try {
    // 1. Validate authenticated user
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Extract and validate search query
    const query =
      typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.status(400).json({
        message: "Search query is required",
      });
    }

    // 3. Search users
    const users = await prisma.user.findMany({
      where: {
        id: {
          not: userId,
        },
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
      orderBy: {
        username: "asc",
      },
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
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  try {
    // 1. Validate authenticated user
    const userId = req.user?.userId;

    if (!userId) {
      // Remove files already uploaded by Multer
      await Promise.allSettled(
        files.map((file) => unlink(file.path)),
      );

      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Validate uploaded files
    if (files.length === 0) {
      return res.status(400).json({
        message: "Please upload at least one photo",
      });
    }

    // 3. Prepare database records once
    const photoData = files.map((file) => ({
      imageUrl: `/api/users/profile-photos/${file.filename}`,
      storageKey: file.filename,
      userId,
    }));

    // 4. Create and retrieve uploaded photos
    const uploadedPhotos = await prisma.$transaction(async (tx) => {
      await tx.profilePhoto.createMany({
        data: photoData,
      });

      return tx.profilePhoto.findMany({
        where: {
          userId,
          storageKey: {
            in: files.map((file) => file.filename),
          },
        },
        select: {
          id: true,
          imageUrl: true,
          storageKey: true,
          userId: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    });

    // 5. Return uploaded photos
    return res.status(201).json({
      message: "Profile photos uploaded successfully",
      photos: uploadedPhotos,
    });
  } catch (error) {
    // 6. Remove uploaded files if database operations fail
    const cleanupResults = await Promise.allSettled(
      files.map((file) => unlink(file.path)),
    );

    cleanupResults.forEach((result) => {
      if (result.status === "rejected") {
        console.error(
          "Profile photo cleanup error:",
          result.reason,
        );
      }
    });

    console.error("Profile photo upload error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


// DELETE PROFILE PHOTO
export const deleteProfilePhoto = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Validate authenticated user
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Validate photo ID
    const photoId = req.params.photoId;

    if (typeof photoId !== "string") {
      return res.status(400).json({
        message: "Invalid photo ID",
      });
    }

    // 3. Find photo
    const photo = await prisma.profilePhoto.findUnique({
      where: {
        id: photoId,
      },
      select: {
        id: true,
        userId: true,
        storageKey: true,
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

    // 5. Delete database record only if ownership still matches
    const deletedPhoto = await prisma.profilePhoto.deleteMany({
      where: {
        id: photoId,
        userId,
      },
    });

    if (deletedPhoto.count === 0) {
      return res.status(404).json({
        message: "Profile photo not found",
      });
    }

    // 6. Delete physical image
    const uploadDirectory = path.resolve(
      process.cwd(),
      "uploads",
      "profile-photos",
    );

    const filePath = path.resolve(
      uploadDirectory,
      path.basename(photo.storageKey),
    );

    if (!filePath.startsWith(`${uploadDirectory}${path.sep}`)) {
      console.error("Invalid profile photo storage path:", photo.storageKey);
    } else {
      try {
        await unlink(filePath);
      } catch (error) {
        if (
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          console.error("Profile photo file cleanup error:", error);
        }
      }
    }

    // 7. Return success
    return res.status(200).json({
      message: "Profile photo deleted successfully",
    });
  } catch (error) {
    console.error("Delete profile photo error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


// UPDATE PROFILE VISIBILITY
export const updateProfileVisibility = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Validate authenticated user
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Validate requested visibility
    const { profileVisibility } = req.body;

    if (
      profileVisibility !== "PUBLIC" &&
      profileVisibility !== "PRIVATE"
    ) {
      return res.status(400).json({
        message: "Profile visibility must be PUBLIC or PRIVATE",
      });
    }

    // 3. Update profile visibility
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

    // 4. Return updated profile
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


// GET SINGLE PROFILE PHOTO
export const getProfilePhoto = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Validate photo ID
    const photoId = req.params.photoId;

    if (typeof photoId !== "string") {
      return res.status(400).json({
        message: "Invalid photo ID",
      });
    }

    // 2. Retrieve photo and visibility information
    const photo = await prisma.profilePhoto.findFirst({
      where: {
        storageKey: photoId,
      },
      select: {
        userId: true,
        storageKey: true,
        user: {
          select: {
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

    // 3. Check profile visibility
    const userId = req.user?.userId;

    if (
      photo.user.profileVisibility === "PRIVATE" &&
      photo.userId !== userId
    ) {
      return res.status(403).json({
        message: "You are not allowed to view this photo",
      });
    }

    // 4. Resolve safe file path
    const uploadDirectory = path.resolve(
      process.cwd(),
      "uploads",
      "profile-photos",
    );

    const filePath = path.resolve(
      uploadDirectory,
      path.basename(photo.storageKey),
    );

    if (!filePath.startsWith(`${uploadDirectory}${path.sep}`)) {
      return res.status(400).json({
        message: "Invalid photo path",
      });
    }

    // 5. Send image asynchronously
    return res.sendFile(filePath, (error) => {
      if (error) {
        if (!res.headersSent) {
          if (
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return res.status(404).json({
              message: "Profile photo file not found",
            });
          }

          console.error("Profile photo delivery error:", error);

          return res.status(500).json({
            message: "Unable to retrieve profile photo",
          });
        }

        console.error("Profile photo delivery interrupted:", error);
      }
    });
  } catch (error) {
    console.error("Get profile photo error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
