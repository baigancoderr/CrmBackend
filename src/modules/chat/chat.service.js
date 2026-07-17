const Conversation = require("./conversation.model");
const Message = require("./message.model");
const User = require("../user/user.model");
const path = require("path");
const fs = require("fs/promises");
const { redisClient } = require("../../config/redis");
const {
  logAuditEvent,
  incrementMetric,
} = require("../../utils/observability");

// Group create/manage allowed only for these system roles.
const GROUP_MANAGER_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
];

const USER_POPULATE_FIELDS =
  "name employeeId role designation department profilePhoto";

const DRAWER_USER_FIELDS =
  "name employeeId role designation department profilePhoto email phone";

const isPrivateStorageEnabled =
  process.env.CHAT_UPLOAD_PRIVATE_STORAGE === "true";

const getActiveMember = (conversation, userId) => {
  const memberId = userId.toString();

  return conversation.members.find((member) => {
    if (member.leftAt) {
      return false;
    }

    // Supports both raw ObjectId and populated user object.
    const memberUserId =
      member.user && member.user._id
        ? member.user._id.toString()
        : member.user?.toString();

    return memberUserId === memberId;
  });
};

const assertActiveMember = (conversation, userId) => {
  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  const member = getActiveMember(conversation, userId);

  if (!member) {
    throw new Error("You do not have access to this conversation");
  }

  return member;
};

const assertGroupManager = (conversation, userId, userRole) => {
  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  // HR / PM / Super Admin can manage any group (membership not required).
  if (GROUP_MANAGER_ROLES.includes(userRole)) {
    return;
  }

  throw new Error(
    "Only HR, Project Manager or Super Admin can manage groups"
  );
};

const canCreateGroup = (role) => {
  return GROUP_MANAGER_ROLES.includes(role);
};

const isGroupManagerRole = (role) => {
  return GROUP_MANAGER_ROLES.includes(role);
};

const normalizeUserIds = (userIds = []) => {
  const uniqueIds = [
    ...new Set(
      userIds
        .filter(Boolean)
        .map((id) => id.toString())
    ),
  ];

  return uniqueIds;
};

const validateActiveUsers = async (userIds) => {
  if (!userIds.length) {
    return [];
  }

  const users = await User.find({
    _id: { $in: userIds },
    isActive: true,
  })
    .select("_id")
    .lean();

  if (users.length !== userIds.length) {
    throw new Error("One or more selected users are invalid or inactive");
  }

  return users.map((user) => user._id);
};

const findExistingDm = async (userId, otherUserId) => {
  const targetIds = [userId.toString(), otherUserId.toString()].sort();

  const conversations = await Conversation.find({
    type: "DM",
    isDeleted: false,
    "members.user": {
      $all: [userId, otherUserId],
    },
  }).lean();

  return (
    conversations.find((conversation) => {
      const memberIds = conversation.members
        .filter((member) => !member.leftAt)
        .map((member) => member.user.toString())
        .sort();

      return (
        memberIds.length === 2 &&
        memberIds[0] === targetIds[0] &&
        memberIds[1] === targetIds[1]
      );
    }) || null
  );
};

const buildConversationQueryForUser = (userId) => {
  return {
    isDeleted: false,
    members: {
      $elemMatch: {
        user: userId,
        leftAt: null,
      },
    },
  };
};

const populateConversation = (query) => {
  return query
    .populate("createdBy", USER_POPULATE_FIELDS)
    .populate("members.user", USER_POPULATE_FIELDS)
    .populate("lastMessage.sender", USER_POPULATE_FIELDS)
    .populate("deletedBy", USER_POPULATE_FIELDS);
};

const populateMessage = (query) => {
  return query
    .populate("sender", USER_POPULATE_FIELDS)
    .populate("mentions", USER_POPULATE_FIELDS)
    .populate({
      path: "forwardedFrom",
      select: "content type sender conversation",
      populate: {
        path: "sender",
        select: USER_POPULATE_FIELDS,
      },
    })
    .populate({
      path: "replyTo",
      populate: {
        path: "sender",
        select: USER_POPULATE_FIELDS,
      },
    });
};

const getUnreadCountForConversation = async (
  conversation,
  member
) => {
  const lastReadAt = member.lastReadAt || new Date(0);

  return Message.countDocuments({
    conversation: conversation._id,
    createdAt: { $gt: lastReadAt },
    isDeletedForAll: false,
    sender: { $ne: member.user },
    deletedFor: { $ne: member.user },
  });
};

