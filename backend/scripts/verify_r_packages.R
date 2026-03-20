#!/usr/bin/env Rscript
#
# Verify R Package Installation
#
# Checks that all required Bioconductor packages are installed.
# Exits with code 0 if all packages are available, 1 otherwise.
#
# Usage: Rscript verify_r_packages.R

cat("Verifying R package installation for Proteomics Visualization Web App\n")
cat("=====================================================================\n\n")

# List of required packages
required_packages <- c(
    "msqrob2",
    "QFeatures",
    "limma",
    "SummarizedExperiment",
    "MsCoreUtils"
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
    cat("\nSUCCESS: All required R packages are installed.\n")
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
    cat("  Rscript -e \"if (!require('BiocManager', quietly = TRUE)) install.packages('BiocManager')\"\n")
    cat("  Rscript -e \"BiocManager::install(c('", paste(missing_packages, collapse = "', '"), "'))\"\n")
    
    quit(status = 1)
}
