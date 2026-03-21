const express = require("express");
const path = require("path");
const cors = require("cors");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors({
  origin: [
    "https://japedia.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ],
  credentials: false
}));
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const root = __dirname;
const clientDir = path.join(root, "client");
const adminDir = path.join(root, "admin");

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback || "").trim();
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n");
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.app();

  const serviceAccountJson = getEnv("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    return admin.initializeApp({
      credential: admin.credential.cert(parsed)
    });
  }

  const projectId = getEnv("FIREBASE_PROJECT_ID");
  const clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(getEnv("FIREBASE_PRIVATE_KEY"));

  if (projectId && clientEmail && privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  }

  throw new Error(
    "Firebase Admin não configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON ou FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY."
  );
}

initFirebaseAdmin();
const db = admin.firestore();

const mpClient = new MercadoPagoConfig({
  accessToken: getEnv("MP_ACCESS_TOKEN")
});

const preferenceClient = new Preference(mpClient);
const paymentClient = new Payment(mpClient);

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function orderRefs(restaurantId, orderId) {
  if (!restaurantId || !orderId) {
    throw new Error("restaurantId e orderId são obrigatórios.");
  }

  const restaurantRef = db.collection("restaurants").doc(String(restaurantId));
  return {
    restaurantRef,
    orderRef: restaurantRef.collection("orders").doc(String(orderId)),
    publicRef: restaurantRef.collection("orders_public").doc(String(orderId)),
    paymentRef: restaurantRef.collection("payments").doc(String(orderId))
  };
}

async function mergeOrderPaymentState({
  restaurantId,
  orderId,
  paymentId = null,
  paymentMethod = null,
  paymentStatus = null,
  status = null,
  extra = {}
}) {
  const { orderRef, publicRef, paymentRef } = orderRefs(restaurantId, orderId);

  const basePatch = { updatedAt: nowTs() };
  if (paymentId) basePatch.mpPaymentId = String(paymentId);
  if (paymentMethod) basePatch.mpPaymentMethod = String(paymentMethod);
  if (paymentStatus) basePatch.paymentStatus = String(paymentStatus);
  if (status) basePatch.status = String(status);

  const patch = { ...basePatch, ...extra };

  Object.keys(patch).forEach((key) => {
    if (patch[key] === undefined) delete patch[key];
  });

  await Promise.all([
    orderRef.set(patch, { merge: true }),
    publicRef.set(patch, { merge: true }),
    paymentRef.set(
      {
        restaurantId: String(restaurantId),
        orderId: String(orderId),
        paymentId: paymentId ? String(paymentId) : null,
        paymentMethod: paymentMethod ? String(paymentMethod) : null,
        paymentStatus: paymentStatus ? String(paymentStatus) : null,
        orderStatus: status ? String(status) : null,
        updatedAt: nowTs(),
        ...extra
      },
      { merge: true }
    )
  ]);
}

async function getOrderRestaurantIdFallback(orderId) {
  const groups = await db
    .collectionGroup("orders")
    .where(admin.firestore.FieldPath.documentId(), "==", String(orderId))
    .limit(1)
    .get();

  if (!groups.empty) {
    const ref = groups.docs[0].ref;
    return ref.parent.parent?.id || "";
  }

  return "";
}

function statusFromPaymentStatus(paymentStatus) {
  const normalized = String(paymentStatus || "").toLowerCase();

  if (normalized === "approved") return "recebido";
  if (normalized === "pending" || normalized === "in_process") return "aguardando_pagamento";
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(normalized)) return "cancelado";

  return "";
}

function parsePaymentResponseStatus(payment) {
  return String(payment?.status || "").toLowerCase();
}

function paymentResponseSnapshot(payment) {
  return {
    id: payment?.id ? String(payment.id) : null,
    status: payment?.status || null,
    status_detail: payment?.status_detail || null,
    external_reference: payment?.external_reference || null,
    date_approved: payment?.date_approved || null,
    date_created: payment?.date_created || null,
    transaction_amount: payment?.transaction_amount ?? null,
    payment_method_id: payment?.payment_method_id || null
  };
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    firebase: !!admin.apps.length,
    mercadopago: !!getEnv("MP_ACCESS_TOKEN")
  });
});

app.post("/createMercadoPagoPreference", async (req, res) => {
  try {
    const { amount, title, orderId, restaurantId } = req.body || {};
    const value = Number(amount || 0);

    if (!restaurantId || !orderId) {
      return res.status(400).json({ error: "restaurantId e orderId são obrigatórios." });
    }
    if (!value || value <= 0) {
      return res.status(400).json({ error: "Valor inválido." });
    }

    const response = await preferenceClient.create({
      body: {
        items: [
          {
            title: title || "Pedido do restaurante",
            quantity: 1,
            unit_price: value,
            currency_id: "BRL"
          }
        ],
        external_reference: String(orderId),
        metadata: {
          orderId: String(orderId),
          restaurantId: String(restaurantId)
        },
        back_urls: {
          success: getEnv("APP_SUCCESS_URL"),
          failure: getEnv("APP_FAILURE_URL"),
          pending: getEnv("APP_PENDING_URL")
        },
        auto_return: "approved",
        notification_url: getEnv("MP_WEBHOOK_URL") || undefined
      }
    });

    await mergeOrderPaymentState({
      restaurantId,
      orderId,
      paymentMethod: "mercadopago_checkout",
      paymentStatus: "created",
      status: "aguardando_pagamento",
      extra: {
        mpPreferenceId: response.id ? String(response.id) : null,
        mpCheckoutInitPoint: response.init_point || null
      }
    });

    return res.json({
      id: response.id,
      init_point: response.init_point
    });
  } catch (error) {
    console.error("Erro ao criar preferência:", error);
    return res.status(500).json({
      error: error?.message || "Erro ao criar preferência"
    });
  }
});

