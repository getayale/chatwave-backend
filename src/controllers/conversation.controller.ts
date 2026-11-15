
import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { createConversationSchema } from "../schemas/conversation.schema.js";
import { isUserOnline } from "../config/presence.js";

const addOnlineStatus = <
  T extends { participants: Array<{ user: { id: string } }> },
>(
  conversation: T,
) => {
  return {
    ...conversation,
    participants: conversation.participants.map(
      (participant) => ({
        ...participant,
        user: {
          ...participant.user,
          isOnline: isUserOnline(participant.user.id),
        },
      }),
    ),
  };
};

export const createConversation = async (
  req: Request,
  res: Response,
) => {
  try {
    const result = createConversationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    const userId = req.user?.userId;
    const { participantId } = result.data;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (userId === participantId) {
      return res.status(400).json({
        message: "You cannot create a conversation with yourself",
      });
    }

    const participant = await prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!participant) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: participantId } } },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (existingConversation) {
      return res.status(200).json({
        message: "Conversation already exists",
        conversation: addOnlineStatus(existingConversation),
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId },
            { userId: participantId },
          ],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return res.status(201).json({
      message: "Conversation created successfully",
      conversation: addOnlineStatus(conversation),
    });
  } catch (error) {
    console.error("Create conversation error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getConversations = async (
  req: Request,
  res: Response,
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: {
            userId,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          include: {
            readReceipts: {
              select: {
                userId: true,
                readAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversationsWithStatus =
      conversations.map(addOnlineStatus);

    return res.status(200).json({
      message: "Conversations retrieved successfully",
      conversations: conversationsWithStatus,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const searchConversations = async (
  req: Request,
  res: Response,
) => {
  try {
    const userId = req.user?.userId;
    const q = req.query.q;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof q !== "string" || !q.trim()) {
      return res.status(400).json({
        message: "Please provide a search term",
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        AND: [
          {
            participants: {
              some: { userId },
            },
          },
          {
            participants: {
              some: {
                userId: { not: userId },
                user: {
                  OR: [
                    {
                      username: {
                        contains: q.trim(),
                        mode: "insensitive",
                      },
                    },
                    {
                      displayName: {
                        contains: q.trim(),
                        mode: "insensitive",
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversationsWithStatus =
      conversations.map(addOnlineStatus);

    return res.status(200).json({
      message: "Conversations retrieved successfully",
      count: conversations.length,
      conversations: conversationsWithStatus,
    });
  } catch (error) {
    console.error("Search conversations error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
