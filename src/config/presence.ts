
const connectedUsers = new Map<string, Set<string>>();

export const addUserConnection = (userId: string, socketId: string) => {
  const userSockets = connectedUsers.get(userId) ?? new Set<string>();

  const wasOffline = userSockets.size === 0;

  userSockets.add(socketId);
  connectedUsers.set(userId, userSockets);

  return wasOffline;
};

export const removeUserConnection = (
  userId: string,
  socketId: string,
) => {
  const userSockets = connectedUsers.get(userId);

  if (!userSockets) {
    return false;
  }

  userSockets.delete(socketId);

  if (userSockets.size === 0) {
    connectedUsers.delete(userId);
    return true;
  }

  return false;
};

export const isUserOnline = (userId: string): boolean => {
  return connectedUsers.has(userId);
};

export const getOnlineUsers = (): string[] => {
  return Array.from(connectedUsers.keys());
};
