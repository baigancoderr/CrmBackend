const Joi = require("joi");
const {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  AUDIENCE_TYPES,
} = require("./announcement.constants");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

const attachmentItemSchema = Joi.object({
  name: Joi.string().required().trim(),
  url: Joi.string().required().trim(),
  type: Joi.string().optional().default("document"),
  size: Joi.number().optional().default(0),
});

const createAnnouncementSchema = Joi.object({
  title: Joi.string().max(200).required().trim(),
  summary: Joi.string().max(500).allow("").optional().trim(),
  content: Joi.string().required(),
  type: Joi.string()
    .valid(...ANNOUNCEMENT_TYPES)
    .optional()
    .default("GENERAL"),
  priority: Joi.string()
    .valid(...ANNOUNCEMENT_PRIORITIES)
    .optional()
    .default("NORMAL"),
  audienceType: Joi.string()
    .valid(...AUDIENCE_TYPES)
    .optional()
    .default("ALL"),
  targetRoles: Joi.array().items(Joi.string().trim()).optional().default([]),
  targetEmployees: Joi.array()
    .items(Joi.string().regex(objectIdPattern).message("Invalid Employee ID"))
    .optional()
    .default([]),
  attachments: Joi.array().items(attachmentItemSchema).optional().default([]),
  publishNow: Joi.boolean().optional().default(false),
  publishAt: Joi.date().iso().allow(null).optional(),
  expiresAt: Joi.date().iso().greater(Joi.ref("publishAt")).allow(null).optional(),
  isPinned: Joi.boolean().optional().default(false),
  requiresAcknowledgement: Joi.boolean().optional().default(false),
});

const updateAnnouncementSchema = Joi.object({
  title: Joi.string().max(200).optional().trim(),
  summary: Joi.string().max(500).allow("").optional().trim(),
  content: Joi.string().optional(),
  type: Joi.string()
    .valid(...ANNOUNCEMENT_TYPES)
    .optional(),
  priority: Joi.string()
    .valid(...ANNOUNCEMENT_PRIORITIES)
    .optional(),
  audienceType: Joi.string()
    .valid(...AUDIENCE_TYPES)
    .optional(),
  targetRoles: Joi.array().items(Joi.string().trim()).optional(),
  targetEmployees: Joi.array()
    .items(Joi.string().regex(objectIdPattern))
    .optional(),
  attachments: Joi.array().items(attachmentItemSchema).optional(),
  publishNow: Joi.boolean().optional(),
  publishAt: Joi.date().iso().allow(null).optional(),
  expiresAt: Joi.date().iso().allow(null).optional(),
  isPinned: Joi.boolean().optional(),
  requiresAcknowledgement: Joi.boolean().optional(),
  status: Joi.string()
    .valid(...ANNOUNCEMENT_STATUSES)
    .optional(),
});

const queryAnnouncementsSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(20),
  search: Joi.string().allow("").optional().trim(),
  type: Joi.string()
    .valid(...ANNOUNCEMENT_TYPES, "")
    .optional(),
  priority: Joi.string()
    .valid(...ANNOUNCEMENT_PRIORITIES, "")
    .optional(),
  status: Joi.string()
    .valid(...ANNOUNCEMENT_STATUSES, "")
    .optional(),
  audienceType: Joi.string()
    .valid(...AUDIENCE_TYPES, "")
    .optional(),
  isPinned: Joi.boolean().optional(),
  includeDeleted: Joi.boolean().optional().default(false),
});

module.exports = {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  queryAnnouncementsSchema,
};
