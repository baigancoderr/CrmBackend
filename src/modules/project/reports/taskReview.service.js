const mongoose = require("mongoose");
const Task = require("../task/task.model");
const TaskHistory = require("../task/taskHistory.model");
const TaskComment = require("../comments/taskComment.model");
const Blocker = require("../blocker/blocker.model");
const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const { createAppError } = require("../project.helper");
const { getIstDayBounds, getTodayDateKey } = require("../../../utils/istDateTime");

const EVENT_GROUPS = {
  REVIEW: ["TASK_SUBMITTED_FOR_REVIEW", "TASK_APPROVED", "TASK_REJECTED", "TASK_REOPENED"],
  PAUSE: ["TASK_PAUSED"],
  PROGRESS: ["TASK_ASSIGNED", "TASK_ACCEPTED", "TASK_STARTED", "TASK_COMPLETED"],
  BLOCK: ["BLOCKER_RAISED", "BLOCKER_RESOLVED"],
  COMMENT: ["COMMENT_ADDED"],
};

const HISTORY_ACTIONS = [...EVENT_GROUPS.REVIEW, ...EVENT_GROUPS.PAUSE, ...EVENT_GROUPS.PROGRESS];
const FEED_TYPES = Object.keys(EVENT_GROUPS);
const OPEN_BLOCKER_STATUSES = ["OPEN", "IN_PROGRESS"];

// Merging three collections in memory only stays honest while every source can
// supply the whole requested window, so the page depth is capped.
const MERGE_CAP = 500;
const TASK_SCOPE_CAP = 4000;
const PENDING_LIST_LIMIT = 25;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toObjectIds = (values) => [...new Set(values.map(String))].map((id) => new mongoose.Types.ObjectId(id));

const populatedField = (value, key) =>
  value && typeof value === "object" && !(value instanceof mongoose.Types.ObjectId) ? value[key] || "" : "";

/**
 * Who a reviewer is allowed to watch:
 * - SUPER_ADMIN / HR: everything
 * - PROJECT_MANAGER: projects they manage, belong to, or lead an area in
 * - TL: only the work areas they lead
 */
const resolveFeedScope = async (user) => {
  if (["SUPER_ADMIN", "HR"].includes(user.role)) {
    return { projectIds: null, areaIds: null };
  }

  if (user.role === "PROJECT_MANAGER") {
    const [managed, memberOf, ledAreas] = await Promise.all([
      Project.find({ projectManager: user.id }).select("_id").lean(),
      Project.find({ teamMembers: user.id }).select("_id").lean(),
      ProjectArea.find({ $or: [{ teamLead: user.id }, { projectLead: user.id }] })
        .select("projectId")
        .lean(),
    ]);

    return {
      projectIds: toObjectIds([
        ...managed.map((p) => p._id),
        ...memberOf.map((p) => p._id),
        ...ledAreas.map((a) => a.projectId),
      ]),
      areaIds: null,
    };
  }

  if (user.role === "TL") {
    const areas = await ProjectArea.find({
      $or: [{ teamLead: user.id }, { projectLead: user.id }],
      isArchived: false,
    })
      .select("_id projectId")
      .lean();

    return {
      projectIds: toObjectIds(areas.map((a) => a.projectId)),
      areaIds: areas.map((a) => a._id),
    };
  }

  throw createAppError(
    "Only Super Admin, HR, Project Managers and Team Leads can view the task review list.",
    403
  );
};

const resolveProjectFilter = (scope, requestedProjectId) => {
  if (!requestedProjectId) return null;
  if (!mongoose.isValidObjectId(requestedProjectId)) {
    throw createAppError("Invalid project id.", 422);
  }
  if (scope.projectIds && !scope.projectIds.some((id) => String(id) === String(requestedProjectId))) {
    throw createAppError("Access denied for this project.", 403);
  }
  return new mongoose.Types.ObjectId(requestedProjectId);
};

const resolveActorFilter = (employeeId) => {
  if (!employeeId) return null;
  if (!mongoose.isValidObjectId(employeeId)) {
    throw createAppError("Invalid employee id.", 422);
  }
  return new mongoose.Types.ObjectId(employeeId);
};

/** Task-level scope, used for both the summary counters and the pending lists. */
const buildTaskScopeFilter = (scope, projectFilter) => {
  const filter = { isArchived: false };
  if (scope.areaIds) filter.projectAreaId = { $in: scope.areaIds };
  else if (scope.projectIds) filter.projectId = { $in: scope.projectIds };
  if (projectFilter) filter.projectId = projectFilter;
  return filter;
};

