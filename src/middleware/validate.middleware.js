const validateRequest = (schemas = {}) => {
  return (req, res, next) => {
    try {
      const validationTargets = [
        ["params", req.params],
        ["query", req.query],
        ["body", req.body],
      ];

      for (const [key, value] of validationTargets) {
        const schema = schemas[key];

        if (!schema) {
          continue;
        }

        const { error, value: validatedValue } =
          schema.validate(value, {
            abortEarly: false,
            stripUnknown: true,
          });

        if (error) {
          return res.status(400).json({
            success: false,
            message: error.details
              .map((item) => item.message)
              .join(", "),
          });
        }

        req[key] = validatedValue;
      }

      return next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Validation middleware failed",
      });
    }
  };
};

module.exports = validateRequest;
