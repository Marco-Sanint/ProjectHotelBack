const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");

const app = express();
const PORT = 3000;
const SECRET_KEY = "tu_clave_secreta_de_hotel"; 

const dbHotel = new sqlite3.Database('./hotel.db', (err) => {
  if (err) console.error("Error BD hotel:", err.message);
  else console.log("Conectado a hotel.db");
});

dbHotel.run(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    telefono TEXT NOT NULL,
    nombre TEXT NOT NULL,
    contraseña TEXT NOT NULL,
    rol TEXT DEFAULT 'cliente' -- 'cliente' o 'admin'
  )
`);

dbHotel.run(`
  CREATE TABLE IF NOT EXISTS habitaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT UNIQUE NOT NULL,
    tipo TEXT NOT NULL, -- Ej: 'Individual', 'Doble', 'Suite'
    precio_noche REAL NOT NULL,
    descripcion TEXT,
    disponible INTEGER DEFAULT 1 -- 1: Sí, 0: No
  )
`);

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("¡Bienvenido al Backend del Hotel! 🏨");
});

app.listen(PORT, () => {
  console.log(`Servidor de Hotel corriendo en http://localhost:${PORT}`);
});