const buildMessagePreviewFromType = (type, content, fileMeta) => {
  const normalizedContent =
    typeof content === "string" ? content.trim() : "";

  if (type === "IMAGE") {
    return "📷 Image";
  }

  if (type === "FILE") {
    const fileName =
      typeof fileMeta?.name === "string" ? fileMeta.name.trim() : "";

    return fileName ? `📎 ${fileName}` : "📎 File";
  }

  return normalizedContent;
};

const getVisibleLastMessageForUser = async (
  conversationId,
  userId
) => {
  const latestMessage = await Message.findOne({
    conversation: conversationId,
    isDeletedForAll: false,
    deletedFor: { $ne: userId },
  })
    .sort({ createdAt: -1 })
    .select("type content fileMeta sender createdAt")
    .lean();

  if (!latestMessage) {
    return {
      text: "",
      sender: null,
      sentAt: null,
    };
  }

  return {
    text: buildMessagePreviewFromType(
      latestMessage.type,
      latestMessage.content,
      latestMessage.fileMeta
    ),
    sender: latestMessage.sender || null,
    sentAt: latestMessage.createdAt,
  };
};

const refreshConversationLastMessage = async (
  conversationId
) => {
  const latestMessage = await Message.findOne({
    conversation: conversationId,
    isDeletedForAll: false,
  })
    .sort({ createdAt: -1 })
    .select("type content fileMeta sender createdAt")
    .lean();

  if (!latestMessage) {
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        text: "",
        sender: null,
        sentAt: null,
      },
    });

    return;
  }

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: {
      text: buildMessagePreviewFromType(
        latestMessage.type,
        latestMessage.content,
        latestMessage.fileMeta
      ),
      sender: latestMessage.sender || null,
      sentAt: latestMessage.createdAt,
    },
  });
};

const canAccessConversation = async (
  conversationId,
  userId
) => {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    isDeleted: false,
    members: {
      $elemMatch: {
        user: userId,
        leftAt: null,
      },
    },
  })
    .select("_id")
    .lean();

  return Boolean(conversation);
};

const recomputeUnreadCounters = async (conversationId) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    return;
  }

  let changed = false;

  for (const member of conversation.members) {
    if (member.leftAt) {
      if (member.unreadCount !== 0) {
        member.unreadCount = 0;
        changed = true;
      }
      continue;
    }

    const unreadCount = await getUnreadCountForConversation(
      conversation,
      member
    );

    if ((member.unreadCount || 0) !== unreadCount) {
      member.unreadCount = unreadCount;
      changed = true;
    }
  }

  if (changed) {
    await conversation.save();
  }
};

const formatConversation = async (conversation, userId) => {
  const member = getActiveMember(conversation, userId);
  const unreadCount = member
    ? typeof member.unreadCount === "number"
      ? member.unreadCount
      : await getUnreadCountForConversation(
          conversation,
          member
        )
    : 0;

  let displayName = conversation.name;
  let displayPhoto = conversation.photo;
  let otherUserId = null;

  if (conversation.type === "DM") {
    const otherMember = conversation.members.find(
      (entry) =>
        entry.user &&
        entry.user._id.toString() !== userId.toString() &&
        !entry.leftAt
    );

    if (otherMember && otherMember.user) {
      displayName = otherMember.user.name;
      displayPhoto = otherMember.user.profilePhoto || "";
      otherUserId = otherMember.user._id?.toString() || null;
    }
  }

  const visibleLastMessage = await getVisibleLastMessageForUser(
    conversation._id,
    userId
  );

  return {
    ...conversation,
    displayName,
    displayPhoto,
    otherUserId,
    lastMessage: visibleLastMessage,
    unreadCount,
    myRole: member ? member.role : null,
    lastReadAt: member ? member.lastReadAt : null,
  };
};

const createSystemMessage = async (
  conversationId,
  content,
  io
) => {
  const message = await Message.create({
    conversation: conversationId,
    sender: null,
    type: "SYSTEM",
    content,
  });

  const populatedMessage = await populateMessage(
    Message.findById(message._id)
  );

  const savedMessage = await populatedMessage;

  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: {
      text: content,
      sender: null,
      sentAt: savedMessage.createdAt,
    },
  });

  const conversation = await Conversation.findById(
    conversationId
  );

  if (conversation) {
    for (const member of conversation.members) {
      if (member.leftAt) {
        continue;
      }

      member.unreadCount = (member.unreadCount || 0) + 1;
    }

    await conversation.save();
  }

  if (io && conversation) {
    // Same as sendMessage: only user rooms (no conversation-room duplicate)
    conversation.members.forEach((member) => {
      if (member.leftAt) {
        return;
      }

      const memberId = member.user.toString();
      io.to(`user:${memberId}`).emit("message:new", {
        conversationId,
        message: savedMessage,
      });
    });
  }

  incrementMetric("chat_system_message_created", {
    conversationId: conversationId.toString(),
  }).catch(() => undefined);

  return savedMessage;
};

