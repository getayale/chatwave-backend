import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { updateProfileSchema } from "../schemas/user.schema.js";

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