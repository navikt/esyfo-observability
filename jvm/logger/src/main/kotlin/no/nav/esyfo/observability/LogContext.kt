package no.nav.esyfo.observability

import java.util.concurrent.CancellationException

internal const val INVALID_CONTEXT_FIELD = "logging_context_invalid"

/** Only metadata preparation is recoverable; control-flow exceptions and JVM errors must propagate. */
internal fun <T> readLogContext(read: () -> T): Result<T> = try {
    Result.success(read())
} catch (failure: Exception) {
    if (failure is CancellationException || failure is InterruptedException) throw failure
    Result.failure(failure)
}
