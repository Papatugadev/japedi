const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

function monthKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

exports.onOrderCreated = functions.firestore
  .document("restaurants/{rid}/orders/{orderId}")
  .onCreate(async (snap, ctx) => {
    const { rid } = ctx.params;
    const order = snap.data() || {};

    // Se quiser evitar contar pedidos cancelados (opcional):
    // if (order.status === "cancelado") return null;

    const mk = monthKey();
    const billRef = db.doc(`restaurants/${rid}/billing/${mk}`);
    const restRef = db.doc(`restaurants/${rid}`);

    await db.runTransaction(async (tx) => {
      const restSnap = await tx.get(restRef);
      const billSnap = await tx.get(billRef);

      const rest = restSnap.exists ? restSnap.data() : {};
      const tier = rest?.plan?.tier || "basic";

      const monthlyPrice =
        tier === "basic" ? 39 :
        tier === "gold" ? 69 :
        tier === "diamond" ? 99 : 39;

      const hasOrderFee = tier !== "diamond"; // só o mais avançado NÃO tem taxa
      const feePerOrder = hasOrderFee ? 0.50 : 0;

      const prev = billSnap.exists ? billSnap.data() : {};
      const prevCount = Number(prev.orderCount || 0);

      const newCount = prevCount + 1;
      const orderFees = Number((newCount * feePerOrder).toFixed(2));
      const totalDue = Number((monthlyPrice + orderFees).toFixed(2));

      tx.set(
        billRef,
        {
          month: mk,
          planTier: tier,
          planMonthly: monthlyPrice,
          feePerOrder,
          orderCount: newCount,
          orderFees,
          totalDue,
          status: "pending",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: prev.createdAt || admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return null;
  });