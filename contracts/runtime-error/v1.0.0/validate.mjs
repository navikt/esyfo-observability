import { readFileSync } from "node:fs";
import Ajv from "ajv";

const catalogFields = [
	"event_type",
	"error_code",
	"operation",
	"exception_type",
	"rejection_reason",
];
const usage =
	"Bruk: node validate.mjs --catalog katalog.json [--format ndjson|json] [--expect-count N] <fil|-> [...]";

function options(args) {
	const result = { format: "ndjson", files: [] };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (["--catalog", "--format", "--expect-count"].includes(arg)) {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(usage);
			const key = arg.slice(2);
			if (key !== "format" && Object.hasOwn(result, key))
				throw new Error(usage);
			result[key] = value;
		} else if (arg === "-" || !arg.startsWith("-")) {
			result.files.push(arg);
		} else {
			throw new Error(usage);
		}
	}
	if (
		!result.catalog ||
		!result.files.length ||
		!["ndjson", "json"].includes(result.format)
	)
		throw new Error(usage);
	if (result.files.filter((file) => file === "-").length > 1)
		throw new Error("stdin kan bare leses én gang.");
	if (
		result["expect-count"] !== undefined &&
		!/^[1-9][0-9]*$/.test(result["expect-count"])
	)
		throw new Error("--expect-count må være et positivt heltall.");
	return result;
}

function read(path) {
	try {
		return readFileSync(path === "-" ? 0 : path, "utf8");
	} catch {
		throw new Error(`Kunne ikke lese ${path === "-" ? "stdin" : path}.`);
	}
}

function parse(input, location) {
	try {
		return JSON.parse(input);
	} catch {
		throw new Error(`${location}: ugyldig JSON; innholdet vises ikke.`);
	}
}

function validators(catalogPath) {
	const schema = parse(
		read(new URL("./schema.json", import.meta.url)),
		"schema.json",
	);
	const catalog = parse(read(catalogPath), "Lokal katalog");
	const ajv = new Ajv({ allErrors: true, strict: true });
	const validateCatalog = ajv.compile({
		type: "object",
		required: ["event_type"],
		additionalProperties: false,
		properties: Object.fromEntries(
			catalogFields.map((field) => [
				field,
				{
					type: "array",
					minItems: 1,
					uniqueItems: true,
					items: schema.properties[field],
				},
			]),
		),
	});
	if (!validateCatalog(catalog))
		throw new Error(
			"Ugyldig lokal katalog: bruk event_type og eventuelt error_code, operation, exception_type og rejection_reason som ikke-tomme lister av gyldige konstanter.",
		);
	return { catalog, validate: ajv.compile(schema) };
}

function main() {
	const args = options(process.argv.slice(2));
	const { catalog, validate } = validators(args.catalog);
	let count = 0;
	let failures = 0;
	for (const file of args.files) {
		const input = read(file);
		const lines = args.format === "json" ? [input] : input.split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			if (!line.trim()) continue;
			count += 1;
			const location = `${file === "-" ? "stdin" : file}:${index + 1}`;
			let record;
			try {
				record = parse(line, location);
			} catch (error) {
				console.error(error.message);
				failures += 1;
				continue;
			}
			if (!validate(record)) {
				for (const error of validate.errors) {
					console.error(
						`${location} ${error.instancePath || "/"}: ${error.message}`,
					);
				}
				failures += 1;
				continue;
			}
			for (const field of catalogFields) {
				if (
					Object.hasOwn(record, field) &&
					!catalog[field]?.includes(record[field])
				) {
					console.error(
						`${location} /${field}: verdien finnes ikke i lokal katalog.`,
					);
					failures += 1;
				}
			}
		}
	}
	if (count === 0)
		throw new Error(
			"Ingen logghendelser å validere. Kontroller at testen faktisk fanger logger.",
		);
	if (
		args["expect-count"] !== undefined &&
		count !== Number(args["expect-count"])
	) {
		console.error(
			`Forventet ${args["expect-count"]} logghendelse(r), fant ${count}.`,
		);
		failures += 1;
	}
	if (failures) {
		process.exitCode = 1;
	} else {
		console.log(
			`${count} logghendelse(r) følger kontrakten og den lokale katalogen.`,
		);
	}
}

try {
	main();
} catch (error) {
	console.error(error.message);
	process.exitCode = 2;
}
