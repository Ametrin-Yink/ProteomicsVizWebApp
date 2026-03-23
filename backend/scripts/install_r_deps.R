# Install missing R dependencies
if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager", repos = "https://cloud.r-project.org/")

# Install stringi and other common dependencies
cat("Installing stringi...\n")
install.packages("stringi", repos = "https://cloud.r-project.org/", dependencies = TRUE)

# Re-install QFeatures to ensure all deps are present
cat("Re-installing QFeatures with dependencies...\n")
BiocManager::install("QFeatures", dependencies = TRUE, ask = FALSE)

cat("Dependencies installed\n")