app.post("/createMercadoPagoPixPayment", async (req, res) => {
  try {
    const { amount, orderId, restaurantId, description, payer } = req.body || {};
    const value = Number(amount || 0);

    if (!restaurantId || !orderId) {
      return res.status(400).json({ error: "restaurantId e orderId são obrigatórios." });
    }
    if (!value || value <= 0) {
      return res.status(400).json({ error: "Valor inválido." });
    }

    const response = await paymentClient.create({
      body: {
        transaction_amount: value,
        description: description || "Pedido do restaurante",
        payment_method_id: "pix",
        external_reference: String(orderId),
        notification_url: getEnv("MP_WEBHOOK_URL") || undefined,
        metadata: {
          orderId: String(orderId),
          restaurantId: String(restaurantId)
        },
        payer: {
          email: payer?.email || "cliente@email.com",
          first_name: payer?.first_name || "Cliente"
        }
      }
    });

    const mpStatus = parsePaymentResponseStatus(response);
    await mergeOrderPaymentState({
      restaurantId,
      orderId,
      paymentId: response.id,
      paymentMethod: "pix",
      paymentStatus: mpStatus || "pending",
      status: statusFromPaymentStatus(mpStatus) || "aguardando_pagamento",
      extra: {
        mpQrCode: response.point_of_interaction?.transaction_data?.qr_code || null,
        mpQrCodeBase64: response.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        mpLastSnapshot: paymentResponseSnapshot(response)
      }
    });

    return res.json({
      paymentId: response.id,
      status: response.status,
      qrCode: response.point_of_interaction?.transaction_data?.qr_code || "",
      qrCodeBase64: response.point_of_interaction?.transaction_data?.qr_code_base64 || ""
    });
  } catch (error) {
    console.error("Erro ao gerar PIX:", error);
    return res.status(500).json({
      error: error?.message || "Erro ao gerar PIX"
    });
  }
});

async function fetchAndSyncPayment({ paymentId, restaurantId = "", orderId = "" }) {
  const response = await paymentClient.get({ id: String(paymentId) });
  const paymentStatus = parsePaymentResponseStatus(response);
  const resolvedOrderId =
    String(orderId || response?.external_reference || response?.metadata?.orderId || "").trim();
  let resolvedRestaurantId =
    String(restaurantId || response?.metadata?.restaurantId || "").trim();

  if (!resolvedOrderId) {
    throw new Error("Não foi possível identificar o orderId do pagamento.");
  }

  if (!resolvedRestaurantId) {
    resolvedRestaurantId = await getOrderRestaurantIdFallback(resolvedOrderId);
  }

  if (!resolvedRestaurantId) {
    throw new Error("Não foi possível identificar o restaurantId do pedido.");
  }

  const nextStatus = statusFromPaymentStatus(paymentStatus);

  await mergeOrderPaymentState({
    restaurantId: resolvedRestaurantId,
    orderId: resolvedOrderId,
    paymentId: response.id,
    paymentMethod: response?.payment_method_id || "pix",
    paymentStatus,
    status: nextStatus || undefined,
    extra: {
      paidAt: paymentStatus === "approved" ? nowTs() : undefined,
      mpApprovedAt: response?.date_approved || null,
      mpStatusDetail: response?.status_detail || null,
      mpLastSnapshot: paymentResponseSnapshot(response)
    }
  });

  return {
    payment: response,
    paymentStatus,
    orderId: resolvedOrderId,
    restaurantId: resolvedRestaurantId,
    orderStatus: nextStatus || null
  };
}

app.post("/getMercadoPagoPaymentStatus", async (req, res) => {
  try {
    const { paymentId, restaurantId, orderId } = req.body || {};
    if (!paymentId) {
      return res.status(400).json({ error: "paymentId é obrigatório." });
    }

    const result = await fetchAndSyncPayment({ paymentId, restaurantId, orderId });

    return res.json({
      id: result.payment.id,
      status: result.paymentStatus,
      status_detail: result.payment?.status_detail || null,
      external_reference: result.payment?.external_reference || null,
      orderId: result.orderId,
      restaurantId: result.restaurantId,
      orderStatus: result.orderStatus
    });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error);
    return res.status(500).json({
      error: error?.message || "Erro ao consultar pagamento"
    });
  }
});

app.get("/payment-status/:id", async (req, res) => {
  try {
    const result = await fetchAndSyncPayment({ paymentId: req.params.id });

    return res.json({
      id: result.payment.id,
      status: result.paymentStatus,
      status_detail: result.payment?.status_detail || null,
      external_reference: result.payment?.external_reference || null,
      orderId: result.orderId,
      restaurantId: result.restaurantId,
      orderStatus: result.orderStatus
    });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error);
    return res.status(500).json({
      error: error?.message || "Erro ao consultar pagamento"
    });
  }
});

app.post("/mercadopago/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const type = body.type || body.topic;
    const paymentId = body?.data?.id || body?.["data.id"] || body?.id;

    if (type !== "payment" || !paymentId) {
      return res.status(200).send("ok");
    }

    await fetchAndSyncPayment({ paymentId });
    return res.status(200).send("ok");
  } catch (error) {
    console.error("Erro no webhook Mercado Pago:", error);
    return res.status(500).send("erro");
  }
});

app.get("/mercadopago/webhook", (_req, res) => {
  res.status(200).send("ok");
});

// admin
app.use("/admin", express.static(adminDir));
app.get("/admin", (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});
app.get("/admin/*", (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});

// client
app.use(express.static(clientDir));
app.get("/", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});