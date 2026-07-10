const Joi = require("joi");

const objectId = Joi.string()
  .trim()
  .pattern(/^[a-fA-F0-9]{24}$/)
  .message("must be a valid MongoDB ObjectId");

// Folder validations
const createFolderSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
});

const updateFolderSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
});

const folderIdParamSchema = Joi.object({
  id: objectId.required(),
});

// Note validations
const createNoteSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  content: Joi.string().allow("").optional().default(""),
  folder: objectId.allow(null, "").optional().default(null),
  tags: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim().allow("")
  ).optional().default([]),
  isPinned: Joi.boolean().optional().default(false),
  isFavorite: Joi.boolean().optional().default(false),
});

const updateNoteSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).optional(),
  content: Joi.string().allow("").optional(),
  folder: objectId.allow(null, "").optional(),
  tags: Joi.alternatives().try(
    Joi.array().items(Joi.string().trim()),
    Joi.string().trim().allow("")
  ).optional(),
  isPinned: Joi.boolean().optional(),
  isFavorite: Joi.boolean().optional(),
  isArchived: Joi.boolean().optional(),
  isDeleted: Joi.boolean().optional(),
}).min(1);

const noteIdParamSchema = Joi.object({
  id: objectId.required(),
});

// Sharing validations
const shareNoteSchema = Joi.object({
  sharedWith: objectId.required(),
  permission: Joi.string().valid("View", "Edit").required(),
});

const removeShareParamSchema = Joi.object({
  id: objectId.required(),
  userId: objectId.required(),
});

const searchNoteQuerySchema = Joi.object({
  q: Joi.string().trim().allow("").optional().default(""),
  folder: objectId.allow("").optional(),
  sortBy: Joi.string().valid("latest", "oldest").optional().default("latest"),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  sortBy: Joi.string().valid("latest", "oldest").optional().default("latest"),
});

module.exports = {
  objectId,
  createFolderSchema,
  updateFolderSchema,
  folderIdParamSchema,
  createNoteSchema,
  updateNoteSchema,
  noteIdParamSchema,
  shareNoteSchema,
  removeShareParamSchema,
  searchNoteQuerySchema,
  paginationQuerySchema,
};
