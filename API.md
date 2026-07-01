# CRM Backend API Reference

Base URL: `http://localhost:5000/api`

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
  "clockIn": "10:30",
  "clockOut": "19:00",
  "reason": "Missed biometric punch"
}
```

At least one of `clockIn` or `clockOut` is required. `reason` is required.

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
