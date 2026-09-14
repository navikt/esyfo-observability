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
        val prepared = mutableMapOf<String, Any>()
        var contextInvalid = false
        val iteration = readLogContext {
            fields.entries.forEach { entry ->
                val field = readLogContext { entry.key to entry.value }
                if (field.isFailure) contextInvalid = true
                field.getOrNull()?.let { (name, value) ->
                    if (name in RESERVED_FIELDS || name == "rejection_reason" || !isDiagnosticValue(value)) {
                        contextInvalid = true
                    } else {
                        value?.let { prepared[name] = it }
                    }
                }
            }
        }
        if (iteration.isFailure) contextInvalid = true
        val builder = logger.atLevel(level)
        prepared.forEach { (name, value) -> builder.addKeyValue(name, value) }
        if (contextInvalid) builder.addKeyValue(INVALID_CONTEXT_FIELD, true)
        builder.log(message)
    }
}

private fun isDiagnosticValue(value: Any?): Boolean = when (value) {
    null, is String, is Boolean, is Byte, is Short, is Int, is Long -> true
    is Float -> value.isFinite()
    is Double -> value.isFinite()
    else -> false
}
