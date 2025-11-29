// routes/payments.js
const express = require('express');

module.exports = ({ dbGet, dbRun, dbAll, verificarToken, soloPersonal }) => {
    const router = express.Router();

    // POST /payments - Crear un pago
    router.post("/", verificarToken, async (req, res) => {
        const { 
            numero_tarjeta, 
            nombre_titular, 
            fecha_expiracion, 
            cvv, 
            monto,
            reservaId 
        } = req.body;

        const usuarioId = req.user.id;

        if (!numero_tarjeta || !nombre_titular || !fecha_expiracion || !cvv || !monto) {
            return res.status(400).json({ error: "Todos los campos de pago son requeridos." });
        }

        // Validar formato de tarjeta (simulado - solo verificar que tenga 16 dígitos)
        const cardNumber = numero_tarjeta.replace(/\s/g, '');
        if (!/^\d{16}$/.test(cardNumber)) {
            return res.status(400).json({ error: "Número de tarjeta inválido. Debe tener 16 dígitos." });
        }

        // Validar formato de fecha de expiración (MM/YY)
        if (!/^\d{2}\/\d{2}$/.test(fecha_expiracion)) {
            return res.status(400).json({ error: "Formato de fecha de expiración inválido. Use MM/YY." });
        }

        // Validar CVV (3 o 4 dígitos)
        if (!/^\d{3,4}$/.test(cvv)) {
            return res.status(400).json({ error: "CVV inválido. Debe tener 3 o 4 dígitos." });
        }

        try {
            // En una pasarela real, aquí se haría la comunicación con el procesador de pagos
            // Por ahora, simulamos que el pago siempre es exitoso
            
            // Guardar el pago en la base de datos
            // Nota: En producción, NUNCA se debe guardar el CVV completo
            // Solo guardamos los últimos 4 dígitos de la tarjeta para referencia
            const ultimosDigitos = cardNumber.slice(-4);
            const numero_tarjeta_masked = `****-****-****-${ultimosDigitos}`;
            
            const paymentResult = await dbRun(
                `INSERT INTO pagos (reservaId, usuarioId, numero_tarjeta, nombre_titular, fecha_expiracion, cvv, monto, estado) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'completado')`,
                [reservaId || null, usuarioId, numero_tarjeta_masked, nombre_titular, fecha_expiracion, '***', monto]
            );

            res.json({ 
                mensaje: "Pago procesado exitosamente.", 
                id: paymentResult.lastID,
                numero_tarjeta: numero_tarjeta_masked
            });

        } catch (error) {
            console.error("Error al procesar el pago:", error);
            res.status(500).json({ error: "Error al procesar el pago." });
        }
    });

    // PUT /payments/:id - Actualizar un pago (principalmente para agregar reservaId)
    router.put("/:id", verificarToken, async (req, res) => {
        const { id } = req.params;
        const { reservaId } = req.body;
        const usuarioId = req.user.id;

        try {
            // Verificar que el pago existe y pertenece al usuario
            const payment = await dbGet("SELECT * FROM pagos WHERE id = ? AND usuarioId = ?", [id, usuarioId]);
            if (!payment) {
                return res.status(404).json({ error: "Pago no encontrado." });
            }

            // Actualizar el reservaId
            await dbRun(
                "UPDATE pagos SET reservaId = ? WHERE id = ?",
                [reservaId || null, id]
            );

            res.json({ mensaje: "Pago actualizado exitosamente." });

        } catch (error) {
            console.error("Error al actualizar el pago:", error);
            res.status(500).json({ error: "Error al actualizar el pago." });
        }
    });

    // GET /payments/my - Obtener pagos del usuario autenticado
    router.get("/my", verificarToken, async (req, res) => {
        const usuarioId = req.user.id;
        try {
            const rows = await dbAll(
                "SELECT * FROM pagos WHERE usuarioId = ? ORDER BY fecha_pago DESC", 
                [usuarioId]
            );
            res.json({ pagos: rows });
        } catch (err) {
            res.status(500).json({ error: "Error al obtener tus pagos." });
        }
    });

    // GET /payments/admin - Obtener todos los pagos (solo para personal)
    router.get("/admin", verificarToken, soloPersonal, async (req, res) => {
        console.log("📥 GET /payments/admin - Usuario:", req.user?.email, "Rol:", req.user?.rol);
        try {
            const rows = await dbAll(
                `SELECT 
                    p.*,
                    u.nombre AS nombre_usuario,
                    u.email AS email_usuario
                FROM pagos p
                JOIN usuarios u ON p.usuarioId = u.id
                ORDER BY p.fecha_pago DESC`
            );
            console.log("✅ Pagos obtenidos:", rows.length);
            res.json({ pagos: rows });
        } catch (err) {
            console.error("❌ Error al obtener todos los pagos:", err);
            res.status(500).json({ error: "Error al obtener los pagos." });
        }
    });

    return router;
};
