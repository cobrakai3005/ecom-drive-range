import mysql2 from "mysql2/promise";
import { config } from "dotenv";
import { sql } from "../models/sql.js";

config();

export const pool = mysql2.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  waitForConnections: true,
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
  queueLimit: 0,
});

export const connect = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await pool.query(`SELECT NOW() AS currentTime`);
    console.log(`✅✅ MYSQL Database Connected`);
    console.log(rows[0]);

    // Create Tables
    const queries = sql.split(";").filter((query) => query.trim());

    for (const query of queries) {
      try {
        await pool.query(query);
      } catch (err) {
        console.log("Query Error:", err.message);
      }
    }

    console.log("Tables created successfully");
    conn.release();
  } catch (error) {
    console.log(`❌❌ Databse Connection failed`, error.message);
  }
};

export default pool;
