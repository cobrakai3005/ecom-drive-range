import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  registerWarranty,
  getUserWarranties,
  getAllWarranties,
  updateWarrantyStatus,
} from "../controllers/warranty.controller.js";

const router = express.Router();

router.post("/register", verifyToken, authorize("Customer"), registerWarranty);
router.get(
  "/my-warranties",
  verifyToken,
  authorize("Customer"),
  getUserWarranties,
);
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllWarranties,
);
router.put(
  "/admin/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateWarrantyStatus,
);

export default router;
