package no.nav.esyfo.observability

import java.sql.SQLException
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.CancellationException

private const val MAX_CAUSE_DEPTH = 16
private val EXCEPTION_TYPE_PATTERN = Regex("^([A-Za-z][A-Za-z0-9_\$]{0,143})?(Error|Exception)$")
private val SQL_STATE_PATTERN = Regex("^[A-Z0-9]{5}$")

/** Returns this exception and up to 15 causes, stopping at identity cycles. */
public fun Throwable.causeChain(): List<Throwable> {
    val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
    return buildList {
        var current: Throwable? = this@causeChain
        while (current != null && size < MAX_CAUSE_DEPTH && seen.add(current)) {
            add(current)
            current = current.cause
        }
    }
}

/** Returns the first contract-valid class category in the superclass chain, or `Exception`. */
public fun Throwable.exceptionType(): String =
    generateSequence<Class<*>>(javaClass) { it.superclass }
        .map { it.name.substringAfterLast('.') }
        .firstOrNull(EXCEPTION_TYPE_PATTERN::matches) ?: "Exception"

/** Returns the category of the deepest reachable cause. */
public fun Throwable.causeType(): String = causeChain().last().exceptionType()

/** Returns the first valid SQL state in the bounded cause chain, if any. */
public fun Throwable.sqlState(): String? =
    causeChain().filterIsInstance<SQLException>()
        .mapNotNull { it.sqlState }
        .firstOrNull(SQL_STATE_PATTERN::matches)

/** Returns only HTTP status values permitted by the runtime-error contract. */
public fun validUpstreamStatus(status: Int?): Int? = status?.takeIf { it in 100..599 }

/**
 * Recognizes cancellation or interruption anywhere in the bounded cause chain.
 * Hele den avgrensede årsakskjeden søkes; også kansellering innpakket i
 * `ExecutionException` regnes som kansellering av gjeldende flyt. Bruk ved
 * grenser der dette skal propageres uten terminal feillogg; ellers sjekk direkte type.
 */
public fun Throwable.isCancellation(): Boolean =
    causeChain().any { it is CancellationException || it is InterruptedException }

/**
 * Rethrows the original cancellation, restoring the thread interrupt flag for interruptions.
 * Hele den avgrensede årsakskjeden søkes; også en innpakket
 * `TimeoutCancellationException` propageres uten terminal feillogg. Bruk
 * ved grenser der dette er ønsket; ellers sjekk direkte type.
 */
public fun Throwable.rethrowIfCancelled() {
    val cancellation = causeChain().firstOrNull { it is CancellationException || it is InterruptedException }
    if (cancellation is InterruptedException) Thread.currentThread().interrupt()
    if (cancellation != null) throw cancellation
}

/**
 * Supplies contract fields for an [Event]. Null values are omitted by the event logger.
 * The original cause is not copied, scrubbed or passed to the logger by these readers.
 */
public fun <C> failureFields(
    cause: (C) -> Throwable?,
    upstreamStatus: (C) -> Int? = { null },
): Map<String, (C) -> Any?> = mapOf(
    "exception_type" to { context -> cause(context)?.exceptionType() },
    "cause_type" to { context -> cause(context)?.causeType() },
    "sql_state" to { context -> cause(context)?.sqlState() },
    "upstream_status" to { context -> validUpstreamStatus(upstreamStatus(context)) },
)
