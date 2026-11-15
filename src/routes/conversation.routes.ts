
import { Router } from "express";
import {
  createConversation,
  deleteConversation,
  getConversations,
  searchConversations,
} from "../controllers/conversation.controller.js";
import { authenticateToken } from "../middleware/auth.middleware.js";

const conversationRouter = Router();

conversationRouter.post("/", authenticateToken, createConversation);

conversationRouter.get("/", authenticateToken, getConversations);

conversationRouter.get("/search", authenticateToken, searchConversations);

conversationRouter.delete(
  "/:conversationId",
  authenticateToken,
  deleteConversation,
);

export default conversationRouter;
