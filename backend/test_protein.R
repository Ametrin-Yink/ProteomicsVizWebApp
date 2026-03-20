psm_data <- read.delim('sessions/224c8838-08ea-4cbc-89b4-0a7cfc29ddf3/results/PSM_Abundances.tsv', sep='\t', stringsAsFactors=FALSE)
cat('Rows with empty Master_Protein_Accessions:', sum(psm_data$Master_Protein_Accessions == '' | is.na(psm_data$Master_Protein_Accessions)), '\n')
cat('Unique proteins:', length(unique(psm_data$Master_Protein_Accessions)), '\n')
cat('Sample Master_Protein_Accessions:', head(psm_data$Master_Protein_Accessions), '\n')
