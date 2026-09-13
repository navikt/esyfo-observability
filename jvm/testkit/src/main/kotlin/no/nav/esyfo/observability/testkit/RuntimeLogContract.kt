package no.nav.esyfo.observability.testkit

import com.fasterxml.jackson.core.JsonFactory
import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.core.StreamReadFeature
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SpecificationVersion
import no.nav.esyfo.observability.Event

/** A validation diagnostic; serialized log content is never included in its message. */
public data class LogViolation(public val record: Int?, public val message: String)

/** Validates actual serialized runtime events. It does not decide which business outcomes to log. */
public class RuntimeLogContract(catalog: Map<String, Set<String>>) {
    public companion object {
        /** Derives fixed metadata from real definitions; dynamic closed values come from local enums. */
        public fun forEvents(
            vararg events: Event<*>,
            rejectionReasons: Set<String> = emptySet(),
            exceptionTypes: Set<String> = emptySet(),
        ): RuntimeLogContract = RuntimeLogContract(buildMap {
            put("event_type", events.map { it.name }.toSet())
            val operations = events.mapNotNull { it.operation }.toSet()
            val errorCodes = events.mapNotNull { it.errorCode }.toSet()
            if (operations.isNotEmpty()) put("operation", operations)
            if (errorCodes.isNotEmpty()) put("error_code", errorCodes)
            if (rejectionReasons.isNotEmpty()) put("rejection_reason", rejectionReasons)
            if (exceptionTypes.isNotEmpty()) put("exception_type", exceptionTypes)
        })
    }

    private val mapper = ObjectMapper(
        JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build(),
    ).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
    private val registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_7)
    private val schemaNode = requireNotNull(javaClass.getResourceAsStream(SCHEMA_RESOURCE)) {
        "The packaged runtime-error schema is missing"
    }.use { mapper.readTree(it) }
    private val schema = registry.getSchema(schemaNode)
    private val localCatalog = catalog.mapValues { (_, values) -> values.toSet() }

    init {
        val catalogNode = mapper.valueToTree<JsonNode>(localCatalog)
        val catalogSchema = mapper.createObjectNode().apply {
            put("type", "object")
            putArray("required").add("event_type")
            put("additionalProperties", false)
            putObject("properties").apply {
                CATALOG_FIELDS.forEach { field ->
                    putObject(field).apply {
                        put("type", "array")
                        put("minItems", 1)
                        put("uniqueItems", true)
                        set<JsonNode>("items", schemaNode.path("properties").path(field))
                    }
                }
            }
        }
        require(registry.getSchema(catalogSchema).validate(catalogNode).isEmpty()) {
            "Catalog must contain event_type and only supported non-empty sets of valid constants"
        }
    }

    public fun validate(records: List<String>, expectedCount: Int? = null): List<LogViolation> {
        require(expectedCount == null || expectedCount >= 0) { "Expected count must be non-negative" }
        return buildList {
            if (records.isEmpty() && expectedCount != 0) add(LogViolation(null, "No log records captured"))
            if (expectedCount != null && records.size != expectedCount) {
                add(LogViolation(null, "Expected $expectedCount records, found ${records.size}"))
            }
            records.forEachIndexed { index, raw ->
                val record = try {
                    mapper.readTree(raw)
                } catch (_: JsonProcessingException) {
                    add(LogViolation(index + 1, "Invalid JSON, duplicate fields, or trailing content"))
                    return@forEachIndexed
                }
                val errors = schema.validate(record)
                errors.forEach { error ->
                    add(LogViolation(index + 1, "Schema ${error.keyword} violation at ${error.instanceLocation}"))
                }
                if (errors.isEmpty()) {
                    CATALOG_FIELDS.filter(record::has).forEach { field ->
                        if (record.path(field).asText() !in localCatalog[field].orEmpty()) {
                            add(LogViolation(index + 1, "$field is not in the application's closed catalog"))
                        }
                    }
                }
            }
        }
    }

    public fun assertValid(records: List<String>, expectedCount: Int? = null) {
        val violations = validate(records, expectedCount)
        if (violations.isNotEmpty()) {
            throw AssertionError(violations.joinToString("\n") { "${it.record ?: "capture"}: ${it.message}" })
        }
    }
}

private const val SCHEMA_RESOURCE = "/contracts/runtime-error/v1.0.0/schema.json"
private val CATALOG_FIELDS = setOf("event_type", "error_code", "operation", "exception_type", "rejection_reason")
