
import type { Server } from "socket.io";

let io: Server;

export const initializeSocket = (server: Server) => {
  io = server;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized");
  }

  return io;
};
