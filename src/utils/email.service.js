/**
 * email.service.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable Nodemailer transport for Leave email notifications.
 *
 * To switch from Gmail to company SMTP later — only update .env:
 *   SMTP_HOST, SMTP_PORT, SMTP_EMAIL, SMTP_PASSWORD
 * No code changes needed.
 *
 * Logo: attached as a CID (inline) attachment — renders in all mail clients
 * without needing a public CDN URL.
 *
 * All public methods NEVER throw — failures are logged only.
 */

"use strict";

const path      = require("path");
const nodemailer = require("nodemailer");
const User      = require("../modules/user/user.model");
const {
  leaveAppliedTemplate,
  leaveApprovedTemplate,
  leaveRejectedTemplate,
} = require("./emailTemplates");

// ── Logo asset (served as CID attachment in every email) ─────────────────────
const LOGO_PATH = path.join(__dirname, "../assets/logo.svg");
const LOGO_CID  = "crm-logo@smarthr";

// ── Transport (lazy singleton) ────────────────────────────────────────────────
let _transporter = null;

const getTransporter = () => {
  if (_transporter) return _transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD,
    },
    tls: { rejectUnauthorized: false },
  });
  return _transporter;
};

// ── Core send ─────────────────────────────────────────────────────────────────

/**
 * Sends one HTML email with the logo as a CID attachment.
 * @param {string|string[]} to
 * @param {string} subject
 * @param {string} html
 */
const sendMail = async (to, subject, html) => {
  if (!process.env.SMTP_EMAIL || !process.env.SMTP_PASSWORD) {
    console.warn("[EmailService] SMTP credentials not set — email skipped.");
    return;
  }

  const recipients = Array.isArray(to)
    ? to.filter(Boolean).join(", ")
    : String(to || "").trim();

  if (!recipients) {
    console.warn("[EmailService] No recipients — email skipped.");
    return;
  }

  const info = await getTransporter().sendMail({
    from: `"Office CRM" <${process.env.SMTP_EMAIL}>`,
    to:   recipients,
    subject,
    html,
    attachments: [
      {
        filename:    "logo.svg",
        path:        LOGO_PATH,
        cid:         LOGO_CID,     // referenced as cid:crm-logo@smarthr in templates
        contentType: "image/svg+xml",
      },
    ],
  });

  const accepted = info.accepted?.join(", ") || "none";
  const rejected = info.rejected?.join(", ") || "none";
  console.log(
    `[EmailService] SMTP accepted "${subject}" → ${accepted} ` +
    `(rejected: ${rejected}, messageId: ${info.messageId}, response: ${info.response || "n/a"})`
  );

  if (info.rejected?.length) {
    console.warn(`[EmailService] SMTP rejected recipients: ${rejected}`);
  }
};

// ── Recipient helpers ─────────────────────────────────────────────────────────

/** All active HR + SUPER_ADMIN emails. */
const getAdminEmails = async () => {
  const users = await User.find(
    { role: { $in: ["HR", "SUPER_ADMIN"] }, isActive: true },
    { email: 1 }
  ).lean();
  return users.map((u) => u.email).filter(Boolean);
};

/** Single user email by ObjectId. Returns null if not found. */
const getUserEmail = async (userId) => {
  if (!userId) return null;
  const user = await User.findOne({ _id: userId, isActive: true }, { email: 1 }).lean();
  return user?.email || null;
};

// ── Date formatter ────────────────────────────────────────────────────────────
const fmtDate = (val) => {
  if (!val) return "—";
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split("-");
    return `${d}-${m}-${y}`;
  }
  return new Date(val).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * sendLeaveAppliedEmail
 * Recipients:
 *   - All HR users
 *   - All SUPER_ADMIN users
 *   - All PROJECT_MANAGER users
 *   - Department TL(s) / Assigned Team Leader
 *   - Selected Reporting Manager (if any)
 */
