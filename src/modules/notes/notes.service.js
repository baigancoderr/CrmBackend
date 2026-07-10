const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");
const Notes = require("./notes.model");
const Folder = require("./folder.model");
const NoteShare = require("./noteShare.model");
const User = require("../user/user.model");

const USER_POPULATE_FIELDS = "name email role designation department profilePhoto";

/**
 * Helper to check note access and return authorization details
 */
const getNoteAccess = async (noteId, userId) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  if (note.owner.toString() === userId.toString()) {
    return { note, isOwner: true, permission: "Edit" };
  }

  const share = await NoteShare.findOne({ noteId, sharedWith: userId });
  if (!share) {
    const error = new Error("Access denied. You do not have access to this note.");
    error.statusCode = 403;
    throw error;
  }

  return { note, isOwner: false, permission: share.permission };
};

/**
 * Folders Services
 */

const createFolder = async (ownerId, data) => {
  const existingFolder = await Folder.findOne({
    name: { $regex: `^${data.name.trim()}$`, $options: "i" },
    owner: ownerId,
  });

  if (existingFolder) {
    const error = new Error("A folder with this name already exists");
    error.statusCode = 400;
    throw error;
  }

  const folder = new Folder({
    name: data.name.trim(),
    owner: ownerId,
  });

  return await folder.save();
};

const getMyFolders = async (ownerId) => {
  return await Folder.find({ owner: ownerId }).sort({ name: 1 });
};

const updateFolder = async (ownerId, folderId, data) => {
  const folder = await Folder.findOne({ _id: folderId, owner: ownerId });
  if (!folder) {
    const error = new Error("Folder not found or unauthorized");
    error.statusCode = 404;
    throw error;
  }

  const existingFolder = await Folder.findOne({
    name: { $regex: `^${data.name.trim()}$`, $options: "i" },
    owner: ownerId,
    _id: { $ne: folderId },
  });

  if (existingFolder) {
    const error = new Error("A folder with this name already exists");
    error.statusCode = 400;
    throw error;
  }

  folder.name = data.name.trim();
  return await folder.save();
};

const deleteFolder = async (ownerId, folderId) => {
  const folder = await Folder.findOne({ _id: folderId, owner: ownerId });
  if (!folder) {
    const error = new Error("Folder not found or unauthorized");
    error.statusCode = 404;
    throw error;
  }

  // Remove the folder reference from all notes in this folder
  await Notes.updateMany({ folder: folderId, owner: ownerId }, { $set: { folder: null } });

  // Delete the folder itself
  await Folder.deleteOne({ _id: folderId });
  return { message: "Folder deleted successfully" };
};

/**
 * Notes Services
 */

