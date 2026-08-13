/**
 * emailTemplates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Industry-grade HTML email templates for Leave notifications.
 * Logo rendered via CID (inline attachment) — centered, above the card body.
 * Each template returns { subject, html }.
 */
"use strict";

// ── Design tokens ─────────────────────────────────────────────────────────────
const BRAND     = "#E12751";
const BRAND2    = "#F58229";
const SUCCESS   = "#16a34a";
const DANGER    = "#dc2626";
const BG_PAGE   = "#edf0f4";
const BG_CARD   = "#ffffff";
const BG_HEAD   = "#fafbfc";
const BG_LABEL  = "#f4f6f8";
const BORDER    = "#dde1e7";
const TXT_HEAD  = "#0d1117";
const TXT_BODY  = "#24292f";
const TXT_MUTED = "#57606a";
const FONT      = "'Segoe UI','Helvetica Neue',Arial,sans-serif";

// ── Row helper — alternating zebra ───────────────────────────────────────────
let _rowIdx = 0;
const resetRows = () => { _rowIdx = 0; };
const row = (label, value) => {
  const bg = (_rowIdx++ % 2 === 0) ? BG_CARD : BG_LABEL;
  return `
<tr>
  <td width="36%" style="padding:11px 16px;font-size:13px;font-weight:600;
      color:${TXT_MUTED};font-family:${FONT};background:${BG_LABEL};
      border-bottom:1px solid ${BORDER};vertical-align:middle;">
    ${label}
  </td>
  <td style="padding:11px 16px;font-size:13px;color:${TXT_BODY};
      font-family:${FONT};background:${bg};
      border-bottom:1px solid ${BORDER};vertical-align:middle;">
    ${value ?? "—"}
  </td>
</tr>`;
};

// ── Info table wrapper ────────────────────────────────────────────────────────
const infoTable = (headerLabel, rows) => `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
  style="border:1px solid ${BORDER};border-radius:6px;overflow:hidden;margin:0;">
  <thead>
    <tr>
      <td colspan="2" style="padding:10px 16px;background:${BG_HEAD};
          border-bottom:1px solid ${BORDER};font-size:11px;font-weight:700;
          letter-spacing:.8px;text-transform:uppercase;color:${TXT_MUTED};
          font-family:${FONT};">
        ${headerLabel}
      </td>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;

// ── Status pill ───────────────────────────────────────────────────────────────
const pill = (text, bg, color) =>
  `<span style="display:inline-block;padding:3px 12px;border-radius:20px;
   font-size:11.5px;font-weight:700;letter-spacing:.4px;
   background:${bg};color:${color};">${text}</span>`;

