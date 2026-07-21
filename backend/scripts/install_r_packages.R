# Install all R packages required by the proteomics pipeline.
#
# Usage: Rscript backend/scripts/install_r_packages.R
#
# Bioconductor packages are installed via BiocManager.
# NOTE: No version pinning. Consider using renv.lock for reproducible environments.

if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager", repos = "https://cloud.r-project.org/")

# MSstats currently imports log4r. CRAN archived log4r in July 2026, so new R
# installations may need the final archived release. Installing from source on
# Windows requires the matching Rtools toolchain.
if (!requireNamespace("log4r", quietly = TRUE)) {
    install.packages(
        "https://cran.r-project.org/src/contrib/Archive/log4r/log4r_0.4.4.tar.gz",
        repos = NULL,
        type = "source"
    )
}

if (!requireNamespace("log4r", quietly = TRUE))
    stop("log4r installation failed; install Rtools and rerun this script")

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

# MSstats 4.18.1 requests C++11, but its current RcppArmadillo dependency
# requires C++14 when packages are built from source.
local({
    makevars <- tempfile("Makevars-")
    old_makevars <- Sys.getenv("R_MAKEVARS_USER", unset = NA_character_)
    on.exit({
        if (is.na(old_makevars)) {
            Sys.unsetenv("R_MAKEVARS_USER")
        } else {
            Sys.setenv(R_MAKEVARS_USER = old_makevars)
        }
        unlink(makevars)
    })
    writeLines("CXX11STD = -std=gnu++14", makevars)
    Sys.setenv(R_MAKEVARS_USER = makevars)
    BiocManager::install(bioc_packages, ask = FALSE, update = FALSE)
})

# ── CRAN packages ────────────────────────────────────────────────────────
cran_packages <- c("data.table", "matrixStats", "jsonlite", "arrow", "tzdb")
missing_cran_packages <- cran_packages[
    !vapply(cran_packages, requireNamespace, logical(1), quietly = TRUE)
]
if (length(missing_cran_packages) > 0) {
    install.packages(missing_cran_packages, repos = "https://cloud.r-project.org/")
}

required_packages <- c(bioc_packages, cran_packages)
missing_packages <- required_packages[
    !vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)
]

if (length(missing_packages) > 0)
    stop(paste("Missing required R packages:", paste(missing_packages, collapse = ", ")))

cat("All pipeline R packages installed.\n")
