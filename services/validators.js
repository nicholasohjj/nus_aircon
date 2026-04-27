function isValidMeterId(txtMtrId) {
  return /^\d{8}$/.test(String(txtMtrId || "").trim());
}

function isValidAmount(txtAmount) {
  const amount = Number(String(txtAmount || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount >= 6 && amount <= 50;
}

module.exports = {
  isValidAmount,
  isValidMeterId,
};
