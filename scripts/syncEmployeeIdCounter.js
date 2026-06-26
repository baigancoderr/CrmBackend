require("dotenv").config();

const connectDB = require("../src/config/db");
const { syncEmployeeIdCounter } = require("../src/utils/employeeId");

const syncCounter = async () => {
    try {
        await connectDB();

        const maxNumber = await syncEmployeeIdCounter();

        console.log(
            `Employee ID counter synced. Next ID will be DOB${String(
                maxNumber + 1
            ).padStart(4, "0")}`
        );

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

syncCounter();
