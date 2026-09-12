// 工单状态与流转常量

export const STATUS = Object.freeze({
  PENDING: "pending", // 待派单
  ACCEPTED: "accepted", // 已接单
  REPAIRING: "repairing", // 维修中
  ACCEPTING: "accepting_check", // 待验收
  VERIFIED: "verified" // 已验收
});

export const STATUS_LABELS = Object.freeze({
  [STATUS.PENDING]: "待派单",
  [STATUS.ACCEPTED]: "已接单",
  [STATUS.REPAIRING]: "维修中",
  [STATUS.ACCEPTING]: "待验收",
  [STATUS.VERIFIED]: "已验收"
});

// 允许的状态流转；验收不通过回到「已接单」
export const STATUS_FLOW = Object.freeze({
  [STATUS.PENDING]: [STATUS.ACCEPTED],
  [STATUS.ACCEPTED]: [STATUS.REPAIRING],
  [STATUS.REPAIRING]: [STATUS.ACCEPTING],
  [STATUS.ACCEPTING]: [STATUS.VERIFIED, STATUS.ACCEPTED],
  [STATUS.VERIFIED]: []
});

export const PRIORITY = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
});

export const PRIORITY_LABELS = Object.freeze({
  [PRIORITY.HIGH]: "高",
  [PRIORITY.MEDIUM]: "中",
  [PRIORITY.LOW]: "低"
});

export const PRIORITY_ORDER = Object.freeze({
  [PRIORITY.HIGH]: 0,
  [PRIORITY.MEDIUM]: 1,
  [PRIORITY.LOW]: 2
});

export const UNFINISHED_STATUSES = Object.freeze([
  STATUS.PENDING,
  STATUS.ACCEPTED,
  STATUS.REPAIRING,
  STATUS.ACCEPTING
]);

export const SCHEMA_VERSION = 1;