const createConversation = async (payload, user) => {
  const { type, name, description, memberIds = [] } = payload;

  if (!type || !["DM", "GROUP"].includes(type)) {
    throw new Error("Conversation type must be DM or GROUP");
  }

  if (type === "GROUP" && !canCreateGroup(user.role)) {
    throw new Error("You are not allowed to create groups");
  }

  if (type === "GROUP" && !name?.trim()) {
    throw new Error("Group name is required");
  }

  const normalizedMemberIds = normalizeUserIds(memberIds);

  if (type === "DM") {
    if (normalizedMemberIds.length !== 1) {
      throw new Error("DM requires exactly one other member");
    }

    if (normalizedMemberIds[0] === user.id.toString()) {
      throw new Error("You cannot start a DM with yourself");
    }

    const existingDm = await findExistingDm(
      user.id,
      normalizedMemberIds[0]
    );

    if (existingDm) {
      const conversation = await populateConversation(
        Conversation.findById(existingDm._id)
      );

      return formatConversation(
        conversation.toObject(),
        user.id
      );
    }
  }

  if (type === "GROUP" && normalizedMemberIds.length < 1) {
    throw new Error("Add at least one member to the group");
  }

  const validatedMemberIds = await validateActiveUsers(
    normalizedMemberIds
  );

  const members = [
    {
      user: user.id,
      role: "ADMIN",
      joinedAt: new Date(),
      lastReadAt: new Date(),
      unreadCount: 0,
    },
    ...validatedMemberIds
      .filter(
        (memberId) =>
          memberId.toString() !== user.id.toString()
      )
      .map((memberId) => ({
        user: memberId,
        role: "MEMBER",
        joinedAt: new Date(),
        lastReadAt: null,
        unreadCount: 0,
      })),
  ];

  const conversation = await Conversation.create({
    type,
    name: type === "GROUP" ? name.trim() : "",
    description: description?.trim() || "",
    createdBy: user.id,
    members,
  });

  const populatedConversation = await populateConversation(
    Conversation.findById(conversation._id)
  );

  if (type === "GROUP") {
    await createSystemMessage(
      conversation._id,
      `${user.name} created this group`
    );
  }

  await incrementMetric("chat_conversation_created", {
    type,
    createdBy: user.id.toString(),
  });
  await logAuditEvent("chat_conversation_created", {
    conversationId: conversation._id.toString(),
    type,
    createdBy: user.id.toString(),
  });

  return formatConversation(
    populatedConversation.toObject(),
    user.id
  );
};

const getMyConversations = async (userId, query = {}, userRole = "") => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(
    Math.max(Number(query.limit) || 20, 1),
    50
  );
  const skip = (page - 1) * limit;

  // Managers can see all active groups + their own DMs.
  const filter = isGroupManagerRole(userRole)
    ? {
        isDeleted: false,
        $or: [
          buildConversationQueryForUser(userId),
          { type: "GROUP" },
        ],
      }
    : buildConversationQueryForUser(userId);

  const [conversations, totalRecords] = await Promise.all([
    populateConversation(
      Conversation.find(filter)
        .sort({ "lastMessage.sentAt": -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
    ),
    Conversation.countDocuments(filter),
  ]);

  const formattedConversations = await Promise.all(
    conversations.map((conversation) =>
      formatConversation(conversation.toObject(), userId)
    )
  );

  return {
    page,
    limit,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    data: formattedConversations,
  };
};

const getConversationById = async (
  conversationId,
  userId,
  userRole = ""
) => {
  const conversation = await populateConversation(
    Conversation.findById(conversationId)
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  if (
    !(
      isGroupManagerRole(userRole) &&
      conversation.type === "GROUP"
    )
  ) {
    assertActiveMember(conversation, userId);
  }

  return formatConversation(
    conversation.toObject(),
    userId
  );
};

const updateConversation = async (
  conversationId,
  payload,
  user
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("Only group conversations can be updated");
  }

  assertGroupManager(conversation, user.id, user.role);

  if (payload.name !== undefined) {
    if (!payload.name.trim()) {
      throw new Error("Group name cannot be empty");
    }

    conversation.name = payload.name.trim();
  }

  if (payload.description !== undefined) {
    conversation.description = payload.description.trim();
  }

  if (payload.photo !== undefined) {
    conversation.photo = payload.photo;
  }

  await conversation.save();

  const populatedConversation = await populateConversation(
    Conversation.findById(conversation._id)
  );

  await incrementMetric("chat_conversation_updated", {
    actorId: user.id.toString(),
  });
  await logAuditEvent("chat_conversation_updated", {
    conversationId: conversationId.toString(),
    actorId: user.id.toString(),
  });

  return formatConversation(
    populatedConversation.toObject(),
    user.id
  );
};

const deleteConversation = async (
  conversationId,
  user,
  io
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("Only group conversations can be deleted");
  }

  assertGroupManager(conversation, user.id, user.role);

  conversation.isDeleted = true;
  conversation.deletedAt = new Date();
  conversation.deletedBy = user.id;
  await conversation.save();

  const memberIds = conversation.members
    .filter((member) => !member.leftAt)
    .map((member) => member.user.toString());

  if (io) {
    memberIds.forEach((memberId) => {
      io.to(`user:${memberId}`).emit(
        "conversation:deleted",
        {
          conversationId,
        }
      );
    });
  }

  await incrementMetric("chat_conversation_deleted", {
    actorId: user.id.toString(),
  });
  await logAuditEvent("chat_conversation_deleted", {
    conversationId: conversationId.toString(),
    actorId: user.id.toString(),
  });

  return {
    conversationId,
    deletedAt: conversation.deletedAt,
  };
};