const sendLeaveAppliedEmail = async ({
  leave,
  employee,
  reportingManagerId,
  teamLeaderId,
  departmentTlIds = [],
}) => {
  try {
    const [adminAndPmUsers, managerEmail, tlEmail, deptTlUsers] = await Promise.all([
      User.find(
        { role: { $in: ["HR", "SUPER_ADMIN", "PROJECT_MANAGER"] }, isActive: true },
        { email: 1 }
      ).lean(),
      getUserEmail(reportingManagerId),
      teamLeaderId ? getUserEmail(teamLeaderId) : Promise.resolve(null),
      Array.isArray(departmentTlIds) && departmentTlIds.length > 0
        ? User.find({ _id: { $in: departmentTlIds }, isActive: true }, { email: 1 }).lean()
        : Promise.resolve([]),
    ]);

    const adminAndPmEmails = adminAndPmUsers.map((u) => u.email).filter(Boolean);
    const deptTlEmails = (deptTlUsers || []).map((u) => u.email).filter(Boolean);

    // Get employee's own email to exclude them from recipients
    const employeeEmail = employee?.email || (await getUserEmail(leave.employeeId));

    // Build deduplicated recipient list — EXCLUDE the employee who applied
    const toSet = new Set([
      ...adminAndPmEmails,
      ...deptTlEmails,
      managerEmail,
      tlEmail,
    ].filter(Boolean));

    // Remove employee's own email (they shouldn't get their own application notification)
    if (employeeEmail) toSet.delete(employeeEmail);

    if (!toSet.size) {
      console.warn("[EmailService] sendLeaveAppliedEmail: no recipients resolved.");
      return;
    }

    const { subject, html } = leaveAppliedTemplate({
      logoCid:            LOGO_CID,
      employeeName:       employee?.name       || "Employee",
      employeeId:         employee?.employeeId || "—",
      fromDate:           fmtDate(leave.fromDate),
      toDate:             fmtDate(leave.toDate),
      totalLeaveDays:     leave.totalLeaveDays,
      category:           leave.category,
      leaveDeductionType: leave.leaveDeductionType,
      earlyLeaveHours:    leave.earlyLeaveHours || 0,
      reason:             leave.reason,
    });

    await sendMail([...toSet], subject, html);
  } catch (err) {
    console.error("[EmailService] sendLeaveAppliedEmail failed:", err.message);
  }
};

/**
 * sendLeaveApprovedEmail
 * Recipient: employee only
 */
const sendLeaveApprovedEmail = async ({ leave, approvedByName }) => {
  try {
    const employeeId    = leave.employeeId?._id || leave.employeeId;
    const employeeName  = leave.employeeId?.name || "Employee";
    const employeeEmail = await getUserEmail(employeeId);

    if (!employeeEmail) {
      console.warn("[EmailService] sendLeaveApprovedEmail: employee email not found.");
      return;
    }

    const { subject, html } = leaveApprovedTemplate({
      logoCid:        LOGO_CID,
      employeeName,
      fromDate:       fmtDate(leave.fromDate),
      toDate:         fmtDate(leave.toDate),
      totalLeaveDays: leave.totalLeaveDays,
      approvedByName: approvedByName || "Manager",
      approvedAt:     fmtDate(leave.approvedAt),
    });

    await sendMail(employeeEmail, subject, html);
  } catch (err) {
    console.error("[EmailService] sendLeaveApprovedEmail failed:", err.message);
  }
};

/**
 * sendLeaveRejectedEmail
 * Recipient: employee only
 */
const sendLeaveRejectedEmail = async ({ leave, rejectedByName }) => {
  try {
    const employeeId    = leave.employeeId?._id || leave.employeeId;
    const employeeName  = leave.employeeId?.name || "Employee";
    const employeeEmail = await getUserEmail(employeeId);

    if (!employeeEmail) {
      console.warn("[EmailService] sendLeaveRejectedEmail: employee email not found.");
      return;
    }

    const { subject, html } = leaveRejectedTemplate({
      logoCid:        LOGO_CID,
      employeeName,
      fromDate:       fmtDate(leave.fromDate),
      toDate:         fmtDate(leave.toDate),
      totalLeaveDays: leave.totalLeaveDays,
      rejectedByName: rejectedByName || "Manager",
      rejectedAt:     fmtDate(leave.rejectedAt),
      rejectReason:   leave.rejectReason,
    });

    await sendMail(employeeEmail, subject, html);
  } catch (err) {
    console.error("[EmailService] sendLeaveRejectedEmail failed:", err.message);
  }
};

module.exports = {
  sendLeaveAppliedEmail,
  sendLeaveApprovedEmail,
  sendLeaveRejectedEmail,
};
