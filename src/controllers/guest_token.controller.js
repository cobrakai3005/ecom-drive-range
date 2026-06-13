import { v4 as uuidv4 } from "uuid";
import { pool } from "../config/db.js";
// store guest sessions in a table

export const createGuestToken = async (req, res) => {
  const token = uuidv4();
  //  store in DB
  await pool.query("INSERT INTO guest_sessions (token) VALUES (?)", [token]);
  res.json({ success: true, token });
};
