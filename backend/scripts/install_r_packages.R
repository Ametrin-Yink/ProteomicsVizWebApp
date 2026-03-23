# Install Bioconductor packages
if (!require("BiocManager", quietly = TRUE))
    install.packages("BiocManager", repos = "https://cloud.r-project.org/")

BiocManager::install(c("msqrob2", "QFeatures", "limma"), ask = FALSE)

cat("Installation complete\n")
