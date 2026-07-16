# CRM Backend API Reference

Base URL: `http://localhost:8080/api`

All protected routes require:

```
Authorization: Bearer <accessToken>
```

**Notes**
- Role checks use the latest role from the database on each request (not only the JWT payload).
- Inactive or deleted users are blocked even with a valid token.

---

## Auth (`/auth`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/auth/login` | Login and get access/refresh tokens | Public |
| `POST` | `/auth/forgot-password` | Request password reset via email (login page) | Public |
| `POST` | `/auth/refresh` | Refresh access token | Public |
| `POST` | `/auth/logout` | Logout current user | Authenticated |
| `POST` | `/auth/change-password` | Change password | Authenticated |
| `POST` | `/auth/request-password-reset` | Request password reset (authenticated) | Authenticated |
| `GET` | `/auth/password-reset-requests` | List pending reset requests | HR, Super Admin |
| `GET` | `/auth/password-reset-history` | List all password reset history | HR, Super Admin |
| `PATCH` | `/auth/:id/reset-password` | Approve password reset | HR, Super Admin |
| `PATCH` | `/auth/:id/reject-password-reset` | Reject password reset | HR, Super Admin |

### Login — `POST /auth/login`

```json
{
  "email": "john@example.com",
  "password": "yourPassword"
}
```

**Response:** `accessToken`, `refreshToken`, `isFirstLogin`, `role`

### Refresh token — `POST /auth/refresh`

```json
{
  "refreshToken": "<refreshToken>"
}
```

**Response:** `accessToken`, `role`

### Change password — `POST /auth/change-password`

```json
{
  "oldPassword": "currentPassword",
  "newPassword": "newPassword"
}
```

### Request password reset — `POST /auth/request-password-reset`

```json
{
  "reason": "Forgot my password",
  "source": "SETTINGS"
}
```

`source` values: `LOGIN`, `SETTINGS` (default: `SETTINGS`)

### Forgot password — `POST /auth/forgot-password`

```json
{
  "email": "john@example.com"
}
```

### Reject password reset — `PATCH /auth/:id/reject-password-reset`

```json
{
  "remarks": "Reason for rejection"
}
```

### Reset password — `PATCH /auth/:id/reset-password`

No body required. Returns a one-time `temporaryPassword` in the response (not stored in DB history).

---

## Users / Employees (`/users`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/users/create` | Create employee | Authenticated (role-based create permissions) |
| `GET` | `/users` | Get all employees | HR, Super Admin |
| `GET` | `/users/team-list` | Get employee-safe team directory (common details only) | Authenticated |
| `GET` | `/users/:id` | Get employee by ID | HR, Super Admin |
| `GET` | `/users/profile` | Get logged-in user profile | Authenticated |
| `PUT` | `/users/profile` | Update logged-in user profile | Authenticated |
| `PATCH` | `/users/:id` | Update employee details by ID | HR, Super Admin |
| `DELETE` | `/users/:id` | Delete employee by ID | HR, Super Admin |
| `PATCH` | `/users/status/:id` | Update employee active/inactive status | HR, Super Admin |
| `PATCH` | `/users/biometric-code/:id` | Update biometric EMP ID | HR, Super Admin |
| `GET` | `/users/dashboard-counts` | Get user dashboard counts | HR, Super Admin |

### Create employee — `POST /users/create`

**Body (example):**

```json
{
  "employeeId": "DOB0001",
  "biometricEmpCode": "0001",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "role": "EMPLOYEE",
  "phone": "9876543210",
  "gender": "MALE",
  "department": "Engineering",
  "designation": "Developer",
  "manager": "<managerUserId>",
  "teamLeader": "<teamLeaderUserId>",
  "joiningDate": "2026-01-15T00:00:00.000Z",
  "employmentType": "FULL_TIME",
  "officeLocation": "Mumbai",
  "shift": "GENERAL",
  "isActive": true
}
```

**Create permissions by role:**

| Actor | Can create |
|-------|------------|
| Super Admin | HR, Project Manager, TL, Accountant, Employee |
| HR | HR, Project Manager, TL, Accountant, Employee |
| Project Manager | TL, Employee |
| TL | Employee |

### Update employee — `PATCH /users/:id`

**Body (all fields optional):**

