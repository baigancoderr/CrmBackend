const Announcement = require("./announcement.model");
const { triggerAnnouncementNotification } = require("./announcement.service");

const checkScheduledAnnouncements = async () => {
  try {
    const now = new Date();

    const scheduledAnnouncements = await Announcement.find({
      status: "SCHEDULED",
      publishAt: { $lte: now },
      isDeleted: false,
    });

    if (!scheduledAnnouncements.length) return;

    console.log(
      `[Announcement Scheduler] Found ${scheduledAnnouncements.length} scheduled announcement(s) to publish.`
    );

    for (const announcement of scheduledAnnouncements) {
      announcement.status = "PUBLISHED";
      announcement.publishedAt = now;
      if (!announcement.publishedBy) {
        announcement.publishedBy = announcement.createdBy;
      }
      await announcement.save();

      await triggerAnnouncementNotification(announcement, announcement.createdBy);
      console.log(
        `[Announcement Scheduler] Published announcement "${announcement.title}" (${announcement._id})`
      );
    }
  } catch (error) {
    console.error("[Announcement Scheduler] Error publishing scheduled announcements:", error);
  }
};

const checkExpiredAnnouncements = async () => {
  try {
    const now = new Date();

    const result = await Announcement.updateMany(
      {
        status: "PUBLISHED",
        expiresAt: { $lte: now },
        isDeleted: false,
      },
      {
        $set: { status: "EXPIRED" },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[Announcement Scheduler] Marked ${result.modifiedCount} announcement(s) as EXPIRED.`
      );
    }
  } catch (error) {
    console.error("[Announcement Scheduler] Error expiring announcements:", error);
  }
};

const startAnnouncementScheduler = (intervalMs = 60 * 1000) => {
  console.log(
    `[Announcement Scheduler] Starting background job running every ${intervalMs / 1000}s...`
  );

  // Initial check
  checkScheduledAnnouncements();
  checkExpiredAnnouncements();

  // Periodic interval
  setInterval(() => {
    checkScheduledAnnouncements();
    checkExpiredAnnouncements();
  }, intervalMs);
};

module.exports = {
  startAnnouncementScheduler,
  checkScheduledAnnouncements,
  checkExpiredAnnouncements,
};
