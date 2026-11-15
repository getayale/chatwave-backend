
import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

import app from "./app.js";
import prisma from "./config/prisma.js";
import { initializeSocket } from "./config/socket.js";
import {
  addUserConnection,
  removeUserConnection,
  getOnlineUsers,
} from "./config/presence.js";

const PORT = 3000;

// 1. Create HTTP server
const httpServer = createServer(app);

// 2. Initialize Socket.IO
const allowedOrigins = [
  "http://localhost:4200",
  "http://localhost:5173",
  "http://localhost:5000",
];

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// Make Socket.IO available to controllers
initializeSocket(io);

// 3. Authenticate Socket.IO connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const secret = process.env.JWT_SECRET;

  if (typeof token !== "string") {
    return next(new Error("Authentication required"));
  }

  if (!secret) {
    return next(
      new Error("Server authentication is not configured"),
    );
  }

  try {
    const decoded = jwt.verify(token, secret);

    if (
      typeof decoded === "string" ||
      typeof decoded.userId !== "string"
    ) {
      return next(new Error("Invalid token"));
    }

    socket.data.userId = decoded.userId;

    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

// 4. Handle authenticated connections
io.on("connection", (socket) => {
  const userId = socket.data.userId;

  console.log(`User connected: ${userId}`);
  console.log(`Socket ID: ${socket.id}`);

  // Track this user's socket connection
  const wasOffline = addUserConnection(userId, socket.id);

  console.log("Was previously offline:", wasOffline);
  console.log("Current online users:", getOnlineUsers());

  // Broadcast online status only when the user first connects
  if (wasOffline) {
    socket.broadcast.emit("presence:online", {
      userId,
    });
  }

  // Send current online users to this connection
  socket.emit("presence:online-users", {
    userIds: getOnlineUsers(),
  });

  // Join private user room
  socket.join(`user:${userId}`);

  // Join conversation room
  socket.on(
    "conversation:join",
    async (conversationId: unknown) => {
      try {
        if (typeof conversationId !== "string") {
          socket.emit("conversation:error", {
            message: "Invalid conversation ID",
          });
          return;
        }

        // Verify conversation membership
        const participant =
          await prisma.conversationParticipant.findUnique({
            where: {
              userId_conversationId: {
                userId,
                conversationId,
              },
            },
          });

        if (!participant) {
          socket.emit("conversation:error", {
            message:
              "You are not allowed to join this conversation",
          });
          return;
        }

        // Join authorized room
        await socket.join(`conversation:${conversationId}`);

        socket.emit("conversation:joined", {
          conversationId,
        });

        console.log(
          `User ${userId} joined conversation ${conversationId}`,
        );
      } catch (error) {
        console.error("Conversation join error:", error);

        socket.emit("conversation:error", {
          message: "Unable to join conversation",
        });
      }
    },
  );

  // Leave conversation room
  socket.on(
    "conversation:leave",
    (conversationId: unknown) => {
      if (typeof conversationId !== "string") {
        return;
      }

      socket.leave(`conversation:${conversationId}`);

      console.log(
        `User ${userId} left conversation ${conversationId}`,
      );
    },
  );

  // Typing indicators: user starts typing
  socket.on("typing:start", (conversationId: unknown) => {
    if (
      typeof conversationId !== "string" ||
      !socket.rooms.has(`conversation:${conversationId}`)
    ) {
      return;
    }

    socket
      .to(`conversation:${conversationId}`)
      .emit("typing:start", {
        conversationId,
        userId,
      });
  });

  // Typing indicators: user stops typing
  socket.on("typing:stop", (conversationId: unknown) => {
    if (
      typeof conversationId !== "string" ||
      !socket.rooms.has(`conversation:${conversationId}`)
    ) {
      return;
    }

    socket
      .to(`conversation:${conversationId}`)
      .emit("typing:stop", {
        conversationId,
        userId,
      });
  });

  // 5. Handle disconnection
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${userId}`);
    console.log(`Disconnected socket ID: ${socket.id}`);

    const becameOffline = removeUserConnection(
      userId,
      socket.id,
    );

    // Diagnostic logs
    console.log("Became offline:", becameOffline);
    console.log("Remaining online users:", getOnlineUsers());

    // Broadcast offline status only when all connections are closed
    if (becameOffline) {
      console.log(`Broadcasting offline status for: ${userId}`);

      socket.broadcast.emit("presence:offline", {
        userId,
      });
    } else {
      console.log(
        `User ${userId} still has another active connection`,
      );
    }
  });
});

// 6. Start server
httpServer.listen(PORT, () => {
  console.log(`ChatWave API running on port ${PORT}`);
  console.log("Socket.IO is ready");
});
