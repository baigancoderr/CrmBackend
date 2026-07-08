const { redisClient } = require("../../config/redis");
const { authenticateSocket } = require("../../utils/socketAuth");
const chatService = require("./chat.service");
const {
  socketConversationSchema,
} = require("./chat.validation");
const {
  consumeRateLimit,
} = require("../../middleware/chatRateLimit.middleware");
const {
  incrementMetric,
  emitAbuseAlert,
  logAuditEvent,
} = require("../../utils/observability");

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

const getActiveSocketCount = (io, userId) => {
  const room = io.sockets.adapter.rooms.get(
    `user:${userId}`
  );

  return room ? room.size : 0;
};

const validateSocketPayload = (
  socket,
  eventName,
  schema,
  payload
) => {
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    socket.emit("socket:validation:error", {
      event: eventName,
      message: error.details
        .map((item) => item.message)
        .join(", "),
    });
    return null;
  }

  return value;
};

const enforceSocketRateLimit = async (
  socket,
  userId,
  eventName,
  maxRequests,
  windowSeconds
) => {
  const key = `rate:socket:${eventName}:${userId}`;
  const result = await consumeRateLimit({
    key,
    maxRequests,
    windowSeconds,
  });

  if (!result.exceeded) {
    return true;
  }

  await incrementMetric("chat_socket_rate_limited", {
    eventName,
    userId: userId.toString(),
  });
  await emitAbuseAlert("chat_socket_rate_limited", {
    eventName,
    userId: userId.toString(),
  });

  socket.emit("socket:rate-limited", {
    event: eventName,
    message: "Too many socket events. Please slow down.",
  });

  return false;
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
    const userRoom = `user:${userId}`;
    const wasOffline =
      getActiveSocketCount(io, userId) === 0;

    socket.join(userRoom);
    await setUserPresence(userId, true);

    if (wasOffline) {
      io.emit("user:online", {
        userId,
        name: socket.user.name,
      });
    }
    await logAuditEvent("chat_socket_connected", {
      userId: userId.toString(),
      socketId: socket.id,
    });

    socket.on(
      "conversation:join",
      async ({ conversationId }) => {
        try {
          const payload = validateSocketPayload(
            socket,
            "conversation:join",
            socketConversationSchema,
            { conversationId }
          );

          if (!payload) {
            return;
          }

          const allowed = await enforceSocketRateLimit(
            socket,
            userId,
            "conversation:join",
            40,
            60
          );

          if (!allowed) {
            return;
          }

          const hasAccess =
            await chatService.canAccessConversation(
              payload.conversationId,
              userId
            );

          if (!hasAccess) {
            socket.emit("conversation:join:error", {
              conversationId: payload.conversationId,
              message:
                "You do not have access to this conversation",
            });
            return;
          }

          socket.join(
            `conversation:${payload.conversationId}`
          );
        } catch (_error) {
          socket.emit("socket:error", {
            event: "conversation:join",
            message: "Failed to join conversation",
          });
        }
      }
    );

    socket.on(
      "conversation:leave",
      async ({ conversationId }) => {
        const payload = validateSocketPayload(
          socket,
          "conversation:leave",
          socketConversationSchema,
          { conversationId }
        );

        if (!payload) {
          return;
        }

        const allowed = await enforceSocketRateLimit(
          socket,
          userId,
          "conversation:leave",
          40,
          60
        );

        if (!allowed) {
          return;
        }

        socket.leave(
          `conversation:${payload.conversationId}`
        );
      }
    );

    socket.on("typing:start", async ({ conversationId }) => {
      const payload = validateSocketPayload(
        socket,
        "typing:start",
        socketConversationSchema,
        { conversationId }
      );

      if (!payload) {
        return;
      }

      const allowed = await enforceSocketRateLimit(
        socket,
        userId,
        "typing:start",
        80,
        60
      );

      if (!allowed) {
        return;
      }

      const hasAccess =
        await chatService.canAccessConversation(
          payload.conversationId,
          userId
        );

      if (!hasAccess) {
        return;
      }

      await setTypingState(
        payload.conversationId,
        userId,
        true
      );

      socket
        .to(`conversation:${payload.conversationId}`)
        .emit("typing:start", {
          conversationId: payload.conversationId,
          userId,
          name: socket.user.name,
        });
    });

    socket.on("typing:stop", async ({ conversationId }) => {
      const payload = validateSocketPayload(
        socket,
        "typing:stop",
        socketConversationSchema,
        { conversationId }
      );

      if (!payload) {
        return;
      }

      const allowed = await enforceSocketRateLimit(
        socket,
        userId,
        "typing:stop",
        100,
        60
      );

      if (!allowed) {
        return;
      }

      const hasAccess =
        await chatService.canAccessConversation(
          payload.conversationId,
          userId
        );

      if (!hasAccess) {
        return;
      }

      await setTypingState(
        payload.conversationId,
        userId,
        false
      );

      socket
        .to(`conversation:${payload.conversationId}`)
        .emit("typing:stop", {
          conversationId: payload.conversationId,
          userId,
        });
    });

    socket.on("presence:heartbeat", async () => {
      const allowed = await enforceSocketRateLimit(
        socket,
        userId,
        "presence:heartbeat",
        90,
        60
      );

      if (!allowed) {
        return;
      }

      await refreshPresence(userId);
    });

    socket.on("disconnect", async () => {
      const remainingConnections = getActiveSocketCount(
        io,
        userId
      );

      if (remainingConnections === 0) {
        await setUserPresence(userId, false);

        io.emit("user:offline", {
          userId,
        });
      } else {
        await refreshPresence(userId);
      }

      await logAuditEvent("chat_socket_disconnected", {
        userId: userId.toString(),
        socketId: socket.id,
        remainingConnections,
      });
    });
  });
};

module.exports = {
  initializeChatSocket,
};
