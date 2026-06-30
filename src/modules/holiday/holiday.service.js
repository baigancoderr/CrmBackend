const Holiday = require("./holiday.model");

const WEEKEND = ["SATURDAY", "SUNDAY"];

const getWorkingDays = (fromDate, toDate) => {
  let totalWorkingDays = 0;

  const currentDate = new Date(fromDate);
  const endDate = new Date(toDate);

  currentDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(0, 0, 0, 0);

  while (currentDate <= endDate) {
    const day = currentDate.getUTCDay();

    if (day !== 0 && day !== 6) {
      totalWorkingDays++;
    }

    currentDate.setUTCDate(
      currentDate.getUTCDate() + 1
    );
  }

  return totalWorkingDays;
};

const formatHolidayResponse = (holiday) => {
  return {
    ...holiday.toObject(),
    isMultiDay:
      holiday.fromDate !== holiday.toDate,
    totalWorkingDays: getWorkingDays(
      holiday.fromDate,
      holiday.toDate
    ),
  };
};

const createHoliday = async (body, userId) => {
  const {
    title,
    description,
    holidayType,
    fromDate,
    toDate,
  } = body;

  if (!title || !fromDate || !toDate) {
    throw new Error(
      "Title, From Date and To Date are required."
    );
  }

 const startDate = new Date(fromDate);
const endDate = new Date(toDate);

if (startDate.getTime() > endDate.getTime()) {
  throw new Error(
    "From Date cannot be greater than To Date."
  );
}

  const duplicateHoliday = await Holiday.findOne({
    title: {
      $regex: `^${title.trim()}$`,
      $options: "i",
    },
    isDeleted: false,
  });

  if (duplicateHoliday) {
    throw new Error(
      "Holiday with same title already exists."
    );
  }

  const holidays = await Holiday.find({
    isDeleted: false,
  });

  const overlapHoliday = holidays.find((holiday) => {
    const holidayStart = new Date(holiday.fromDate);
    const holidayEnd = new Date(holiday.toDate);

    return (
      holidayStart <= endDate &&
      holidayEnd >= startDate
    );
  });

  if (overlapHoliday) {
    throw new Error(
      "Holiday already exists between selected dates."
    );
  }

const holiday = await Holiday.create({
  title: title.trim(),
  description: description?.trim() || "",
  holidayType,
  fromDate,
  toDate,
  createdBy: userId,
});

  const createdHoliday = await Holiday.findById(
    holiday._id
  ).populate(
    "createdBy",
    "name employeeId role"
  );

  return formatHolidayResponse(createdHoliday);
};


const getAllHolidays = async (query) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    year,
    holidayType,
    isActive,
  } = query;

  const filter = {
    isDeleted: false,
  };

  const conditions = [];

  if (search.trim()) {
    conditions.push({
      $or: [
        {
          title: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          description: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          holidayType: {
            $regex: search.trim(),
            $options: "i",
          },
        },
      ],
    });
  }

  if (year) {
    const startDate = `${year}-01-01`;
const endDate = `${year}-12-31`;

    conditions.push({
      $or: [
        {
          fromDate: {
            $gte: startDate,
            $lte: endDate,
          },
        },
        {
          toDate: {
            $gte: startDate,
            $lte: endDate,
          },
        },
        {
          fromDate: {
            $lte: startDate,
          },
          toDate: {
            $gte: endDate,
          },
        },
      ],
    });
  }

  if (conditions.length) {
    filter.$and = conditions;
  }

  if (holidayType) {
    filter.holidayType = holidayType;
  }

  if (typeof isActive !== "undefined") {
    filter.isActive = isActive === "true";
  }

  const currentPage = Math.max(
    Number(page) || 1,
    1
  );

  const perPage = Math.max(
    Number(limit) || 10,
    1
  );

  const skip = (currentPage - 1) * perPage;

  const totalRecords =
    await Holiday.countDocuments(filter);

  const holidays = await Holiday.find(filter)
    .populate(
      "createdBy",
      "name employeeId role"
    )
    .populate(
      "updatedBy",
      "name employeeId role"
    )
    .sort({
      fromDate: 1,
      createdAt: -1,
    })
    .skip(skip)
    .limit(perPage);

  const data = holidays.map((holiday) =>
    formatHolidayResponse(holiday)
  );

  return {
    page: currentPage,
    limit: perPage,
    totalRecords,
    totalPages:
      Math.ceil(totalRecords / perPage) || 1,
    data,
  };
};

