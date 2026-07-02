import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  claimWarranty,
  getMyWarrantyItems,getClaimedWarrantyItemsAdmin

} from "../controllers/warranty.controller.js";

const router = express.Router();

router.get(
  "/my-warranties",
  verifyToken,
  authorize("Customer"),
  getMyWarrantyItems,
);
router.post(
  "/claim/:orderItemId",
  verifyToken,
  authorize("Customer"),
  claimWarranty,
);

router.get("/admin/show-claims", verifyToken,
  authorize("Admin", "Staff"), getClaimedWarrantyItemsAdmin);

export default router;
