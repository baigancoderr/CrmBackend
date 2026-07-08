const { redisClient } = require("../../config/redis");
const { authenticateSocket } = require("../../utils/socketAuth");
const chatService = require("./chat.service");

const PRESENCE_TTL_SECONDS = 30;

const setUserPresence = async (userId, isOnline) => {
  const key = `presence:${userId}`;

  if (isOnline) {
    await redisClient.set(key, "online", {
      EX: PRESENCE_TTL_SECONDS,
    });
  } else {
    await redisClient.del(key);
  }
};

const refreshPresence = async (userId) => {
  await redisClient.set(`presence:${userId}`, "online", {
    EX: PRESENCE_TTL_SECONDS,
  });
};

const setTypingState = async (
  conversationId,
  userId,
  isTyping
) => {
  const key = `typing:${conversationId}:${userId}`;

  if (isTyping) {
    await redisClient.set(key, "1", {
      EX: 5,
    });
  } else {
    await redisClient.del(key);
  }
};

const initializeChatSocket = (io) => {
  chatService.setSocketIo(io);

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      const user = await authenticateSocket(token);

      socket.user = user;
      next();
    } catch (error) {
      next(new Error(error.message));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id;

    socket.join(`user:${userId}`);
    await setUserPresence(userId, true);

    io.emit("user:online", {
      userId,
      name: socket.user.name,
    });

    socket.on("conversation:join", ({ conversationId }) => {
      if (!conversationId) {
        return;
      }

      socket.join(`conversation:${conversationId}`);
    });

    socket.on("conversation:leave", ({ conversationId }) => {
      if (!conversationId) {
        return;
      }

      socket.leave(`conversation:${conversationId}`);
    });

    socket.on("typing:start", async ({ conversationId }) => {
      if (!conversationId) {
        return;
      }

      await setTypingState(
        conversationId,
        userId,
        true
      );

      socket
        .to(`conversation:${conversationId}`)
        .emit("typing:start", {
          conversationId,
          userId,
          name: socket.user.name,
        });
    });

    socket.on("typing:stop", async ({ conversationId }) => {
      if (!conversationId) {
        return;
      }

      await setTypingState(
        conversationId,
        userId,
        false
      );

      socket
        .to(`conversation:${conversationId}`)
        .emit("typing:stop", {
          conversationId,
          userId,
        });
    });

    socket.on("presence:heartbeat", async () => {
      await refreshPresence(userId);
    });

    socket.on("disconnect", async () => {
      await setUserPresence(userId, false);

      io.emit("user:offline", {
        userId,
      });
    });
  });
};

module.exports = {
  initializeChatSocket,
};