const leaveConversation = async (
  conversationId,
  userId,
  io
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("You cannot leave a direct message");
  }

  const member = assertActiveMember(conversation, userId);
  const user = await User.findById(userId)
    .select("name")
    .lean();

  member.leftAt = new Date();
  member.unreadCount = 0;

  const activeAdmins = conversation.members.filter(
    (entry) => !entry.leftAt && entry.role === "ADMIN"
  );

  if (
    member.role === "ADMIN" &&
    activeAdmins.length === 1
  ) {
    const nextAdmin = conversation.members.find(
      (entry) =>
        !entry.leftAt &&
        entry.user.toString() !== userId.toString()
    );

    if (nextAdmin) {
      nextAdmin.role = "ADMIN";
    }
  }

  await conversation.save();

  await createSystemMessage(
    conversation._id,
    `${user.name} left the group`,
    io
  );

  if (io) {
    io.to(`user:${userId}`).emit("conversation:left", {
      conversationId,
    });
  }

  await incrementMetric("chat_conversation_left", {
    userId: userId.toString(),
  });

  return {
    conversationId,
    leftAt: member.leftAt,
  };
};

const getConversationMembers = async (
  conversationId,
  userId,
  userRole = ""
) => {
  const conversation = await populateConversation(
    Conversation.findById(conversationId)
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  // Managers can view members of any group; others must be active members.
  if (!isGroupManagerRole(userRole)) {
    assertActiveMember(conversation, userId);
  } else if (conversation.type !== "GROUP") {
    assertActiveMember(conversation, userId);
  }

  return conversation.members
    .filter((member) => !member.leftAt)
    .map((member) => ({
      user: member.user,
      role: member.role,
      joinedAt: member.joinedAt,
      lastReadAt: member.lastReadAt,
      unreadCount: member.unreadCount || 0,
    }));
};

const addMembers = async (
  conversationId,
  memberIds,
  user,
  io
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("Members can only be added to groups");
  }

  assertGroupManager(conversation, user.id, user.role);

  const normalizedMemberIds = normalizeUserIds(memberIds);

  if (!normalizedMemberIds.length) {
    throw new Error("Select at least one member to add");
  }

  const validatedMemberIds = await validateActiveUsers(
    normalizedMemberIds
  );

  const activeMemberIds = new Set(
    conversation.members
      .filter((member) => !member.leftAt)
      .map((member) => member.user.toString())
  );

  const addedUsers = [];

  for (const memberId of validatedMemberIds) {
    const memberIdStr = memberId.toString();

    if (activeMemberIds.has(memberIdStr)) {
      continue;
    }

    const existingMember = conversation.members.find(
      (member) => member.user.toString() === memberIdStr
    );

    if (existingMember) {
      existingMember.leftAt = null;
      existingMember.joinedAt = new Date();
      existingMember.role = "MEMBER";
      existingMember.lastReadAt = null;
      existingMember.unreadCount = 0;
    } else {
      conversation.members.push({
        user: memberId,
        role: "MEMBER",
        joinedAt: new Date(),
        lastReadAt: null,
        unreadCount: 0,
      });
    }

    const addedUser = await User.findById(memberId)
      .select("name")
      .lean();

    addedUsers.push(addedUser);
    activeMemberIds.add(memberIdStr);

    if (io) {
      io.to(`user:${memberIdStr}`).emit(
        "conversation:added",
        {
          conversationId,
        }
      );
    }
  }

  if (!addedUsers.length) {
    throw new Error("Selected users are already in the group");
  }

  await conversation.save();

  for (const addedUser of addedUsers) {
    await createSystemMessage(
      conversation._id,
      `${user.name} added ${addedUser.name} to the group`,
      io
    );
  }

  await incrementMetric("chat_members_added", {
    actorId: user.id.toString(),
  });

  return getConversationMembers(conversationId, user.id, user.role);
};

