
import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { createConversationSchema } from "../schemas/conversation.schema.js";

export const createConversation = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = createConversationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Get the logged-in user and the other participant
    const userId = req.user?.userId;
    const { participantId } = result.data;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 3. Prevent users from creating conversations with themselves
    if (userId === participantId) {
      return res.status(400).json({
        message: "You cannot create a conversation with yourself",
      });
    }

    // 4. Check whether the other user exists
    const participant = await prisma.user.findUnique({
      where: { id: participantId },
      select: { id: true },
    });

    if (!participant) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // 5. Find an existing conversation between both users
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
        conversation: existingConversation,
      });
    }

    // 6. Create a new conversation
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
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};




export const getConversations = async (req: Request, res: Response) => {
  try {
    // 1. Get the logged-in user
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Retrieve conversations belonging to this user
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

    // 3. Return conversations
    return res.status(200).json({
      message: "Conversations retrieved successfully",
      conversations,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};




export const searchConversations = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user and search query
    const userId = req.user?.userId;
    const q = req.query.q;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 2. Validate search query
    if (typeof q !== "string" || !q.trim()) {
      return res.status(400).json({
        message: "Please provide a search term",
      });
    }

    // 3. Search conversations by the other participant
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

    // 4. Return search results
    return res.status(200).json({
      message: "Conversations retrieved successfully",
      count: conversations.length,
      conversations,
    });
  } catch (error) {
    console.error("Search conversations error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
