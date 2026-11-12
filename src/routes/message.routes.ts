
import { Router } from "express";
import { deleteMessage, getMessages, markMessagesAsRead, searchMessages, sendMessage, updateMessage } from "../controllers/message.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const messageRouter = Router();

messageRouter.post(
  "/conversations/:conversationId/messages",
  authenticateToken,
  sendMessage
);

messageRouter.get(
  "/conversations/:conversationId/messages",
  authenticateToken,
  getMessages
);

messageRouter.patch(
  "/messages/:messageId",
  authenticateToken,
  updateMessage
);
messageRouter.delete(
  "/messages/:messageId",
  authenticateToken,
  deleteMessage
);


messageRouter.get(
  "/conversations/:conversationId/messages/search",
  authenticateToken,
  searchMessages);

  messageRouter.patch(
  "/conversations/:conversationId/read",
  authenticateToken,
  markMessagesAsRead);
export default messageRouter;
