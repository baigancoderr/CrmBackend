const mongoose = require("mongoose");

const socialLinksSchema = new mongoose.Schema(
    {
        linkedin: {
            type: String,
            default: "",
        },

        github: {
            type: String,
            default: "",
        },

        twitter: {
            type: String,
            default: "",
        },

        instagram: {
            type: String,
            default: "",
        },

        facebook: {
            type: String,
            default: "",
        },

        website: {
            type: String,
            default: "",
        },
    },
    {
        _id: false,
    }
);

const addressSchema = new mongoose.Schema(
    {
        address: {
            type: String,
            default: "",
        },

        city: {
            type: String,
            default: "",
        },

        state: {
            type: String,
            default: "",
        },

        country: {
            type: String,
            default: "",
        },

        pincode: {
            type: String,
            default: "",
        },
    },
    {
        _id: false,
    }
);

const userSchema = new mongoose.Schema(
    {
        employeeId: {
            type: String,
            unique: true,
        },

        biometricEmpCode: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },

        firstName: {
            type: String,
            trim: true,
            default: "",
        },

        lastName: {
            type: String,
            default: "",
            trim: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        password: {
            type: String,
            required: true,
        },

        role: {
            type: String,
            enum: [
                "SUPER_ADMIN",
                "HR",
                "PROJECT_MANAGER",
                "TL",
                "ACCOUNTANT",
                "EMPLOYEE",
            ],
            default: "EMPLOYEE",
        },

        phone: {
            type: String,
            default: "",
        },

        gender: {
            type: String,
            enum: [
                "MALE",
                "FEMALE",
                "OTHER",
            ],
            default: "OTHER",
        },

        profilePhoto: {
            type: String,
            default: "",
        },

        department: {
            type: String,
            default: "",
        },

        designation: {
            type: String,
            default: "",
        },

        birthday: {
            type: Date,
        },

        joiningDate: {
            type: Date,
        },

        officeLocation: {
            type: String,
            default: "",
        },

        shift: {
            type: String,
            default: "",
        },

        manager: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        teamLeader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        addressInfo: addressSchema,

        socialLinks: socialLinksSchema,

        isFirstLogin: {
            type: Boolean,
            default: true,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

       officeTiming: {
    startTime: {
        type: String,
        default: "10:00"
    },

    endTime: {
        type: String,
        default: "19:00"
    }
},

weeklyOff: {
    type: [String],
    default: ["SATURDAY", "SUNDAY"]
},

employmentType: {
    type: String,
    enum: [
        "FULL_TIME",
        "PART_TIME",
        "INTERN",
        "CONTRACT",
        "FREELANCER"
    ],
    default: "FULL_TIME"
},

passwordResetRequest: {
  status: {
    type: String,
    enum: ["NONE", "PENDING", "APPROVED", "REJECTED"],
    default: "NONE",
  },
  reason: String,
  source: {
    type: String,
    enum: ["LOGIN", "SETTINGS"],
    default: "SETTINGS",
  },
  requestedAt: Date,
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  remarks: String,
},

passwordResetHistory: [
  {
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
    },

    reason: String,

    source: {
      type: String,
      enum: ["LOGIN", "SETTINGS"],
      default: "SETTINGS",
    },

    requestedAt: Date,

    reviewedAt: Date,

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    remarks: String,

  },
],

lastPasswordChangedAt: {
  type: Date,
  default: null,
},

lastLogin: {
    type: Date,
    default: null
} ,
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model(
    "User",
    userSchema
);