const removeMember = async (
  conversationId,
  targetUserId,
  user,
  io
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("Members can only be removed from groups");
  }

  assertGroupManager(conversation, user.id, user.role);

  if (targetUserId.toString() === user.id.toString()) {
    throw new Error("Use leave endpoint to remove yourself");
  }

  const member = getActiveMember(
    conversation,
    targetUserId
  );

  if (!member) {
    throw new Error("Member not found in this group");
  }

  const removedUser = await User.findById(targetUserId)
    .select("name")
    .lean();

  member.leftAt = new Date();
  member.unreadCount = 0;
  await conversation.save();

  await createSystemMessage(
    conversation._id,
    `${user.name} removed ${removedUser.name} from the group`,
    io
  );

  if (io) {
    io.to(`user:${targetUserId}`).emit(
      "conversation:removed",
      {
        conversationId,
      }
    );
  }

  await incrementMetric("chat_member_removed", {
    actorId: user.id.toString(),
  });

  return getConversationMembers(conversationId, user.id, user.role);
};

const getMessages = async (
  conversationId,
  userId,
  query = {},
  userRole = ""
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  if (
    !(
      isGroupManagerRole(userRole) &&
      conversation.type === "GROUP"
    )
  ) {
    assertActiveMember(conversation, userId);
  }

  const limit = Math.min(
    Math.max(Number(query.limit) || 50, 1),
    100
  );

  const filter = {
    conversation: conversationId,
    isDeletedForAll: false,
    deletedFor: { $ne: userId },
  };

  if (query.before) {
    const beforeMessage = await Message.findById(
      query.before
    );

    if (beforeMessage) {
      filter.createdAt = { $lt: beforeMessage.createdAt };
    }
  }

  const messages = await populateMessage(
    Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
  );

  return {
    conversationId,
    limit,
    data: messages.reverse(),
  };
};

const sendMessage = async (
  conversationId,
  payload,
  user,
  io
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  assertActiveMember(conversation, user.id);

  const { content, type = "TEXT", replyTo, mentions = [], forwardedFrom = null } =
    payload;
  const normalizedContent =
    typeof content === "string" ? content.trim() : "";

  if (!normalizedContent && type === "TEXT") {
    throw new Error("Message content is required");
  }

  if (replyTo) {
    const parentMessage = await Message.findOne({
      _id: replyTo,
      conversation: conversationId,
    }).select("_id");

    if (!parentMessage) {
      throw new Error("Reply message not found");
    }
  }

  const activeMemberIds = conversation.members
    .filter((member) => !member.leftAt)
    .map((member) => member.user.toString());

  const validMentions = normalizeUserIds(mentions).filter(
    (mentionId) => activeMemberIds.includes(mentionId)
  );

  const message = await Message.create({
    conversation: conversationId,
    sender: user.id,
    type,
    content: normalizedContent,
    fileMeta: payload.fileMeta || undefined,
    replyTo: replyTo || null,
    forwardedFrom: forwardedFrom || null,
    mentions: validMentions,
    readBy: [
      {
        user: user.id,
        readAt: new Date(),
      },
    ],
  });

  const previewText = buildMessagePreviewFromType(
    type,
    normalizedContent,
    payload.fileMeta
  );
  const sentAt = message.createdAt || new Date();

  // One conversation write — skip redundant find + update + find + save
  conversation.lastMessage = {
    text: previewText,
    sender: user.id,
    sentAt,
  };

  for (const member of conversation.members) {
    if (member.leftAt) {
      continue;
    }

    if (member.user.toString() === user.id.toString()) {
      member.lastReadAt = sentAt;
      member.unreadCount = 0;
      continue;
    }

    member.unreadCount = (member.unreadCount || 0) + 1;
  }

  await conversation.save();

  const savedMessage = await populateMessage(
    Message.findById(message._id)
  );

  // Emit once per online member via user room (everyone joins user: on connect).
  // Avoid also emitting to conversation room — causes duplicate client handlers.
  if (io) {
    activeMemberIds.forEach((memberId) => {
      io.to(`user:${memberId}`).emit("message:new", {
        conversationId,
        message: savedMessage,
      });
    });
  }

  // Do not block send response on metrics
  incrementMetric("chat_message_sent", {
    senderId: user.id.toString(),
    type,
  }).catch(() => undefined);

  return savedMessage;
};

