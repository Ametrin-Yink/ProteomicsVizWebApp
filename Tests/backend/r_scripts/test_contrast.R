library(msqrob2)

# Check makeContrast function
print(args(makeContrast))

# Example from documentation
coefs <- c("(Intercept)", "conditionTreatment")
L <- makeContrast("conditionTreatment", coefs)
print(L)
