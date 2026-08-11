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
const chatNotificationService = require("./chatNotification.service");
const storageService = require("../../services/storage.service");

// Group create/manage allowed only for these system roles.
const GROUP_MANAGER_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
];

const USER_POPULATE_FIELDS =
  "name employeeId role designation department profilePhoto";

const LIST_USER_FIELDS = "name profilePhoto";

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

const assertNotProjectChat = (conversation, action = "modify") => {
  if (conversation.projectId) {
    throw new Error(
      `Project chat members are managed from the project roster. You cannot ${action} this chat manually.`
    );
  }
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

/** Active Super Admins must be members of every GROUP conversation. */
const getActiveSuperAdminUserIds = async () => {
  const users = await User.find({
    role: "SUPER_ADMIN",
    isActive: true,
  })
    .select("_id")
    .lean();

  return users.map((user) => user._id);
};

const ensureSuperAdminsInConversation = async (conversation) => {
  if (
    !conversation ||
    conversation.type !== "GROUP" ||
    conversation.isDeleted
  ) {
    return conversation;
  }

  const superAdminIds = await getActiveSuperAdminUserIds();

  if (!superAdminIds.length) {
    return conversation;
  }

  const resolveMemberUserId = (member) => {
    if (member.user && member.user._id) {
      return member.user._id.toString();
    }

    return member.user?.toString();
  };

  let changed = false;
  const activeMemberIds = new Set(
    conversation.members
      .filter((member) => !member.leftAt)
      .map((member) => resolveMemberUserId(member))
      .filter(Boolean)
  );

  for (const adminId of superAdminIds) {
    const adminIdStr = adminId.toString();

    if (activeMemberIds.has(adminIdStr)) {
      continue;
    }

    const existingMember = conversation.members.find(
      (member) => resolveMemberUserId(member) === adminIdStr
    );

    if (existingMember) {
      existingMember.leftAt = null;
      existingMember.joinedAt = new Date();
      existingMember.unreadCount = 0;
    } else {
      conversation.members.push({
        user: adminId,
        role: "MEMBER",
        joinedAt: new Date(),
        lastReadAt: null,
        unreadCount: 0,
      });
    }

    activeMemberIds.add(adminIdStr);
    changed = true;
  }

  if (changed) {
    await conversation.save();
  }

  return conversation;
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

// Inbox list only needs DM peer + lastMessage preview — skip heavy populates.
const populateConversationList = (query) => {
  return query
    .populate("members.user", LIST_USER_FIELDS)
    .populate("lastMessage.sender", LIST_USER_FIELDS);
};

const populateMessage = (query) => {
  return query
    .populate("sender", USER_POPULATE_FIELDS)
    .populate("mentions", USER_POPULATE_FIELDS)
    .populate("reactions.users", "name employeeId profilePhoto")
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

const formatConversation = async (
  conversation,
  userId,
  options = {}
) => {
  const {
    // List path: use embedded lastMessage (no N+1 Message.findOne).
    resolveVisibleLastMessage = true,
    // List path: return only fields the inbox UI needs.
    slim = false,
  } = options;

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

  const lastMessage = resolveVisibleLastMessage
    ? await getVisibleLastMessageForUser(conversation._id, userId)
    : {
        text: conversation.lastMessage?.text || "",
        sender: conversation.lastMessage?.sender || null,
        sentAt: conversation.lastMessage?.sentAt || null,
      };

  if (slim) {
    return {
      _id: conversation._id,
      type: conversation.type,
      name: conversation.name,
      description: conversation.description,
      photo: conversation.photo,
      displayName,
      displayPhoto,
      otherUserId,
      lastMessage,
      unreadCount,
      myRole: member ? member.role : null,
      lastReadAt: member ? member.lastReadAt : null,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  }

  return {
    ...conversation,
    displayName,
    displayPhoto,
    otherUserId,
    lastMessage,
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

  let normalizedMemberIds = normalizeUserIds(memberIds);

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

  if (type === "GROUP") {
    const superAdminIds = await getActiveSuperAdminUserIds();
    normalizedMemberIds = normalizeUserIds([
      ...normalizedMemberIds,
      ...superAdminIds,
    ]);
  }

  const otherMemberIds = normalizedMemberIds.filter(
    (memberId) => memberId.toString() !== user.id.toString()
  );

  if (type === "GROUP" && otherMemberIds.length < 1) {
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
    populateConversationList(
      Conversation.find(filter)
        .sort({ "lastMessage.sentAt": -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
    ),
    Conversation.countDocuments(filter),
  ]);

  const formattedConversations = await Promise.all(
    conversations.map((conversation) =>
      formatConversation(conversation.toObject(), userId, {
        resolveVisibleLastMessage: false,
        slim: true,
      })
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
  let conversation = await Conversation.findById(conversationId);

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

  if (conversation.type === "GROUP") {
    await ensureSuperAdminsInConversation(conversation);
  }

  conversation = await populateConversation(
    Conversation.findById(conversationId)
  );

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

  assertNotProjectChat(conversation, "leave");

  const member = assertActiveMember(conversation, userId);
  const user = await User.findById(userId)
    .select("name role")
    .lean();

  if (user?.role === "SUPER_ADMIN") {
    throw new Error(
      "Super Admin cannot leave group conversations"
    );
  }

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
  let conversation = await Conversation.findById(conversationId);

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

  if (conversation.type === "GROUP") {
    await ensureSuperAdminsInConversation(conversation);
  }

  conversation = await populateConversation(
    Conversation.findById(conversationId)
  );

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

  assertNotProjectChat(conversation, "add members to");
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

  assertNotProjectChat(conversation, "remove members from");
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
    .select("name role")
    .lean();

  if (removedUser?.role === "SUPER_ADMIN") {
    throw new Error(
      "Super Admin cannot be removed from group conversations"
    );
  }

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

  const fetchedMessages = await populateMessage(
    Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
  );

  const hasMore = fetchedMessages.length > limit;
  const pageMessages = hasMore
    ? fetchedMessages.slice(0, limit)
    : fetchedMessages;

  return {
    conversationId,
    limit,
    hasMore,
    data: pageMessages.reverse(),
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

  try {
    // Don't block send response on notification fanout
    chatNotificationService
      .createMessageNotifications({
        io,
        conversation,
        message: savedMessage,
        sender: user,
        recipientIds: activeMemberIds,
      })
      .catch(() => undefined);
  } catch (_error) {
    // Do not fail message send when notification fanout fails.
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
  io,
  replyTo = null
) => {
  const isImage = file.mimetype.startsWith("image/");
  const filePath = storageService.isBackblazeStorage()
    ? await storageService.persistUploadedFile(file, "chat")
    : isPrivateStorageEnabled
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
      replyTo: replyTo || null,
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
  user,
  io
) => {
  const userId = typeof user === "object" ? user.id : user;
  const userName =
    typeof user === "object" && user.name
      ? String(user.name).trim()
      : "Someone";

  const message = await Message.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  const conversation = await Conversation.findById(
    message.conversation
  );

  assertActiveMember(conversation, userId);

  let updatedMessage = null;

  if (scope === "all") {
    if (message.sender?.toString() !== userId.toString()) {
      throw new Error("You can only delete your own messages for everyone");
    }

    message.isDeletedForAll = true;
    message.content = `Deleted by ${userName || "Someone"}`;
    // Keep type TEXT so clients render the deleted placeholder, not media.
    if (message.type === "IMAGE" || message.type === "FILE") {
      message.type = "TEXT";
      message.fileMeta = undefined;
    }
    await message.save();
    await recomputeUnreadCounters(message.conversation);
    await refreshConversationLastMessage(
      message.conversation
    );

    updatedMessage = await populateMessage(
      Message.findById(message._id)
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
      message: updatedMessage,
    };

    if (scope === "all") {
      io.to(`conversation:${message.conversation}`).emit(
        "message:deleted",
        deletePayload
      );
      // Also push updated placeholder so clients can replace in-place.
      if (updatedMessage) {
        const activeMemberIds = conversation.members
          .filter((member) => !member.leftAt)
          .map((member) => member.user.toString());

        activeMemberIds.forEach((memberId) => {
          io.to(`user:${memberId}`).emit("message:updated", {
            conversationId: message.conversation.toString(),
            message: updatedMessage,
          });
        });
      }
    } else {
      io.to(`user:${userId}`).emit("message:deleted", deletePayload);
    }
  }

  incrementMetric("chat_message_deleted", {
    userId: userId.toString(),
    scope,
  }).catch(() => undefined);

  return {
    messageId: message._id,
    scope,
    message: updatedMessage,
  };
};

const reactToMessage = async (messageId, emoji, userId, io) => {
  const normalizedEmoji = typeof emoji === "string" ? emoji.trim() : "";

  if (!normalizedEmoji) {
    throw new Error("Reaction emoji is required");
  }

  const message = await Message.findById(messageId);

  if (!message) {
    throw new Error("Message not found");
  }

  if (message.isDeletedForAll) {
    throw new Error("Message has been deleted");
  }

  const conversation = await Conversation.findById(message.conversation);
  assertActiveMember(conversation, userId);

  const reactionIndex = message.reactions.findIndex(
    (reaction) => reaction.emoji === normalizedEmoji
  );
  const existingReaction = message.reactions[reactionIndex];
  const hasSameReaction = existingReaction?.users.some(
    (id) => id.toString() === userId.toString()
  );

  // One user can have only one reaction on a message. Selecting the same
  // reaction again removes it; selecting another one replaces the old reaction.
  for (let index = message.reactions.length - 1; index >= 0; index -= 1) {
    const reaction = message.reactions[index];
    reaction.users = reaction.users.filter(
      (id) => id.toString() !== userId.toString()
    );

    if (reaction.users.length === 0) {
      message.reactions.splice(index, 1);
    }
  }

  if (!hasSameReaction) {
    const replacementReaction = message.reactions.find(
      (reaction) => reaction.emoji === normalizedEmoji
    );

    if (replacementReaction) {
      replacementReaction.users.push(userId);
    } else {
    message.reactions.push({ emoji: normalizedEmoji, users: [userId] });
    }
  }

  await message.save();

  const savedMessage = await populateMessage(Message.findById(message._id));
  const activeMemberIds = conversation.members
    .filter((member) => !member.leftAt)
    .map((member) => member.user.toString());

  if (io) {
    activeMemberIds.forEach((memberId) => {
      io.to(`user:${memberId}`).emit("message:updated", {
        conversationId: message.conversation.toString(),
        message: savedMessage,
      });
    });
  }

  incrementMetric("chat_message_reaction_updated", {
    userId: userId.toString(),
  }).catch(() => undefined);

  return savedMessage;
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

  try {
    await chatNotificationService.markConversationNotificationsAsRead(
      conversationId,
      userId,
      io
    );
  } catch (_error) {
    // Keep core chat read flow resilient if notification sync fails.
  }

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

  if (conversation.photo) {
    await storageService.deleteStoredFile(conversation.photo);
  }

  const relativePath = storageService.isBackblazeStorage()
    ? await storageService.persistUploadedFile(file, "chat")
    : isPrivateStorageEnabled
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

const getProjectMemberUserIds = async (project) => {
  const ProjectMember = require("../project/projectMember.model");
  const ProjectArea = require("../project/projectArea.model");
  const Task = require("../project/task/task.model");

  const [memberships, areas, tasks] = await Promise.all([
    ProjectMember.find({
      projectId: project._id,
      isActive: true,
    })
      .select("userId")
      .lean(),
    ProjectArea.find({ projectId: project._id })
      .select("teamLead projectLead")
      .lean(),
    Task.find({
      projectId: project._id,
      assignedTo: { $ne: null },
      isArchived: false,
    })
      .select("assignedTo")
      .lean(),
  ]);

  const superAdminIds = await getActiveSuperAdminUserIds();

  const ids = normalizeUserIds([
    project.projectManager,
    ...(Array.isArray(project.teamMembers) ? project.teamMembers : []),
    ...memberships.map((m) => m.userId),
    ...areas.flatMap((area) => [area.teamLead, area.projectLead]),
    ...tasks.map((task) => task.assignedTo),
    ...superAdminIds,
  ]);

  if (!ids.length) return [];

  const activeUsers = await User.find({
    _id: { $in: ids },
    isActive: true,
  })
    .select("_id")
    .lean();

  return activeUsers.map((u) => u._id);
};

const syncProjectChatMembers = async (conversation, projectMemberIds) => {
  const desired = new Set(projectMemberIds.map((id) => id.toString()));
  const superAdminIds = new Set(
    (await getActiveSuperAdminUserIds()).map((id) => id.toString())
  );
  let changed = false;

  for (const member of conversation.members) {
    const memberId = member.user.toString();
    if (desired.has(memberId) || superAdminIds.has(memberId)) {
      if (member.leftAt) {
        member.leftAt = null;
        member.joinedAt = new Date();
        member.unreadCount = 0;
        changed = true;
      }
    } else if (!member.leftAt) {
      member.leftAt = new Date();
      member.unreadCount = 0;
      changed = true;
    }
  }

  const existingIds = new Set(
    conversation.members.map((m) => m.user.toString())
  );

  for (const memberId of desired) {
    if (existingIds.has(memberId)) continue;

    conversation.members.push({
      user: memberId,
      role:
        projectMemberIds.length &&
        String(conversation.createdBy) === memberId
          ? "ADMIN"
          : "MEMBER",
      joinedAt: new Date(),
      lastReadAt: null,
      unreadCount: 0,
    });
    changed = true;
  }

  // Ensure at least one ADMIN remains among active members
  const activeMembers = conversation.members.filter((m) => !m.leftAt);
  const hasAdmin = activeMembers.some((m) => m.role === "ADMIN");
  if (!hasAdmin && activeMembers.length) {
    activeMembers[0].role = "ADMIN";
    changed = true;
  }

  if (changed) {
    await conversation.save();
  }

  return changed;
};

const ensureProjectChatMember = async (projectId, userId, userName = "") => {
  const conversation = await Conversation.findOne({
    projectId,
    isDeleted: false,
  }).select("_id members");

  // The first project-chat open will include this user from ProjectMember.
  if (!conversation) return false;

  const member = conversation.members.find(
    (item) => String(item.user) === String(userId)
  );

  if (member && !member.leftAt) return false;

  if (member) {
    member.leftAt = null;
    member.joinedAt = new Date();
    member.lastReadAt = null;
    member.unreadCount = 0;
    await conversation.save();
  } else {
    const result = await Conversation.updateOne(
      {
        _id: conversation._id,
        "members.user": { $ne: userId },
      },
      {
        $push: {
          members: {
            user: userId,
            role: "MEMBER",
            joinedAt: new Date(),
            lastReadAt: null,
            unreadCount: 0,
          },
        },
      }
    );

    if (!result.modifiedCount) return false;
  }

  if (socketIo) {
    socketIo.to(`user:${String(userId)}`).emit("conversation:added", {
      conversationId: String(conversation._id),
    });
  }

  let displayName = String(userName || "").trim();
  if (!displayName) {
    const user = await User.findById(userId).select("name").lean();
    displayName = user?.name || "A member";
  }

  await createSystemMessage(
    conversation._id,
    `${displayName} joined the project chat`,
    socketIo
  );

  return true;
};

const getOrCreateProjectConversation = async (projectId, user) => {
  const projectService = require("../project/project.service");
  const project = await projectService.assertProjectAccess(projectId, user);

  let conversation = await Conversation.findOne({
    projectId: project._id,
    isDeleted: false,
  });

  // Fast path: room already exists — skip roster sync/populate on every open.
  if (conversation) {
    let activeMember = getActiveMember(conversation, user.id);
    const nextName = `${project.projectName} Chat`.slice(0, 100);
    if (conversation.name !== nextName) {
      conversation.name = nextName;
      conversation.save().catch(() => undefined);
    }

    if (!activeMember) {
      // Assignment-based members need access on their first chat open.
      const memberIds = await getProjectMemberUserIds(project);
      await syncProjectChatMembers(conversation, memberIds);
      activeMember = getActiveMember(conversation, user.id);
    } else {
      // Existing members should not wait for a full roster query.
      getProjectMemberUserIds(project)
        .then((memberIds) => {
          if (!memberIds.length) return null;
          return Conversation.findById(conversation._id).then((fresh) => {
            if (!fresh || fresh.isDeleted) return null;
            return syncProjectChatMembers(fresh, memberIds);
          });
        })
        .catch(() => undefined);
    }

    const memberCount = conversation.members.filter((m) => !m.leftAt).length;

    return {
      _id: conversation._id,
      type: conversation.type,
      name: conversation.name,
      description: conversation.description || "",
      displayName: conversation.name,
      displayPhoto: conversation.photo || "",
      projectId: project._id,
      canSend: Boolean(activeMember),
      memberCount,
      unreadCount: activeMember?.unreadCount || 0,
      myRole: activeMember?.role || null,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  }

  // Create path (first open only)
  const projectMemberIds = await getProjectMemberUserIds(project);
  if (!projectMemberIds.length) {
    throw new Error("Project has no members to start a chat.");
  }

  const isProjectMember = projectMemberIds.some(
    (id) => id.toString() === user.id.toString()
  );

  const adminId = project.projectManager || projectMemberIds[0];
  const members = projectMemberIds.map((memberId) => ({
    user: memberId,
    role: memberId.toString() === String(adminId) ? "ADMIN" : "MEMBER",
    joinedAt: new Date(),
    lastReadAt: null,
    unreadCount: 0,
  }));

  conversation = await Conversation.create({
    type: "GROUP",
    name: `${project.projectName} Chat`.slice(0, 100),
    description: `Project chat for ${project.projectCode || project.projectName}`,
    createdBy: adminId,
    projectId: project._id,
    members,
  });

  // Don't block first open on system message / metrics
  createSystemMessage(
    conversation._id,
    `Project chat created for ${project.projectName}`
  ).catch(() => undefined);

  incrementMetric("chat_project_conversation_created", {
    projectId: project._id.toString(),
    createdBy: user.id.toString(),
  }).catch(() => undefined);

  return {
    _id: conversation._id,
    type: conversation.type,
    name: conversation.name,
    description: conversation.description || "",
    displayName: conversation.name,
    displayPhoto: "",
    projectId: project._id,
    canSend: isProjectMember,
    memberCount: members.length,
    unreadCount: 0,
    myRole: isProjectMember
      ? String(adminId) === String(user.id)
        ? "ADMIN"
        : "MEMBER"
      : null,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
  };
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
  reactToMessage,
  markConversationAsRead,
  getUnreadCount,
  getUsersPresence,
  touchUserPresence,
  forwardMessage,
  getChatFilePathForUser,
  getConversationDrawerInfo,
  getConversationAttachments,
  getOrCreateProjectConversation,
  ensureProjectChatMember,
  setSocketIo,
  getSocketIo,
};
