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

dbHotel.run(`
  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habitacionId INTEGER NOT NULL,
    usuarioId INTEGER NOT NULL,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    estado TEXT DEFAULT 'pendiente', -- 'pendiente', 'confirmada', 'cancelada'
    precio_total REAL NOT NULL,
    FOREIGN KEY(habitacionId) REFERENCES habitaciones(id) ON DELETE RESTRICT,
    FOREIGN KEY(usuarioId) REFERENCES usuarios(id) ON DELETE RESTRICT
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

const verificarToken = (req, res, next) => {
  const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Acceso denegado. Token requerido." });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token inválido o expirado." });
    req.user = decoded; // { id, email, nombre, rol, ... }
    next();
  });
};

app.post("/register", (req, res) => {
  const { email, telefono, nombre, contraseña } = req.body;
  if (!email || !telefono || !nombre || !contraseña) {
    return res.status(400).json({ error: "Todos los campos son obligatorios." });
  }

  dbHotel.get("SELECT * FROM usuarios WHERE email = ?", [email], (err, row) => {
    if (err) return res.status(500).json({ error: "Error en la base de datos." });
    if (row) return res.status(409).json({ error: "El correo ya está registrado." });

    dbHotel.run(
      "INSERT INTO usuarios (email, telefono, nombre, contraseña, rol) VALUES (?, ?, ?, ?, 'cliente')",
      [email, telefono, nombre, contraseña],
      function (err) {
        if (err) return res.status(500).json({ error: "Error al registrar usuario." });

        res.json({
          mensaje: `¡Registro exitoso, ${nombre}!`,
          usuario: { id: this.lastID, email, nombre, rol: 'cliente' }
        });
      }
    );
  });
});

app.post("/login", (req, res) => {
  const { email, contraseña } = req.body;
  if (!email || !contraseña) {
    return res.status(400).json({ error: "Email y contraseña requeridos." });
  }

  dbHotel.get(
    "SELECT * FROM usuarios WHERE email = ? AND contraseña = ?",
    [email, contraseña],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Error en el servidor." });
      if (!row) return res.status(401).json({ error: "Credenciales incorrectas." });

      const payload = {
        id: row.id, 
        email: row.email,
        nombre: row.nombre,
        rol: row.rol
      };

      const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "8h" });
      res.cookie("token", token, { httpOnly: true, secure: false, maxAge: 8 * 3600000 }); 
      res.json({
        mensaje: "Login exitoso",
        usuario: payload
      });
    }
  );
});

app.get("/rooms", (req, res) => {
  // Opcionalmente filtrar por disponibilidad
  const { disponible } = req.query; 
  let sql = "SELECT * FROM habitaciones";
  const params = [];

  if (disponible !== undefined) {
    sql += " WHERE disponible = ?";
    params.push(disponible === 'true' || disponible === '1' ? 1 : 0);
  }

  dbHotel.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Error al obtener habitaciones." });
    res.json({ 
      habitaciones: rows.map(r => ({ ...r, disponible: r.disponible === 1 }))
    });
  });
});

app.get("/room/:id", (req, res) => {
  const { id } = req.params;
  dbHotel.get("SELECT * FROM habitaciones WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: "Error al buscar habitación." });
    if (!row) return res.status(404).json({ error: "Habitación no encontrada." });

    res.json({
      habitacion: {
        ...row,
        disponible: row.disponible === 1
      }
    });
  });
});