const getHolidayById = async (id) => {
  const holiday = await Holiday.findOne({
    _id: id,
    isDeleted: false,
  })
    .populate(
      "createdBy",
      "name employeeId role"
    )
    .populate(
      "updatedBy",
      "name employeeId role"
    );

  if (!holiday) {
    throw new Error("Holiday not found.");
  }

  return formatHolidayResponse(holiday);
};

const updateHoliday = async (
  id,
  body,
  userId
) => {
  const holiday = await Holiday.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!holiday) {
    throw new Error("Holiday not found.");
  }

  const fromDate =
    body.fromDate || holiday.fromDate;

  const toDate =
    body.toDate || holiday.toDate;

  const startDate = new Date(fromDate);
  const endDate = new Date(toDate);

  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(
      "From Date cannot be greater than To Date."
    );
  }

  const duplicateHoliday =
    await Holiday.findOne({
      _id: { $ne: id },
      title: {
        $regex: `^${(
          body.title || holiday.title
        ).trim()}$`,
        $options: "i",
      },
      isDeleted: false,
    });

  if (duplicateHoliday) {
    throw new Error(
      "Holiday with same title already exists."
    );
  }

  const holidays = await Holiday.find({
    _id: { $ne: id },
    isDeleted: false,
  });

  const overlapHoliday = holidays.find((item) => {
    const holidayStart = new Date(item.fromDate);
    const holidayEnd = new Date(item.toDate);

    return (
      holidayStart <= endDate &&
      holidayEnd >= startDate
    );
  });

  if (overlapHoliday) {
    throw new Error(
      "Holiday already exists between selected dates."
    );
  }

  holiday.title =
    body.title?.trim() || holiday.title;

  holiday.description =
    body.description?.trim() ??
    holiday.description;

  holiday.holidayType =
    body.holidayType ||
    holiday.holidayType;

  holiday.fromDate = fromDate;

  holiday.toDate = toDate;

  if (
    typeof body.isActive === "boolean"
  ) {
    holiday.isActive = body.isActive;
  }

  holiday.updatedBy = userId;

  await holiday.save();

  const updatedHoliday =
    await Holiday.findById(
      holiday._id
    )
      .populate(
        "createdBy",
        "name employeeId role"
      )
      .populate(
        "updatedBy",
        "name employeeId role"
      );

  return formatHolidayResponse(
    updatedHoliday
  );
};

const deleteHoliday = async (id, userId) => {
  const holiday = await Holiday.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!holiday) {
    throw new Error("Holiday not found.");
  }

  holiday.isDeleted = true;
  holiday.deletedAt = new Date();
  holiday.updatedBy = userId;

  await holiday.save();

  return {
    message: "Holiday deleted successfully.",
  };
};

const restoreHoliday = async (id, userId) => {
  const holiday = await Holiday.findOne({
    _id: id,
    isDeleted: true,
  });

  if (!holiday) {
    throw new Error("Holiday not found.");
  }

  const holidays = await Holiday.find({
    _id: { $ne: id },
    isDeleted: false,
  });

  const restoreStart = new Date(holiday.fromDate);
  const restoreEnd = new Date(holiday.toDate);

  const overlapHoliday = holidays.find((item) => {
    const holidayStart = new Date(item.fromDate);
    const holidayEnd = new Date(item.toDate);

    return (
      holidayStart <= restoreEnd &&
      holidayEnd >= restoreStart
    );
  });

  if (overlapHoliday) {
    throw new Error(
      "Cannot restore because another holiday already exists for the same date."
    );
  }

  holiday.isDeleted = false;
  holiday.deletedAt = null;
  holiday.updatedBy = userId;

  await holiday.save();

  const restoredHoliday = await Holiday.findById(
    holiday._id
  )
    .populate(
      "createdBy",
      "name employeeId role"
    )
    .populate(
      "updatedBy",
      "name employeeId role"
    );

  return formatHolidayResponse(
    restoredHoliday
  );
};

module.exports = {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
  restoreHoliday,
};