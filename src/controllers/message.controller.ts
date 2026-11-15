
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

    // 3. Check whether the conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    // 4. Check whether the user belongs to this conversation
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 5. Save the message
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

    // 6. Update conversation activity
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
      },
    });

    // 7. Broadcast the saved message through Socket.IO
    getIO()
      .to(`conversation:${conversationId}`)
      .emit("message:new", message);

    // 8. Return successful response
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

    // 2. Check whether the conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    // 3. Check whether the user belongs to this conversation
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Retrieve messages and their read receipts
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: "asc",
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
        readReceipts: {
          select: {
            userId: true,
          },
        },
          attachments: true,
      },
    });

    // 5. Calculate whether each message has been read
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
      messages: messagesWithReadStatus,
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

    // 3. Find the message
    const existingMessage = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!existingMessage) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    // 4. Check message ownership
    if (existingMessage.senderId !== userId) {
      return res.status(403).json({
        message: "You can only edit your own messages",
      });
    }

    // 5. Update the message
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { content },
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
}
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

    // 3. Check whether the conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    // 4. Check whether the user belongs to this conversation
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 5. Search messages
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        content: {
          contains: q.trim(),
          mode: "insensitive",
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
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    // 6. Return search results
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

    // 2. Check whether the conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    // 3. Verify conversation membership
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Retrieve unread messages sent by other users
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        senderId: {
          not: userId,
        },
        readReceipts: {
          none: {
            userId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    // 5. Create read receipts without duplicates
    const result = await prisma.messageRead.createMany({
      data: messages.map((message) => ({
        messageId: message.id,
        userId,
      })),
      skipDuplicates: true,
    });

    // 6. Notify other conversation participants
    if (result.count > 0) {
      const io = getIO();

      io.to(`conversation:${conversationId}`).emit("message:read", {
        conversationId,
        userId,
        messageIds: messages.map((message) => message.id),
        readAt: new Date().toISOString(),
      });
    }

    // 7. Return the result
    return res.status(200).json({
      message: "Messages marked as read successfully",
      markedAsRead: result.count,
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

    // 2. Find the message
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        readReceipts: {
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

    if (!message) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    // 3. Verify conversation membership
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId: message.conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    // 4. Return read receipts
    return res.status(200).json({
      message: "Read receipts retrieved successfully",
      readReceipts: message.readReceipts.map((receipt) => ({
        id: receipt.id,
        readAt: receipt.readAt,
        user: receipt.user,
      })),
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

    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });

    if (!participant) {
      return res.status(403).json({
        message: "You are not a participant in this conversation",
      });
    }

    const message = await prisma.$transaction(async (tx) => {
      return tx.message.create({
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
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    getIO()
      .to(`conversation:${conversationId}`)
      .emit("message:new", message);

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

    const attachment = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          select: {
            conversationId: true,
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({
        message: "Attachment not found",
      });
    }

    const participant =
      await prisma.conversationParticipant.findUnique({
        where: {
          userId_conversationId: {
            userId,
            conversationId: attachment.message.conversationId,
          },
        },
      });

    if (!participant) {
      return res.status(403).json({
        message: "You cannot access this attachment",
      });
    }

    const uploadDirectory = path.resolve("uploads/chat-files");
    const filePath = path.resolve(
      uploadDirectory,
      path.basename(attachment.storageKey),
    );

    if (!existsSync(filePath)) {
      return res.status(404).json({
        message: "File not found on server",
      });
    }

    return res.download(
      filePath,
      attachment.fileName,
      (error) => {
        if (error && !res.headersSent) {
          console.error("File download error:", error);
          res.status(500).json({
            message: "Unable to download file",
          });
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
    const userId = req.user?.userId;
    const messageId = req.params.messageId;

    // 1. Validate authenticated user
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

    // 2. Find the message and its attachments
    const existingMessage = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        attachments: true,
      },
    });

    if (!existingMessage) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    // 3. Only the sender can delete their message
    if (existingMessage.senderId !== userId) {
      return res.status(403).json({
        message: "You can only delete your own messages",
      });
    }

    // 4. Delete the message from the database
    // Prisma also deletes its attachments and read receipts
    // because of onDelete: Cascade.
    await prisma.message.delete({
      where: { id: messageId },
    });

    // 5. Delete the physical attachment files
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
          // Ignore files that are already missing
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

    // Log any physical files that could not be deleted
    cleanupResults.forEach((result) => {
      if (result.status === "rejected") {
        console.error(
          "Attachment cleanup error:",
          result.reason,
        );
      }
    });

    // 6. Notify everyone in this conversation
    getIO()
      .to(`conversation:${existingMessage.conversationId}`)
      .emit("message:deleted", {
        messageId,
        conversationId: existingMessage.conversationId,
      });

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
