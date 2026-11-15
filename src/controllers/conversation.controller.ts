
import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { createConversationSchema } from "../schemas/conversation.schema.js";
import { isUserOnline } from "../config/presence.js";

// Reusable participant fields for conversation responses
const conversationInclude = {
  participants: {
    select: {
      id: true,
      userId: true,
      conversationId: true,
      joinedAt: true,
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
};

const addOnlineStatus = <
  T extends { participants: Array<{ user: { id: string } }> },
>(
  conversation: T,
) => {
  return {
    ...conversation,
    participants: conversation.participants.map((participant) => ({
      ...participant,
      user: {
        ...participant.user,
        isOnline: isUserOnline(participant.user.id),
      },
    })),
  };
};

// CREATE CONVERSATION
export const createConversation = async (
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

    // 1. Validate request data
    const result = createConversationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    const { participantId } = result.data;

    if (userId === participantId) {
      return res.status(400).json({
        message: "You cannot create a conversation with yourself",
      });
    }

    // 2. Check whether a conversation already exists
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          {
            participants: {
              some: { userId },
            },
          },
          {
            participants: {
              some: { userId: participantId },
            },
          },
        ],
      },
      include: conversationInclude,
    });

    if (existingConversation) {
      // Restore the conversation for this user if previously deleted
      await prisma.conversationParticipant.updateMany({
        where: {
          conversationId: existingConversation.id,
          userId,
          deletedAt: {
            not: null,
          },
        },
        data: {
          deletedAt: null,
        },
      });

      return res.status(200).json({
        message: "Conversation already exists",
        conversation: addOnlineStatus(existingConversation),
      });
    }

    // 3. Check whether the other user exists
    const participant = await prisma.user.findUnique({
      where: {
        id: participantId,
      },
      select: {
        id: true,
      },
    });

    if (!participant) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // 4. Create conversation and participants
    const conversation = await prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId },
            { userId: participantId },
          ],
        },
      },
      include: conversationInclude,
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

// GET CONVERSATIONS
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
            deletedAt: null,
          },
        },
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,

        participants: conversationInclude.participants,

        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            content: true,
            senderId: true,
            conversationId: true,
            createdAt: true,
            updatedAt: true,
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

    const conversationsWithStatus = conversations.map(addOnlineStatus);

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

// SEARCH CONVERSATIONS
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

    // Trim once and reuse the search term
    const searchTerm = q.trim();

    const conversations = await prisma.conversation.findMany({
      where: {
        AND: [
          {
            participants: {
              some: {
                userId,
                deletedAt: null,
              },
            },
          },
          {
            participants: {
              some: {
                userId: {
                  not: userId,
                },
                user: {
                  OR: [
                    {
                      username: {
                        contains: searchTerm,
                        mode: "insensitive",
                      },
                    },
                    {
                      displayName: {
                        contains: searchTerm,
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
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,

        participants: conversationInclude.participants,

        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            content: true,
            senderId: true,
            conversationId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversationsWithStatus = conversations.map(addOnlineStatus);

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

// DELETE CONVERSATION FOR CURRENT USER ONLY
export const deleteConversation = async (
  req: Request,
  res: Response,
) => {
  try {
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;

    // 1. Validate authenticated user
    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof conversationId !== "string") {
      return res.status(400).json({
        message: "Invalid conversation ID",
      });
    }

    // 2. Hide conversation for this user only
    const result = await prisma.conversationParticipant.updateMany({
      where: {
        conversationId,
        userId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    // 3. Check whether a conversation was actually hidden
    if (result.count === 0) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    return res.status(200).json({
      message: "Conversation deleted successfully",
      conversationId,
    });
  } catch (error) {
    console.error("Delete conversation error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