const sendFileMessage = async (
  conversationId,
  file,
  user,
  io
) => {
  const isImage = file.mimetype.startsWith("image/");
  // Prefer /api/uploads so nginx setups that only proxy /api can serve files.
  const filePath = isPrivateStorageEnabled
    ? `/api/chat/files/${file.filename}`
    : `/api/uploads/chat/${file.filename}`;

  return sendMessage(
    conversationId,
    {
      type: isImage ? "IMAGE" : "FILE",
      content: filePath,
      fileMeta: {
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      },
    },
    user,
    io
  );
};

const editMessage = async (
  messageId,
  content,
  userId,
  io
) => {
  const message = await Message.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  if (message.isDeletedForAll) {
    throw new Error("Message has been deleted");
  }

  if (message.sender?.toString() !== userId.toString()) {
    throw new Error("You can only edit your own messages");
  }

  if (message.type !== "TEXT") {
    throw new Error("Only text messages can be edited");
  }

  if (!content?.trim()) {
    throw new Error("Message content is required");
  }

  message.content = content.trim();
  message.editedAt = new Date();
  await message.save();
  await refreshConversationLastMessage(message.conversation);

  const populatedMessage = await populateMessage(
    Message.findById(message._id)
  );

  const savedMessage = await populatedMessage;

  if (io) {
    io.to(`conversation:${message.conversation}`).emit(
      "message:updated",
      {
        conversationId: message.conversation,
        message: savedMessage,
      }
    );
  }

  return savedMessage;
};

const deleteMessage = async (
  messageId,
  scope,
  userId,
  io
) => {
  const message = await Message.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  const conversation = await Conversation.findById(
    message.conversation
  );

  assertActiveMember(conversation, userId);

  if (scope === "all") {
    if (message.sender?.toString() !== userId.toString()) {
      throw new Error("You can only delete your own messages for everyone");
    }

    message.isDeletedForAll = true;
    message.content = "This message was deleted";
    await message.save();
    await recomputeUnreadCounters(message.conversation);
    await refreshConversationLastMessage(
      message.conversation
    );
  } else {
    if (
      !message.deletedFor.some(
        (id) => id.toString() === userId.toString()
      )
    ) {
      message.deletedFor.push(userId);
      await message.save();
    }
  }

  const visibleLastMessage = await getVisibleLastMessageForUser(
    message.conversation,
    userId
  );

  if (io) {
    const deletePayload = {
      conversationId: message.conversation,
      messageId: message._id,
      scope,
      lastMessage: visibleLastMessage,
    };

    if (scope === "all") {
      io.to(`conversation:${message.conversation}`).emit(
        "message:deleted",
        deletePayload
      );
    } else {
      io.to(`user:${userId}`).emit("message:deleted", deletePayload);
    }
  }

  await incrementMetric("chat_message_deleted", {
    userId: userId.toString(),
    scope,
  });

  return {
    messageId: message._id,
    scope,
  };
};

