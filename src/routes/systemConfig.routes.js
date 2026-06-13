import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  getAllConfig,
  getConfig,
  setConfig,
  deleteConfig,
} from "../controllers/systemConfig.controller.js";

const router = express.Router();

// Public readable config (but only specific safe keys? We'll allow any key but it's public – restrict if needed)
router.get("/public/:key", getConfig);

// Admin/Staff only
router.get("/", verifyToken, authorize("Admin", "Staff"), getAllConfig);
router.get("/:key", verifyToken, authorize("Admin", "Staff"), getConfig);
router.put("/:key", verifyToken, authorize("Admin", "Staff"), setConfig);
router.delete("/:key", verifyToken, authorize("Admin"), deleteConfig);

export default router;
