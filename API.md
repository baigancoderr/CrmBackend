# CRM Backend API Reference

Base URL: `http://localhost:5000/api`

All protected routes require:

```
Authorization: Bearer <accessToken>
```

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

---

## Users / Employees (`/users`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/users/create` | Create employee | Authenticated |
| `GET` | `/users` | Get all employees | HR, Super Admin |
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
  "joiningDate": "2026-01-15T00:00:00.000Z",
  "employmentType": "FULL_TIME",
  "officeLocation": "Mumbai",
  "shift": "GENERAL",
  "isActive": true
}
```

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
  "joiningDate": "2026-01-15T00:00:00.000Z",
  "employmentType": "FULL_TIME",
  "officeLocation": "Mumbai",
  "shift": "GENERAL",
  "isActive": true
}
```

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
| `POST` | `/attendance/clock-in` | Clock in | All roles |
| `POST` | `/attendance/clock-out` | Clock out | All roles |
| `GET` | `/attendance/today` | Get today's attendance | All roles |
| `GET` | `/attendance/my-history` | Get my attendance history | All roles |
| `GET` | `/attendance/my-monthly` | Get my monthly attendance | All roles |
| `GET` | `/attendance/my-dashboard` | Get my attendance dashboard | All roles |
| `GET` | `/attendance/dashboard` | Get management dashboard | HR, Super Admin, PM, TL |
| `GET` | `/attendance/dashboard-details` | Get dashboard details | HR, Super Admin, PM, TL |
| `GET` | `/attendance/employee/:employeeId` | Get employee attendance | HR, Super Admin, PM, TL |
| `GET` | `/attendance/monthly-team-sheet` | Get monthly all-employees sheet data | HR, Super Admin |
| `PATCH` | `/attendance/manual-update/:id` | Manual attendance update | HR, Super Admin |

---

## Biometric (`/biometric`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `GET` | `/biometric/in-out-data` | Get in/out data | HR, Super Admin, PM, TL |
| `GET` | `/biometric/my-in-out-data` | Get my in/out data | All roles |
| `POST` | `/biometric/sync` | Sync biometric punches | HR, Super Admin |
| `GET` | `/biometric/sync-status` | Get sync status | HR, Super Admin |

---

## Extra Work (`/extrawork`)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| `POST` | `/extrawork/request` | Request extra work | All roles |
| `PATCH` | `/extrawork/approve/:id` | Approve extra work request | HR, Super Admin |
| `POST` | `/extrawork/clock-in` | Extra work clock in | All roles |
| `POST` | `/extrawork/clock-out` | Extra work clock out | All roles |
| `GET` | `/extrawork/my-status` | Get my request status | All roles |
| `GET` | `/extrawork/my-activity` | Get my activity | All roles |
| `GET` | `/extrawork/all-requests` | Get all requests | HR, Super Admin |

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

## Employee CRUD Summary

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create | `POST` | `/users/create` |
| Read (all) | `GET` | `/users` |
| Read (one) | `GET` | `/users/:id` |
| Update | `PATCH` | `/users/:id` |
| Delete | `DELETE` | `/users/:id` |