// ── Shell ─────────────────────────────────────────────────────────────────────
const shell = (preheader, accentColor, logoCid, body) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${preheader}</title>
<style>
  body,table,td{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  body{margin:0;padding:0;background:${BG_PAGE};}
  img{border:0;display:block;outline:none;}
  table{border-collapse:collapse;}
  @media(max-width:600px){
    .card{width:100%!important;border-radius:0!important;}
    .body-pad{padding:22px 18px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BG_PAGE};font-family:${FONT};">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;
            color:${BG_PAGE};mso-hide:all;">
  ${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr><td align="center" style="padding:36px 12px 44px;">

  <!-- ─ Outer card ─────────────────────────────────────────── -->
  <table class="card" width="580" cellpadding="0" cellspacing="0" role="presentation"
    style="background:${BG_CARD};border-radius:10px;overflow:hidden;
           border:1px solid ${BORDER};box-shadow:0 4px 20px rgba(0,0,0,.08);">

   

    <!-- Logo row (centered) -->
    <tr>
      <td align="center" style="padding:28px 32px 20px;background:${BG_CARD};
                                border-bottom:1px solid ${BORDER};">
        <img src="cid:${logoCid}" width="120" height="28"
             alt="Office CRM" style="height:auto;max-width:120px;width:100%;display:block;margin:0 auto;"/>
        <p style="margin:8px 0 0;font-size:11px;color:${TXT_MUTED};
                  letter-spacing:.8px;text-transform:uppercase;font-family:${FONT};">
          Leave Management System
        </p>
      </td>
    </tr>

    <!-- Accent colour bar under header -->
    <tr>
      <td style="background:${accentColor};height:2px;line-height:2px;font-size:0;">&nbsp;</td>
    </tr>

    <!-- Body -->
    <tr>
      <td class="body-pad" style="padding:28px 32px;">${body}</td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:16px 32px;background:${BG_LABEL};border-top:1px solid ${BORDER};
                 text-align:center;">
        <p style="margin:0 0 3px;font-size:12px;color:${TXT_MUTED};font-family:${FONT};">
          This is an automated notification from <strong>Office CRM</strong>.&nbsp;
          Please do not reply to this email.
        </p>
        <p style="margin:0;font-size:11px;color:#8b949e;font-family:${FONT};">
          &copy; ${new Date().getFullYear()} Digital One Box &mdash; All rights reserved.
        </p>
      </td>
    </tr>

  </table>
  <!-- ─ /Outer card ────────────────────────────────────────── -->

</td></tr>
</table>
</body>
</html>`;

// ── Template 1 — Leave Applied (HR / SUPER_ADMIN / Manager / TL) ─────────────
const leaveAppliedTemplate = ({
  logoCid, employeeName, employeeId,
  fromDate, toDate, totalLeaveDays,
  category, leaveDeductionType, earlyLeaveHours, reason,
}) => {
  const subject = `New Leave Request — ${employeeName}`;
  const days    = `${totalLeaveDays} ${totalLeaveDays === 1 ? "day" : "days"}`;
  const categoryLabel = category === "EARLY_LEAVE" ? "Early Leave" : category === "FULL_DAY" ? "Full Day" : "Half Day";
  const deductionLabel = { LEAVE_BALANCE: "Leave Balance", SALARY: "Salary Deduction", BOTH: "Leave Balance + Salary", EARLY_LEAVE: "Early Leave (Complete Work Hours)" }[leaveDeductionType] || leaveDeductionType;
  const earlyLeaveHoursText = Number(earlyLeaveHours || 0) > 0 ? `${Number(earlyLeaveHours).toFixed(Number.isInteger(Number(earlyLeaveHours)) ? 0 : 1)} hours` : "—";

  resetRows();
  const body = `
    <!-- Tag + heading -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;">
      <tr>
        <td>
          <span style="display:inline-block;padding:3px 11px;border-radius:4px;
                       background:#fff0f3;border:1px solid #fca5a5;
                       color:${BRAND};font-size:11px;font-weight:700;
                       letter-spacing:.5px;font-family:${FONT};">
            ● ACTION REQUIRED
          </span>
        </td>
      </tr>
      <tr><td style="padding:10px 0 4px;">
        <h2 style="margin:0;font-size:20px;font-weight:700;color:${TXT_HEAD};
                   font-family:${FONT};line-height:1.3;">New Leave Request</h2>
      </td></tr>
      <tr><td>
        <p style="margin:0;font-size:13.5px;color:${TXT_MUTED};font-family:${FONT};line-height:1.6;">
          <strong style="color:${TXT_BODY};">${employeeName}</strong>
          has submitted a leave request and it is awaiting your review.
        </p>
      </td></tr>
    </table>

    <!-- Info table -->
    ${infoTable("Leave Request Details", `
      ${row("Employee Name",  `<strong>${employeeName}</strong>`)}
      ${row("Employee ID",    employeeId)}
      ${row("From Date",      fromDate)}
      ${row("To Date",        toDate)}
      ${row("Leave Days",     `<strong>${days}</strong>`)}
      ${row("Category",       categoryLabel)}
      ${row("Early Leave Hours", earlyLeaveHoursText)}
      ${row("Deduction Type", deductionLabel)}
      ${row("Reason",         reason)}
      ${row("Status",         pill("● PENDING", "#fff7e6", "#b45309"))}
    `)}

    <!-- Footer note -->
    <p style="margin:20px 0 0;font-size:12.5px;color:${TXT_MUTED};
              font-family:${FONT};line-height:1.6;text-align:center;">
      Please log in to <strong>Office CRM</strong> to review and take action.
    </p>`;

  return { subject, html: shell(subject, BRAND, logoCid, body) };
};

// ── Template 2 — Leave Approved (employee only) ───────────────────────────────
const leaveApprovedTemplate = ({
  logoCid, employeeName,
  fromDate, toDate, totalLeaveDays,
  approvedByName, approvedAt,
}) => {
  const subject = "Your Leave Request Has Been Approved";
  const days    = `${totalLeaveDays} ${totalLeaveDays === 1 ? "day" : "days"}`;

  resetRows();
  const body = `
    <!-- Status banner -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="margin-bottom:22px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:14px 28px;background:#f0fdf4;border-radius:8px;
                         border:1px solid #bbf7d0;text-align:center;">
                <p style="margin:0 0 4px;font-size:28px;line-height:1;">&#10003;</p>
                <p style="margin:0;font-size:17px;font-weight:700;color:${SUCCESS};
                           font-family:${FONT};">Leave Approved</p>
                <p style="margin:6px 0 0;font-size:13px;color:${TXT_MUTED};
                           font-family:${FONT};">
                  Hi <strong style="color:${TXT_BODY};">${employeeName}</strong>,
                  your leave request has been approved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Info table -->
    ${infoTable("Approval Details", `
      ${row("Employee Name",  `<strong>${employeeName}</strong>`)}
      ${row("From Date",      fromDate)}
      ${row("To Date",        toDate)}
      ${row("Leave Days",     `<strong>${days}</strong>`)}
      ${row("Approved By",    approvedByName)}
      ${row("Approved On",    approvedAt)}
      ${row("Status",         pill("● APPROVED", "#dcfce7", "#15803d"))}
    `)}

    <!-- Note -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:20px;">
      <tr>
        <td style="padding:13px 16px;background:#f0fdf4;border-radius:6px;
                   border-left:3px solid ${SUCCESS};">
          <p style="margin:0;font-size:13px;color:${TXT_BODY};
                    font-family:${FONT};line-height:1.6;">
            Enjoy your time off! Reach out to HR if you have any questions.
          </p>
        </td>
      </tr>
    </table>`;

  return { subject, html: shell(subject, SUCCESS, logoCid, body) };
};

// ── Template 3 — Leave Rejected (employee only) ───────────────────────────────
const leaveRejectedTemplate = ({
  logoCid, employeeName,
  fromDate, toDate, totalLeaveDays,
  rejectedByName, rejectedAt, rejectReason,
}) => {
  const subject = "Your Leave Request Has Been Rejected";
  const days    = `${totalLeaveDays} ${totalLeaveDays === 1 ? "day" : "days"}`;

  resetRows();
  const body = `
    <!-- Status banner -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="margin-bottom:22px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="padding:14px 28px;background:#fff1f2;border-radius:8px;
                         border:1px solid #fecdd3;text-align:center;">
                <p style="margin:0 0 4px;font-size:28px;line-height:1;color:${DANGER};">&#10005;</p>
                <p style="margin:0;font-size:17px;font-weight:700;color:${DANGER};
                           font-family:${FONT};">Leave Rejected</p>
                <p style="margin:6px 0 0;font-size:13px;color:${TXT_MUTED};
                           font-family:${FONT};">
                  Hi <strong style="color:${TXT_BODY};">${employeeName}</strong>,
                  your leave request was not approved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Info table -->
    ${infoTable("Rejection Details", `
      ${row("Employee Name",   `<strong>${employeeName}</strong>`)}
      ${row("From Date",       fromDate)}
      ${row("To Date",         toDate)}
      ${row("Leave Days",      `<strong>${days}</strong>`)}
      ${row("Rejected By",     rejectedByName)}
      ${row("Rejected On",     rejectedAt)}
      ${row("Reason",          rejectReason || "No reason provided")}
      ${row("Status",          pill("● REJECTED", "#fee2e2", "#b91c1c"))}
    `)}

    <!-- Note -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:20px;">
      <tr>
        <td style="padding:13px 16px;background:#fff1f2;border-radius:6px;
                   border-left:3px solid ${DANGER};">
          <p style="margin:0;font-size:13px;color:${TXT_BODY};
                    font-family:${FONT};line-height:1.6;">
            If you believe this is incorrect, please contact your reporting manager or HR.
          </p>
        </td>
      </tr>
    </table>`;

  return { subject, html: shell(subject, DANGER, logoCid, body) };
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { leaveAppliedTemplate, leaveApprovedTemplate, leaveRejectedTemplate };
