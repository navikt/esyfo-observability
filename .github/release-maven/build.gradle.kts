import org.gradle.api.publish.maven.tasks.GenerateMavenPom

plugins { `maven-publish` }

val releaseVersion = providers.gradleProperty("releaseVersion").get()
require(releaseVersion.matches(Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)"))) {
    "releaseVersion must be a stable semantic version"
}
val releaseDirectory = file(providers.gradleProperty("releaseDirectory").get())
val registry = "https://maven.pkg.github.com/navikt/esyfo-observability"
val releaseRepository = providers.gradleProperty("releaseRepository").getOrElse(registry)
require(releaseRepository == registry || releaseRepository.startsWith("file:")) {
    "Only GitHub Packages or a local verification repository is supported"
}

publishing {
    repositories {
        maven {
            name = "Release"
            url = uri(releaseRepository)
            if (releaseRepository == registry) {
                credentials {
                    username = providers.environmentVariable("GITHUB_ACTOR").get()
                    password = providers.environmentVariable("GITHUB_TOKEN").get()
                }
            }
        }
    }
    for ((publicationName, name) in listOf("Logger" to "esyfo-logger", "Testkit" to "esyfo-logger-testkit")) {
        val base = releaseDirectory.resolve("no/nav/esyfo/observability/$name/$releaseVersion/$name-$releaseVersion")
        for (suffix in listOf(".jar", "-sources.jar", ".module", ".pom")) {
            require(file("$base$suffix").isFile) { "Missing verified artifact: $base$suffix" }
        }
        publications.create<MavenPublication>(publicationName) {
            groupId = "no.nav.esyfo.observability"
            artifactId = name
            version = releaseVersion
            artifact(file("$base.jar"))
            artifact(file("$base-sources.jar")) { classifier = "sources" }
            artifact(file("$base.module")) { extension = "module" }
        }
        // Preserve the tested POM as well as the JARs and Gradle metadata.
        tasks.named<GenerateMavenPom>("generatePomFileFor${publicationName}Publication") {
            destination = file("$base.pom")
            enabled = false
        }
    }
}
