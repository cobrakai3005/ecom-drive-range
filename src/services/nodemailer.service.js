import nodemailer from "nodemailer";
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_PORT == "465", // true for 465, false for others
  family: 4, // Force IPv4
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000,
  socketTimeout: 10000,
  // debug: true, // logs SMTP conversation
  // logger: true, // logs to console
});

// ------------------- Helper: Send Verification Email -------------------
export async function sendOTPEmail(email, otp) {
  const mailOptions = {
    from: `"DRIVE RANGER " <${process.env.EMAIL_USER}>`, // Add a real name
    to: email,
    subject: "🔐 Your OTP for Email Verification",
    text: `Your OTP code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, please ignore this email.`,
    html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px; border: 1px solid #ddd;">
                <h2 style="color: #333;">Email Verification</h2>
                <p>Your One-Time Password (OTP) is:</p>
                <div style="font-size: 36px; font-weight: bold; letter-spacing: 5px; background: #f4f4f4; display: inline-block; padding: 10px 20px; border-radius: 5px;">
                    ${otp}
                </div>
                <p style="margin-top: 20px;">This OTP is valid for <strong>10 minutes</strong>.</p>
                <hr style="margin: 20px 0;">
                <p style="font-size: 12px; color: #777;">If you did not request this, please ignore this email. No action is needed.</p>
            </div>
        `,
    headers: {
      "X-Priority": "3", // Normal priority
      "X-Mailer": "YourAppName/1.0",
    },
  };
  await transporter.sendMail(mailOptions);
  console.log("Email sent");
}
// Helper: currency formatter
function formatCurrency(amount, currencyCode = "INR") {
  const symbol = currencyCode === "INR" ? "₹" : "$";
  return `${symbol}${parseFloat(amount).toFixed(2)}`;
}

// Helper: basic XSS prevention
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>]/g, function (m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}

export async function sendOrderConfirmationEmail(email, orderDetails) {
  if (!email) {
    throw new Error("Customer email is required");
  }

  if (!orderDetails?.order_id) {
    throw new Error("Order details are required");
  }

  const orderDate = orderDetails.order_date
    ? new Date(orderDetails.order_date).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      })
    : new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      });

  const currencyCode = orderDetails.currency_code || "INR";

  const itemsHtmlRows = (orderDetails.items || [])
    .map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;

      return `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">
            ${escapeHtml(item.product_name || "Product")}
          </td>

          <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee;">
            ${quantity}
          </td>

          <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">
            ${formatCurrency(unitPrice, currencyCode)}
          </td>

          <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">
            ${formatCurrency(quantity * unitPrice, currencyCode)}
          </td>
        </tr>
      `;
    })
    .join("");

  const itemsText = (orderDetails.items || [])
    .map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;

      return `- ${item.product_name || "Product"} x ${quantity} = ${formatCurrency(
        quantity * unitPrice,
        currencyCode,
      )}`;
    })
    .join("\n");

  const mailOptions = {
    from: `"DRIVE RANGER" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmation ${orderDetails.order_id}`,

    text: `
Greetings from Drive Ranger!
Hello ${orderDetails.customer_name || "Valued Customer"},

Thank you for your order!

Order Number : ${orderDetails.order_id}
Date: ${orderDate}
Order Status: ${orderDetails.order_status || "pending"}

Items:
${itemsText || "No items found"}

Subtotal: ${formatCurrency(orderDetails.subtotal || 0, currencyCode)}
Shipping: ${formatCurrency(orderDetails.shipping_cost || 0, currencyCode)}
Tax: ${formatCurrency(orderDetails.tax_amount || 0, currencyCode)}
Discount: -${formatCurrency(orderDetails.discount_amount || 0, currencyCode)}
Total: ${formatCurrency(orderDetails.total_amount || 0, currencyCode)}

Shipping Address:
${orderDetails.shipping_address || "Not provided"}

${
  orderDetails.customer_notes
    ? `Customer Notes: ${orderDetails.customer_notes}\n`
    : ""
}

We'll notify you once your order ships.

Thank you for shopping with DRIVE RANGEE!
    `.trim(),

    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
        <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">
          Order Confirmation
        </h2>

        <p>
          Hello
          <strong>
            ${escapeHtml(orderDetails.customer_name || "Valued Customer")}
          </strong>,
        </p>

        <p>Thank you for your order! Here are the details:</p>

        <div style="background: #f9f9f9; padding: 12px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Order Number:</strong> ${orderDetails.order_id}</p>
          <p><strong>Date:</strong> ${escapeHtml(orderDate)}</p>
          <p>
            <strong>Order Status:</strong>
            ${escapeHtml(orderDetails.order_status || "pending")}
          </p>
        </div>

        <h3>Items Ordered</h3>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr>
              <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 8px;">
                Product
              </th>

              <th style="text-align: center; border-bottom: 1px solid #ddd; padding: 8px;">
                Qty
              </th>

              <th style="text-align: right; border-bottom: 1px solid #ddd; padding: 8px;">
                Unit Price
              </th>

              <th style="text-align: right; border-bottom: 1px solid #ddd; padding: 8px;">
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            ${
              itemsHtmlRows ||
              '<tr><td colspan="4" style="padding: 8px;">No items found</td></tr>'
            }
          </tbody>
        </table>

        <div style="text-align: right; margin: 15px 0;">
          <p style="margin: 5px 0;">
            Subtotal:
            ${formatCurrency(orderDetails.subtotal || 0, currencyCode)}
          </p>

          <p style="margin: 5px 0;">
            Shipping:
            ${formatCurrency(orderDetails.shipping_cost || 0, currencyCode)}
          </p>

          <p style="margin: 5px 0;">
            Tax:
            ${formatCurrency(orderDetails.tax_amount || 0, currencyCode)}
          </p>

          <p style="margin: 5px 0; color: #d9534f;">
            Discount:
            -${formatCurrency(orderDetails.discount_amount || 0, currencyCode)}
          </p>

          <p style="font-size: 18px; font-weight: bold; margin: 10px 0 0;">
            Total:
            ${formatCurrency(orderDetails.total_amount || 0, currencyCode)}
          </p>
        </div>

        <div style="background: #f4f4f4; padding: 12px; border-radius: 5px; margin: 15px 0;">
          <strong>Shipping Address:</strong><br>

          ${escapeHtml(orderDetails.shipping_address || "Not provided").replace(
            /\n/g,
            "<br>",
          )}
        </div>

        ${
          orderDetails.customer_notes
            ? `
              <div style="background: #fff3cd; padding: 12px; border-radius: 5px; margin: 15px 0;">
                <strong>Your Notes:</strong><br>
                ${escapeHtml(orderDetails.customer_notes)}
              </div>
            `
            : ""
        }

        <p>We'll notify you once your order ships.</p>

        <hr style="margin: 20px 0;">

        <p style="font-size: 12px; color: #777;">
          Thank you for shopping with DRIVE RANGEE! If you have any questions,
          reply to this email or contact support.
        </p>
      </div>
    `,

    headers: {
      "X-Priority": "3",
      "X-Mailer": "DriveRange/1.0",
    },
  };

  console.log(`Attempting to send order email to ${email}`);

  const info = await transporter.sendMail(mailOptions);

  console.log("Email sent successfully:", info.messageId);
  console.log(
    `Order confirmation email sent to ${email} for order ${orderDetails.order_id}`,
  );

  return info;
}