const resolveDateRange = (from, to) => {
  const range = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(from || ""))) range.$gte = getIstDayBounds(from).start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(to || ""))) range.$lte = getIstDayBounds(to).end;
  return Object.keys(range).length ? range : null;
};

const TASK_POPULATE = [
  { path: "projectId", select: "projectName projectCode status" },
  { path: "projectAreaId", select: "title" },
  { path: "assignedTo", select: "name employeeId role profilePhoto" },
];

const mapTaskRef = (task) => ({
  _id: task._id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  deadline: task.deadline || null,
  projectId: task.projectId?._id || task.projectId,
  projectName: populatedField(task.projectId, "projectName"),
  projectCode: populatedField(task.projectId, "projectCode"),
  areaId: task.projectAreaId?._id || task.projectAreaId || null,
  areaTitle: populatedField(task.projectAreaId, "title"),
  assignedTo: task.assignedTo?._id
    ? {
        _id: task.assignedTo._id,
        name: task.assignedTo.name || "",
        employeeId: task.assignedTo.employeeId || "",
        role: task.assignedTo.role || "",
      }
    : null,
});

const groupOfAction = (action) =>
  FEED_TYPES.find((type) => EVENT_GROUPS[type].includes(action)) || "PROGRESS";

const buildHistoryFilter = ({ scope, projectFilter, actorFilter, dateRange, searchRegex, searchTaskIds, actions }) => {
  const filter = { action: { $in: actions } };
  if (scope.areaIds) filter.taskId = { $in: scope.scopeTaskIds };
  else if (scope.projectIds) filter.projectId = { $in: scope.projectIds };
  if (projectFilter) filter.projectId = projectFilter;
  if (actorFilter) filter.user = actorFilter;
  if (dateRange) filter.createdAt = dateRange;
  if (searchRegex) {
    filter.$or = [{ userNameSnapshot: searchRegex }, { taskId: { $in: searchTaskIds } }];
  }
  return filter;
};

const buildCommentFilter = ({ scope, projectFilter, actorFilter, dateRange, searchRegex, searchTaskIds }) => {
  const filter = {};
  if (scope.areaIds) filter.taskId = { $in: scope.scopeTaskIds };
  else if (scope.projectIds) filter.projectId = { $in: scope.projectIds };
  if (projectFilter) filter.projectId = projectFilter;
  if (actorFilter) filter.author = actorFilter;
  if (dateRange) filter.createdAt = dateRange;
  if (searchRegex) {
    filter.$or = [{ authorNameSnapshot: searchRegex }, { taskId: { $in: searchTaskIds } }];
  }
  return filter;
};

const buildBlockerFilter = ({
  scope,
  projectFilter,
  actorFilter,
  dateRange,
  searchRegex,
  searchTaskIds,
  resolved,
}) => {
  const filter = {};
  if (scope.areaIds) filter.taskId = { $in: scope.scopeTaskIds };
  else if (scope.projectIds) filter.projectId = { $in: scope.projectIds };
  if (projectFilter) filter.projectId = projectFilter;
  if (actorFilter) filter[resolved ? "resolvedBy" : "employee"] = actorFilter;
  if (resolved) filter.resolvedAt = dateRange ? { ...dateRange } : { $ne: null };
  else if (dateRange) filter.raisedAt = dateRange;
  if (searchRegex) {
    filter.$or = [
      { [resolved ? "resolvedByNameSnapshot" : "employeeNameSnapshot"]: searchRegex },
      { taskId: { $in: searchTaskIds } },
    ];
  }
  return filter;
};

const buildSummary = async ({ taskScopeFilter, eventScopeFilter }) => {
  const todayStart = getIstDayBounds(getTodayDateKey()).start;

  const [pendingReviews, openBlockers, paused, workingNow, submittedToday, commentsToday] =
    await Promise.all([
      Task.countDocuments({ ...taskScopeFilter, status: "UNDER_REVIEW" }),
      Blocker.countDocuments({ ...eventScopeFilter, status: { $in: OPEN_BLOCKER_STATUSES } }),
      Task.countDocuments({ ...taskScopeFilter, status: "PAUSED" }),
      Task.countDocuments({ ...taskScopeFilter, status: "IN_PROGRESS" }),
      TaskHistory.countDocuments({
        ...eventScopeFilter,
        action: "TASK_SUBMITTED_FOR_REVIEW",
        createdAt: { $gte: todayStart },
      }),
      TaskComment.countDocuments({ ...eventScopeFilter, createdAt: { $gte: todayStart } }),
    ]);

  return { pendingReviews, openBlockers, paused, workingNow, submittedToday, commentsToday };
};

