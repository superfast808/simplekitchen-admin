---
name: Subscription add-on payment gating
description: Why subscription orders with paid add-ons must not be treated as ready before verified payment
---

Payable subscription choices are saved as held orders only after checkout can be created. Move them into operational processing only after a matching payment is independently verified. A cancelled checkout must leave those orders on hold and allow the customer to resume an open payment link.

**Why:** Previously a checkout failure or abandoned payment left a processing order, making unpaid premium meals or add-ons appear ready to fulfil.

**How to apply:** When modifying subscription checkout, admin payment links, or fulfillment lists, preserve the difference between submitted choices and paid/ready orders. Verify against the invite's current payment reference and expected amount, not only Stripe's general succeeded status.