import { Router, raw } from 'express';
import type Stripe from 'stripe';
import type { RowDataPacket } from 'mysql2';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { stripe } from '../services/stripe.js';

type PaymentRow = RowDataPacket & { id: number; entry_id: number; gross_amount_cents: number; status: string };

export const stripeWebhookRouter = Router();
stripeWebhookRouter.post('/stripe', raw({ type: 'application/json' }), async (request, response) => {
  const signature = request.header('stripe-signature');
  if (!signature) { response.status(400).send('Missing Stripe signature'); return; }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(request.body, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch {
    response.status(400).send('Invalid Stripe signature');
    return;
  }

  if (event.type === 'charge.updated') {
    const charge = event.data.object;
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    const balanceTransactionId = typeof charge.balance_transaction === 'string' ? charge.balance_transaction : charge.balance_transaction?.id;
    if (paymentIntentId && balanceTransactionId) {
      const balance = await stripe.balanceTransactions.retrieve(balanceTransactionId);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [existing] = await connection.query<RowDataPacket[]>('SELECT event_id FROM stripe_events WHERE event_id = ? FOR UPDATE', [event.id]);
        if (!existing.length) {
          await connection.execute(
            `UPDATE payments SET processor_fee_cents = ?, net_amount_cents = ? WHERE payment_intent_id = ? AND status = 'paid'`,
            [balance.fee, balance.net, paymentIntentId]
          );
          await connection.execute('INSERT INTO stripe_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type]);
        }
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    }
    response.json({ received: true });
    return;
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    response.json({ received: true });
    return;
  }

  const session = event.data.object;
  if (session.payment_status === 'unpaid') { response.json({ received: true }); return; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query<RowDataPacket[]>('SELECT event_id FROM stripe_events WHERE event_id = ? FOR UPDATE', [event.id]);
    if (existing.length) { await connection.rollback(); response.json({ received: true }); return; }

    const [payments] = await connection.query<PaymentRow[]>('SELECT id, entry_id, gross_amount_cents, status FROM payments WHERE checkout_session_id = ? FOR UPDATE', [session.id]);
    const payment = payments[0];
    const entryId = Number(session.metadata?.entryId);
    if (!payment || payment.entry_id !== entryId || session.amount_total !== payment.gross_amount_cents || session.currency !== 'usd') {
      throw new Error('Checkout session did not match its local payment record');
    }

    await connection.execute(
      `UPDATE payments SET status = 'paid', payment_intent_id = ?, paid_at = UTC_TIMESTAMP(3) WHERE id = ?`,
      [typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null, payment.id]
    );
    await connection.execute(
      `UPDATE entries SET status = 'submitted', submitted_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'checkout_pending'`,
      [payment.entry_id]
    );
    await connection.execute('INSERT INTO stripe_events (event_id, event_type) VALUES (?, ?)', [event.id, event.type]);
    await connection.commit();
    response.json({ received: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});
