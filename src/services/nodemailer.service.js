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
    from: `"DRIVE RANGEE " <${process.env.EMAIL_USER}>`, // Add a real name
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

// export async function sendOrderConfirmationEmail(email, orderDetails) {
//   // console.log("Email function called with to:", to);
//   console.log("Order details:", JSON.stringify(orderDetails));
//   // Safely format date
//   const orderDate = orderDetails?.order_date
//     ? new Date(orderDetails.order_date).toLocaleString()
//     : "Pending";

//   // Build items rows for HTML table
//   const itemsHtmlRows = (orderDetails.items || [])
//     .map(
//       (item) => `
//     <tr>
//       <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(item.product_name)}</td>
//       <td style="text-align: center; padding: 8px; border-bottom: 1px solid #eee;">${item.quantity}</td>
//       <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${formatCurrency(item.unit_price, orderDetails.currency_code)}</td>
//       <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${formatCurrency(item.quantity * item.unit_price, orderDetails.currency_code)}</td>
//     </tr>
//   `,
//     )
//     .join("");

//   // Items text for plain-text version
//   const itemsText = (orderDetails.items || [])
//     .map(
//       (item) =>
//         `- ${item.product_name} x ${item.quantity} = ${formatCurrency(item.quantity * item.unit_price, orderDetails.currency_code)}`,
//     )
//     .join("\n");

//   const mailOptions = {
//     from: `"DRIVE RANGEE" <${process.env.EMAIL_USER}>`,
//     to: email,
//     subject: `✅ Order Confirmation #${orderDetails.order_id}`,
//     text: `
// Hello ${orderDetails.customer_name || "Valued Customer"},

// Thank you for your order!

// Order ID: ${orderDetails.order_id}
// Date: ${orderDate}
// Order Status: ${orderDetails.order_status || "pending"}

// Items:
// ${itemsText}

// Subtotal: ${formatCurrency(orderDetails.subtotal, orderDetails.currency_code)}
// Shipping: ${formatCurrency(orderDetails.shipping_cost, orderDetails.currency_code)}
// Tax: ${formatCurrency(orderDetails.tax_amount, orderDetails.currency_code)}
// Discount: -${formatCurrency(orderDetails.discount_amount, orderDetails.currency_code)}
// Total: ${formatCurrency(orderDetails.total_amount, orderDetails.currency_code)}

// Shipping Address:
// ${orderDetails.shipping_address || "Not provided"}

// ${orderDetails.customer_notes ? `Customer Notes: ${orderDetails.customer_notes}\n` : ""}
// We'll notify you once your order ships.

// Thank you for shopping with DRIVE RANGEE!
//     `,
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd;">
//         <h2 style="color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Order Confirmation</h2>
//         <p>Hello <strong>${escapeHtml(orderDetails.customer_name || "Valued Customer")}</strong>,</p>
//         <p>Thank you for your order! Here are the details:</p>

//         <div style="background: #f9f9f9; padding: 12px; border-radius: 5px; margin: 15px 0;">
//           <p><strong>Order ID:</strong> ${orderDetails.order_id}</p>
//           <p><strong>Date:</strong> ${orderDate}</p>
//           <p><strong>Order Status:</strong> ${orderDetails.order_status || "pending"}</p>
//         </div>

//         <h3>Items Ordered</h3>
//         <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
//           <thead>
//             <tr>
//               <th style="text-align: left; border-bottom: 1px solid #ddd; padding: 8px;">Product</th>
//               <th style="text-align: center; border-bottom: 1px solid #ddd; padding: 8px;">Qty</th>
//               <th style="text-align: right; border-bottom: 1px solid #ddd; padding: 8px;">Unit Price</th>
//               <th style="text-align: right; border-bottom: 1px solid #ddd; padding: 8px;">Total</th>
//             </tr>
//           </thead>
//           <tbody>
//             ${itemsHtmlRows || '<tr><td colspan="4" style="padding: 8px;">No items found</td></tr>'}
//           </tbody>
//         </table>

//         <div style="text-align: right; margin: 15px 0;">
//           <p style="margin: 5px 0;">Subtotal: ${formatCurrency(orderDetails.subtotal, orderDetails.currency_code)}</p>
//           <p style="margin: 5px 0;">Shipping: ${formatCurrency(orderDetails.shipping_cost, orderDetails.currency_code)}</p>
//           <p style="margin: 5px 0;">Tax: ${formatCurrency(orderDetails.tax_amount, orderDetails.currency_code)}</p>
//           <p style="margin: 5px 0; color: #d9534f;">Discount: -${formatCurrency(orderDetails.discount_amount, orderDetails.currency_code)}</p>
//           <p style="font-size: 18px; font-weight: bold; margin: 10px 0 0;">Total: ${formatCurrency(orderDetails.total_amount, orderDetails.currency_code)}</p>
//         </div>

//         <div style="background: #f4f4f4; padding: 12px; border-radius: 5px; margin: 15px 0;">
//           <strong>Shipping Address:</strong><br>
//           ${escapeHtml(orderDetails.shipping_address || "Not provided").replace(/\n/g, "<br>")}
//         </div>

//         ${
//           orderDetails.customer_notes
//             ? `
//         <div style="background: #fff3cd; padding: 12px; border-radius: 5px; margin: 15px 0;">
//           <strong>Your Notes:</strong><br>
//           ${escapeHtml(orderDetails.customer_notes)}
//         </div>
//         `
//             : ""
//         }

//         <p>We’ll notify you once your order ships.</p>
//         <hr style="margin: 20px 0;">
//         <p style="font-size: 12px; color: #777;">Thank you for shopping with DRIVE RANGEE! If you have any questions, reply to this email or contact support.</p>
//       </div>
//     `,
//     headers: {
//       "X-Priority": "3",
//       "X-Mailer": "DriveRange/1.0",
//     },
//   };

//   try {
//     console.log("Attempting to send email...");
//     await transporter.sendMail(mailOptions);

//     console.log("Email sent successfully:", info.messageId);
//     console.log(
//       `Order confirmation email sent to ${email} for order ${orderDetails.order_id}`,
//     );
//   } catch (error) {
//     console.log(error);
//   }
// }

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
    from: `"DRIVE RANGEE" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmation ${orderDetails.order_id}`,

    text: `
Hello ${orderDetails.customer_name || "Valued Customer"},

Thank you for your order!

Order ID: ${orderDetails.order_id}
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
          <p><strong>Order ID:</strong> ${orderDetails.order_id}</p>
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
