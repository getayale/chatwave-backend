
  import type { Request, Response } from "express";
import prisma from "../config/prisma.js";
import { getIO } from "../config/socket.js";
import {
  createMessageSchema,
  updateMessageSchema,
} from "../schemas/message.schema.js";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Express } from "express";
import { unlink } from "node:fs/promises";


export const sendMessage = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = createMessageSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Get authenticated user and conversation ID
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;

    if (typeof conversationId !== "string") {
      return res.status(400).json({
        message: "Invalid conversation ID",
      });
    }

    const { content } = result.data;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    // 3. Check conversation existence and user participation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        participants: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.participants.length === 0) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Save the message
    const message = await prisma.message.create({
      data: {
        content,
        senderId: userId,
        conversationId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // 5. Update conversation activity
    await prisma.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    // 6. Broadcast the saved message through Socket.IO
    getIO()
      .to(`conversation:${conversationId}`)
      .emit("message:new", message);

    // 7. Return successful response
    return res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("Send message error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;

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

    // 2. Check conversation existence and user participation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        participants: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.participants.length === 0) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 3. Get pagination parameters
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 30, 1),
      100,
    );

    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    // 4. Retrieve paginated messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        readReceipts: {
          select: {
            userId: true,
          },
        },
        attachments: true,
      },
    });

    // 5. Calculate read status
    const messagesWithReadStatus = messages.map((message) => {
      const isRead = message.readReceipts.some(
        (receipt) => receipt.userId !== message.senderId,
      );

      return {
        ...message,
        isRead,
      };
    });

    // 6. Return messages
    return res.status(200).json({
      message: "Messages retrieved successfully",
      messages: messagesWithReadStatus.reverse(),
      pagination: {
        page,
        limit,
        hasMore: messages.length === limit,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};



export const updateMessage = async (req: Request, res: Response) => {
  try {
    // 1. Validate incoming data
    const result = updateMessageSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        errors: result.error.issues,
      });
    }

    // 2. Get authenticated user and message ID
    const userId = req.user?.userId;
    const messageId = req.params.messageId;
    const { content } = result.data;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof messageId !== "string") {
      return res.status(400).json({
        message: "Invalid message ID",
      });
    }

    // 3. Update only if the message belongs to the authenticated user
    const resultUpdate = await prisma.message.updateMany({
      where: {
        id: messageId,
        senderId: userId,
      },
      data: {
        content,
      },
    });

    if (resultUpdate.count === 0) {
      const messageExists = await prisma.message.findUnique({
        where: {
          id: messageId,
        },
        select: {
          id: true,
        },
      });

      if (!messageExists) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      return res.status(403).json({
        message: "You can only edit your own messages",
      });
    }

    // 4. Retrieve the updated message
    const updatedMessage = await prisma.message.findUnique({
      where: {
        id: messageId,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: "Message updated successfully",
      data: updatedMessage,
    });
  } catch (error) {
    console.error("Update message error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const searchMessages = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user and conversation ID
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;
    const q = req.query.q;

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

    // 2. Validate search query
    if (typeof q !== "string" || !q.trim()) {
      return res.status(400).json({
        message: "Please provide a search term",
      });
    }

    const searchTerm = q.trim();

    // 3. Check conversation existence and user participation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        participants: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.participants.length === 0) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Search messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        content: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        content: true,
        senderId: true,
        conversationId: true,
        createdAt: true,
        updatedAt: true,
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    // 5. Return search results
    return res.status(200).json({
      message: "Messages retrieved successfully",
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Search messages error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const markMessagesAsRead = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user and conversation ID
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;

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

    // 2. Check conversation existence and user participation
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        participants: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.participants.length === 0) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 3. Create read receipts directly in the database
    const markedAt = new Date();

    const markedCount = await prisma.$executeRaw`
      INSERT INTO "MessageRead" ("id", "messageId", "userId", "readAt")
      SELECT
        gen_random_uuid()::text,
        m."id",
        ${userId},
        ${markedAt}
      FROM "Message" m
      WHERE m."conversationId" = ${conversationId}
        AND m."senderId" != ${userId}
        AND NOT EXISTS (
          SELECT 1
          FROM "MessageRead" mr
          WHERE mr."messageId" = m."id"
            AND mr."userId" = ${userId}
        )
      ON CONFLICT ("messageId", "userId") DO NOTHING
    `;

    // 4. Notify other conversation participants
    if (markedCount > 0) {
      getIO().to(`conversation:${conversationId}`).emit("message:read", {
        conversationId,
        userId,
        readAt: markedAt.toISOString(),
      });
    }

    // 5. Return the result
    return res.status(200).json({
      message: "Messages marked as read successfully",
      markedAsRead: markedCount,
    });
  } catch (error) {
    console.error("Mark messages as read error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};


export const getMessageReadReceipts = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Get authenticated user and message ID
    const userId = req.user?.userId;
    const messageId = req.params.messageId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof messageId !== "string") {
      return res.status(400).json({
        message: "Invalid message ID",
      });
    }

    // 2. Find message and verify conversation membership
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversation: {
          participants: {
            some: {
              userId,
            },
          },
        },
      },
      select: {
        id: true,
        readReceipts: {
          select: {
            id: true,
            readAt: true,
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

    // 3. Handle missing message
    if (!message) {
      const messageExists = await prisma.message.findUnique({
        where: {
          id: messageId,
        },
        select: {
          id: true,
        },
      });

      if (!messageExists) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Return read receipts
    return res.status(200).json({
      message: "Read receipts retrieved successfully",
      readReceipts: message.readReceipts,
    });
  } catch (error) {
    console.error("Get message read receipts error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};




export const sendAttachment = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user and request data
    const userId = req.user?.userId;
    const conversationId = req.params.conversationId;
    const files = req.files as Express.Multer.File[];

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

    if (!files || files.length === 0) {
      return res.status(400).json({
        message: "Please select at least one file",
      });
    }

    const content =
      typeof req.body.content === "string" ? req.body.content.trim() : "";

    // 2. Check conversation existence and membership
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      select: {
        id: true,
        participants: {
          where: {
            userId,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.participants.length === 0) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 3. Create message, attachments, and update conversation
    const message = await prisma.$transaction(async (tx) => {
      const newMessage = await tx.message.create({
        data: {
          content,
          senderId: userId,
          conversationId,
          attachments: {
            create: files.map((file) => ({
              fileName: file.originalname,
              storedName: file.filename,
              mimeType: file.mimetype,
              size: file.size,
              storageKey: file.filename,
              fileUrl: `/uploads/chat-files/${file.filename}`,
            })),
          },
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
            },
          },
          attachments: true,
        },
      });

      await tx.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return newMessage;
    });

    // 4. Broadcast the saved message
    getIO()
      .to(`conversation:${conversationId}`)
      .emit("message:new", message);

    // 5. Return successful response
    return res.status(201).json({
      message: "Attachment sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("Send attachment error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};





export const downloadAttachment = async (
  req: Request,
  res: Response,
) => {
  try {
    // 1. Get authenticated user and attachment ID
    const userId = req.user?.userId;
    const attachmentId = req.params.attachmentId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof attachmentId !== "string") {
      return res.status(400).json({
        message: "Invalid attachment ID",
      });
    }

    // 2. Find attachment and verify conversation membership
    const attachment = await prisma.chatAttachment.findFirst({
      where: {
        id: attachmentId,
        message: {
          conversation: {
            participants: {
              some: {
                userId,
              },
            },
          },
        },
      },
      select: {
        fileName: true,
        storageKey: true,
      },
    });

    if (!attachment) {
      return res.status(404).json({
        message: "Attachment not found or you cannot access it",
      });
    }

    // 3. Safely resolve file path
    const uploadDirectory = path.resolve("uploads/chat-files");

    const filePath = path.resolve(
      uploadDirectory,
      path.basename(attachment.storageKey),
    );

    // 4. Download file using streaming
    return res.download(
      filePath,
      attachment.fileName,
      (error) => {
        if (error) {
          if (!res.headersSent) {
            if (
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return res.status(404).json({
                message: "File not found on server",
              });
            }

            console.error("File download error:", error);

            return res.status(500).json({
              message: "Unable to download file",
            });
          }

          console.error("File download interrupted:", error);
        }
      },
    );
  } catch (error) {
    console.error("Download attachment error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};



export const deleteMessage = async (req: Request, res: Response) => {
  try {
    // 1. Get authenticated user and message ID
    const userId = req.user?.userId;
    const messageId = req.params.messageId;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (typeof messageId !== "string") {
      return res.status(400).json({
        message: "Invalid message ID",
      });
    }

    // 2. Find the message and verify ownership
    const existingMessage = await prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
      },
      select: {
        id: true,
        conversationId: true,
        attachments: {
          select: {
            storageKey: true,
          },
        },
      },
    });

    if (!existingMessage) {
      // Check whether the message exists
      const messageExists = await prisma.message.findUnique({
        where: {
          id: messageId,
        },
        select: {
          id: true,
        },
      });

      if (!messageExists) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      return res.status(403).json({
        message: "You can only delete your own messages",
      });
    }

    // 3. Delete the message from the database
    // Attachments and read receipts are deleted through cascade.
    await prisma.message.delete({
      where: {
        id: messageId,
      },
    });

    // 4. Delete physical attachment files
    const uploadDirectory = path.resolve("uploads/chat-files");

    const cleanupResults = await Promise.allSettled(
      existingMessage.attachments.map(async (attachment) => {
        const filePath = path.resolve(
          uploadDirectory,
          path.basename(attachment.storageKey),
        );

        // Ensure the file is inside the upload directory
        if (!filePath.startsWith(`${uploadDirectory}${path.sep}`)) {
          throw new Error("Invalid attachment file path");
        }

        try {
          await unlink(filePath);
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return;
          }

          throw error;
        }
      }),
    );

    // 5. Log failed file cleanup operations
    cleanupResults.forEach((result) => {
      if (result.status === "rejected") {
        console.error(
          "Attachment cleanup error:",
          result.reason,
        );
      }
    });

    // 6. Notify conversation participants
    getIO()
      .to(`conversation:${existingMessage.conversationId}`)
      .emit("message:deleted", {
        messageId,
        conversationId: existingMessage.conversationId,
      });

    // 7. Return successful response
    return res.status(200).json({
      message: "Message deleted successfully",
      messageId,
    });
  } catch (error) {
    console.error("Delete message error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
