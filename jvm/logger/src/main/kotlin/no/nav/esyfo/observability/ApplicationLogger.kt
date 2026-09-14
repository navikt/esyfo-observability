package no.nav.esyfo.observability

import org.slf4j.Logger
import org.slf4j.event.Level

/** Binds application logging to an existing logger without changing its configuration. */
public fun createLogger(logger: Logger): ApplicationLogger = ApplicationLogger(logger)

/** Named events own their level; plain diagnostics are limited to INFO and DEBUG. */
public class ApplicationLogger internal constructor(private val logger: Logger) {
    public fun <C> event(definition: Event<C>, context: C, cause: Throwable? = null): Unit =
        logger.emit(definition, context, cause)

    public fun event(definition: Event<Unit>, cause: Throwable? = null): Unit =
        logger.emit(definition, cause)

    public fun info(message: String, fields: Map<String, Any?> = emptyMap()): Unit =
        diagnostic(Level.INFO, message, fields)

    public fun debug(message: String, fields: Map<String, Any?> = emptyMap()): Unit =
        diagnostic(Level.DEBUG, message, fields)

    private fun diagnostic(level: Level, message: String, fields: Map<String, Any?>) {
        if (!logger.isEnabledForLevel(level)) return
        require(message.isNotBlank()) { "Diagnostic message must not be blank" }
        require(fields.keys.none { it in RESERVED_FIELDS || it == "rejection_reason" }) {
            "Diagnostic fields must not replace event, logger, or trace fields"
        }
        require(fields.values.all(::isDiagnosticValue)) { "Diagnostic fields must be primitive values or null" }
        val builder = logger.atLevel(level)
        fields.forEach { (name, value) -> value?.let { builder.addKeyValue(name, it) } }
        builder.log(message)
    }
}

private fun isDiagnosticValue(value: Any?): Boolean = when (value) {
    null, is String, is Boolean, is Byte, is Short, is Int, is Long -> true
    is Float -> value.isFinite()
    is Double -> value.isFinite()
    else -> false
}
