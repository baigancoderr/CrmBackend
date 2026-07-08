const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .message("must be a valid MongoDB ObjectId");

const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).optional(),
});

const createConversationSchema = Joi.object({
  type: Joi.string().valid("DM", "GROUP").required(),
  name: Joi.string().trim().max(100).optional(),
  description: Joi.string().trim().max(500).optional(),
  memberIds: Joi.array().items(objectId).default([]),
});

const conversationIdParamSchema = Joi.object({
  id: objectId.required(),
});

const messageIdParamSchema = Joi.object({
  messageId: objectId.required(),
});

const removeMemberParamSchema = Joi.object({
  id: objectId.required(),
  userId: objectId.required(),
});

const fileNameParamSchema = Joi.object({
  fileName: Joi.string()
    .trim()
    .max(200)
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .required(),
});

const updateConversationSchema = Joi.object({
  name: Joi.string().trim().max(100).optional(),
  description: Joi.string().trim().max(500).allow("").optional(),
  photo: Joi.string().trim().max(500).allow("").optional(),
}).min(1);

const addMembersSchema = Joi.object({
  userIds: Joi.array().items(objectId).min(1).required(),
});

const sendMessageSchema = Joi.object({
  type: Joi.string()
    .valid("TEXT", "IMAGE", "FILE", "SYSTEM")
    .default("TEXT"),
  content: Joi.string().allow("").max(5000).optional(),
  replyTo: objectId.optional(),
  mentions: Joi.array().items(objectId).default([]),
  fileMeta: Joi.object({
    name: Joi.string().max(255).allow("").optional(),
    size: Joi.number().min(0).optional(),
    mimeType: Joi.string().max(255).allow("").optional(),
  }).optional(),
});

const getMessagesQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional(),
  before: objectId.optional(),
});

const editMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required(),
});

const deleteMessageQuerySchema = Joi.object({
  scope: Joi.string().valid("me", "all").optional(),
});

const socketConversationSchema = Joi.object({
  conversationId: objectId.required(),
});

module.exports = {
  paginationQuerySchema,
  createConversationSchema,
  conversationIdParamSchema,
  messageIdParamSchema,
  removeMemberParamSchema,
  fileNameParamSchema,
  updateConversationSchema,
  addMembersSchema,
  sendMessageSchema,
  getMessagesQuerySchema,
  editMessageSchema,
  deleteMessageQuerySchema,
  socketConversationSchema,
};
