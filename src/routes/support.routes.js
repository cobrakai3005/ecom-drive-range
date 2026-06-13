import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  createTicket,
  getUserTickets,
  addCommunication,
  getTicketDetails,
  getAllTickets,
  updateTicketStatus,
} from "../controllers/support.controller.js";

const router = express.Router();

router.post("/create", verifyToken, authorize("Customer"), createTicket);
router.get("/my-tickets", verifyToken, authorize("Customer"), getUserTickets);
router.post(
  "/communication",
  verifyToken,
  authorize("Customer", "Admin", "Staff"),
  addCommunication,
);
router.get(
  "/:id",
  verifyToken,
  authorize("Customer", "Admin", "Staff"),
  getTicketDetails,
);
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllTickets,
);
router.put(
  "/admin/:id/status",
  verifyToken,
  authorize("Admin", "Staff"),
  updateTicketStatus,
);

export default router;
