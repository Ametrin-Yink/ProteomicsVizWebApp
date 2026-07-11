# Install all R packages required by the proteomics pipeline.
#
# Usage: Rscript backend/scripts/install_r_packages.R
#
# Bioconductor packages are installed via BiocManager.
# NOTE: No version pinning. Consider using renv.lock for reproducible environments.

if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager", repos = "https://cloud.r-project.org/")

# ── Bioconductor packages ──────────────────────────────────────────────────
bioc_packages <- c(
    "msqrob2",
    "QFeatures",
    "limma",
    "MSstats",
    "MSstatsConvert",
    "MSstatsPTM",
    "MSstatsBioNet",
    "Biostrings",
    "BiocParallel",
    "SummarizedExperiment"
)
BiocManager::install(bioc_packages, ask = FALSE)

# ── CRAN packages ────────────────────────────────────────────────────────
cran_packages <- c("data.table", "matrixStats", "jsonlite", "arrow")
install.packages(cran_packages, repos = "https://cloud.r-project.org/")

cat("All pipeline R packages installed.\n")
