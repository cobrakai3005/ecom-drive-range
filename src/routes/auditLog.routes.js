import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  getAuditLogs,
  getAuditLogByRecord,
} from "../controllers/auditLog.controller.js";

const router = express.Router();

router.get("/", verifyToken, authorize("Admin"), getAuditLogs);
router.get(
  "/:table_name/:record_id",
  verifyToken,
  authorize("Admin"),
  getAuditLogByRecord,
);

export default router;
