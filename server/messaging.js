// Capa de mensajería. Por defecto solo REGISTRA el mensaje en la línea de tiempo del contacto.
// Para enviar de verdad, conecta aquí tu proveedor (Twilio, SendGrid, la API de HighLevel, etc.)
// usando variables de entorno. Debe devolver un estado corto para mostrar en la conversación.
export function sendMessage(channel, contact, body, subject = '') {
  const to = channel === 'sms' ? contact.phone : contact.email;
  if (!to) return 'sin destino';
  if (channel === 'sms' && process.env.TWILIO_ACCOUNT_SID) {
    // TODO: integrar Twilio -> client.messages.create({ to, from: process.env.TWILIO_FROM, body })
    return 'pendiente de integración';
  }
  if (channel === 'email' && process.env.SMTP_HOST) {
    // TODO: integrar nodemailer -> transporter.sendMail({ to, subject, text: body })
    return 'pendiente de integración';
  }
  console.log(`[${channel} simulado] -> ${to}: ${subject ? subject + ' | ' : ''}${body}`);
  return 'registrado';
}
