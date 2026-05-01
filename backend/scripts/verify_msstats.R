#!/usr/bin/env Rscript
#
# Verify MSstats Package Installation
#
# Checks that MSstats and MSstatsConvert packages are installed.
# Exits with code 0 if all packages are available, 1 otherwise.
#
# Usage: Rscript verify_msstats.R

cat("Verifying MSstats installation for Proteomics Visualization Web App\n")
cat("=====================================================================\n\n")

# List of required MSstats packages
required_packages <- c(
    "MSstats",
    "MSstatsConvert"
)

missing_packages <- c()
installed_packages <- c()

# Check each package
for (pkg in required_packages) {
    if (require(pkg, character.only = TRUE, quietly = TRUE)) {
        cat("[OK]", pkg, "- installed\n")
        installed_packages <- c(installed_packages, pkg)
    } else {
        cat("[MISSING]", pkg, "- NOT installed\n")
        missing_packages <- c(missing_packages, pkg)
    }
}

cat("\n=====================================================================\n")

# Report results
if (length(missing_packages) == 0) {
    cat("\nSUCCESS: All required MSstats packages are installed.\n")
    cat("Installed packages:", paste(installed_packages, collapse = ", "), "\n")

    # Print version information
    cat("\nPackage versions:\n")
    for (pkg in installed_packages) {
        ver <- packageVersion(pkg)
        cat("  ", pkg, ":", as.character(ver), "\n")
    }

    quit(status = 0)
} else {
    cat("\nERROR: Missing required packages:\n")
    for (pkg in missing_packages) {
        cat("  -", pkg, "\n")
    }

    cat("\nTo install missing packages, run:\n")
    cat("  C:/Program Files/R/R-4.5.1/bin/x64/Rscript.exe -e \"BiocManager::install('", paste(missing_packages, collapse = "', '"), "', ask=FALSE, update='basic')\"\n")

    quit(status = 1)
}
