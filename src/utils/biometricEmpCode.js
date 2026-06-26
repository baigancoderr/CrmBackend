const normalizeBiometricEmpCode = (empCode) => {
  if (!empCode) {
    return "";
  }

  const digits = String(empCode).replace(/\D/g, "");

  if (!digits) {
    return String(empCode).trim();
  }

  const numericValue = parseInt(digits, 10);

  if (Number.isNaN(numericValue)) {
    return String(empCode).trim();
  }

  return String(numericValue).padStart(4, "0");
};

const normalizeEmpCode = normalizeBiometricEmpCode;

module.exports = {
  normalizeBiometricEmpCode,
  normalizeEmpCode,
};
