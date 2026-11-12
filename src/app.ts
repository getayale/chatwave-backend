
import express from "express";
import cors from "cors";

import prisma from "./config/prisma.js";
import authRouter from "./routes/auth.routes.js";
import userRouter from "./routes/user.routes.js";
import conversationRouter from "./routes/conversation.routes.js";
import messageRouter from "./routes/message.routes.js";

const app = express();

// Allow frontend development origins
app.use(
  cors({
    origin: [
      "http://localhost:5000",
      "http://localhost:4200",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Welcome to ChatWave API!",
    status: "Server is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "ChatWave API is healthy",
  });
});

app.get("/health/db", async (req, res) => {
  try {
    await prisma.$connect();

    res.json({
      status: "OK",
      message: "ChatWave database connected successfully!",
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed",
    });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/conversations", conversationRouter);
app.use("/api", messageRouter);

export default app;