const createNote = async (ownerId, data, files = []) => {
  // Validate folder if provided
  if (data.folder) {
    const folderExists = await Folder.findOne({ _id: data.folder, owner: ownerId });
    if (!folderExists) {
      const error = new Error("Folder not found or does not belong to you");
      error.statusCode = 400;
      throw error;
    }
  }

  // Handle attachments mapping
  const attachments = files.map((file) => {
    // Generate static file URL
    const fileUrl = `/uploads/notes/${file.filename}`;
    return {
      fileName: file.originalname,
      fileUrl,
      fileType: file.mimetype,
      fileSize: file.size,
    };
  });

  // Handle tags parsing (can be array or comma-separated string)
  let tags = [];
  if (data.tags) {
    if (Array.isArray(data.tags)) {
      tags = data.tags;
    } else if (typeof data.tags === "string") {
      tags = data.tags.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  const note = new Notes({
    title: data.title,
    content: data.content || "",
    owner: ownerId,
    folder: data.folder || null,
    tags,
    attachments,
    isPinned: data.isPinned === "true" || data.isPinned === true,
    isFavorite: data.isFavorite === "true" || data.isFavorite === true,
  });

  await note.save();
  return await Notes.findById(note._id)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");
};

const getMyNotes = async (userId, query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;
  const sortDirection = query.sortBy === "oldest" ? 1 : -1;

  // Find IDs of notes shared with this user
  const shares = await NoteShare.find({ sharedWith: userId }).select("noteId");
  const sharedNoteIds = shares.map((s) => s.noteId);

  const filter = {
    $or: [
      { owner: userId },
      { _id: { $in: sharedNoteIds } },
    ],
    isDeleted: false,
    isArchived: false,
  };

  const total = await Notes.countDocuments(filter);
  const notes = await Notes.find(filter)
    .sort({ createdAt: sortDirection })
    .skip(skip)
    .limit(limit)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");

  return {
    notes,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getSingleNote = async (userId, noteId) => {
  const { note } = await getNoteAccess(noteId, userId);
  
  return await Notes.findById(note._id)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");
};

const updateNote = async (userId, noteId, data, files = []) => {
  const { note, isOwner, permission } = await getNoteAccess(noteId, userId);

  if (permission !== "Edit") {
    const error = new Error("Unauthorized. You only have View permission for this note.");
    error.statusCode = 403;
    throw error;
  }

  // Handle folder validation (only note owner can set folder, or it must belong to note owner)
  if (data.folder !== undefined) {
    if (data.folder === null || data.folder === "" || data.folder === "null") {
      note.folder = null;
    } else {
      const folderOwnerId = isOwner ? userId : note.owner;
      const folderExists = await Folder.findOne({ _id: data.folder, owner: folderOwnerId });
      if (!folderExists) {
        const error = new Error("Folder not found or does not belong to the note owner");
        error.statusCode = 400;
        throw error;
      }
      note.folder = data.folder;
    }
  }

  // Update text fields
  if (data.title !== undefined) note.title = data.title;
  if (data.content !== undefined) note.content = data.content;

  // Handle tags
  if (data.tags !== undefined) {
    if (Array.isArray(data.tags)) {
      note.tags = data.tags;
    } else if (typeof data.tags === "string") {
      note.tags = data.tags.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  // Boolean attributes update
  if (data.isPinned !== undefined) {
    note.isPinned = data.isPinned === "true" || data.isPinned === true;
  }
  if (data.isFavorite !== undefined) {
    note.isFavorite = data.isFavorite === "true" || data.isFavorite === true;
  }

  // Handle file append
  if (files && files.length > 0) {
    const newAttachments = files.map((file) => {
      const fileUrl = `/uploads/notes/${file.filename}`;
      return {
        fileName: file.originalname,
        fileUrl,
        fileType: file.mimetype,
        fileSize: file.size,
      };
    });
    note.attachments.push(...newAttachments);
  }

  // Keep track of existing attachments to delete or replace if sent in body as a JSON string
  if (data.removeAttachments) {
    let toRemove = [];
    if (Array.isArray(data.removeAttachments)) {
      toRemove = data.removeAttachments;
    } else if (typeof data.removeAttachments === "string") {
      try {
        toRemove = JSON.parse(data.removeAttachments);
      } catch (e) {
        toRemove = data.removeAttachments.split(",").map((url) => url.trim());
      }
    }

    if (toRemove.length > 0) {
      // Physically delete files from uploads/notes folder
      for (const url of toRemove) {
        const match = note.attachments.find((att) => att.fileUrl === url);
        if (match) {
          const filename = path.basename(match.fileUrl);
          const fullPath = path.join(__dirname, "../../uploads/notes", filename);
          try {
            await fs.unlink(fullPath);
          } catch (err) {
            console.error(`Failed to delete physical file: ${fullPath}`, err.message);
          }
        }
      }
      note.attachments = note.attachments.filter((att) => !toRemove.includes(att.fileUrl));
    }
  }

  await note.save();
  return await Notes.findById(note._id)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");
};

const softDeleteNote = async (userId, noteId) => {
  const { note, isOwner } = await getNoteAccess(noteId, userId);

  if (!isOwner) {
    const error = new Error("Unauthorized. Only the owner can delete this note.");
    error.statusCode = 403;
    throw error;
  }

  note.isDeleted = true;
  note.isPinned = false; // standard UX behavior: unpin when trashed
  await note.save();
  return { message: "Note moved to trash successfully", noteId };
};

const restoreNote = async (userId, noteId) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  if (note.owner.toString() !== userId.toString()) {
    const error = new Error("Unauthorized. Only the owner can restore this note.");
    error.statusCode = 403;
    throw error;
  }

  note.isDeleted = false;
  await note.save();
  return await Notes.findById(note._id)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");
};

const permanentDeleteNote = async (userId, noteId) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  if (note.owner.toString() !== userId.toString()) {
    const error = new Error("Unauthorized. Only the owner can permanently delete this note.");
    error.statusCode = 403;
    throw error;
  }

  // Delete physical files
  if (note.attachments && note.attachments.length > 0) {
    for (const att of note.attachments) {
      const filename = path.basename(att.fileUrl);
      const fullPath = path.join(__dirname, "../../uploads/notes", filename);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        console.error(`Failed to delete physical file: ${fullPath}`, err.message);
      }
    }
  }

  // Remove sharing records
  await NoteShare.deleteMany({ noteId });

  // Delete note itself
  await Notes.deleteOne({ _id: noteId });
  return { message: "Note permanently deleted", noteId };
};

const togglePin = async (userId, noteId) => {
  const { note, permission } = await getNoteAccess(noteId, userId);
  if (permission !== "Edit") {
    const error = new Error("Unauthorized. You only have View permission for this note.");
    error.statusCode = 403;
    throw error;
  }

  note.isPinned = !note.isPinned;
  await note.save();
  return { isPinned: note.isPinned, message: note.isPinned ? "Note pinned" : "Note unpinned" };
};

const toggleFavorite = async (userId, noteId) => {
  const { note, permission } = await getNoteAccess(noteId, userId);
  if (permission !== "Edit") {
    const error = new Error("Unauthorized. You only have View permission for this note.");
    error.statusCode = 403;
    throw error;
  }

  note.isFavorite = !note.isFavorite;
  await note.save();
  return { isFavorite: note.isFavorite, message: note.isFavorite ? "Note added to favorites" : "Note removed from favorites" };
};

const toggleArchive = async (userId, noteId) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  if (note.owner.toString() !== userId.toString()) {
    const error = new Error("Unauthorized. Only the owner can archive/unarchive this note.");
    error.statusCode = 403;
    throw error;
  }

  note.isArchived = !note.isArchived;
  if (note.isArchived) {
    note.isPinned = false; // unpin on archive
  }
  await note.save();
  return { isArchived: note.isArchived, message: note.isArchived ? "Note archived" : "Note restored from archive" };
};

const getArchivedNotes = async (userId, query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;
  const sortDirection = query.sortBy === "oldest" ? 1 : -1;

  const filter = {
    owner: userId,
    isArchived: true,
    isDeleted: false,
  };

  const total = await Notes.countDocuments(filter);
  const notes = await Notes.find(filter)
    .sort({ createdAt: sortDirection })
    .skip(skip)
    .limit(limit)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");

  return {
    notes,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getTrashNotes = async (userId, query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;
  const sortDirection = query.sortBy === "oldest" ? 1 : -1;

  const filter = {
    owner: userId,
    isDeleted: true,
  };

  const total = await Notes.countDocuments(filter);
  const notes = await Notes.find(filter)
    .sort({ createdAt: sortDirection })
    .skip(skip)
    .limit(limit)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");

  return {
    notes,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const searchNotes = async (userId, query) => {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const skip = (page - 1) * limit;
  const sortDirection = query.sortBy === "oldest" ? 1 : -1;

  // Find shared notes
  const shares = await NoteShare.find({ sharedWith: userId }).select("noteId");
  const sharedNoteIds = shares.map((s) => s.noteId);

  const filter = {
    $or: [
      { owner: userId },
      { _id: { $in: sharedNoteIds } },
    ],
    isDeleted: false,
    isArchived: false,
  };

  // Filter by folder if requested
  if (query.folder) {
    filter.folder = query.folder;
  }

  // Filter by search string
  if (query.q) {
    const qStr = query.q.trim();
    filter.$and = [
      {
        $or: [
          { title: { $regex: qStr, $options: "i" } },
          { content: { $regex: qStr, $options: "i" } },
          { tags: { $in: [new RegExp(qStr, "i")] } },
        ],
      },
    ];
  }

  const total = await Notes.countDocuments(filter);
  const notes = await Notes.find(filter)
    .sort({ createdAt: sortDirection })
    .skip(skip)
    .limit(limit)
    .populate("owner", USER_POPULATE_FIELDS)
    .populate("folder", "name");

  return {
    notes,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Note Sharing Services
 */

const shareNote = async (userId, noteId, sharedWithId, permissionLevel) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  // Only owner can share
  if (note.owner.toString() !== userId.toString()) {
    const error = new Error("Unauthorized. Only the owner can share this note.");
    error.statusCode = 403;
    throw error;
  }

  // Cannot share with self
  if (sharedWithId.toString() === userId.toString()) {
    const error = new Error("You cannot share a note with yourself");
    error.statusCode = 400;
    throw error;
  }

  // Check if target user exists and is active
  const targetUser = await User.findOne({ _id: sharedWithId, isActive: true });
  if (!targetUser) {
    const error = new Error("Target employee does not exist or is inactive");
    error.statusCode = 404;
    throw error;
  }

  // Upsert NoteShare record
  let share = await NoteShare.findOne({ noteId, sharedWith: sharedWithId });
  if (share) {
    share.permission = permissionLevel;
    await share.save();
  } else {
    share = new NoteShare({
      noteId,
      sharedBy: userId,
      sharedWith: sharedWithId,
      permission: permissionLevel,
    });
    await share.save();
  }

  return await NoteShare.findById(share._id)
    .populate("sharedWith", USER_POPULATE_FIELDS)
    .populate("sharedBy", USER_POPULATE_FIELDS);
};

const removeShare = async (userId, noteId, sharedWithId) => {
  const note = await Notes.findById(noteId);
  if (!note) {
    const error = new Error("Note not found");
    error.statusCode = 404;
    throw error;
  }

  // Only owner can remove shares
  if (note.owner.toString() !== userId.toString()) {
    const error = new Error("Unauthorized. Only the owner can remove shares.");
    error.statusCode = 403;
    throw error;
  }

  const result = await NoteShare.deleteOne({ noteId, sharedWith: sharedWithId });
  if (result.deletedCount === 0) {
    const error = new Error("Note is not shared with this user");
    error.statusCode = 404;
    throw error;
  }

  return { message: "Sharing removed successfully", noteId, sharedWith: sharedWithId };
};

const getSharedUsers = async (userId, noteId) => {
  const { note } = await getNoteAccess(noteId, userId);

  // Return list of all users this note is shared with
  return await NoteShare.find({ noteId: note._id })
    .populate("sharedWith", USER_POPULATE_FIELDS)
    .populate("sharedBy", USER_POPULATE_FIELDS);
};

module.exports = {
  // Folders
  createFolder,
  getMyFolders,
  updateFolder,
  deleteFolder,
  // Notes
  createNote,
  getMyNotes,
  getSingleNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  permanentDeleteNote,
  togglePin,
  toggleFavorite,
  toggleArchive,
  getArchivedNotes,
  getTrashNotes,
  searchNotes,
  // Sharing
  shareNote,
  removeShare,
  getSharedUsers,
};
