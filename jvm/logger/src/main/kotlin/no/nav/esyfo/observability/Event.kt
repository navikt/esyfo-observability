package no.nav.esyfo.observability

import org.slf4j.Logger
import org.slf4j.event.Level

/** A local event definition. Null field values are absent metadata; nested values are unchanged. */
public class Event<C>(
    public val name: String,
    public val level: Level,
    public val message: String,
    public val operation: String? = null,
    public val errorCode: String? = null,
    fields: Map<String, (C) -> Any?> = emptyMap(),
    public val errorCodeFrom: ((C) -> String?)? = null,
) {
    internal val contextFields: Map<String, (C) -> Any?> = fields.toMap()

    init {
        require(name.matches(EVENT_VALUE_PATTERN)) { "Event name must be a stable lowercase identifier" }
        require(operation == null || operation.matches(EVENT_VALUE_PATTERN)) { "Operation must be a stable lowercase identifier" }
        require(errorCode == null || errorCode.matches(CODE_VALUE_PATTERN)) { "Error code must be a stable uppercase code" }
        require(errorCode == null || errorCodeFrom == null) { "Use either errorCode or errorCodeFrom, not both" }
        require(message.isNotBlank()) { "Event message must not be blank" }
        require(level in setOf(Level.INFO, Level.WARN, Level.ERROR)) { "Event level must be INFO, WARN, or ERROR" }
        require(fields.keys.none { it in RESERVED_FIELDS }) {
            "Context fields must not replace event, logger, or trace fields"
        }
    }
}

private val EVENT_VALUE_PATTERN = Regex("^[a-z][a-z0-9_.-]{0,79}$")
private val CODE_VALUE_PATTERN = Regex("^[A-Z][A-Z0-9_]{1,79}$")

internal val RESERVED_FIELDS: Set<String> = setOf(
    "event_type", "operation", "error_code", "level", "level_value", "message",
    "@timestamp", "@version", "timestamp", "logger_name", "thread_name", "stack_trace",
    "trace_id", "span_id", "trace_flags", "traceId", "spanId",
)

/** Emits an event with no additional context. */
public fun Logger.emit(event: Event<Unit>, cause: Throwable? = null): Unit = emit(event, Unit, cause)

/** Emits once through the supplied logger, retaining its configuration and the original cause. */
public fun <C> Logger.emit(event: Event<C>, context: C, cause: Throwable? = null) {
    if (!isEnabledForLevel(event.level)) return
    val errorCode = event.errorCode ?: event.errorCodeFrom?.invoke(context)
    require(errorCode == null || errorCode.matches(CODE_VALUE_PATTERN)) { "Error code must be a stable uppercase code" }
    val builder = atLevel(event.level)
        .addKeyValue("event_type", event.name)
    event.operation?.let { builder.addKeyValue("operation", it) }
    errorCode?.let { builder.addKeyValue("error_code", it) }
    event.contextFields.forEach { (name, value) -> value(context)?.let { builder.addKeyValue(name, it) } }
    cause?.let(builder::setCause)
    builder.log(event.message)
}
