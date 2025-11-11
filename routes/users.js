// routes/users.js
const express = require('express');

// Exportamos una función para recibir las dependencias (DB, Middlewares, etc.)
module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloAdmin, SECRET_KEY, bcrypt, SALT_ROUNDS }) => {
    const router = express.Router();

    // --- RUTAS PÚBLICAS DE AUTENTICACIÓN ---

    // POST /register
    router.post("/register", async (req, res) => {
        const { email, telefono, nombre, contraseña } = req.body;
        if (!email || !telefono || !nombre || !contraseña) {
            return res.status(400).json({ error: "Todos los campos (email, teléfono, nombre y contraseña) son obligatorios." });
        }

        try {
            const existingUser = await dbGet("SELECT * FROM usuarios WHERE email = ?", [email]);
            if (existingUser) return res.status(409).json({ error: "Correo ya registrado." });

            const hashedPassword = await bcrypt.hash(contraseña, SALT_ROUNDS);

            await dbRun(
                "INSERT INTO usuarios (email, telefono, nombre, contraseña, rol) VALUES (?, ?, ?, ?, 'cliente')",
                [email, telefono, nombre, hashedPassword]
            );
            res.json({ mensaje: `Registro exitoso, ${nombre}! Por favor, inicia sesión.` });

        } catch (error) {
            console.error("Error al registrar:", error);
            res.status(500).json({ error: "Error interno al procesar el registro." });
        }
    });

    // POST /login
    router.post("/login", async (req, res) => {
        const { email, contraseña } = req.body;
        if (!email || !contraseña) return res.status(400).json({ error: "Email y contraseña requeridos." });

        try {
            const user = await dbGet("SELECT id, email, nombre, rol, contraseña FROM usuarios WHERE email = ?", [email]);
            if (!user) return res.status(401).json({ error: "Credenciales incorrectas." });

            const match = await bcrypt.compare(contraseña, user.contraseña);
            if (!match) return res.status(401).json({ error: "Credenciales incorrectas." });

            delete user.contraseña; 
            const payload = { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol };
            const token = require('jsonwebtoken').sign(payload, SECRET_KEY, { expiresIn: "8h" });

            res.cookie("token", token, { 
                httpOnly: true, 
                secure: process.env.NODE_ENV === 'production', 
                maxAge: 8 * 3600000,
                sameSite: 'Lax'
            });

            res.json({ mensaje: "Login exitoso", usuario: payload });

        } catch (error) {
            console.error("Error en el login:", error);
            res.status(500).json({ error: "Error en el servidor." });
        }
    });

    // POST /logout
    router.post("/logout", (req, res) => {
        res.clearCookie("token");
        res.json({ mensaje: "Sesión cerrada con éxito." });
    });

    // --- RUTAS DE ADMINISTRACIÓN DE USUARIOS ---

    // GET / - Obtener todos los usuarios
    router.get("/", verificarToken, soloAdmin, async (req, res) => {
        try {
            const sql = "SELECT id, email, telefono, nombre, rol FROM usuarios";
            const rows = await dbAll(sql, []);
            res.json({ usuarios: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener todos los usuarios." });
        }
    });

    // GET /:id - Obtener usuario por ID
    router.get("/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const sql = "SELECT id, email, telefono, nombre, rol FROM usuarios WHERE id = ?";
            const user = await dbGet(sql, [id]);
            if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
            res.json({ usuario: user });
        } catch (err) {
            res.status(500).json({ error: "Error al buscar usuario." });
        }
    });

    // PUT /:id - Editar usuario
    router.put("/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        const { email, telefono, nombre, rol, contraseña } = req.body;

        if (!email || !telefono || !nombre || !rol) {
            return res.status(400).json({ error: "Email, teléfono, nombre y rol son obligatorios." });
        }

        try {
            let sql = "UPDATE usuarios SET email = ?, telefono = ?, nombre = ?, rol = ?";
            const params = [email, telefono, nombre, rol];

            if (contraseña) {
                const hashedPassword = await bcrypt.hash(contraseña, SALT_ROUNDS);
                sql += ", contraseña = ?";
                params.push(hashedPassword);
            }

            sql += " WHERE id = ?";
            params.push(id);
            
            const result = await dbRun(sql, params);

            if (result.changes === 0) return res.status(404).json({ error: "Usuario no encontrado o sin cambios realizados." });
            res.json({ mensaje: `Usuario con ID ${id} actualizado con éxito.` });

        } catch (err) {
            console.error("Error al actualizar usuario:", err);
            res.status(500).json({ error: "Error al actualizar el usuario." });
        }
    });

    // DELETE /:id - Eliminar usuario
    router.delete("/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            if (req.user.id == id) {
                return res.status(403).json({ error: "No puedes eliminar tu propia cuenta de administrador." });
            }
            
            const result = await dbRun("DELETE FROM usuarios WHERE id = ?", [id]);
            if (result.changes === 0) return res.status(404).json({ error: "Usuario no encontrado." });
            res.json({ mensaje: `Usuario con ID ${id} eliminado.` });

        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                return res.status(409).json({ error: "No se puede eliminar el usuario porque tiene reservas asociadas." });
            }
            console.error("Error al eliminar usuario:", err);
            res.status(500).json({ error: "Error al eliminar el usuario." });
        }
    });

    // GET /status - Verificar estado de sesión y obtener datos del token
    router.get("/status", verificarToken, async (req, res) => {
        try {
            // El token ya fue verificado por 'verificarToken'.
            // req.user contiene { id, email, nombre, rol } del payload del token.
            
            // Opcional: Para obtener todos los datos (incluyendo teléfono) desde la DB
            const sql = "SELECT id, email, telefono, nombre, rol FROM usuarios WHERE id = ?";
            const user = await dbGet(sql, [req.user.id]);

            if (!user) {
                return res.status(404).json({ error: "Usuario asociado al token no encontrado." });
            }
            
            res.json({ 
                mensaje: "Sesión activa", 
                usuario: user 
            });

        } catch (error) {
            console.error("Error al verificar estado:", error);
            res.status(500).json({ error: "Error interno al verificar la sesión." });
        }
    });
    
    return router;
};