```json
{
  "employeeId": "DOB0001",
  "biometricEmpCode": "0001",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "role": "EMPLOYEE",
  "phone": "9876543210",
  "gender": "MALE",
  "department": "Engineering",
  "designation": "Developer",
  "manager": "<managerUserId>",
  "teamLeader": "<teamLeaderUserId>",
  "joiningDate": "2026-01-15T00:00:00.000Z",
  "employmentType": "FULL_TIME",
  "officeLocation": "Mumbai",
  "shift": "GENERAL",
  "isActive": true
}
```

### Update profile — `PUT /users/profile`

**Body (optional fields):** `name`, `phone`, `gender`, `profilePhoto`, `addressInfo`, `socialLinks`

### Update status — `PATCH /users/status/:id`

```json
{
  "isActive": false
}
```

### Update biometric code — `PATCH /users/biometric-code/:id`

```json
{
  "biometricEmpCode": "0001"
}
```

---

## Attendance (`/attendance`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/attendance/clock-in` | Clock in | Super Admin, HR, PM, TL, Employee |
| `POST` | `/attendance/clock-out` | Clock out | Super Admin, HR, PM, TL, Employee |
| `GET` | `/attendance/today` | Get today's attendance | Super Admin, HR, PM, TL, Employee |
| `GET` | `/attendance/my-history` | Get my attendance history | Super Admin, HR, PM, TL, Employee |
| `GET` | `/attendance/my-monthly` | Get my monthly attendance | Super Admin, HR, PM, TL, Employee |
| `GET` | `/attendance/my-dashboard` | Get my attendance dashboard | Super Admin, HR, PM, TL, Employee |
| `GET` | `/attendance/dashboard` | Get management dashboard | HR, Super Admin, PM, TL |
| `GET` | `/attendance/dashboard-details` | Get dashboard details | HR, Super Admin, PM, TL |
| `GET` | `/attendance/employee/:employeeId` | Get employee attendance | HR, Super Admin, PM, TL |
| `GET` | `/attendance/monthly-team-sheet` | Get monthly all-employees sheet data | HR, Super Admin |
| `PATCH` | `/attendance/manual-update/:id` | Manual attendance update | HR, Super Admin |
| `PATCH` | `/attendance/revoke-clock-out/:id` | Revoke employee clock-out | HR, Super Admin |

### My history — `GET /attendance/my-history`

**Query params:** `page` (default: 1), `limit` (default: 10)

### My monthly — `GET /attendance/my-monthly`

**Query params:** `month` (1–12), `year`

### My dashboard — `GET /attendance/my-dashboard`

**Query params:** `date` (optional, format: `YYYY-MM-DD`)

### Dashboard details — `GET /attendance/dashboard-details`

**Query params:** `date` (optional, format: `YYYY-MM-DD`)

### Employee attendance — `GET /attendance/employee/:employeeId`

**Query params:** `page` (default: 1), `limit` (default: 10)

`:employeeId` is the CRM employee ID (e.g. `DOB0001`), not MongoDB `_id`.

### Monthly team sheet — `GET /attendance/monthly-team-sheet`

**Query params:** `month` (required), `year` (required)

### Manual update — `PATCH /attendance/manual-update/:id`

`:id` is the attendance record MongoDB `_id`.

```json
{
  "date": "2026-07-02",
  "employeeId": "<employeeMongoId>",
  "clockIn": "10:30",
  "clockOut": "19:00",
  "reason": "Missed biometric punch"
}
```

`:id` is the attendance record MongoDB `_id`, or employee MongoDB `_id` when no attendance record exists yet.

At least one of `clockIn` or `clockOut` is required. `reason` and `date` are required when updating or creating attendance for a specific day. `employeeId` helps resolve the employee when attendance record does not exist yet.

### Revoke clock out — `PATCH /attendance/revoke-clock-out/:id`

`:id` is the attendance record MongoDB `_id`.

```json
{
  "reason": "Employee clocked out by mistake"
}
```

Behavior:
- Sets `clockOut` to `null`
- Recalculates attendance metrics (`workingMinutes`, `overtimeMinutes`, `shortfallMinutes`, `earlyOutMinutes`, `status`)
- Saves audit details (`updatedBy`, `updateReason`, `isManuallyUpdated`)

### Attendance status rules

**Check-in (default office start 10:00 AM, 20-minute grace):**

