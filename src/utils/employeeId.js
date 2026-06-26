const Counter = require("../modules/counter/counter.model");
const User = require("../modules/user/user.model");

const EMPLOYEE_ID_KEY = "employeeId";
const EMPLOYEE_ID_PREFIX = "DOB";

const normalizeEmployeeId = (employeeId) => {
    if (!employeeId) {
        return "";
    }

    return String(employeeId).trim().toUpperCase();
};

const parseEmployeeNumber = (employeeId) => {
    if (!employeeId) {
        return 0;
    }

    const match = String(employeeId).match(/^DOB(\d+)$/i);

    if (!match) {
        return 0;
    }

    return parseInt(match[1], 10);
};

const getMaxEmployeeNumber = async () => {
    const users = await User.find({
        employeeId: /^DOB\d+$/i,
    })
        .select("employeeId")
        .lean();

    let maxNumber = 0;

    for (const user of users) {
        const number = parseEmployeeNumber(user.employeeId);

        if (number > maxNumber) {
            maxNumber = number;
        }
    }

    return maxNumber;
};

const ensureCounterInitialized = async () => {
    const counterExists = await Counter.exists({
        key: EMPLOYEE_ID_KEY,
    });

    if (counterExists) {
        return;
    }

    const maxNumber = await getMaxEmployeeNumber();

    try {
        await Counter.create({
            key: EMPLOYEE_ID_KEY,
            seq: maxNumber,
        });
    } catch (error) {
        // Another request may have created the counter at the same time.
        if (error.code !== 11000) {
            throw error;
        }
    }
};

const getNextEmployeeId = async () => {
    await ensureCounterInitialized();

    const counter = await Counter.findOneAndUpdate(
        { key: EMPLOYEE_ID_KEY },
        { $inc: { seq: 1 } },
        { new: true }
    );

    return `${EMPLOYEE_ID_PREFIX}${String(counter.seq).padStart(4, "0")}`;
};

const syncEmployeeIdCounter = async () => {
    const maxNumber = await getMaxEmployeeNumber();
    const counter = await Counter.findOne({
        key: EMPLOYEE_ID_KEY,
    });

    if (!counter) {
        await Counter.create({
            key: EMPLOYEE_ID_KEY,
            seq: maxNumber,
        });

        return maxNumber;
    }

    if (counter.seq < maxNumber) {
        counter.seq = maxNumber;
        await counter.save();
    }

    return Math.max(counter.seq, maxNumber);
};

module.exports = {
    normalizeEmployeeId,
    getNextEmployeeId,
    syncEmployeeIdCounter,
    getMaxEmployeeNumber,
};