export async function sendOrderStatusEmail(email, orderDetails) {
  if (!email) {
    throw new Error("Customer email is required");
  }

  const {
    order_id,
    customer_name,
    order_status,
    // tracking_number,
    carrier,
    total_amount,
    currency_code = "INR",
    shipping_address,
  } = orderDetails;

  const currencyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency_code,
  });

  const statusConfig = {
    shipped: {
      subject: `Your order number ${order_id} has been shipped`,
      heading: "Your order is on the way!",
      message:
        "Greetings from Drive Ranger, Good news! Your order has been shipped and is on its way to you.",
    },

    delivered: {
      subject: `Your order number ${order_id} has been delivered`,
      heading: "Your order has been delivered",
      message:
        "Greetings from Drive Ranger! Your order has been delivered successfully. We hope you enjoy your purchase.",
    },

    cancelled: {
      subject: `Your order  number ${order_id} has been cancelled`,
      heading: "Your order has been cancelled",
      message:
        "Greetings from Drive Ranger, Your order has been cancelled. Please contact our support team if you have any questions.",
    },

    returned: {
      subject: `Return update for order  number ${order_id}`,
      heading: "Your order has been returned",
      message:
        "Greetings from Drive Ranger, Your returned order has been received or marked as returned. We will notify you about the next steps.",
    },
  };

  const config = statusConfig[order_status];

  if (!config) {
    throw new Error(`Email is not configured for status: ${order_status}`);
  }

  const trackingSection =
    order_status === "shipped"
      ? `
        <div style="margin-top: 20px;">
          <h3 style="margin-bottom: 10px;">Shipment details</h3>

          <p>
            <strong>Carrier:</strong>
            ${carrier || "Not available"}
          </p>

         

        </div>
      `
      : "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
      </head>

      <body style="
        margin: 0;
        padding: 0;
        background-color: #f5f5f5;
        font-family: Arial, sans-serif;
        color: #222222;
      ">
        <div style="
          max-width: 650px;
          margin: 30px auto;
          background-color: #ffffff;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #e5e5e5;
        ">
          <div style="
            background-color: #111827;
            color: #ffffff;
            padding: 24px;
            text-align: center;
          ">
            <h1 style="margin: 0; font-size: 24px;">
              ${config.heading}
            </h1>
          </div>

          <div style="padding: 30px;">
            <p>Hello ${customer_name || "Customer"},</p>

            <p>${config.message}</p>

            <div style="
              background-color: #f9fafb;
              padding: 16px;
              margin-top: 20px;
              border-radius: 6px;
            ">
              <p>
                <strong>Order Number:</strong>
                #${order_id}
              </p>

              <p>
                <strong>Status:</strong>
                ${order_status.toUpperCase()}
              </p>

              <p>
                <strong>Order amount:</strong>
                ${currencyFormatter.format(Number(total_amount || 0))}
              </p>
            </div>

            ${trackingSection}

            ${
              shipping_address
                ? `
                  <div style="margin-top: 20px;">
                    <h3>Shipping address</h3>
                    <p style="line-height: 1.6;">
                      ${shipping_address}
                    </p>
                  </div>
                `
                : ""
            }

            <p style="margin-top: 30px;">
              Thank you for shopping with us.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `
Hello ${customer_name || "Customer"},

${config.message}

Order Number: ${order_id}
Status: ${order_status}
Order amount: ${currencyFormatter.format(Number(total_amount || 0))}
${
  order_status === "shipped"
    ? `
Carrier: ${carrier || "Not available"}

`
    : ""
}

${shipping_address ? `Shipping address: ${shipping_address}` : ""}

Thank you for shopping with us.
  `;

  return transporter.sendMail({
    from: `"DRIVE RANGER " <${process.env.EMAIL_USER}>`,
    to: email,
    subject: config.subject,
    text,
    html,
  });
}
