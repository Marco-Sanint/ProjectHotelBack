// routes/users.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloAdmin, SECRET_KEY, bcrypt, SALT_ROUNDS }) => {
    const router = express.Router();
    const jwt = require('jsonwebtoken'); // Se añade aquí para limpieza

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
            const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "8h" }); // Usando la variable jwt

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
    
    // --- RUTAS DE PERFIL DE USUARIO (CLIENTE/ADMIN) ---

    // GET /me - Obtener mis propios datos de perfil (usando el token) ⬅️ NUEVO
    router.get("/me", verificarToken, async (req, res) => {
        try {
            // Se usa req.user.id del token verificado
            const sql = "SELECT id, email, telefono, nombre, rol FROM usuarios WHERE id = ?";
            const user = await dbGet(sql, [req.user.id]);

            if (!user) {
                return res.status(404).json({ error: "Usuario asociado al token no encontrado." });
            }
            
            res.json({ usuario: user });

        } catch (error) {
            console.error("Error al obtener perfil:", error);
            res.status(500).json({ error: "Error interno al obtener los datos de perfil." });
        }
    });

    // PUT /me - Editar mi propio perfil (excepto rol) ⬅️ NUEVO
    router.put("/me", verificarToken, async (req, res) => {
        const usuarioId = req.user.id;
        const { email, telefono, nombre, contraseña } = req.body;
        
        try {
            let sql = "UPDATE usuarios SET";
            const params = [];
            const updates = [];

            if (email) { updates.push("email = ?"); params.push(email); }
            if (telefono) { updates.push("telefono = ?"); params.push(telefono); }
            if (nombre) { updates.push("nombre = ?"); params.push(nombre); }
            
            if (contraseña) {
                const hashedPassword = await bcrypt.hash(contraseña, SALT_ROUNDS);
                updates.push("contraseña = ?");
                params.push(hashedPassword);
            }

            if (updates.length === 0) {
                 return res.status(400).json({ error: "No se proporcionaron datos válidos para actualizar." });
            }

            sql += " " + updates.join(", ");
            sql += " WHERE id = ?";
            params.push(usuarioId); // CRÍTICO: Asegura que solo se actualice el usuario del token.

            const result = await dbRun(sql, params);

            if (result.changes === 0) return res.status(404).json({ error: "Usuario no encontrado o sin cambios realizados." });
            res.json({ mensaje: "Perfil actualizado con éxito." });

        } catch (err) {
             // Este error captura conflictos de email
            if (err.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ error: "El email proporcionado ya está en uso." });
            }
            console.error("Error al actualizar perfil:", err);
            res.status(500).json({ error: "Error al actualizar el perfil." });
        }
    });
    
    // GET /status - Verificar estado de sesión y obtener datos del token (Se mantiene, aunque /me es mejor)
    router.get("/status", verificarToken, async (req, res) => {
        try {
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

    // --- RUTAS DE ADMINISTRACIÓN DE USUARIOS ---

    router.post("/admin/register", verificarToken, soloAdmin, async (req, res) => {
        const { email, telefono, nombre, contraseña, rol } = req.body;
        
        if (!email || !telefono || !nombre || !contraseña || !rol) {
            return res.status(400).json({ error: "Todos los campos (email, teléfono, nombre, contraseña y rol) son obligatorios." });
        }

        const rolesPermitidos = ['admin', 'recepcionista', 'cliente'];
        if (!rolesPermitidos.includes(rol)) {
            return res.status(400).json({ error: "Rol inválido. Roles permitidos: admin, recepcionista, cliente." });
        }

        try {
            const existingUser = await dbGet("SELECT * FROM usuarios WHERE email = ?", [email]);
            if (existingUser) return res.status(409).json({ error: "Correo ya registrado." });

            const hashedPassword = await bcrypt.hash(contraseña, SALT_ROUNDS);

            const result = await dbRun(
                "INSERT INTO usuarios (email, telefono, nombre, contraseña, rol) VALUES (?, ?, ?, ?, ?)",
                [email, telefono, nombre, hashedPassword, rol]
            );
            
            res.status(201).json({ 
                mensaje: `Usuario ${nombre} (${rol}) creado exitosamente.`,
                id: result.lastID
            });

        } catch (error) {
            console.error("Error al crear usuario por admin:", error);
            res.status(500).json({ error: "Error interno al crear el usuario." });
        }
    });

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

    // PUT /:id - Editar usuario (Admin)
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
            // Previene que el administrador elimine su propia cuenta
            if (req.user.id == id) {
                return res.status(403).json({ error: "No puedes eliminar tu propia cuenta de administrador." });
            }
            
            const result = await dbRun("DELETE FROM usuarios WHERE id = ?", [id]);
            if (result.changes === 0) return res.status(404).json({ error: "Usuario no encontrado." });
            res.json({ mensaje: `Usuario con ID ${id} eliminado.` });

        } catch (err) {
             // Maneja si el usuario tiene reservas
            if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                return res.status(409).json({ error: "No se puede eliminar el usuario porque tiene reservas asociadas." });
            }
            console.error("Error al eliminar usuario:", err);
            res.status(500).json({ error: "Error al eliminar el usuario." });
        }
    });

    return router;
};
