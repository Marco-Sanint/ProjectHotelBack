// routes/reservations.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloPersonal, soloAdmin }) => {
    const router = express.Router();

    // --- RUTAS DE RESERVAS (CLIENTE) (/reservations) ---

    // POST /reservations
    router.post("/", verificarToken, async (req, res) => {
        const { habitacionId, fecha_inicio, fecha_fin, usuarioId: usuarioIdBody } = req.body;
        
        // Debug: Ver qué fechas se están recibiendo
        console.log('📥 Fechas recibidas en el servidor:', {
            fecha_inicio,
            fecha_fin,
            tipo_inicio: typeof fecha_inicio,
            tipo_fin: typeof fecha_fin,
            body_completo: req.body
        });
        
        // Si es admin o recepcionista y proporciona usuarioId, usar ese. Si no, usar el del token
        const usuarioId = ((req.user.rol === 'admin' || req.user.rol === 'recepcionista') && usuarioIdBody) ? usuarioIdBody : req.user.id;

        if (!habitacionId || !fecha_inicio || !fecha_fin) return res.status(400).json({ error: "Campos de reserva requeridos." });

        try {
            // --- 1. Verificación de la Habitación (EXISTE y está disponible genéricamente) ---
            const roomInfo = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [habitacionId]);
            if (!roomInfo || roomInfo.disponible === 0) return res.status(404).json({ error: "Habitación no disponible (generalmente)." });

            // --- 2. Validación de Fechas ---
            // Trabajar con strings YYYY-MM-DD directamente para evitar problemas de zona horaria
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_fin)) {
                return res.status(400).json({ error: "Formato de fecha inválido. Use formato YYYY-MM-DD." });
            }
            
            // Comparar fechas como strings para validar orden
            if (fecha_fin <= fecha_inicio) {
                return res.status(400).json({ error: "La fecha de fin debe ser posterior a la fecha de inicio." });
            }
            
            // Calcular días de diferencia usando fechas UTC para evitar problemas de zona horaria
            const inicioUTC = new Date(fecha_inicio + 'T00:00:00.000Z');
            const finUTC = new Date(fecha_fin + 'T00:00:00.000Z');
            const diffTime = Math.abs(finUTC - inicioUTC);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return res.status(400).json({ error: "Fechas inválidas o duración cero." });

            const precio_total = roomInfo.precio_noche * diffDays;

            // --- 3. ⚠️ Verificación de Conflictos de Fechas (Lo Esencial) ---
            const conflictSql = `
                SELECT id FROM reservas 
                WHERE habitacionId = ? 
                AND estado = 'confirmada'  -- Solo verifica conflictos con reservas ya confirmadas
                AND (
                    (fecha_fin > ?) AND (fecha_inicio < ?)
                )
            `;
            const conflictParams = [habitacionId, fecha_inicio, fecha_fin];
            const conflictingReservation = await dbGet(conflictSql, conflictParams);

            if (conflictingReservation) {
                // ¡Conflicto encontrado! La habitación ya está reservada para esa fecha.
                return res.status(409).json({ 
                    error: "Conflicto de reserva. La habitación ya está ocupada en ese rango de fechas.", 
                    conflictingId: conflictingReservation.id
                });
            }
            
            // --- 4. Inserción de la Reserva (Si pasa todas las verificaciones) ---
            // Guardar quién creó la reserva (siempre se guarda el usuario que crea la reserva)
            const creadoPor = req.user.id; // Siempre guardar el usuario que crea la reserva
            
            // Debug: Ver qué se va a guardar
            console.log('💾 Datos que se van a guardar en la BD:', {
                habitacionId,
                usuarioId,
                fecha_inicio,
                fecha_fin,
                precio_total,
                creadoPor
            });
            
            const reservationResult = await dbRun(
                `INSERT INTO reservas (habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total, estado, creadoPor) VALUES (?, ?, ?, ?, ?, 'confirmada', ?)`,
                [habitacionId, usuarioId, fecha_inicio, fecha_fin, precio_total, creadoPor]
            );
            
            // Debug: Verificar qué se guardó
            const savedReservation = await dbGet("SELECT * FROM reservas WHERE id = ?", [reservationResult.lastID]);
            console.log('✅ Reserva guardada en la BD:', savedReservation);

            res.json({ mensaje: "Reserva creada y confirmada con éxito.", id: reservationResult.lastID, precio_total });

        } catch (error) {
            console.error("Error en la creación de reserva:", error);
            res.status(500).json({ error: "Error al procesar la reserva." });
        }
    });

    // GET /reservations/availability/:roomId - Verificar disponibilidad de fechas (público para clientes)
    // IMPORTANTE: Esta ruta debe ir ANTES de /my y /admin para evitar conflictos de routing
    router.get("/availability/:roomId", verificarToken, async (req, res) => {
        const { roomId } = req.params;
        console.log(`🔍 Verificando disponibilidad para habitación ${roomId}`);
        try {
            // Obtener solo las reservas confirmadas o pendientes de la habitación
            const rows = await dbAll(
                `SELECT id, fecha_inicio, fecha_fin, estado 
                 FROM reservas 
                 WHERE habitacionId = ? 
                 AND (estado = 'confirmada' OR estado = 'pendiente')
                 ORDER BY fecha_inicio ASC`,
                [roomId]
            );
            console.log(`✅ Disponibilidad verificada: ${rows.length} reservas encontradas`);
            res.json({ reservas: rows });
        } catch (err) {
            console.error("❌ Error al verificar disponibilidad:", err);
            res.status(500).json({ error: "Error al verificar disponibilidad." });
        }
    });

    // GET /reservations/my
    router.get("/my", verificarToken, async (req, res) => {
        const usuarioId = req.user.id;
        try {
            const rows = await dbAll("SELECT * FROM reservas WHERE usuarioId = ? ORDER BY fecha_inicio DESC", [usuarioId]);
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener tus reservas." });
        }
    });


    // GET /reservations/admin - Ver todas las reservas (CON FILTROS OPCIONALES)
    router.get("/admin", verificarToken, soloPersonal, async (req, res) => {
        // ⬅️ EXPLICITO: Leer los filtros de búsqueda de la URL
        const { userId, roomId } = req.query; 

        let sql = `
            SELECT 
                r.*, 
                u.nombre AS nombre_usuario, 
                u.email AS email_usuario,
                h.numero AS numero_habitacion,
                h.precio_noche,
                creador.nombre AS nombre_creador,
                creador.email AS email_creador
            FROM reservas r
            JOIN usuarios u ON r.usuarioId = u.id
            JOIN habitaciones h ON r.habitacionId = h.id
            LEFT JOIN usuarios creador ON r.creadoPor = creador.id
        `;
        let params = [];
        let whereClause = [];

        // ⬅️ EXPLICITO: Construir la cláusula WHERE condicionalmente
        if (userId) {
            whereClause.push("r.usuarioId = ?");
            params.push(userId);
        }
        if (roomId) {
            whereClause.push("r.habitacionId = ?");
            params.push(roomId);
        }

        if (whereClause.length > 0) {
            sql += " WHERE " + whereClause.join(" AND ");
        }
        
        sql += " ORDER BY r.fecha_inicio DESC";

        try {
            const rows = await dbAll(sql, params); // Pasar 'params' al final
            res.json({ reservas: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener reservas filtradas." });
        }
    });

    // PUT /reservations/:id - Editar reserva
    router.put("/:id", verificarToken, soloPersonal, async (req, res) => {
        const { id } = req.params;
        const { fecha_inicio, fecha_fin, estado, habitacionId } = req.body;

        if (!fecha_inicio || !fecha_fin || !estado || !habitacionId) {
            return res.status(400).json({ error: "Campos obligatorios faltantes." });
        }

        try {
            // --- 1. Obtener información de la habitación para recalcular precio ---
            const roomInfo = await dbGet("SELECT * FROM habitaciones WHERE id = ?", [habitacionId]);
            if (!roomInfo) return res.status(404).json({ error: "Habitación no encontrada." });

            // --- 2. Calcular nuevo precio total basado en las fechas ---
            // Trabajar con strings YYYY-MM-DD directamente para evitar problemas de zona horaria
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_fin)) {
                return res.status(400).json({ error: "Formato de fecha inválido. Use formato YYYY-MM-DD." });
            }
            
            // Comparar fechas como strings para validar orden
            if (fecha_fin <= fecha_inicio) {
                return res.status(400).json({ error: "La fecha de fin debe ser posterior a la fecha de inicio." });
            }
            
            // Calcular días de diferencia usando fechas UTC para evitar problemas de zona horaria
            const inicioUTC = new Date(fecha_inicio + 'T00:00:00.000Z');
            const finUTC = new Date(fecha_fin + 'T00:00:00.000Z');
            const diffTime = Math.abs(finUTC - inicioUTC);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) return res.status(400).json({ error: "Fechas inválidas o duración cero." });
            
            const nuevo_precio_total = roomInfo.precio_noche * diffDays;

            // --- 3. Verificación de Conflicto (Integridad de Datos) ---
            // Buscamos conflictos con OTRAS reservas (id != ?)
            const conflictSql = `
                SELECT id FROM reservas 
                WHERE habitacionId = ? 
                AND id != ? 
                AND estado = 'confirmada'
                AND ((fecha_fin > ?) AND (fecha_inicio < ?))
            `;
            const conflictParams = [habitacionId, id, fecha_inicio, fecha_fin];
            const conflictingReservation = await dbGet(conflictSql, conflictParams);

            if (conflictingReservation) {
                return res.status(409).json({ 
                    error: "Conflicto de fechas. La nueva fecha/habitación se superpone con otra reserva confirmada.", 
                    conflictingId: conflictingReservation.id
                });
            }
            
            // --- 4. Ejecución de la Actualización (incluyendo nuevo precio) ---
            const result = await dbRun(
                "UPDATE reservas SET habitacionId = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?, precio_total = ? WHERE id = ?",
                [habitacionId, fecha_inicio, fecha_fin, estado, nuevo_precio_total, id]
            );

            if (result.changes === 0) return res.status(404).json({ error: "Reserva no encontrada o sin cambios realizados." });
            res.json({ mensaje: `Reserva con ID ${id} actualizada a estado: ${estado}.`, precio_total: nuevo_precio_total });

        } catch (error) {
            console.error("Error al actualizar reserva:", error);
            res.status(500).json({ error: "Error al actualizar la reserva." });
        }
    });

    // DELETE /reservations/:id - Eliminar reserva
    router.delete("/:id", verificarToken, soloPersonal, async (req, res) => {
        const { id } = req.params;
        const usuarioId = req.user.id;
        const userRole = req.user.rol;

        try {
            // 1. Verificar si la reserva existe y obtener el dueño
            const reserva = await dbGet("SELECT usuarioId FROM reservas WHERE id = ?", [id]);
            if (!reserva) return res.status(404).json({ error: "Reserva no encontrada." });

            // 2. Lógica de Autorización: Solo el dueño, administrador o recepcionista pueden eliminar
            const esDueno = reserva.usuarioId === usuarioId;
            const esAdmin = userRole === 'admin';
            const esRecepcionista = userRole === 'recepcionista';

            if (!esDueno && !esAdmin && !esRecepcionista) {
                return res.status(403).json({ error: "Acceso denegado. Solo puedes eliminar tus propias reservas." });
            }
            
            // 3. Ejecutar la eliminación
            const result = await dbRun("DELETE FROM reservas WHERE id = ?", [id]);
            
            // La ruta de administrador puede seguir en /admin/:id si quieres mantenerla como super-override.
            // Pero esta ruta es la que el cliente debería usar.

            if (result.changes === 0) return res.status(404).json({ error: "Reserva no encontrada después de la verificación." });
            res.json({ mensaje: `Reserva con ID ${id} eliminada.` });

        } catch (err) {
            console.error("Error al eliminar reserva (Cliente/Admin):", err);
            res.status(500).json({ error: "Error al eliminar la reserva." });
        }
    });

    return router;
};