const markConversationAsRead = async (
  conversationId,
  userId,
  io,
  userRole = ""
) => {
  const conversation = await Conversation.findById(
    conversationId
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  const member = getActiveMember(conversation, userId);

  // Managers can open groups without membership; skip read update then.
  if (!member) {
    if (
      isGroupManagerRole(userRole) &&
      conversation.type === "GROUP"
    ) {
      return {
        conversationId,
        readAt: null,
        skipped: true,
      };
    }

    throw new Error("You do not have access to this conversation");
  }

  const readAt = new Date();

  member.lastReadAt = readAt;
  member.unreadCount = 0;
  await conversation.save();

  await Message.updateMany(
    {
      conversation: conversationId,
      sender: { $ne: userId },
      "readBy.user": { $ne: userId },
    },
    {
      $push: {
        readBy: {
          user: userId,
          readAt,
        },
      },
    }
  );

  if (io) {
    io.to(`conversation:${conversationId}`).emit(
      "conversation:read",
      {
        conversationId,
        userId,
        readAt,
      }
    );
  }

  await incrementMetric("chat_mark_read", {
    userId: userId.toString(),
  });

  return {
    conversationId,
    readAt,
  };
};

const getUnreadCount = async (userId) => {
  const conversations = await Conversation.find(
    buildConversationQueryForUser(userId)
  ).lean();

  const totalUnread = conversations.reduce(
    (sum, conversation) => {
      const member = getActiveMember(conversation, userId);
      return sum + Number(member?.unreadCount || 0);
    },
    0
  );

  return {
    totalUnread,
  };
};

const getUsersPresence = async (userIds = []) => {
  const uniqueIds = normalizeUserIds(userIds);
  const presence = {};

  let inMemoryPresence = {};

  try {
    const { getOnlinePresenceMap } = require("./chat.socket");
    inMemoryPresence = getOnlinePresenceMap();
  } catch (_error) {
    inMemoryPresence = {};
  }

  await Promise.all(
    uniqueIds.map(async (id) => {
      if (inMemoryPresence[id]) {
        presence[id] = true;
        return;
      }

      try {
        const value = await redisClient.get(`presence:${id}`);
        presence[id] = value === "online";
      } catch (_error) {
        presence[id] = false;
      }
    })
  );

  return presence;
};

const touchUserPresence = async (userId) => {
  if (!userId) {
    return;
  }

  try {
    await redisClient.set(`presence:${userId}`, "online", {
      EX: 45,
    });
  } catch (_error) {
    // Ignore redis issues; chat presence can still rely on in-memory/socket events.
  }
};

const forwardMessage = async (
  messageId,
  targetConversationIds,
  user,
  io
) => {
  const message = await Message.findById(messageId);

  if (!message || message.isDeletedForAll) {
    throw new Error("Message not found");
  }

  if (
    message.deletedFor.some(
      (id) => id.toString() === user.id.toString()
    )
  ) {
    throw new Error("Message not found");
  }

  const sourceConversation = await Conversation.findById(
    message.conversation
  );

  assertActiveMember(sourceConversation, user.id);

  const uniqueTargets = normalizeUserIds(targetConversationIds);

  if (!uniqueTargets.length) {
    throw new Error("Select at least one conversation to forward to");
  }

  const forwardedMessages = [];

  for (const targetConversationId of uniqueTargets) {
    if (
      targetConversationId.toString() ===
      message.conversation.toString()
    ) {
      continue;
    }

    const targetConversation = await Conversation.findById(
      targetConversationId
    );

    if (!targetConversation || targetConversation.isDeleted) {
      throw new Error("Target conversation not found");
    }

    assertActiveMember(targetConversation, user.id);

    const forwardedMessage = await sendMessage(
      targetConversationId,
      {
        type: message.type,
        content: message.content,
        fileMeta: message.fileMeta || undefined,
        forwardedFrom: message._id,
      },
      user,
      io
    );

    forwardedMessages.push(forwardedMessage);
  }

  if (!forwardedMessages.length) {
    throw new Error("Select a different conversation to forward to");
  }

  return forwardedMessages;
};

const getFileAbsolutePath = (fileName) => {
  const folder = isPrivateStorageEnabled
    ? "../../uploads-private/chat"
    : "../../uploads/chat";

  return path.join(__dirname, folder, fileName);
};

const getFileContentCandidates = (fileName) => {
  return [
    `/api/uploads/chat/${fileName}`,
    `/uploads/chat/${fileName}`,
    `/api/chat/files/${fileName}`,
  ];
};

const getChatFilePathForUser = async (fileName, userId) => {
  const message = await Message.findOne({
    type: { $in: ["IMAGE", "FILE"] },
    content: { $in: getFileContentCandidates(fileName) },
  })
    .select("conversation")
    .lean();

  if (!message) {
    throw new Error("File not found");
  }

  const hasAccess = await canAccessConversation(
    message.conversation,
    userId
  );

  if (!hasAccess) {
    throw new Error("You do not have access to this file");
  }

  const absolutePath = getFileAbsolutePath(fileName);

  try {
    await fs.access(absolutePath);
  } catch (_error) {
    throw new Error("File not found");
  }

  await incrementMetric("chat_file_accessed", {
    userId: userId.toString(),
  });

  return absolutePath;
};

const assertCanViewConversation = async (
  conversationId,
  userId,
  userRole = ""
) => {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation || conversation.isDeleted) {
    throw new Error("Conversation not found");
  }

  if (
    !(
      isGroupManagerRole(userRole) &&
      conversation.type === "GROUP"
    )
  ) {
    assertActiveMember(conversation, userId);
  }

  return conversation;
};

