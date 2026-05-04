# Install Bioconductor packages
if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager", repos = "https://cloud.r-project.org/")

# NOTE: No version pinning. Bioconductor packages may have API changes across versions.
# Consider adding renv.lock for reproducible environments in production.
BiocManager::install(c("msqrob2", "QFeatures", "limma"), ask = FALSE)

cat("Installation complete\n")
