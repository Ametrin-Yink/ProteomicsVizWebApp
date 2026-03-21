library(msqrob2)

# Test different contrast formats
coefs <- c("(Intercept)", "conditionTreatment")

# Try different formats
tryCatch({
    L1 <- makeContrast("conditionTreatment", coefs)
    cat("Format 1 worked:\n")
    print(L1)
}, error = function(e) cat("Format 1 failed:", conditionMessage(e), "\n"))

tryCatch({
    L2 <- makeContrast("conditionTreatment=0", coefs)
    cat("Format 2 worked:\n")
    print(L2)
}, error = function(e) cat("Format 2 failed:", conditionMessage(e), "\n"))

tryCatch({
    L3 <- makeContrast(c("conditionTreatment"), coefs)
    cat("Format 3 worked:\n")
    print(L3)
}, error = function(e) cat("Format 3 failed:", conditionMessage(e), "\n"))
