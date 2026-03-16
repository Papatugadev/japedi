const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const mercadopago = require("mercadopago");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const ACCESS_TOKEN = "APP_USR-2139305345042774-031611-8ef23dd36208ef490dfe2fe3ee38999d-579466817";

function getClient() {
  return new mercadopago.MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
}

function normalizeMercadoPagoEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
}

function cors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

async function updateOrderPayment(restaurantId, orderId, patch = {}) {
  if (!restaurantId || !orderId) return;
 const safePatch = { ...patch, updatedAt: FieldValue.serverTimestamp() };
  const orderRef = db.collection("restaurants").doc(restaurantId).collection("orders").doc(orderId);
  const publicRef = db.collection("restaurants").doc(restaurantId).collection("orders_public").doc(orderId);
  await orderRef.set(safePatch, { merge: true });
  await publicRef.set(safePatch, { merge: true });
}

exports.createMercadoPagoPixPayment = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const amount = Number(body.amount || 0);
    const orderId = String(body.orderId || "");
    const restaurantId = String(body.restaurantId || "");
    const description = String(body.description || `Pedido ${orderId}`);
    const payer = body.payer || {};

    if (!amount || amount <= 0) return res.status(400).json({ error: "Valor inválido." });
    if (!orderId) return res.status(400).json({ error: "orderId é obrigatório." });

    const payment = new mercadopago.Payment(getClient());
    const result = await payment.create({
      body: {
        transaction_amount: amount,
        description,
        payment_method_id: "pix",
        external_reference: orderId,
        payer: {
          email: normalizeMercadoPagoEmail(payer.email) || `cliente.${Date.now()}@example.com`,
          first_name: String(payer.first_name || "Cliente")
        }
      }
    });

    const qrCodeBase64 = result?.point_of_interaction?.transaction_data?.qr_code_base64 || "";
    const qrCode = result?.point_of_interaction?.transaction_data?.qr_code || "";

    await updateOrderPayment(restaurantId, orderId, {
      status: "aguardando_pagamento",
      paymentStatus: result.status || "pending",
      mpPaymentId: result.id || null,
      mpPaymentMethod: "pix"
    });

    return res.json({
      ok: true,
      paymentId: result.id || null,
      status: result.status || "pending",
      qrCodeBase64,
      qrCode
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ error: error.message || "Erro ao criar PIX" });
  }
});

exports.getMercadoPagoPaymentStatus = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const paymentId = String(body.paymentId || "");
    const orderId = String(body.orderId || "");
    const restaurantId = String(body.restaurantId || "");

    if (!paymentId) return res.status(400).json({ error: "paymentId é obrigatório." });

    const payment = new mercadopago.Payment(getClient());
    const result = await payment.get({ id: paymentId });

    const status = result?.status || "unknown";
    if (status === "approved") {
      await updateOrderPayment(restaurantId, orderId, {
        status: "recebido",
        paymentStatus: "approved",
        mpPaymentId: result.id || paymentId,
        mpPaymentMethod: result.payment_method_id || null
      });
    } else {
      await updateOrderPayment(restaurantId, orderId, {
        status: "aguardando_pagamento",
        paymentStatus: status,
        mpPaymentId: result.id || paymentId,
        mpPaymentMethod: result.payment_method_id || null
      });
    }

    return res.json({ ok: true, status, paymentId: result.id || paymentId });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ error: error.message || "Erro ao consultar pagamento" });
  }
});

exports.createMercadoPagoCardPayment = onRequest({ cors: true }, async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const orderId = String(body.orderId || "");
    const restaurantId = String(body.restaurantId || "");
    const description = String(body.description || `Pedido ${orderId}`);
    const transactionAmount = Number(body.transaction_amount || 0);
    const payer = body.payer || {};
    const formData = body.formData || {};

    if (!orderId) return res.status(400).json({ error: "orderId é obrigatório." });
    if (!transactionAmount || transactionAmount <= 0) return res.status(400).json({ error: "Valor inválido." });

    const payment = new mercadopago.Payment(getClient());
    const result = await payment.create({
      body: {
        token: formData.token,
        issuer_id: formData.issuer_id || undefined,
        payment_method_id: formData.payment_method_id,
        transaction_amount: transactionAmount,
        installments: Number(formData.installments || 1),
        description,
        external_reference: orderId,
        payer: {
          email: normalizeMercadoPagoEmail(payer.email) || `cliente.${Date.now()}@example.com`,
          first_name: String(payer.first_name || "Cliente"),
          identification: payer.identification || undefined
        }
      }
    });

    if (result.status === "approved") {
      await updateOrderPayment(restaurantId, orderId, {
        status: "recebido",
        paymentStatus: "approved",
        mpPaymentId: result.id || null,
        mpPaymentMethod: result.payment_method_id || "card"
      });
    } else {
      await updateOrderPayment(restaurantId, orderId, {
        status: "aguardando_pagamento",
        paymentStatus: result.status || "pending",
        mpPaymentId: result.id || null,
        mpPaymentMethod: result.payment_method_id || "card"
      });
    }

    return res.json({
      ok: true,
      paymentId: result.id || null,
      status: result.status || "pending"
    });
  } catch (error) {
    logger.error(error);
    return res.status(500).json({ error: error.message || "Erro ao processar cartão" });
  }
});