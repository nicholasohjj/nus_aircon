function isValidMeterId(txtMtrId) {
  return /^\d{8}$/.test(String(txtMtrId || "").trim());
}

function isValidAmount(txtAmount) {
  const amount = Number(String(txtAmount || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount >= 6 && amount <= 50;
}

function validationError({ txtMtrId, txtAmount }) {
  if (!txtMtrId && !txtAmount) {
    return "Please enter your meter ID and top-up amount.";
  }

  if (!txtMtrId) {
    return "Please enter your meter ID.";
  }

  if (!txtAmount) {
    return "Please enter a top-up amount.";
  }

  if (!isValidMeterId(txtMtrId)) {
    return "Invalid meter ID. Meter ID must be exactly 8 digits.";
  }

  if (!isValidAmount(txtAmount)) {
    return "Invalid amount. Please enter an amount between $6.00 and $50.00.";
  }

  return null;
}

module.exports = {
  isValidAmount,
  isValidMeterId,
  validationError,
};
