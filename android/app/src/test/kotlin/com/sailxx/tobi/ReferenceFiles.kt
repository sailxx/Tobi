package com.sailxx.tobi

import java.io.File

/** Locates the desktop reference sources (src/..., the repository root) so tests can compare against them. */
object ReferenceFiles {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "src/core/pills.ts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root with src/core/pills.ts not found from ${System.getProperty("user.dir")}")
    }

    /** The old paths of Coucou's repository ("windows/src/...", "NotchBuddy/Resources/...") still work: they are mapped to Tobi's layout. */
    private fun map(path: String): String = when {
        path == "windows" -> ""
        path.startsWith("windows/") -> path.removePrefix("windows/")
        path.startsWith("NotchBuddy/Resources/") -> path.removePrefix("NotchBuddy/Resources/")
        else -> path
    }

    fun read(path: String): String = File(repoRoot(), map(path)).readText()
    fun file(path: String): File = File(repoRoot(), map(path))
}