const getConversationDrawerInfo = async (
  conversationId,
  userId,
  userRole = ""
) => {
  await assertCanViewConversation(conversationId, userId, userRole);

  const conversation = await populateConversation(
    Conversation.findById(conversationId)
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const conversationObject = conversation.toObject();

  if (conversationObject.type === "DM") {
    const otherMember = conversationObject.members.find((entry) => {
      const memberUserId = entry.user?._id?.toString();

      return memberUserId && memberUserId !== userId.toString() && !entry.leftAt;
    });

    if (!otherMember?.user?._id) {
      throw new Error("Contact not found");
    }

    const profile = await User.findById(otherMember.user._id)
      .select(DRAWER_USER_FIELDS)
      .lean();

    if (!profile) {
      throw new Error("Contact not found");
    }

    return {
      type: "DM",
      profile,
      otherUserId: profile._id?.toString() || null,
    };
  }

  const activeMemberUsers = conversationObject.members
    .filter((member) => !member.leftAt && member.user?._id)
    .map((member) => member.user);

  const memberIds = activeMemberUsers.map((user) => user._id);
  const usersWithContact = await User.find({
    _id: { $in: memberIds },
  })
    .select(DRAWER_USER_FIELDS)
    .lean();

  const userMap = new Map(
    usersWithContact.map((user) => [user._id.toString(), user])
  );

  const members = conversationObject.members
    .filter((member) => !member.leftAt && member.user?._id)
    .map((member) => {
      const memberUser = userMap.get(member.user._id.toString()) || member.user;

      return {
        _id: memberUser._id,
        name: memberUser.name,
        employeeId: memberUser.employeeId,
        role: memberUser.role,
        designation: memberUser.designation,
        department: memberUser.department,
        profilePhoto: memberUser.profilePhoto,
        email: memberUser.email,
        phone: memberUser.phone,
        chatRole: member.role,
      };
    });

  return {
    type: "GROUP",
    name: conversationObject.name || "",
    description: conversationObject.description || "",
    photo: conversationObject.photo || "",
    memberCount: members.length,
    members,
  };
};

const getConversationAttachments = async (
  conversationId,
  userId,
  userRole = "",
  query = {}
) => {
  await assertCanViewConversation(conversationId, userId, userRole);

  const attachmentType =
    query.type === "documents" ? "documents" : "media";
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 24));
  const skip = (page - 1) * limit;

  const filter = {
    conversation: conversationId,
    isDeletedForAll: false,
    deletedFor: { $ne: userId },
    type: attachmentType === "media" ? "IMAGE" : "FILE",
  };

  const [data, totalRecords] = await Promise.all([
    Message.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("type content fileMeta createdAt sender")
      .populate("sender", USER_POPULATE_FIELDS)
      .lean(),
    Message.countDocuments(filter),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / limit) || 1);

  return {
    type: attachmentType,
    page,
    limit,
    totalRecords,
    totalPages,
    data,
  };
};

let socketIo = null;

const setSocketIo = (io) => {
  socketIo = io;
};

const getSocketIo = () => socketIo;

const updateGroupPhoto = async (conversationId, file, user, io) => {
  const conversation = await Conversation.findById(conversationId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  if (conversation.type !== "GROUP") {
    throw new Error("Only group conversations can have a photo");
  }

  assertGroupManager(conversation, user.id, user.role);

  // Delete old photo file if it was a locally stored file
  if (conversation.photo) {
    const oldRelative = conversation.photo.startsWith("/")
      ? conversation.photo
      : `/${conversation.photo}`;

    // Strip /api prefix if present so we get a real filesystem path
    const normalizedPath = oldRelative.replace(/^\/api/, "");

    const oldAbsolute = path.join(
      __dirname,
      "../../..",
      normalizedPath
    );

    fs.unlink(oldAbsolute).catch(() => {
      // Ignore — old file may not exist locally (e.g. migrated storage)
    });
  }

  // Build the public URL path for the uploaded file
  const relativePath = isPrivateStorageEnabled
    ? `/uploads-private/chat/${file.filename}`
    : `/uploads/chat/${file.filename}`;

  conversation.photo = relativePath;
  await conversation.save();

  const populatedConversation = await populateConversation(
    Conversation.findById(conversation._id)
  );

  // Notify all active group members in real time
  if (io) {
    const activeMembers = conversation.members.filter((m) => !m.leftAt);
    activeMembers.forEach((member) => {
      io.to(`user:${member.user.toString()}`).emit(
        "conversation:updated",
        {
          conversationId: conversationId.toString(),
          conversation: { photo: relativePath },
        }
      );
    });
  }

  await incrementMetric("chat_group_photo_updated", {
    actorId: user.id.toString(),
  });
  await logAuditEvent("chat_group_photo_updated", {
    conversationId: conversationId.toString(),
    actorId: user.id.toString(),
  });

  return formatConversation(
    populatedConversation.toObject(),
    user.id
  );
};

module.exports = {
  canCreateGroup,
  canAccessConversation,
  createConversation,
  getMyConversations,
  getConversationById,
  updateConversation,
  updateGroupPhoto,
  deleteConversation,
  leaveConversation,
  getConversationMembers,
  addMembers,
  removeMember,
  getMessages,
  sendMessage,
  sendFileMessage,
  editMessage,
  deleteMessage,
  markConversationAsRead,
  getUnreadCount,
  getUsersPresence,
  touchUserPresence,
  forwardMessage,
  getChatFilePathForUser,
  getConversationDrawerInfo,
  getConversationAttachments,
  setSocketIo,
  getSocketIo,
};