| Check-In Time | Status |
|---------------|--------|
| 10:00 AM – 10:20 AM | `PRESENT` |
| After 10:20 AM | `LATE` |

**Check-out (default office end 7:00 PM, half-day cutoff 4:00 PM):**

| Check-Out Time | Status |
|----------------|--------|
| Before 4:00 PM | `HALF_DAY` |
| 4:00 PM – 6:59 PM | `EARLY_LEAVE` |
| 7:00 PM or later | `PRESENT` or `LATE` (from check-in) |

Status values: `PRESENT`, `LATE`, `HALF_DAY`, `EARLY_LEAVE`, `ABSENT`, `WEEK_OFF`, `LEAVE`

---

## Biometric (`/biometric`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/biometric/in-out-data` | Get in/out data | HR, Super Admin, PM, TL |
| `GET` | `/biometric/my-in-out-data` | Get my in/out data | Super Admin, HR, PM, TL, Employee |
| `POST` | `/biometric/sync` | Sync biometric punches | HR, Super Admin |
| `GET` | `/biometric/sync-status` | Get sync status | HR, Super Admin |

### In/out data — `GET /biometric/in-out-data`

**Query params:** `date` (optional)

### My in/out data — `GET /biometric/my-in-out-data`

**Query params:** `date` (optional)

---

## Extra Work (`/extrawork`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/extrawork/request` | Request extra work | Super Admin, HR, PM, TL, Employee |
| `PATCH` | `/extrawork/approve/:id` | Approve or reject extra work request | HR, Super Admin |
| `POST` | `/extrawork/clock-in` | Extra work clock in | Super Admin, HR, PM, TL, Employee |
| `POST` | `/extrawork/clock-out` | Extra work clock out | Super Admin, HR, PM, TL, Employee |
| `GET` | `/extrawork/my-status` | Get my request status | Super Admin, HR, PM, TL, Employee |
| `GET` | `/extrawork/my-activity` | Get my activity | Super Admin, HR, PM, TL, Employee |
| `GET` | `/extrawork/all-requests` | Get all requests | HR, Super Admin |

### Request extra work — `POST /extrawork/request`

```json
{
  "reason": "Need to complete urgent task"
}
```

### Approve / reject — `PATCH /extrawork/approve/:id`

```json
{
  "action": "APPROVED"
}
```

`action` values: `APPROVED`, `REJECTED`

### All requests — `GET /extrawork/all-requests`

**Query params:** `page`, `limit`, `status`

`status` values: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`

---

## Holidays (`/holiday`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/holiday` | Create holiday | HR, Super Admin |
| `GET` | `/holiday` | Get all holidays (paginated) | Authenticated |
| `GET` | `/holiday/:id` | Get holiday by ID | Authenticated |
| `PATCH` | `/holiday/:id` | Update holiday | HR, Super Admin |
| `DELETE` | `/holiday/:id` | Soft delete holiday | HR, Super Admin |
| `PATCH` | `/holiday/:id/restore` | Restore deleted holiday | HR, Super Admin |

### Create holiday — `POST /holiday`

```json
{
  "title": "Diwali",
  "description": "Festival holiday",
  "holidayType": "FESTIVAL",
  "fromDate": "2026-11-01",
  "toDate": "2026-11-01"
}
```

`holidayType` values: `COMPANY`, `FESTIVAL`, `OPTIONAL` (default: `COMPANY`)

Dates use `YYYY-MM-DD` format. Title must be unique (case-insensitive). Overlapping date ranges are not allowed.

### Get all holidays — `GET /holiday`

**Query params:**

| Param | Description |
|-------|-------------|
| `page` | Page number (default: 1) |
| `limit` | Records per page (default: 10) |
| `search` | Search in title, description, holidayType |
| `year` | Filter by year (e.g. `2026`) |
| `holidayType` | Filter by type |
| `isActive` | `true` or `false` |

**Response includes:** `page`, `limit`, `totalRecords`, `totalPages`, `data`

Each holiday item includes computed fields: `isMultiDay`, `totalWorkingDays`

### Update holiday — `PATCH /holiday/:id`

**Body (all fields optional):**

```json
{
  "title": "Diwali",
  "description": "Updated description",
  "holidayType": "FESTIVAL",
  "fromDate": "2026-11-01",
  "toDate": "2026-11-02",
  "isActive": true
}
```

