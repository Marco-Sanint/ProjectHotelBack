// routes/rooms.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloAdmin }) => {
    const router = express.Router();

    // Función auxiliar para deserializar los campos JSON
    const formatRoom = (room) => {
        if (!room) return null;
        
        // Mapea 1/0 a booleano
        const disponible = room.disponible === 1;
        
        // Parsea los campos JSON (maneja null o strings vacías)
        const caracteristicas = room.caracteristicas_json ? JSON.parse(room.caracteristicas_json) : null;
        const imagenes = room.imagenes_json ? JSON.parse(room.imagenes_json) : [];

        // Retorna el objeto formateado para el Frontend
        return {
            id: room.id,
            numero: room.numero,
            tipo: room.tipo,
            precio_noche: room.precio_noche,
            descripcion: room.descripcion,
            disponible,
            // AÑADIDOS
            caracteristicas,
            imagenes,
        };
    };

    // routes/rooms.js

    // --- RUTAS PÚBLICAS DE HABITACIONES (ÚNICO GET /) ---

    // GET / - Obtener todas las habitaciones (POR DEFECTO: disponibles)
    router.get("/", async (req, res) => {
        // Si no se especifica 'disponible', asumimos 'true' (solo mostrar disponibles al público)
        const { disponible = 'true' } = req.query; 

        let sql = "SELECT * FROM habitaciones";
        const params = [];

        // Lógica para filtrar por disponible=true o disponible=false
        if (disponible === 'true' || disponible === '1') {
            sql += " WHERE disponible = 1";
        } else if (disponible === 'false' || disponible === '0') {
            // Opcional: El público podría querer ver las no disponibles si existe ese caso
            sql += " WHERE disponible = 0";
        }
        // Si el cliente no pasa el parámetro 'disponible', por defecto solo ve las que tienen 'disponible = 1'
        
        // NOTA: Si necesitas que el admin vea TODAS las habitaciones sin pasar filtro, 
        // debes usar un endpoint diferente, como /rooms/all, protegido por soloAdmin.
        
        try {
            const rows = await dbAll(sql, params);
            res.json({
                habitaciones: rows.map(formatRoom) 
            });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener habitaciones." });
        }
    });

    // GET /admin/all - Obtener TODAS las habitaciones sin filtro (Solo Admin)
    router.get("/admin/all", verificarToken, soloAdmin, async (req, res) => {
        try {
            const rows = await dbAll("SELECT * FROM habitaciones", []);
            res.json({
                habitaciones: rows.map(formatRoom) 
            });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener habitaciones." });
        }
    });

    // GET /:id - Obtener una habitación por ID
    router.get("/:id", async (req, res) => {
        const { id } = req.params;
        try {
            const row = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [id]);
            if (!row) return res.status(404).json({ error: "Habitación no encontrada." });

            // USAMOS LA FUNCIÓN AUXILIAR
            res.json({ habitacion: formatRoom(row) }); 
        } catch (err) {
            res.status(500).json({ error: "Error al buscar habitación." });
        }
    });


    // --- RUTAS DE ADMINISTRACIÓN DE HABITACIONES ---

    // POST / - Crear habitación
    router.post("/", verificarToken, soloAdmin, async (req, res) => {
        const { numero, tipo, precio_noche, descripcion, caracteristicas, imagenes } = req.body;
        if (!numero || !tipo || !precio_noche) return res.status(400).json({ error: "Número, tipo y precio son obligatorios." });

        try {
            // SERIALIZAMOS LOS DATOS ESTRUCTURADOS PARA SQLITE
            const caracteristicas_json = caracteristicas ? JSON.stringify(caracteristicas) : null;
            const imagenes_json = imagenes && imagenes.length > 0 ? JSON.stringify(imagenes) : '[]'; // Guardamos array vacío si no hay

            const result = await dbRun(
                // AÑADIMOS LOS NUEVOS CAMPOS A LA INSERCIÓN
                "INSERT INTO habitaciones (numero, tipo, precio_noche, descripcion, caracteristicas_json, imagenes_json) VALUES (?, ?, ?, ?, ?, ?)",
                [numero, tipo, precio_noche, descripcion, caracteristicas_json, imagenes_json]
            );
            res.status(201).json({ mensaje: "Habitación creada.", id: result.lastID });
        } catch (error) {
            console.error("Error al crear habitación:", error);
            res.status(500).json({ error: "Error al crear la habitación. El número podría estar duplicado." });
        }
    });

    // PUT /:id - Editar habitación
    router.put("/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        const { numero, tipo, precio_noche, descripcion, disponible, caracteristicas, imagenes } = req.body;
        
        if (!numero || !tipo || !precio_noche || disponible === undefined) {
            return res.status(400).json({ error: "Número, tipo, precio y estado de disponibilidad son obligatorios." });
        }

        try {
            const caracteristicas_json = caracteristicas ? JSON.stringify(caracteristicas) : null;
            const imagenes_json = imagenes && imagenes.length > 0 ? JSON.stringify(imagenes) : '[]';

            const result = await dbRun(
                "UPDATE habitaciones SET numero = ?, tipo = ?, precio_noche = ?, descripcion = ?, disponible = ?, caracteristicas_json = ?, imagenes_json = ? WHERE id = ?",
                [numero, tipo, precio_noche, descripcion, disponible ? 1 : 0, caracteristicas_json, imagenes_json, id]
            );

            if (result.changes === 0) return res.status(404).json({ error: "Habitación no encontrada o sin cambios realizados." });
            res.json({ mensaje: `Habitación ${numero} actualizada con éxito.` });

        } catch (err) {
            console.error("Error al actualizar habitación:", err);
            res.status(500).json({ error: "Error al actualizar la habitación." });
        }
    });

    // DELETE /:id - Eliminar habitación
    router.delete("/:id", verificarToken, soloAdmin, async (req, res) => {
        const { id } = req.params;
        try {
            const result = await dbRun("DELETE FROM habitaciones WHERE id = ?", [id]);
            if (result.changes === 0) return res.status(404).json({ error: "Habitación no encontrada." });
            res.json({ mensaje: `Habitación con ID ${id} eliminada.` });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                return res.status(409).json({ error: "No se puede eliminar la habitación porque tiene reservas asociadas. Elimine las reservas primero." });
            }
            console.error("Error al eliminar habitación:", err);
            res.status(500).json({ error: "Error al eliminar la habitación." });
        }
    });

    return router;
};