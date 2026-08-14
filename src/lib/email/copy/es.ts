import type { EmailStrings } from "./en";

/**
 * Neutral Spanish — PLAN-LOCALIZATION decision 2. No *vosotros*, no
 * Iberia-only vocabulary; it has to read correctly in Madrid and in Bogotá.
 * Machine-assisted draft, native review still open in HUMAN-REVIEW.md.
 *
 * "Tú" throughout, unlike the German. Spanish "usted" from a learning product
 * reads as a bank, and the register is consistent across both regions in a way
 * German's du/Sie split is not.
 *
 * `welcome` says "Te damos la bienvenida" rather than "Bienvenido", because the
 * adjective would have to guess the reader's gender and we do not collect it.
 */
export const es: EmailStrings = {
  brand: "MeritKeep",

  paste: "O pega este enlace en tu navegador:",

  codeLabel: "Tu código",

  system: {
    verifyCode: {
      subject: "Tu código de confirmación · {brand}",
      heading: "Confirma tu correo",
      body: [
        "Escribe este código en la página que dejaste abierta para confirmar esta dirección.",
        "Sirve durante {duration} y una sola vez.",
      ],
      footer:
        "¿No lo pediste? Ignóralo. Sin este código nadie puede hacer nada con tu dirección.",
    },

    verifyEmail: {
      subject: "Confirma tu correo · {brand}",
      heading: "Confirma tu correo",
      body: [
        "Confirma esta dirección para que podamos enviarte un restablecimiento de contraseña si alguna vez lo necesitas.",
        "El enlace sirve durante {duration}.",
      ],
      action: "Confirmar esta dirección",
      footer:
        "Si no creaste esta cuenta, ignora este correo: no pasa nada mientras nadie use el enlace.",
    },

    resetPassword: {
      subject: "Restablece tu contraseña · {brand}",
      heading: "Restablece tu contraseña",
      body: [
        "Alguien pidió restablecer la contraseña de esta cuenta. Si fuiste tú, define una nueva aquí.",
        "El enlace sirve durante {duration} y solo se puede usar una vez.",
      ],
      action: "Definir una contraseña nueva",
      footer:
        "¿No lo pediste? Ignóralo. Tu contraseña no ha cambiado, y quien lo pidió no puede ver este correo.",
    },

    changeEmail: {
      subject: "Aprueba tu nueva dirección de correo · {brand}",
      heading: "Aprueba tu nueva dirección de correo",
      body: [
        "Pediste cambiar el correo de esta cuenta de {oldEmail} a {newEmail}.",
        "No cambia nada hasta que lo apruebes desde esta dirección. El enlace sirve durante {duration}.",
      ],
      action: "Aprobar el cambio",
      footer:
        "¿No lo pediste? No uses el enlace y cambia tu contraseña. Puede que otra persona haya entrado en tu cuenta.",
    },
  },

  billing: {
    trialStarted: {
      subject: "Tus 4 días de Pro empiezan ahora · {brand}",
      heading: "Ya estás en Pro",
      body: [
        "Durante los próximos cuatro días tienes todo abierto: el plan completo, el tutor y {evaluations} proyectos corregidos.",
        "El {renewsOn} pasa a costar {price} al mes. Cancela antes y no pagas nada más que los {trialPrice} que ya pagaste.",
        "La forma más rápida de saber si esto te funciona es entregar algo. Lo demás aquí no es evidencia.",
      ],
      action: "Entregar algo",
      footer: "Puedes cancelar en dos clics desde tu cuenta, cuando quieras.",
    },

    trialEnding: {
      subject: "Tu prueba se renueva mañana · {brand}",
      heading: "Mañana esto pasa a {price} al mes",
      body: [
        "Tus cuatro días de Pro terminan el {renewsOn}, y entonces empieza la suscripción de {price} al mes.",
        "Si es lo que quieres, no tienes que hacer nada.",
        "Si no lo es, cancela ahora y conservas Pro hasta el {renewsOn} igualmente.",
      ],
      action: "Conservar o cancelar",
      footer:
        "Preferimos que canceles a que se te pase. Este correo existe para que nunca sea una sorpresa.",
    },

    trialConverted: {
      subject: "Ya estás en Pro · {brand}",
      heading: "Ya estás en Pro",
      body: [
        "Tu prueba se ha convertido en una suscripción de {price} al mes. El próximo cobro es el {renewsOn}.",
        "Son {evaluations} proyectos corregidos al mes, evaluados con los mismos criterios públicos y citando la evidencia de tu propio trabajo.",
      ],
      action: "Seguir donde lo dejaste",
      footer: "Las facturas y los datos de pago están en tu cuenta.",
    },

    paymentFailed: {
      subject: "No pudimos cobrar tu pago · {brand}",
      heading: "Ese pago no se completó",
      body: [
        "Tu tarjeta fue rechazada, que suele ser una fecha de caducidad y no algo de lo que preocuparse.",
        "Lo intentaremos otra vez en los próximos días. Mientras tanto no se detiene nada: conservas todo hasta que se resuelva.",
      ],
      action: "Actualizar la tarjeta",
      footer:
        "Si en un par de semanas sigue sin funcionar, la cuenta pasa a Free y no se pierde nada.",
    },

    cancelled: {
      subject: "Cancelado — conservas Pro hasta el {endsOn} · {brand}",
      heading: "Conservas Pro hasta el {endsOn}",
      body: [
        "No se cobrará nada más. Todo sigue funcionando hasta el {endsOn}, y después la cuenta pasa a Free.",
        "Tu registro de competencias se queda exactamente donde está. Todo lo que te han corregido sigue siendo tuyo.",
        "Gracias por decirnos el motivo: es la única forma de que esto mejore.",
      ],
      action: "Cambiar de idea",
      footer: "Vuelve cuando quieras. Tu evidencia te estará esperando.",
    },

    referralRewarded: {
      subject: "{friend} se ha unido — aquí tienes tus {days} días · {brand}",
      heading: "{days} días de Pro, invita la casa",
      body: [
        "{friend} se ha suscrito, así que los {days} días de Pro que te prometimos están en tu cuenta desde hoy.",
        "Nada que activar y nada que pagar. Simplemente corren hasta el {endsOn}.",
      ],
      action: "Aprovecharlos",
      footer: "Invita a alguien más y vuelve a pasar lo mismo.",
    },
  },

  operator: {
    welcome: {
      subject: "Te damos la bienvenida a {brand}, {name}",
      heading: "Te damos la bienvenida a {brand}",
      body: [
        "Hola {name}: gracias por registrarte.",
        "{brand} parte de una idea: no cuenta haber visto una lección, cuenta el trabajo que aguanta una corrección. Así que la forma más rápida de ver si te sirve es entregar algo.",
        "Si algo no se entiende, o no hace lo que esperabas, responde a este correo. Me llega directamente a mí.",
      ],
      action: "Retomar donde lo dejaste",
      signature: "— {sender}",
      footer:
        "Recibes este correo porque creaste una cuenta en {brand}. Responde cuando quieras.",
    },

    checkIn: {
      subject: "¿Cómo va {goal}?",
      heading: "¿Cómo va?",
      body: [
        "Hola {name}: te propusiste trabajar en {goal} y llevas un tiempo sin aparecer.",
        "Sin reproches: me interesa de verdad saber si se cruzó algo o si el plan que construimos sencillamente no era el adecuado. Las dos respuestas sirven, y la segunda es un fallo que puedo arreglar.",
      ],
      action: "Ver hasta dónde llegaste",
      signature: "— {sender}",
      footer:
        "Recibes este correo porque tienes un objetivo activo en {brand}. Dime que pare y paro.",
    },

    packReady: {
      subject: "{topic} ya está en {brand}",
      heading: "{topic} ya está listo",
      body: [
        "Hola {name}: pediste {topic} y ya está construido: un mapa de habilidades, trabajo corregido y un plan que se adapta a lo que ya puedes demostrar.",
        "Empieza con un diagnóstico corto en lugar de con la lección uno, así que todo lo que ya sepas te lo saltas.",
      ],
      action: "Empezar {topic}",
      signature: "— {sender}",
      footer: "Recibes este correo porque pediste este tema.",
    },

    reply: {
      subject: "Re: {subject}",
      heading: "",
      body: ["Hola {name}:", "{message}"],
      signature: "— {sender}, {brand}",
      footer: "Responde a este correo y nos llega directamente.",
    },

    resolved: {
      subject: "Re: {subject}",
      heading: "",
      body: [
        "Hola {name}:",
        "{message}",
        "Lo doy por resuelto por nuestra parte, pero si sigue sin funcionar, responde y lo reabrimos.",
      ],
      signature: "— {sender}, {brand}",
      footer: "Responde a este correo y nos llega directamente.",
    },
  },
};