---

## Leave (`/leave`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/leave/apply` | Apply for leave | Authenticated |
| `GET` | `/leave/my` | Get my leave list | Authenticated |
| `GET` | `/leave/:id` | Get my leave details by ID | Authenticated |
| `GET` | `/leave` | Get all leave requests (paginated/filterable) | Authenticated |
| `PATCH` | `/leave/cancel/:id` | Cancel pending leave | Authenticated |
| `PATCH` | `/leave/approve/:id` | Approve leave request | HR, Project Manager, Super Admin |
| `PATCH` | `/leave/reject/:id` | Reject leave request | HR, Project Manager, Super Admin |
| `GET` | `/leave/balance/:employeeId` | Get leave balance by employee | Authenticated (self), HR/Super Admin (any employee) |
| `PATCH` | `/leave/balance/:employeeId` | Allocate/update leave balance | HR, Super Admin |
| `PATCH` | `/leave/complete` | Mark past approved leaves as completed | HR, Super Admin |

### Apply leave — `POST /leave/apply`

```json
{
  "fromDate": "2026-07-01",
  "toDate": "2026-07-03",
  "category": "FULL_DAY",
  "reason": "Family function",
  "attachment": "",
  "mentions": ["<userId1>", "<userId2>"],
  "leaveDeductionType": "LEAVE_BALANCE",
  "leaveBalanceDays": 3,
  "salaryDeductionDays": 0
}
```

Validation/business rules:
- `fromDate`, `toDate`, `reason`, `leaveDeductionType` are required
- `category` values: `FULL_DAY`, `HALF_DAY` (default: `FULL_DAY`)
- `leaveDeductionType` values: `LEAVE_BALANCE`, `SALARY`, `BOTH`
- If deduction type is `LEAVE_BALANCE`, `leaveBalanceDays` must equal calculated total leave days
- If deduction type is `SALARY`, `salaryDeductionDays` must equal calculated total leave days
- If deduction type is `BOTH`, `leaveBalanceDays + salaryDeductionDays` must equal calculated total leave days
- Weekends and active holidays are excluded from leave-day calculation
- User can have only one `PENDING` leave at a time
- Overlapping non-cancelled/non-rejected leaves are not allowed

### My leaves — `GET /leave/my`

**Query params:** `page` (default: 1), `limit` (default: 10), `status`, `year`

### All leaves — `GET /leave`

**Query params:** `page` (default: 1), `limit` (default: 10), `search`, `status`, `employeeId`, `year`

### Reject leave — `PATCH /leave/reject/:id`

```json
{
  "reason": "Project critical timeline"
}
```

`reason` is optional.

### Allocate leave balance — `PATCH /leave/balance/:employeeId`

```json
{
  "allocatedLeaves": 15,
  "extraLeaves": 2,
  "usedLeaves": 3
}
```

- `allocatedLeaves` (optional): annual allocation, non-negative, max 15.
- `extraLeaves` (optional): amount to **add** to current extra leaves (only applied if > 0).
- `usedLeaves` (optional): absolute used leave count to **set** (non-negative). Remaining is recalculated as: accrued/allocated + extra − used.

### Leave balance access — `GET /leave/balance/:employeeId`

- Employee can fetch only own balance (`employeeId` must match logged-in user).
- HR and Super Admin can fetch any employee balance.

### Complete leaves — `PATCH /leave/complete`

No body required. Manual API (admin-triggered) that marks `APPROVED` leaves as `COMPLETED` when `toDate` is before today.

---

## Chat (`/chat`)

### NEW CHANGES (Chat hardening + consistency)

