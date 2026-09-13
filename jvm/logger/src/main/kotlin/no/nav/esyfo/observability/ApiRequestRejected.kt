package no.nav.esyfo.observability

import org.slf4j.event.Level

/**
 * A request finally rejected by the application. Emit only after any successful fallback is ruled out.
 * Operation and rejection reasons remain code-owned definitions in the consuming application.
 */
public fun <C> apiRequestRejected(
    operation: String,
    message: String,
    reason: (C) -> String,
    errorCode: String? = null,
    fields: Map<String, (C) -> Any?> = emptyMap(),
): Event<C> {
    require("rejection_reason" !in fields) { "Use the reason parameter for rejection_reason" }
    return Event(
        name = "api_request_rejected",
        level = Level.WARN,
        message = message,
        operation = operation,
        errorCode = errorCode,
        fields = fields + ("rejection_reason" to reason),
    )
}
