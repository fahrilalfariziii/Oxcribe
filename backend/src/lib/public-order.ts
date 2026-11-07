type PublicRecord = Record<string, unknown>;

function record(value: unknown): PublicRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as PublicRecord : {};
}

function pick(value: unknown, fields: readonly string[]): PublicRecord {
  const source = record(value);
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function toPublicPayment(value: unknown) {
  const payment = record(value);
  return {
    ...pick(payment, ["id", "method", "status", "amount", "paidAt", "gateway", "reference"]),
    gatewayData: pick(payment.gatewayData, ["qrContent", "qrUrl", "qrString", "referenceNo", "partnerReferenceNo", "expiredDate", "expiry_time", "expiryTime", "chargeAttemptStatus", "chargeMessage"]),
  };
}

export function toPublicOrder(value: unknown) {
  if (value === null || value === undefined) return null;
  const order = record(value);
  return {
    ...pick(order, ["id", "orderNumber", "clientOrderId", "tableId", "customerName", "source", "status", "paymentMethod", "paymentStatus", "subtotal", "serviceCharge", "tax", "taxLabel", "taxBearer", "platformFee", "platformFeeBearer", "total", "createdAt", "updatedAt"]),
    items: list(order.items).map((item) => pick(item, ["id", "productId", "productName", "price", "quantity", "options", "optionsLabel", "subtotal"])),
    payments: list(order.payments).map(toPublicPayment),
    statusLogs: list(order.statusLogs).map((entry) => pick(entry, ["status", "createdAt"])),
    table: order.table ? pick(order.table, ["id", "tableNumber", "area"]) : null,
  };
}

export function toPublicGatewayStatus(value: unknown) {
  return value ? pick(value, ["latestTransactionStatus", "transactionStatus", "responseCode"]) : null;
}