- Added socket room access validation: user can join/emit typing only for conversations where user is an active member.
- Added socket event `conversation:join:error` when unauthorized room join is attempted.
- Presence logic now supports multi-tab/device sessions correctly (offline is emitted only when last active socket disconnects).
- `sendMessage` now safely handles non-text payloads without `content.trim()` runtime crash.
- Added Redis-backed REST and socket event rate limiting for spam control.
- Added Joi validation schemas for chat REST and socket payloads.
- Added upload signature validation (magic bytes) and optional antivirus command scan.
- Added optional private chat file storage mode with authenticated file access endpoint.
- Added denormalized per-member `unreadCount` for high-volume unread scalability.
- Enabled Socket.IO Redis adapter for multi-instance horizontal scaling.
- Added structured audit logging + Redis metrics counters + abuse threshold alerts.
- Conversation `lastMessage` now auto-refreshes after:
  - text message edit
  - delete-for-everyone
  so chat list preview stays consistent.

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/chat/unread-count` | Get total unread messages for logged-in user | Authenticated |
| `POST` | `/chat/conversations` | Create DM or Group conversation | Authenticated (group creation role-based) |` DONE`
| `GET` | `/chat/conversations` | Get my active conversations (HR/PM/SA also see all groups) | Authenticated |
| `GET` | `/chat/conversations/:id` | Get one conversation details | Active member, or HR/PM/SA for groups |
| `PATCH` | `/chat/conversations/:id` | Update group name/description/photo | HR / Project Manager / Super Admin |
| `DELETE` | `/chat/conversations/:id` | Soft delete group | HR / Project Manager / Super Admin |
| `POST` | `/chat/conversations/:id/leave` | Leave group conversation | Active member only |
| `GET` | `/chat/conversations/:id/members` | Get active members of conversation | Active member, or HR/PM/SA for groups |
| `POST` | `/chat/conversations/:id/members` | Add members to group | HR / Project Manager / Super Admin |
| `DELETE` | `/chat/conversations/:id/members/:userId` | Remove member from group | HR / Project Manager / Super Admin |
| `GET` | `/chat/conversations/:id/messages` | Get messages for a conversation | Active member only | DONE
| `POST` | `/chat/conversations/:id/messages` | Send text/image/file/system-compatible message payload | Active member only |
| `POST` | `/chat/conversations/:id/upload` | Upload file and send as message | Active member only |
| `GET` | `/chat/files/:fileName` | Authenticated file fetch (used for private storage mode) | Active member only |
| `POST` | `/chat/conversations/:id/read` | Mark conversation as read | Active member only | DONE
| `PATCH` | `/chat/messages/:messageId` | Edit my text message | Sender only | DONE
| `DELETE` | `/chat/messages/:messageId?scope=me\|all` | Delete message for me or everyone | Member (scope rules apply) | DONE

### Create conversation — `POST /chat/conversations`

```json
{
  "type": "DM",
  "memberIds": ["<otherUserId>"]
}
```

```json
{
  "type": "GROUP",
  "name": "UI Team",
  "description": "Frontend collaboration",
  "memberIds": ["<userId1>", "<userId2>"]
}
```

Rules:
- `type` must be `DM` or `GROUP`.
- Group can be created only by: `SUPER_ADMIN`, `HR`, `PROJECT_MANAGER`.
- `GROUP` requires `name` and at least one `memberId`.
- `DM` requires exactly one other member (cannot be self).
- If DM between same two active users already exists, API returns existing DM instead of creating a new one.
- All selected members must be active users.
- Request body is Joi-validated and rejects invalid ObjectIds/unknown fields.

### Get my conversations — `GET /chat/conversations`

Query params:
- `page` (default `1`)
- `limit` (default `20`, max `50`)
- Query schema is Joi-validated.

Response data includes per conversation:
- `displayName` and `displayPhoto` (for DM, this is the other active user)
- `unreadCount`
- `myRole`
- `lastReadAt`

### Get one conversation — `GET /chat/conversations/:id`

Returns formatted conversation object with populated:
- `createdBy`
- `members.user`
- `lastMessage.sender`
- `deletedBy`

### Update conversation — `PATCH /chat/conversations/:id`

```json
{
  "name": "Updated Group Name",
  "description": "Updated description",
  "photo": "/uploads/chat/group-photo.png"
}
```

Rules:
- Only `GROUP` can be updated.
- `name` cannot be empty when provided.
- Permission: only `HR`, `PROJECT_MANAGER`, or `SUPER_ADMIN`.

### Delete conversation — `DELETE /chat/conversations/:id`

Rules:
- Only `GROUP` can be deleted.
- Soft delete (`isDeleted`, `deletedAt`, `deletedBy`) is used.
- Permission: only `HR`, `PROJECT_MANAGER`, or `SUPER_ADMIN`.

### Leave conversation — `POST /chat/conversations/:id/leave`

Rules:
- Only for `GROUP`.
- Sets member `leftAt`.
- If leaving user is last active admin, admin role is auto-transferred to another active member.

### Add members — `POST /chat/conversations/:id/members`

```json
{
  "userIds": ["<userId1>", "<userId2>"]
}
```

Rules:
- Only for `GROUP`.
- Permission: only `HR`, `PROJECT_MANAGER`, or `SUPER_ADMIN`.
- Inactive/invalid users rejected.
- Existing left members are re-activated (`leftAt=null`, role reset to `MEMBER`).
- Already active users are skipped.
- If nothing new is added, returns error.

### Remove member — `DELETE /chat/conversations/:id/members/:userId`

Rules:
- Only for `GROUP`.
- Permission: only `HR`, `PROJECT_MANAGER`, or `SUPER_ADMIN`.
- Cannot remove yourself with this endpoint (use `leave` endpoint).
- Member is soft-removed by setting `leftAt`.

### Get messages — `GET /chat/conversations/:id/messages`

Query params:
- `limit` (default `50`, max `100`)
- `before` (`messageId`, for older-message pagination cursor)

Rules:
- Excludes globally deleted messages (`isDeletedForAll=true`).
- Excludes messages deleted only for logged-in user (`deletedFor` contains user).
- Returns results in chronological order (oldest to latest within requested batch).

### Send message — `POST /chat/conversations/:id/messages`

```json
{
  "type": "TEXT",
  "content": "Hi team",
  "replyTo": "<optionalMessageId>",
  "mentions": ["<optionalUserId>"]
}
```

Rules:
- Default `type` is `TEXT`.
- Supported types: `TEXT`, `IMAGE`, `FILE`, `SYSTEM`.
- `TEXT` requires non-empty `content`.
- For non-text types, empty content is handled safely (no trim crash).
- `replyTo` must belong to same conversation.
- `mentions` are filtered to only active conversation members.
- Sender gets immediate read receipt entry in `readBy`.
- Conversation `lastMessage` is updated automatically.
- Rate limit: `40` sends per user per minute.

### Upload file message — `POST /chat/conversations/:id/upload`

Form-data:
- `file` (required)

Upload behavior:
- Stored under `/uploads/chat` by default.
- If `CHAT_UPLOAD_PRIVATE_STORAGE=true`, file is stored under `uploads-private/chat` and served via `GET /chat/files/:fileName`.
- Allowed mime types: `jpg`, `jpeg`, `png`, `webp`, `pdf`, `docx`, `zip`.
- Max file size: `10MB`.
- Magic-byte signature is verified against mime type.
- Optional malware scan command supported via `CHAT_VIRUS_SCAN_COMMAND` (replace `{file}` placeholder or append file path).
- Server creates message with:
  - `type = IMAGE` if file is image mime
  - `type = FILE` otherwise
  - `content = /uploads/chat/<generatedFilename>` (public mode) OR `/api/chat/files/<generatedFilename>` (private mode)
  - `fileMeta = { name, size, mimeType }`
- Rate limit: `12` uploads per user per minute.

### Get chat file — `GET /chat/files/:fileName`

Rules:
- Requires auth token.
- User can access file only if they are active member of the conversation where that file message exists.
- Used primarily when private storage mode is enabled.

### Edit message — `PATCH /chat/messages/:messageId`

```json
{
  "content": "Updated text message"
}
```

Rules:
- Only sender can edit.
- Only `TEXT` messages can be edited.
- Message cannot be already deleted for all.
- Sets `editedAt`.
- Rebuilds conversation `lastMessage` preview after edit.

### Delete message — `DELETE /chat/messages/:messageId?scope=me|all`

Rules:
- `scope=all`: only sender can delete for everyone. Marks `isDeletedForAll=true` and replaces content with `"This message was deleted"`.
- `scope=me` (default): adds logged-in user to `deletedFor` list.
- User must be active conversation member.
- On `scope=all`, conversation `lastMessage` preview is recalculated from latest visible (not deleted-for-all) message.

### Mark as read — `POST /chat/conversations/:id/read`

Rules:
- Sets current member `lastReadAt` for conversation.
- Adds read receipt entry for all unread incoming messages (`readBy` push where user not already present).
- Resets denormalized member `unreadCount` to `0`.

### Unread count — `GET /chat/unread-count`

Unread rules per conversation:
- Uses denormalized `members.unreadCount` for fast aggregation (O(conversations), no per-conversation message count scans).
- Counter is incremented on message send for active recipients and cleared on mark-as-read.
- On delete-for-everyone, counters are recomputed for consistency.

---

## Chat Socket.IO Logic

Socket setup:
- Socket.IO is initialized in `server.js` and chat socket handlers are attached once server starts.
- Client must send token in handshake:
  - `socket.handshake.auth.token` or
  - `socket.handshake.query.token`
- On successful auth:
  - socket joins room `user:<userId>`
  - presence key `presence:<userId>` is stored in Redis with TTL `30s`
  - `user:online` is broadcast

Client-emitted events:
- `conversation:join` with `{ conversationId }` -> joins room only if user has active membership
- `conversation:leave` with `{ conversationId }` -> leave room
- `typing:start` with `{ conversationId }` -> allowed only for active member, stores typing Redis key for 5s and emits `typing:start` to other room members
- `typing:stop` with `{ conversationId }` -> allowed only for active member, removes typing key and emits `typing:stop`
- `presence:heartbeat` -> refresh online TTL to keep user online
- All above payloads are Joi-validated.
- Socket rate limits:
  - `conversation:join` -> 40/min/user
  - `conversation:leave` -> 40/min/user
  - `typing:start` -> 80/min/user
  - `typing:stop` -> 100/min/user
  - `presence:heartbeat` -> 90/min/user

Server-emitted events used by chat module:
- `message:new`
- `message:updated`
- `message:deleted`
- `conversation:updated`
- `conversation:deleted`
- `conversation:left`
- `conversation:added`
- `conversation:removed`
- `conversation:read`
- `user:online`
- `user:offline`
- `typing:start`
- `typing:stop`
- `conversation:join:error`
- `socket:validation:error`
- `socket:rate-limited`

Disconnect behavior:
- User is marked offline only when no socket/tab remains active for that user.
- `user:offline` is broadcast only for last active disconnect.

Horizontal scaling:
- Socket.IO Redis adapter is enabled (`@socket.io/redis-adapter`) using Redis pub/sub clients.
- Room events now work across multiple backend instances.

Observability:
- Chat HTTP requests are logged with status and latency.
- Chat domain actions emit structured audit logs.
- Metrics counters are tracked in Redis (requests, failures, rate-limit hits, uploads rejected, etc.).
- Abuse alerts are emitted when rate-limit/rejection signals cross threshold (`ABUSE_ALERT_THRESHOLD`).

Relevant env flags:
- `CHAT_UPLOAD_PRIVATE_STORAGE` (`true`/`false`, default `false`)
- `CHAT_VIRUS_SCAN_COMMAND` (optional command, uses `{file}` placeholder if provided)
- `CHAT_VIRUS_SCAN_TIMEOUT_MS` (default `15000`)
- `ABUSE_ALERT_THRESHOLD` (default `20` per minute signal bucket)
- `METRIC_TTL_SECONDS` (default `86400`)

---

## Roles

| Role | Value |
|------|-------|
| Super Admin | `SUPER_ADMIN` |
| HR | `HR` |
| Project Manager | `PROJECT_MANAGER` |
| Team Leader | `TL` |
| Accountant | `ACCOUNTANT` |
| Employee | `EMPLOYEE` |

---

## Route Summary

| Module | Base path |
|--------|-----------|
| Auth | `/auth` |
| Users | `/users` |
| Attendance | `/attendance` |
| Biometric | `/biometric` |
| Extra Work | `/extrawork` |
| Holidays | `/holiday` |
| Leave | `/leave` |
| Chat | `/chat` |
| Notes | `/notes` |
| Folders | `/folders` |

---

## Employee CRUD Summary

| Operation | Method | Endpoint | Access |
|-----------|--------|----------|--------|
| Create | `POST` | `/users/create` | Authenticated (role-based) |
| Read (all) | `GET` | `/users` | HR, Super Admin |
| Read (one) | `GET` | `/users/:id` | HR, Super Admin |
| Read (self) | `GET` | `/users/profile` | Authenticated |
| Update (self) | `PUT` | `/users/profile` | Authenticated |
| Update | `PATCH` | `/users/:id` | HR, Super Admin |
| Delete | `DELETE` | `/users/:id` | HR, Super Admin |
| Update status | `PATCH` | `/users/status/:id` | HR, Super Admin |

---

## Notes & Folders Module

### Folders (`/folders`)

All folders endpoints require JWT Authentication.

#### Create Folder — `POST /folders`
- **Request Body:**
  ```json
  {
    "name": "Project Ideas"
  }
  ```
- **Response (201):** Folder data object.

#### Get My Folders — `GET /folders`
- **Response (200):** Array of folders owned by the authenticated employee.

#### Update Folder — `PATCH /folders/:id`
- **Request Body:**
  ```json
  {
    "name": "New Folder Name"
  }
  ```
- **Response (200):** Updated folder data object.

#### Delete Folder — `DELETE /folders/:id`
- **Response (200):** Success message. All notes in this folder are unlinked (folder set to null).

---

### Notes (`/notes`)

All notes endpoints require JWT Authentication.

#### Create Note — `POST /notes`
- **Request Format:** `multipart/form-data`
- **Request Fields:**
  - `title` (string, required)
  - `content` (string, optional)
  - `folder` (ObjectId string, optional folder)
  - `tags` (array of strings, or comma-separated string, optional)
  - `isPinned` (boolean, optional)
  - `isFavorite` (boolean, optional)
  - `attachments` (file upload, optional multiple files: Images, PDF, DOC, DOCX, XLS, XLSX)
- **Response (201):** Created note object with populated owner details.

#### Get My Notes — `GET /notes`
- **Request Query Params:**
  - `page` (number, default: 1)
  - `limit` (number, default: 10)
  - `sortBy` (`latest` or `oldest`, default: `latest`)
- **Response (200):** Paginated notes list including both owned notes and notes shared with the user.

#### Get Single Note — `GET /notes/:id`
- **Response (200):** Populated note details. Accessible by owner or any shared user (View/Edit).

#### Update Note — `PATCH /notes/:id`
- **Request Format:** `multipart/form-data`
- **Request Fields (at least one):**
  - `title`, `content`, `folder`, `tags`, `isPinned`, `isFavorite`
  - `attachments` (new file uploads)
  - `removeAttachments` (array of attachment file URLs to remove)
- **Response (200):** Updated note details. Accessible by owner or shared user with `Edit` permission.

#### Soft Delete Note — `DELETE /notes/:id`
- **Response (200):** Moves note to Trash (`isDeleted: true`). Accessible by owner only.

#### Restore Note — `PATCH /notes/:id/restore`
- **Response (200):** Restores note from Trash (`isDeleted: false`). Accessible by owner only.

#### Permanent Delete Note — `DELETE /notes/:id/permanent`
- **Response (200):** Permanently deletes the note and its attachment files on disk. Accessible by owner only.

#### Pin Note — `PATCH /notes/:id/pin`
- **Response (200):** Toggles `isPinned` state. Accessible by owner or shared user with `Edit` permission.

#### Favorite Note — `PATCH /notes/:id/favorite`
- **Response (200):** Toggles `isFavorite` state. Accessible by owner or shared user with `Edit` permission.

#### Archive Note — `PATCH /notes/:id/archive`
- **Response (200):** Toggles `isArchived` state. Accessible by owner only.

#### Get Archived Notes — `GET /notes/archive`
- **Response (200):** Paginated list of user's archived notes.

#### Get Trash Notes — `GET /notes/trash`
- **Response (200):** Paginated list of user's trashed notes.

#### Search Notes — `GET /notes/search`
- **Request Query Params:**
  - `q` (search string)
  - `folder` (folder ID)
  - `page`, `limit`, `sortBy`
- **Response (200):** Paginated matching notes list. Searches titles, content, and tags.

---

### Note Sharing (`/notes/:id/share`)

#### Share Note — `POST /notes/:id/share`
- **Request Body:**
  ```json
  {
    "sharedWith": "64bfd4e0e64391e8432a5103",
    "permission": "Edit"
  }
  ```
- **Response (200):** Created/updated share record. Accessible by note owner only.

#### Remove Shared Access — `DELETE /notes/:id/share/:userId`
- **Response (200):** Success message. Accessible by note owner only.

#### Get Shared Users — `GET /notes/:id/share`
- **Response (200):** Array of all share records for this note populated with employee info. Accessible by owner and any shared users.

