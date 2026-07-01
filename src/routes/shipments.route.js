import express from "express";
const router = express.Router();
import * as shipmentController from "../controllers/shipments.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js ";

router.post(
  "/",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.createShipment,
);
router.get(
  "/",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.getAllShipments,
);
router.get(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.getShipmentById,
);
router.put(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.updateShipment,
);
router.patch(
  "/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.updateStatus,
);
router.post(
  "/:id/tracking",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.addTrackingEvent,
);
router.delete(
  "/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  shipmentController.deleteShipment,
);
export default router;
