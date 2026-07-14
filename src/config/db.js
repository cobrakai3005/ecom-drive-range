import mysql2 from "mysql2/promise";
import { config } from "dotenv";
import { sql } from "../models/sql.js";

config();

export const pool = mysql2.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  // India Time Zone (IST)
  timezone: "+05:30",
  dateStrings: true,
});

export const connect = async () => {
  let conn;

  try {
    conn = await pool.getConnection();

    // Set MySQL session timezone to IST
    await conn.query("SET time_zone = '+05:30'");

    const [rows] = await conn.query("SELECT NOW() AS currentTime");

    console.log("✅✅ MYSQL Database Connected");
    console.log("Current DB Time:", rows[0].currentTime);

    // Create Tables
    const queries = sql
      .split(";")
      .map((q) => q.trim())
      .filter(Boolean);

    for (const query of queries) {
      try {
        await conn.query(query);
      } catch (err) {
        console.log("Query Error:", err.message);
      }
    }

    console.log("✅ Tables created successfully");
  } catch (error) {
    console.log("❌❌ Database Connection Failed:", error.message);
  } finally {
    if (conn) conn.release();
  }
};

export default pool;
