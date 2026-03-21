psm_data <- read.delim('sessions/224c8838-08ea-4cbc-89b4-0a7cfc29ddf3/results/PSM_Abundances.tsv', sep='\t', stringsAsFactors=FALSE)
psm_agg <- aggregate(Abundance ~ Unique_PSM + Sample_Origination, data=psm_data[, c('Unique_PSM', 'Sample_Origination', 'Abundance')], FUN=sum)
cat('Original Unique_PSM:', head(psm_agg$Unique_PSM), '\n')
cat('After make.names:', head(make.names(psm_agg$Unique_PSM, unique=TRUE)), '\n')