const buildPendingLists = async ({ taskScopeFilter, eventScopeFilter }) => {
  const [reviewTasks, blockers] = await Promise.all([
    Task.find({ ...taskScopeFilter, status: "UNDER_REVIEW" })
      .sort({ updatedAt: 1 })
      .limit(PENDING_LIST_LIMIT)
      .populate(TASK_POPULATE)
      .select("title status priority deadline projectId projectAreaId assignedTo reviewNotes updatedAt")
      .lean(),
    Blocker.find({ ...eventScopeFilter, status: { $in: OPEN_BLOCKER_STATUSES } })
      .sort({ raisedAt: 1 })
      .limit(PENDING_LIST_LIMIT)
      .populate({ path: "taskId", select: "title status priority deadline projectId projectAreaId assignedTo", populate: TASK_POPULATE })
      .populate({ path: "projectId", select: "projectName projectCode" })
      .populate({ path: "employee", select: "name employeeId role" })
      .lean(),
  ]);

  return {
    reviews: reviewTasks.map((task) => ({
      ...mapTaskRef(task),
      reviewNotes: task.reviewNotes || "",
      waitingSince: task.updatedAt,
    })),
    blockers: blockers
      .filter((blocker) => blocker.taskId)
      .map((blocker) => ({
        _id: blocker._id,
        reason: blocker.reason,
        status: blocker.status,
        raisedAt: blocker.raisedAt,
        raisedBy: blocker.employee?._id
          ? { _id: blocker.employee._id, name: blocker.employee.name || "", role: blocker.employee.role || "" }
          : { _id: null, name: blocker.employeeNameSnapshot || "", role: "" },
        task: mapTaskRef(blocker.taskId),
      })),
  };
};

const emptyFeed = (page, limit) => ({
  summary: { pendingReviews: 0, openBlockers: 0, paused: 0, workingNow: 0, submittedToday: 0, commentsToday: 0 },
  pending: { reviews: [], blockers: [] },
  projects: [],
  page,
  limit,
  totalRecords: 0,
  totalPages: 1,
  maxPage: 1,
  data: [],
});

