
import { Router } from "express";
import { deleteMessage, downloadAttachment, getMessages, markMessagesAsRead, searchMessages, sendAttachment, sendMessage, updateMessage } from "../controllers/message.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";
import { chatUpload } from "../config/chat-upload.js";
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

  messageRouter.post(
  "/conversations/:conversationId/attachments",
  authenticateToken,
  chatUpload.array("files", 5),
  sendAttachment
);

messageRouter.get(
  "/attachments/:attachmentId/download",
  authenticateToken,
  downloadAttachment);
export default messageRouter;