const getTaskReviewFeed = async (user, query = {}) => {
  const scope = await resolveFeedScope(user);

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
  const requestedType = String(query.type || "").toUpperCase();
  const type = FEED_TYPES.includes(requestedType) ? requestedType : "";
  const search = String(query.search || "").trim();

  if (scope.projectIds && !scope.projectIds.length) return emptyFeed(page, limit);

  const projectFilter = resolveProjectFilter(scope, query.projectId);
  const actorFilter = resolveActorFilter(query.employeeId);
  const dateRange = resolveDateRange(query.from, query.to);
  const taskScopeFilter = buildTaskScopeFilter(scope, projectFilter);

  // A TL is scoped by work area, which only tasks carry, so their event queries
  // have to go through the task ids of those areas.
  const scopeTaskIds = scope.areaIds
    ? (await Task.find(taskScopeFilter).select("_id").limit(TASK_SCOPE_CAP).lean()).map((t) => t._id)
    : null;

  const searchRegex = search ? new RegExp(escapeRegex(search), "i") : null;
  const searchTaskIds = searchRegex
    ? (
        await Task.find({ ...taskScopeFilter, title: searchRegex })
          .select("_id")
          .limit(TASK_SCOPE_CAP)
          .lean()
      ).map((t) => t._id)
    : [];

  const filterContext = {
    scope: { ...scope, scopeTaskIds },
    projectFilter,
    actorFilter,
    dateRange,
    searchRegex,
    searchTaskIds,
  };

  // Every event collection carries taskId + projectId, so one scope filter works
  // for history, comments and blockers alike.
  const eventScopeFilter = scopeTaskIds
    ? { taskId: { $in: scopeTaskIds } }
    : projectFilter
      ? { projectId: projectFilter }
      : scope.projectIds
        ? { projectId: { $in: scope.projectIds } }
        : {};

  const wantHistory = !type || ["REVIEW", "PAUSE", "PROGRESS"].includes(type);
  const wantComments = !type || type === "COMMENT";
  const wantBlockers = !type || type === "BLOCK";
  const historyActions = type && wantHistory ? EVENT_GROUPS[type] : HISTORY_ACTIONS;

  const historyFilter = wantHistory ? buildHistoryFilter({ ...filterContext, actions: historyActions }) : null;
  const commentFilter = wantComments ? buildCommentFilter(filterContext) : null;
  const blockerRaisedFilter = wantBlockers ? buildBlockerFilter({ ...filterContext, resolved: false }) : null;
  const blockerResolvedFilter = wantBlockers ? buildBlockerFilter({ ...filterContext, resolved: true }) : null;

  const fetchLimit = Math.min(page * limit, MERGE_CAP);

  const [
    summary,
    pending,
    projects,
    historyRows,
    commentRows,
    blockerRaisedRows,
    blockerResolvedRows,
    historyCount,
    commentCount,
    blockerRaisedCount,
    blockerResolvedCount,
  ] = await Promise.all([
    buildSummary({ taskScopeFilter, eventScopeFilter }),
    buildPendingLists({ taskScopeFilter, eventScopeFilter }),
    Project.find(scope.projectIds ? { _id: { $in: scope.projectIds } } : { isArchived: false })
      .select("projectName projectCode")
      .sort({ projectName: 1 })
      .limit(200)
      .lean(),
    historyFilter
      ? TaskHistory.find(historyFilter).sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    commentFilter
      ? TaskComment.find(commentFilter).sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    blockerRaisedFilter
      ? Blocker.find(blockerRaisedFilter).sort({ raisedAt: -1 }).limit(fetchLimit).lean()
      : [],
    blockerResolvedFilter
      ? Blocker.find(blockerResolvedFilter).sort({ resolvedAt: -1 }).limit(fetchLimit).lean()
      : [],
    historyFilter ? TaskHistory.countDocuments(historyFilter) : 0,
    commentFilter ? TaskComment.countDocuments(commentFilter) : 0,
    blockerRaisedFilter ? Blocker.countDocuments(blockerRaisedFilter) : 0,
    blockerResolvedFilter ? Blocker.countDocuments(blockerResolvedFilter) : 0,
  ]);

  const events = [
    ...historyRows.map((row) => ({
      _id: `history:${row._id}`,
      action: row.action,
      type: groupOfAction(row.action),
      at: row.createdAt,
      actor: { _id: row.user, name: row.userNameSnapshot || "", role: row.userRoleSnapshot || "" },
      taskId: row.taskId,
      note: row.reason || row.description || "",
      blocker: null,
    })),
    ...commentRows.map((row) => ({
      _id: `comment:${row._id}`,
      action: "COMMENT_ADDED",
      type: "COMMENT",
      at: row.createdAt,
      actor: { _id: row.author, name: row.authorNameSnapshot || "", role: "" },
      taskId: row.taskId,
      note: row.content || "",
      isInternal: Boolean(row.isInternal),
      attachmentCount: row.attachments?.length || 0,
      blocker: null,
    })),
    ...blockerRaisedRows.map((row) => ({
      _id: `blocker-raised:${row._id}`,
      action: "BLOCKER_RAISED",
      type: "BLOCK",
      at: row.raisedAt,
      actor: { _id: row.employee, name: row.employeeNameSnapshot || "", role: "" },
      taskId: row.taskId,
      note: row.reason || "",
      attachmentCount: row.attachments?.length || 0,
      blocker: { _id: row._id, status: row.status },
    })),
    ...blockerResolvedRows.map((row) => ({
      _id: `blocker-resolved:${row._id}`,
      action: "BLOCKER_RESOLVED",
      type: "BLOCK",
      at: row.resolvedAt,
      actor: { _id: row.resolvedBy, name: row.resolvedByNameSnapshot || "", role: "" },
      taskId: row.taskId,
      note: row.resolutionNotes || row.reason || "",
      blocker: { _id: row._id, status: row.status },
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice((page - 1) * limit, page * limit);

  const taskIds = [...new Set(events.map((e) => String(e.taskId)))];
  const tasks = taskIds.length
    ? await Task.find({ _id: { $in: taskIds } })
        .select("title status priority deadline projectId projectAreaId assignedTo")
        .populate(TASK_POPULATE)
        .lean()
    : [];
  const taskMap = new Map(tasks.map((task) => [String(task._id), mapTaskRef(task)]));

  const data = events
    .filter((event) => taskMap.has(String(event.taskId)))
    .map(({ taskId, ...event }) => {
      const task = taskMap.get(String(taskId));
      return {
        ...event,
        task,
        canReview: task.status === "UNDER_REVIEW",
        canResolveBlocker: Boolean(event.blocker && OPEN_BLOCKER_STATUSES.includes(event.blocker.status)),
      };
    });

  const totalRecords = historyCount + commentCount + blockerRaisedCount + blockerResolvedCount;

  return {
    summary,
    pending,
    projects,
    page,
    limit,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    maxPage: Math.ceil(MERGE_CAP / limit),
    data,
  };
};

module.exports = { getTaskReviewFeed };
